-- セミナーアンケートシステム用 Supabase テーブル設定
-- Supabaseダッシュボードの SQL Editor で実行してください

-- 質問テーブル
CREATE TABLE IF NOT EXISTS questions (
    id BIGSERIAL PRIMARY KEY,
    question_text TEXT NOT NULL,
    question_type VARCHAR(20) NOT NULL CHECK (question_type IN ('single', 'multiple', 'text', 'rating')),
    options JSONB DEFAULT NULL,
    is_required BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 回答テーブル
CREATE TABLE IF NOT EXISTS responses (
    id BIGSERIAL PRIMARY KEY,
    question_id BIGINT REFERENCES questions(id) ON DELETE CASCADE,
    session_id VARCHAR(100) NOT NULL,
    answer TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス作成（パフォーマンス向上）
CREATE INDEX IF NOT EXISTS idx_responses_question_id ON responses(question_id);
CREATE INDEX IF NOT EXISTS idx_responses_session_id ON responses(session_id);
CREATE INDEX IF NOT EXISTS idx_questions_is_active ON questions(is_active);
CREATE INDEX IF NOT EXISTS idx_questions_sort_order ON questions(sort_order);

-- Row Level Security (RLS) を有効化
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE responses ENABLE ROW LEVEL SECURITY;

-- 匿名ユーザーが質問を読み取れるポリシー
CREATE POLICY "Allow anonymous read questions" ON questions
    FOR SELECT
    USING (true);

-- 匿名ユーザーが回答を挿入できるポリシー
CREATE POLICY "Allow anonymous insert responses" ON responses
    FOR INSERT
    WITH CHECK (true);

-- 匿名ユーザーが回答を読み取れるポリシー（重複チェック用）
CREATE POLICY "Allow anonymous read responses" ON responses
    FOR SELECT
    USING (true);

-- 管理者用：質問の追加・更新・削除を許可
-- 注意: 本番環境では認証を追加することを推奨
CREATE POLICY "Allow anonymous manage questions" ON questions
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- 管理者用：回答の削除を許可
CREATE POLICY "Allow anonymous delete responses" ON responses
    FOR DELETE
    USING (true);

-- リアルタイム機能を有効化
-- Supabaseダッシュボード > Database > Replication で
-- responses テーブルのリアルタイムを有効にしてください

-- サンプル質問データ（オプション）
INSERT INTO questions (question_text, question_type, options, is_required, sort_order)
VALUES
    ('本日のセミナーの満足度を教えてください', 'rating', NULL, true, 1),
    ('特に印象に残った内容を選んでください', 'multiple', '["講演内容", "実践ワークショップ", "Q&Aセッション", "ネットワーキング"]', false, 2),
    ('今後取り上げてほしいトピックはありますか？', 'single', '["AI・機械学習", "クラウド技術", "セキュリティ", "プロジェクト管理", "その他"]', false, 3),
    ('ご意見・ご感想がありましたらお聞かせください', 'text', NULL, false, 4);

-- 確認用クエリ
-- SELECT * FROM questions ORDER BY sort_order;
