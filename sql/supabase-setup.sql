-- =====================================================
-- 伝心くん Supabase セットアップSQL
-- =====================================================
-- 統合版: 全マイグレーションを含む完全スキーマ
--
-- 使用方法:
-- 1. Supabase Dashboard (https://supabase.com/dashboard) にログイン
-- 2. プロジェクトを選択（または新規作成）
-- 3. SQL Editor を開く
-- 4. このファイルの内容を貼り付けて実行
-- =====================================================

-- =====================================================
-- 1. テーブル作成
-- =====================================================

-- events テーブル（イベント管理）
CREATE TABLE IF NOT EXISTS events (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    event_date DATE,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    expected_participants INTEGER,
    material_url TEXT,
    text_display_enabled BOOLEAN DEFAULT false,
    image_display_enabled BOOLEAN DEFAULT false,
    owner_id UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 既存テーブルへのカラム追加（マイグレーション用）
ALTER TABLE events ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id);

-- public_token カラム追加（URL難読化用 NanoID 12文字）
ALTER TABLE events ADD COLUMN IF NOT EXISTS public_token TEXT;
UPDATE events
    SET public_token = replace(replace(
        encode(gen_random_bytes(9), 'base64'), '/', '_'), '+', '-')
    WHERE public_token IS NULL;
ALTER TABLE events ALTER COLUMN public_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_public_token ON events(public_token);

COMMENT ON TABLE events IS 'イベント管理テーブル';
COMMENT ON COLUMN events.name IS 'イベント名';
COMMENT ON COLUMN events.event_date IS '開催日';
COMMENT ON COLUMN events.description IS 'イベント説明';
COMMENT ON COLUMN events.is_active IS 'アクティブフラグ';
COMMENT ON COLUMN events.expected_participants IS '予想参加人数';
COMMENT ON COLUMN events.material_url IS '関連資料URL';
COMMENT ON COLUMN events.text_display_enabled IS '自由記述の表示制御';
COMMENT ON COLUMN events.image_display_enabled IS '画像投稿の表示制御';

-- questions テーブル（質問管理）
CREATE TABLE IF NOT EXISTS questions (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    question_type TEXT NOT NULL CHECK (question_type IN ('single', 'multiple', 'text', 'rating', 'image')),
    options JSONB,
    is_required BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    duplicate_mode TEXT DEFAULT 'overwrite',  -- 'overwrite' (上書き) または 'append' (追加)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 既存テーブルへのカラム追加（マイグレーション用）
ALTER TABLE questions ADD COLUMN IF NOT EXISTS duplicate_mode TEXT DEFAULT 'overwrite';

COMMENT ON TABLE questions IS '質問管理テーブル';
COMMENT ON COLUMN questions.question_type IS '質問タイプ（single/multiple/text/rating/image）';
COMMENT ON COLUMN questions.options IS '選択肢（JSON配列、single/multiple用）';

-- responses テーブル（回答管理）
CREATE TABLE IF NOT EXISTS responses (
    id BIGSERIAL PRIMARY KEY,
    question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    answer TEXT,
    moderation_status TEXT DEFAULT 'none'
        CHECK (moderation_status IN ('none', 'pending', 'approved', 'blocked')),
    moderation_categories JSONB,
    moderation_timestamp TIMESTAMPTZ,
    policy_agreed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE responses IS '回答管理テーブル';
COMMENT ON COLUMN responses.session_id IS 'セッションID（ブラウザごとにユニーク）';
COMMENT ON COLUMN responses.moderation_status IS 'モデレーション状態（none/pending/approved/blocked）';

-- admin_state テーブル（プレゼンモード状態管理）
CREATE TABLE IF NOT EXISTS admin_state (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    current_question_id BIGINT REFERENCES questions(id) ON DELETE SET NULL,
    is_presenting BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_id)
);

COMMENT ON TABLE admin_state IS 'プレゼンモード状態管理テーブル';

-- rate_limits テーブル（投稿レート制限）
CREATE TABLE IF NOT EXISTS rate_limits (
    id BIGSERIAL PRIMARY KEY,
    session_id TEXT NOT NULL,
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    question_type TEXT NOT NULL,
    submitted_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE rate_limits IS '投稿レート制限テーブル';

-- =====================================================
-- 2. インデックス
-- =====================================================

-- events
CREATE INDEX IF NOT EXISTS idx_events_is_active ON events(is_active);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_owner_id ON events(owner_id);

-- questions
CREATE INDEX IF NOT EXISTS idx_questions_event_id ON questions(event_id);
CREATE INDEX IF NOT EXISTS idx_questions_is_active ON questions(is_active);
CREATE INDEX IF NOT EXISTS idx_questions_sort_order ON questions(sort_order);
CREATE INDEX IF NOT EXISTS idx_questions_event_active ON questions(event_id, is_active);

-- responses
CREATE INDEX IF NOT EXISTS idx_responses_question_id ON responses(question_id);
CREATE INDEX IF NOT EXISTS idx_responses_session_id ON responses(session_id);
CREATE INDEX IF NOT EXISTS idx_responses_question_session ON responses(question_id, session_id);
CREATE INDEX IF NOT EXISTS idx_responses_created_at ON responses(created_at);
CREATE INDEX IF NOT EXISTS idx_responses_moderation_status ON responses(moderation_status);

-- admin_state
CREATE INDEX IF NOT EXISTS idx_admin_state_event_id ON admin_state(event_id);
CREATE INDEX IF NOT EXISTS idx_admin_state_updated_at ON admin_state(updated_at DESC);

-- rate_limits
CREATE INDEX IF NOT EXISTS idx_rate_limits_session_event ON rate_limits(session_id, event_id);
CREATE INDEX IF NOT EXISTS idx_rate_limits_submitted_at ON rate_limits(submitted_at);

-- =====================================================
-- 3. Row Level Security (RLS)
-- =====================================================

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- events（ロールベースアクセス制御）
-- 既存ポリシーを削除して再作成
DROP POLICY IF EXISTS "events_select_policy" ON events;
DROP POLICY IF EXISTS "events_insert_policy" ON events;
DROP POLICY IF EXISTS "events_update_policy" ON events;
DROP POLICY IF EXISTS "events_delete_policy" ON events;

-- SELECT: 参加者は公開イベント、システムオーナーは全件、イベント管理者は自分のイベントのみ
CREATE POLICY "events_select_by_role" ON events FOR SELECT USING (
    (auth.uid() IS NULL AND is_active = true)  -- 未認証の参加者は公開イベントのみ
    OR EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role = 'system_owner')
    OR owner_id = auth.uid()
);

-- INSERT: 認証済みユーザーは自分をowner_idに設定して作成可能
CREATE POLICY "events_insert_authenticated" ON events FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL AND owner_id = auth.uid());

-- UPDATE: システムオーナーまたは所有者のみ
CREATE POLICY "events_update_by_role" ON events FOR UPDATE USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role = 'system_owner')
    OR owner_id = auth.uid()
);

