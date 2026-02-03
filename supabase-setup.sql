-- =====================================================
-- セミナーアンケートシステム Supabase セットアップSQL
-- =====================================================
--
-- 使用方法:
-- 1. Supabase Dashboard (https://supabase.com/dashboard) にログイン
-- 2. プロジェクトを選択（または新規作成）
-- 3. SQL Editor を開く
-- 4. このファイルの内容を貼り付けて実行
--
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
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- events テーブルにコメント追加
COMMENT ON TABLE events IS 'イベント管理テーブル';
COMMENT ON COLUMN events.id IS 'イベントID（自動採番）';
COMMENT ON COLUMN events.name IS 'イベント名';
COMMENT ON COLUMN events.event_date IS '開催日';
COMMENT ON COLUMN events.description IS 'イベント説明';
COMMENT ON COLUMN events.is_active IS 'アクティブフラグ（true: 有効, false: 無効）';
COMMENT ON COLUMN events.created_at IS '作成日時';

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
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- questions テーブルにコメント追加
COMMENT ON TABLE questions IS '質問管理テーブル';
COMMENT ON COLUMN questions.id IS '質問ID（自動採番）';
COMMENT ON COLUMN questions.event_id IS 'イベントID（外部キー）';
COMMENT ON COLUMN questions.question_text IS '質問文';
COMMENT ON COLUMN questions.question_type IS '質問タイプ（single: 単一選択, multiple: 複数選択, text: 自由記述, rating: 5段階評価, image: 画像アップロード）';
COMMENT ON COLUMN questions.options IS '選択肢（JSON配列、single/multipleの場合のみ使用）';
COMMENT ON COLUMN questions.is_required IS '必須回答フラグ';
COMMENT ON COLUMN questions.is_active IS 'アクティブフラグ（true: 表示, false: 非表示）';
COMMENT ON COLUMN questions.sort_order IS '表示順序';
COMMENT ON COLUMN questions.created_at IS '作成日時';

-- responses テーブル（回答管理）
CREATE TABLE IF NOT EXISTS responses (
    id BIGSERIAL PRIMARY KEY,
    question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    answer TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- responses テーブルにコメント追加
COMMENT ON TABLE responses IS '回答管理テーブル';
COMMENT ON COLUMN responses.id IS '回答ID（自動採番）';
COMMENT ON COLUMN responses.question_id IS '質問ID（外部キー）';
COMMENT ON COLUMN responses.session_id IS 'セッションID（ブラウザごとにユニーク）';
COMMENT ON COLUMN responses.answer IS '回答内容（テキストまたはJSON配列）';
COMMENT ON COLUMN responses.created_at IS '回答日時';

-- =====================================================
-- 2. インデックス作成（パフォーマンス最適化）
-- =====================================================

-- events テーブルのインデックス
CREATE INDEX IF NOT EXISTS idx_events_is_active ON events(is_active);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);

-- questions テーブルのインデックス
CREATE INDEX IF NOT EXISTS idx_questions_event_id ON questions(event_id);
CREATE INDEX IF NOT EXISTS idx_questions_is_active ON questions(is_active);
CREATE INDEX IF NOT EXISTS idx_questions_sort_order ON questions(sort_order);
CREATE INDEX IF NOT EXISTS idx_questions_event_active ON questions(event_id, is_active);

-- responses テーブルのインデックス
CREATE INDEX IF NOT EXISTS idx_responses_question_id ON responses(question_id);
CREATE INDEX IF NOT EXISTS idx_responses_session_id ON responses(session_id);
CREATE INDEX IF NOT EXISTS idx_responses_question_session ON responses(question_id, session_id);
CREATE INDEX IF NOT EXISTS idx_responses_created_at ON responses(created_at);

-- =====================================================
-- 3. Row Level Security (RLS) 設定
-- =====================================================

-- RLSを有効化
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE responses ENABLE ROW LEVEL SECURITY;

-- events テーブルのポリシー（匿名ユーザー向け）
CREATE POLICY "events_select_policy" ON events
    FOR SELECT USING (true);

CREATE POLICY "events_insert_policy" ON events
    FOR INSERT WITH CHECK (true);

CREATE POLICY "events_update_policy" ON events
    FOR UPDATE USING (true);

CREATE POLICY "events_delete_policy" ON events
    FOR DELETE USING (true);

-- questions テーブルのポリシー（匿名ユーザー向け）
CREATE POLICY "questions_select_policy" ON questions
    FOR SELECT USING (true);

CREATE POLICY "questions_insert_policy" ON questions
    FOR INSERT WITH CHECK (true);

CREATE POLICY "questions_update_policy" ON questions
    FOR UPDATE USING (true);

CREATE POLICY "questions_delete_policy" ON questions
    FOR DELETE USING (true);

-- responses テーブルのポリシー（匿名ユーザー向け）
CREATE POLICY "responses_select_policy" ON responses
    FOR SELECT USING (true);

CREATE POLICY "responses_insert_policy" ON responses
    FOR INSERT WITH CHECK (true);

CREATE POLICY "responses_update_policy" ON responses
    FOR UPDATE USING (true);

CREATE POLICY "responses_delete_policy" ON responses
    FOR DELETE USING (true);

-- =====================================================
-- 4. Realtime 有効化
-- =====================================================

-- Realtime Publication にテーブルを追加
-- （Supabase Dashboard の Database > Replication でも設定可能）

-- 既存のpublicationを確認し、なければ作成
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;

-- テーブルをpublicationに追加（既に追加済みの場合はスキップ）
ALTER PUBLICATION supabase_realtime ADD TABLE events;
ALTER PUBLICATION supabase_realtime ADD TABLE questions;
ALTER PUBLICATION supabase_realtime ADD TABLE responses;

-- =====================================================
-- 5. Storage バケット作成
-- =====================================================

-- survey-images バケットを作成
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'survey-images',
    'survey-images',
    true,
    5242880,  -- 5MB
    ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS ポリシー設定

-- 読み取りポリシー（誰でも読み取り可能）
CREATE POLICY "survey_images_select_policy" ON storage.objects
    FOR SELECT
    USING (bucket_id = 'survey-images');

-- アップロードポリシー（誰でもアップロード可能）
CREATE POLICY "survey_images_insert_policy" ON storage.objects
    FOR INSERT
    WITH CHECK (bucket_id = 'survey-images');

-- 更新ポリシー（誰でも更新可能）
CREATE POLICY "survey_images_update_policy" ON storage.objects
    FOR UPDATE
    USING (bucket_id = 'survey-images');

-- 削除ポリシー（誰でも削除可能）
CREATE POLICY "survey_images_delete_policy" ON storage.objects
    FOR DELETE
    USING (bucket_id = 'survey-images');

-- =====================================================
-- 6. サンプルデータ（オプション）
-- =====================================================
--
-- 以下のコメントを外すとサンプルデータが挿入されます
--

/*
-- サンプルイベント
INSERT INTO events (name, event_date, description) VALUES
    ('第1回 技術セミナー', '2026-02-15', 'AI・機械学習に関する技術セミナー'),
    ('第2回 ワークショップ', '2026-03-01', 'ハンズオン形式のワークショップ');

-- サンプル質問（イベントID=1用）
INSERT INTO questions (event_id, question_text, question_type, options, is_required, sort_order) VALUES
    (1, '本日のセミナーの満足度を教えてください', 'rating', NULL, true, 1),
    (1, '特に興味を持った内容を選んでください', 'multiple', '["AI基礎", "機械学習実践", "データ分析", "活用事例"]', false, 2),
    (1, '次回参加したいテーマは？', 'single', '["AI・機械学習", "クラウド技術", "セキュリティ", "Web開発", "その他"]', false, 3),
    (1, 'ご意見・ご感想をお聞かせください', 'text', NULL, false, 4),
    (1, '名刺の写真をアップロードしてください', 'image', NULL, false, 5);
*/

-- =====================================================
-- セットアップ完了
-- =====================================================
--
-- 次のステップ:
-- 1. Supabase Dashboard → Settings → API で以下を取得:
--    - Project URL (SUPABASE_URL)
--    - anon public key (SUPABASE_ANON_KEY)
-- 2. config.js の値を更新
-- 3. admin.html にアクセスして動作確認
--
-- トラブルシューティング:
-- - ポリシーが既に存在するエラー → Dashboard で既存ポリシーを削除後に再実行
-- - Realtime が動作しない → Dashboard > Database > Replication で確認
-- - 画像がアップロードできない → Storage > survey-images のポリシーを確認
--
-- =====================================================
