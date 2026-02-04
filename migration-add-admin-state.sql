-- =====================================================
-- マイグレーション: admin_state テーブル追加
-- =====================================================
--
-- 既存のSupabase環境に admin_state テーブルを追加します。
-- プレゼンモード機能を使用するために必要です。
--
-- 使用方法:
-- 1. Supabase Dashboard の SQL Editor を開く
-- 2. このファイルの内容を貼り付けて実行
--
-- =====================================================

-- admin_state テーブル（管理画面の状態を参加者画面に同期）
CREATE TABLE IF NOT EXISTS admin_state (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    current_question_id BIGINT REFERENCES questions(id) ON DELETE SET NULL,
    is_presenting BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_id)
);

-- コメント追加
COMMENT ON TABLE admin_state IS '管理画面プレゼンモード状態管理テーブル';
COMMENT ON COLUMN admin_state.id IS 'ID（自動採番）';
COMMENT ON COLUMN admin_state.event_id IS 'イベントID（外部キー）';
COMMENT ON COLUMN admin_state.current_question_id IS '現在表示中の質問ID';
COMMENT ON COLUMN admin_state.is_presenting IS 'プレゼンモードフラグ（true: 配信中, false: 停止中）';
COMMENT ON COLUMN admin_state.updated_at IS '最終更新日時';

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_admin_state_event_id ON admin_state(event_id);
CREATE INDEX IF NOT EXISTS idx_admin_state_updated_at ON admin_state(updated_at DESC);

-- RLS有効化
ALTER TABLE admin_state ENABLE ROW LEVEL SECURITY;

-- RLSポリシー作成（既存の場合はスキップ）
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'admin_state' AND policyname = 'admin_state_select_policy') THEN
        CREATE POLICY "admin_state_select_policy" ON admin_state FOR SELECT USING (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'admin_state' AND policyname = 'admin_state_insert_policy') THEN
        CREATE POLICY "admin_state_insert_policy" ON admin_state FOR INSERT WITH CHECK (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'admin_state' AND policyname = 'admin_state_update_policy') THEN
        CREATE POLICY "admin_state_update_policy" ON admin_state FOR UPDATE USING (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'admin_state' AND policyname = 'admin_state_delete_policy') THEN
        CREATE POLICY "admin_state_delete_policy" ON admin_state FOR DELETE USING (true);
    END IF;
END $$;

-- Realtime有効化
ALTER PUBLICATION supabase_realtime ADD TABLE admin_state;

-- =====================================================
-- マイグレーション完了
-- =====================================================