-- DELETE: システムオーナーまたは所有者のみ
CREATE POLICY "events_delete_by_role" ON events FOR DELETE USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role = 'system_owner')
    OR owner_id = auth.uid()
);

-- questions（ロールベースアクセス制御: イベント所有者に基づく）
DROP POLICY IF EXISTS "questions_select_policy" ON questions;
DROP POLICY IF EXISTS "questions_insert_policy" ON questions;
DROP POLICY IF EXISTS "questions_update_policy" ON questions;
DROP POLICY IF EXISTS "questions_delete_policy" ON questions;

-- SELECT: 参加者は公開イベントの質問、認証ユーザーは権限のあるイベントの質問
CREATE POLICY "questions_select_by_role" ON questions FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM events e
        WHERE e.id = questions.event_id
        AND (
            (auth.uid() IS NULL AND e.is_active = true)
            OR EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role = 'system_owner')
            OR e.owner_id = auth.uid()
        )
    )
);

-- INSERT: イベント所有者またはシステムオーナーのみ
CREATE POLICY "questions_insert_by_role" ON questions FOR INSERT WITH CHECK (
    EXISTS (
        SELECT 1 FROM events e
        WHERE e.id = questions.event_id
        AND (
            EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role = 'system_owner')
            OR e.owner_id = auth.uid()
        )
    )
);

