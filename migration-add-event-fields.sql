-- =====================================================
-- イベント管理機能拡張マイグレーション
-- =====================================================
--
-- 実行方法:
-- 1. Supabase Dashboard → SQL Editor
-- 2. このファイルの内容を貼り付けて実行
--
-- =====================================================

-- expected_participants カラム追加（予想参加人数）
ALTER TABLE events ADD COLUMN IF NOT EXISTS expected_participants INTEGER;
COMMENT ON COLUMN events.expected_participants IS '予想参加人数';

-- material_url カラム追加（関連資料URL）
ALTER TABLE events ADD COLUMN IF NOT EXISTS material_url TEXT;
COMMENT ON COLUMN events.material_url IS '関連資料URL';
