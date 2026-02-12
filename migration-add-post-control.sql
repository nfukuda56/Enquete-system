-- ========================================
-- 投稿制御機能 マイグレーション
-- ========================================

-- events テーブル: 表示制御カラム追加
ALTER TABLE events ADD COLUMN IF NOT EXISTS text_display_enabled BOOLEAN DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS image_display_enabled BOOLEAN DEFAULT false;

-- responses テーブル: モデレーションカラム追加
ALTER TABLE responses ADD COLUMN IF NOT EXISTS moderation_status TEXT DEFAULT 'none'
    CHECK (moderation_status IN ('none', 'pending', 'approved', 'blocked'));
ALTER TABLE responses ADD COLUMN IF NOT EXISTS moderation_categories JSONB;
ALTER TABLE responses ADD COLUMN IF NOT EXISTS moderation_timestamp TIMESTAMPTZ;
ALTER TABLE responses ADD COLUMN IF NOT EXISTS policy_agreed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_responses_moderation_status ON responses(moderation_status);

-- レート制限テーブル
CREATE TABLE IF NOT EXISTS rate_limits (
    id BIGSERIAL PRIMARY KEY,
    session_id TEXT NOT NULL,
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    question_type TEXT NOT NULL,
    submitted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_session_event ON rate_limits(session_id, event_id);
CREATE INDEX IF NOT EXISTS idx_rate_limits_submitted_at ON rate_limits(submitted_at);

-- RLS
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rate_limits_select_policy" ON rate_limits FOR SELECT USING (true);
CREATE POLICY "rate_limits_insert_policy" ON rate_limits FOR INSERT WITH CHECK (true);
CREATE POLICY "rate_limits_delete_policy" ON rate_limits FOR DELETE USING (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE rate_limits;
