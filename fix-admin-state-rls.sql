-- =====================================================
-- admin_state テーブル RLS ポリシー修正
-- =====================================================
--
-- 406 (Not Acceptable) エラーの原因:
-- RLSが有効だがポリシーが存在しない場合、全てのリクエストが拒否される
--
-- 使用方法:
-- Supabase Dashboard > SQL Editor でこのファイルを実行
--
-- =====================================================

-- まず現在のポリシー状況を確認
SELECT policyname, permissive, cmd
FROM pg_policies
WHERE tablename = 'admin_state';

-- =====================================================
-- RLSポリシーを強制的に再作成
-- =====================================================

-- 既存のポリシーを削除（存在する場合）
DROP POLICY IF EXISTS "admin_state_select_policy" ON admin_state;
DROP POLICY IF EXISTS "admin_state_insert_policy" ON admin_state;
DROP POLICY IF EXISTS "admin_state_update_policy" ON admin_state;
DROP POLICY IF EXISTS "admin_state_delete_policy" ON admin_state;
DROP POLICY IF EXISTS "admin_state_all_access" ON admin_state;

-- RLSを一旦無効化して再度有効化（キャッシュクリア効果）
ALTER TABLE admin_state DISABLE ROW LEVEL SECURITY;
ALTER TABLE admin_state ENABLE ROW LEVEL SECURITY;

-- ポリシーを作成（誰でもアクセス可能）
CREATE POLICY "admin_state_select_policy" ON admin_state
    FOR SELECT USING (true);

CREATE POLICY "admin_state_insert_policy" ON admin_state
    FOR INSERT WITH CHECK (true);

CREATE POLICY "admin_state_update_policy" ON admin_state
    FOR UPDATE USING (true);

CREATE POLICY "admin_state_delete_policy" ON admin_state
    FOR DELETE USING (true);

-- 作成されたポリシーを確認
SELECT policyname, permissive, cmd
FROM pg_policies
WHERE tablename = 'admin_state';

-- =====================================================
-- Realtime Publication 確認（既に追加済みの場合はエラーになるが無視して良い）
-- =====================================================

-- ALTER PUBLICATION supabase_realtime ADD TABLE admin_state;

-- =====================================================
-- 修正完了
-- =====================================================
--
-- 上記実行後、ブラウザをリロードして再度テストしてください。
-- まだエラーが出る場合は、Supabase Dashboardで:
-- 1. Settings > API に移動
-- 2. 「Reload database schema」ボタンを押す
--
-- =====================================================