-- UPDATE: イベント所有者またはシステムオーナーのみ
CREATE POLICY "questions_update_by_role" ON questions FOR UPDATE USING (
    EXISTS (
        SELECT 1 FROM events e
        WHERE e.id = questions.event_id
        AND (
            EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role = 'system_owner')
            OR e.owner_id = auth.uid()
        )
    )
);

-- DELETE: イベント所有者またはシステムオーナーのみ
CREATE POLICY "questions_delete_by_role" ON questions FOR DELETE USING (
    EXISTS (
        SELECT 1 FROM events e
        WHERE e.id = questions.event_id
        AND (
            EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role = 'system_owner')
            OR e.owner_id = auth.uid()
        )
    )
);

-- responses（ロールベースアクセス制御: イベント所有者に基づく）
DROP POLICY IF EXISTS "responses_select_policy" ON responses;
DROP POLICY IF EXISTS "responses_insert_policy" ON responses;
DROP POLICY IF EXISTS "responses_update_policy" ON responses;
DROP POLICY IF EXISTS "responses_delete_policy" ON responses;

-- SELECT: 参加者は公開イベントの回答、認証ユーザーは権限のあるイベントの回答
CREATE POLICY "responses_select_by_role" ON responses FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM questions q
        JOIN events e ON e.id = q.event_id
        WHERE q.id = responses.question_id
        AND (
            (auth.uid() IS NULL AND e.is_active = true)
            OR EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role = 'system_owner')
            OR e.owner_id = auth.uid()
        )
    )
);

-- INSERT: 参加者（認証不要）または権限のある認証ユーザー
CREATE POLICY "responses_insert_by_role" ON responses FOR INSERT WITH CHECK (
    EXISTS (
        SELECT 1 FROM questions q
        JOIN events e ON e.id = q.event_id
        WHERE q.id = responses.question_id
        AND (
            e.is_active = true  -- 参加者は公開イベントに回答可能
            OR EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role = 'system_owner')
            OR e.owner_id = auth.uid()
        )
    )
);

-- UPDATE: イベント所有者またはシステムオーナーのみ
CREATE POLICY "responses_update_by_role" ON responses FOR UPDATE USING (
    EXISTS (
        SELECT 1 FROM questions q
        JOIN events e ON e.id = q.event_id
        WHERE q.id = responses.question_id
        AND (
            EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role = 'system_owner')
            OR e.owner_id = auth.uid()
        )
    )
);

-- DELETE: イベント所有者またはシステムオーナーのみ
CREATE POLICY "responses_delete_by_role" ON responses FOR DELETE USING (
    EXISTS (
        SELECT 1 FROM questions q
        JOIN events e ON e.id = q.event_id
        WHERE q.id = responses.question_id
        AND (
            EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role = 'system_owner')
            OR e.owner_id = auth.uid()
        )
    )
);

-- admin_state（ロールベースアクセス制御: イベント所有者に基づく）
DROP POLICY IF EXISTS "admin_state_select_policy" ON admin_state;
DROP POLICY IF EXISTS "admin_state_insert_policy" ON admin_state;
DROP POLICY IF EXISTS "admin_state_update_policy" ON admin_state;
DROP POLICY IF EXISTS "admin_state_delete_policy" ON admin_state;

-- SELECT: 参加者は公開イベントの状態、認証ユーザーは権限のあるイベントの状態
CREATE POLICY "admin_state_select_by_role" ON admin_state FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM events e
        WHERE e.id = admin_state.event_id
        AND (
            (auth.uid() IS NULL AND e.is_active = true)
            OR EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role = 'system_owner')
            OR e.owner_id = auth.uid()
        )
    )
);

