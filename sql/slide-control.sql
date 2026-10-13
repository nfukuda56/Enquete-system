-- スライド連携用：操作トークンによる設問切り替え
--
-- 背景:
--   admin_state の UPDATE は RLS でイベント所有者に限定されているため、
--   外部スライド（trigger.html / embed.html）から設問を切り替えるには
--   「同一ブラウザプロファイルにログイン済みセッションがあること」が必要だった。
--   この制約により、スライドを伝心くんと同一オリジンに置かねばならず、
--   ローカルファイルのスライドで運用できない（＝回線に完全依存する）。
--
--   読み取りは既に anon で通る（events / questions / responses の SELECT ポリシー）。
--   認証を要求しているのは admin_state の書き込み1点だけなので、
--   そこだけをトークン検証付きの関数経由で解放する。
--
-- トークンを events 列にしない理由:
--   events の SELECT ポリシーは anon に対して「is_active = true の行は全件可」であり、
--   app.js は select('*') で読んでいる。events に列を足すと参加者が操作トークンを
--   読み出せてしまうため、anon から一切読めない別テーブルに分離する。
--
-- 冪等。Supabase の SQL エディタで繰り返し実行してよい。

-- ============================================================
-- 1. 操作トークンテーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS event_control_tokens (
    event_id   BIGINT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
    token      TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_control_tokens_token
    ON event_control_tokens(token);

COMMENT ON TABLE event_control_tokens IS
    'スライド連携用の操作トークン。参加者（anon）からは読めない。public_token とは別の値';

-- 既存イベントに発行
INSERT INTO event_control_tokens (event_id, token)
SELECT e.id,
       replace(replace(encode(gen_random_bytes(12), 'base64'), '/', '_'), '+', '-')
  FROM events e
 WHERE NOT EXISTS (
       SELECT 1 FROM event_control_tokens t WHERE t.event_id = e.id
 );

-- 新規イベントにも自動発行
CREATE OR REPLACE FUNCTION issue_event_control_token()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO event_control_tokens (event_id, token)
        VALUES (NEW.id,
                replace(replace(encode(gen_random_bytes(12), 'base64'), '/', '_'), '+', '-'))
        ON CONFLICT (event_id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_issue_event_control_token ON events;
CREATE TRIGGER trg_issue_event_control_token
    AFTER INSERT ON events
    FOR EACH ROW EXECUTE FUNCTION issue_event_control_token();

-- トリガ関数は PostgREST から直接呼べてはいけない。
-- 新規関数は既定で PUBLIC に EXECUTE が付くため明示的に剥がす
REVOKE ALL ON FUNCTION issue_event_control_token() FROM PUBLIC;
REVOKE ALL ON FUNCTION issue_event_control_token() FROM anon, authenticated;

-- ============================================================
-- 2. RLS: anon は読めない。所有者とシステムオーナーのみ参照可
-- ============================================================
ALTER TABLE event_control_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_control_tokens_select_by_owner" ON event_control_tokens;
CREATE POLICY "event_control_tokens_select_by_owner" ON event_control_tokens FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM events e
        WHERE e.id = event_control_tokens.event_id
        AND (
            EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role = 'system_owner')
            OR e.owner_id = auth.uid()
        )
    )
);

-- INSERT / UPDATE / DELETE のポリシーは作らない（= 誰も直接書けない）。
-- 発行はトリガと下記の security definer 関数のみが行う。

-- RLS で行は守られるが、Supabase は既定で public スキーマの全テーブルに
-- anon の SELECT 権限を付けるため、テーブル自体が GraphQL スキーマに露出する。
-- トークン表は anon が触る理由が一切ないので、テーブル権限ごと剥がす。
-- （authenticated は残す。所有者が自分のトークンを参照する用途があるため）
REVOKE ALL ON TABLE event_control_tokens FROM anon;

-- ============================================================
-- 3. 設問切り替え関数
-- ============================================================
-- security definer で RLS をバイパスし、代わりに操作トークンを関数内で検証する。
-- 戻り値で成否が分かるため、呼び出し側は失敗を検知して警告を出せる
-- （RLS 拒否は「0件更新で成功扱い」になり、無言で失敗するため）。
--
-- p_question_id = 0 は配信終了（待機画面に戻す）。