-- INSERT: イベント所有者またはシステムオーナーのみ
CREATE POLICY "admin_state_insert_by_role" ON admin_state FOR INSERT WITH CHECK (
    EXISTS (
        SELECT 1 FROM events e
        WHERE e.id = admin_state.event_id
        AND (
            EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role = 'system_owner')
            OR e.owner_id = auth.uid()
        )
    )
);

-- UPDATE: イベント所有者またはシステムオーナーのみ
CREATE POLICY "admin_state_update_by_role" ON admin_state FOR UPDATE USING (
    EXISTS (
        SELECT 1 FROM events e
        WHERE e.id = admin_state.event_id
        AND (
            EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role = 'system_owner')
            OR e.owner_id = auth.uid()
        )
    )
);

-- DELETE: イベント所有者またはシステムオーナーのみ
CREATE POLICY "admin_state_delete_by_role" ON admin_state FOR DELETE USING (
    EXISTS (
        SELECT 1 FROM events e
        WHERE e.id = admin_state.event_id
        AND (
            EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role = 'system_owner')
            OR e.owner_id = auth.uid()
        )
    )
);

-- rate_limits
CREATE POLICY "rate_limits_select_policy" ON rate_limits FOR SELECT USING (true);
CREATE POLICY "rate_limits_insert_policy" ON rate_limits FOR INSERT WITH CHECK (true);
CREATE POLICY "rate_limits_delete_policy" ON rate_limits FOR DELETE USING (true);

-- =====================================================
-- 4. Realtime 有効化
-- =====================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE events;
ALTER PUBLICATION supabase_realtime ADD TABLE questions;
ALTER PUBLICATION supabase_realtime ADD TABLE responses;
ALTER PUBLICATION supabase_realtime ADD TABLE admin_state;
ALTER PUBLICATION supabase_realtime ADD TABLE rate_limits;

-- =====================================================
-- 5. Storage バケット
-- =====================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'survey-images',
    'survey-images',
    true,
    5242880,  -- 5MB
    ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "survey_images_select_policy" ON storage.objects
    FOR SELECT USING (bucket_id = 'survey-images');
CREATE POLICY "survey_images_insert_policy" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'survey-images');
CREATE POLICY "survey_images_update_policy" ON storage.objects
    FOR UPDATE USING (bucket_id = 'survey-images');
CREATE POLICY "survey_images_delete_policy" ON storage.objects
    FOR DELETE USING (bucket_id = 'survey-images');

-- =====================================================
-- 6. データ移行（既存環境用）
-- =====================================================

-- 既存ユーザー全員に event_admin プロファイルを作成
INSERT INTO user_profiles (user_id, role)
SELECT id, 'event_admin' FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- 既存イベントの owner_id を設定（システムオーナーがいる場合）
-- ※ 最初のシステムオーナー設定後に実行
-- UPDATE events
-- SET owner_id = (
--     SELECT user_id FROM user_profiles WHERE role = 'system_owner' LIMIT 1
-- )
-- WHERE owner_id IS NULL;

-- =====================================================
-- 7. システムオーナー設定（手動実行）
-- =====================================================
-- 特定メールアドレスのユーザーをシステムオーナーに設定する場合:
-- UPDATE user_profiles
-- SET role = 'system_owner'
-- WHERE user_id = (SELECT id FROM auth.users WHERE email = 'YOUR_EMAIL@example.com');

-- =====================================================
-- セットアップ完了
-- =====================================================
-- 次のステップ:
-- 1. Supabase Dashboard → Settings → API で取得:
--    - Project URL (SUPABASE_URL)
--    - anon public key (SUPABASE_ANON_KEY)
-- 2. config.js の値を更新
-- 3. admin.html にアクセスして動作確認
-- 4. 必要に応じてシステムオーナーを設定
-- =====================================================