CREATE OR REPLACE FUNCTION set_current_question(
    p_control_token TEXT,
    p_question_id   BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event_id BIGINT;
BEGIN
    -- トークン検証。イベントを跨いだ操作はできない
    SELECT t.event_id INTO v_event_id
      FROM event_control_tokens t
      JOIN events e ON e.id = t.event_id
     WHERE t.token = p_control_token
       AND e.is_active = true;

    IF v_event_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
    END IF;

    -- 配信終了
    IF p_question_id = 0 THEN
        INSERT INTO admin_state (event_id, current_question_id, is_presenting, updated_at)
            VALUES (v_event_id, NULL, false, NOW())
            ON CONFLICT (event_id) DO UPDATE
                SET current_question_id = NULL,
                    is_presenting       = false,
                    updated_at          = NOW();

        RETURN jsonb_build_object(
            'ok', true, 'event_id', v_event_id, 'question_id', NULL, 'presenting', false
        );
    END IF;

    -- 指定された設問が、このイベントの有効な設問であることを確認
    IF NOT EXISTS (
        SELECT 1 FROM questions
        WHERE id = p_question_id
          AND event_id = v_event_id
          AND is_active = true
    ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'question_not_found');
    END IF;

    INSERT INTO admin_state (event_id, current_question_id, is_presenting, updated_at)
        VALUES (v_event_id, p_question_id, true, NOW())
        ON CONFLICT (event_id) DO UPDATE
            SET current_question_id = p_question_id,
                is_presenting       = true,
                updated_at          = NOW();

    RETURN jsonb_build_object(
        'ok', true, 'event_id', v_event_id, 'question_id', p_question_id, 'presenting', true
    );
END;
$$;

COMMENT ON FUNCTION set_current_question(TEXT, BIGINT) IS
    'スライド連携用。操作トークンを検証して admin_state.current_question_id を更新する。p_question_id=0 で配信終了';

REVOKE ALL ON FUNCTION set_current_question(TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_current_question(TEXT, BIGINT) TO anon, authenticated;

-- ============================================================
-- 4. 表示順で切り替える関数（PowerPoint 連携の互換用）
-- ============================================================
-- 既存の PowerPoint スライドは「1始まりの表示順」でリンクを張っている。
-- 設問IDを調べずに書けるので手書きには便利だが、sort_order を変更すると
-- 対応がずれる点は従来どおり。新規は set_current_question（ID指定）を推奨。

CREATE OR REPLACE FUNCTION set_current_question_by_order(
    p_control_token TEXT,
    p_order         INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event_id    BIGINT;
    v_question_id BIGINT;
BEGIN
    IF p_order = 0 THEN
        RETURN set_current_question(p_control_token, 0);
    END IF;

    SELECT t.event_id INTO v_event_id
      FROM event_control_tokens t
      JOIN events e ON e.id = t.event_id
     WHERE t.token = p_control_token
       AND e.is_active = true;

    IF v_event_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
    END IF;

    SELECT id INTO v_question_id
      FROM (
        SELECT id, row_number() OVER (ORDER BY sort_order, id) AS rn
          FROM questions
         WHERE event_id = v_event_id AND is_active = true
      ) ranked
     WHERE rn = p_order;

    IF v_question_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'order_out_of_range');
    END IF;

    RETURN set_current_question(p_control_token, v_question_id);
END;
$$;

COMMENT ON FUNCTION set_current_question_by_order(TEXT, INTEGER) IS
    'スライド連携用。表示順（1始まり）で設問を切り替える。p_order=0 で配信終了';

REVOKE ALL ON FUNCTION set_current_question_by_order(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_current_question_by_order(TEXT, INTEGER) TO anon, authenticated;

-- ============================================================
-- 5. ハートビート関数
-- ============================================================
-- 現状は admin.html が updated_at を30秒ごとに打っており、これが止まると
-- 参加者画面は90秒後に待機画面へ落ちる。
-- admin.html を開かずスライドだけで運用したくなった場合に備えて用意しておく。
-- 現行の運用（admin.html 併用）では呼ばなくてよい。

CREATE OR REPLACE FUNCTION touch_admin_state(p_control_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event_id BIGINT;
BEGIN
    SELECT t.event_id INTO v_event_id
      FROM event_control_tokens t
      JOIN events e ON e.id = t.event_id
     WHERE t.token = p_control_token
       AND e.is_active = true;

    IF v_event_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
    END IF;

    UPDATE admin_state SET updated_at = NOW() WHERE event_id = v_event_id;

    RETURN jsonb_build_object('ok', true, 'event_id', v_event_id);
END;
$$;

COMMENT ON FUNCTION touch_admin_state(TEXT) IS
    'スライド連携用のハートビート。admin_state.updated_at のみ更新する';

REVOKE ALL ON FUNCTION touch_admin_state(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION touch_admin_state(TEXT) TO anon, authenticated;

-- ============================================================
-- 6. 操作トークンの確認用クエリ
-- ============================================================
-- スライドに埋め込む値をここで引く（SQL エディタで実行）。
--
-- SELECT e.id            AS event_id,
--        e.name,
--        e.public_token  AS 参加者URL用,
--        t.token         AS スライド操作用,
--        q.id            AS question_id,
--        q.sort_order,
--        q.question_type,
--        q.question_text
--   FROM events e
--   LEFT JOIN event_control_tokens t ON t.event_id = e.id
--   LEFT JOIN questions q ON q.event_id = e.id AND q.is_active = true
--  WHERE e.is_active = true
--  ORDER BY e.id, q.sort_order;
