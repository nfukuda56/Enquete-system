-- ========================================
-- 認証システム用データベーススキーマ
-- ========================================
--
-- このスキーマは以下の認証方式をサポートします:
-- 1. メールアドレス + パスワード（必須）
-- 2. Google OAuth（任意）
-- 3. パスキー/生体認証（任意）
--
-- 注意: Supabaseでは auth.users テーブルが標準で提供されています。
--       このスキーマはそれに追加の認証テーブルを定義します。

-- ========================================
-- OAuth プロバイダー連携テーブル
-- ========================================
--
-- 各ユーザーが連携しているOAuthプロバイダー（Google等）を管理
-- 1ユーザーにつき各プロバイダー1つまで

CREATE TABLE IF NOT EXISTS user_oauth_providers (
    id BIGSERIAL PRIMARY KEY,

    -- Supabase auth.users への外部キー
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- プロバイダー名（'google', 'apple', 'github' など）
    provider VARCHAR(50) NOT NULL,

    -- プロバイダー側のユーザーID
    provider_user_id VARCHAR(255) NOT NULL,

    -- プロバイダーから取得したメールアドレス（表示用）
    provider_email VARCHAR(255),

    -- メタデータ
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- 1ユーザーにつき各プロバイダー1つまで
    UNIQUE(user_id, provider)
);

-- インデックス: プロバイダーIDでのログイン検索用
CREATE INDEX IF NOT EXISTS idx_oauth_provider_lookup
    ON user_oauth_providers(provider, provider_user_id);

-- RLS (Row Level Security) ポリシー
ALTER TABLE user_oauth_providers ENABLE ROW LEVEL SECURITY;

-- 既存ポリシーを削除
DROP POLICY IF EXISTS "Users can view own oauth providers" ON user_oauth_providers;
DROP POLICY IF EXISTS "Users can insert own oauth providers" ON user_oauth_providers;
DROP POLICY IF EXISTS "Users can delete own oauth providers" ON user_oauth_providers;

-- ユーザーは自分のレコードのみ参照可能
CREATE POLICY "Users can view own oauth providers" ON user_oauth_providers
    FOR SELECT USING (auth.uid() = user_id);

-- ユーザーは自分のレコードのみ追加可能
CREATE POLICY "Users can insert own oauth providers" ON user_oauth_providers
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ユーザーは自分のレコードのみ削除可能
CREATE POLICY "Users can delete own oauth providers" ON user_oauth_providers
    FOR DELETE USING (auth.uid() = user_id);


-- ========================================
-- パスキー（WebAuthn）テーブル
-- ========================================
--
-- 各ユーザーが登録しているパスキー（生体認証）を管理
-- 1ユーザーにつき1つまで（計画に基づく制限）

CREATE TABLE IF NOT EXISTS user_passkeys (
    id BIGSERIAL PRIMARY KEY,

    -- Supabase auth.users への外部キー
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- WebAuthn クレデンシャルID（Base64エンコード）
    credential_id TEXT NOT NULL UNIQUE,

    -- 公開鍵（Base64エンコード）
    public_key TEXT NOT NULL,

    -- デバイス名（表示用）
    device_name VARCHAR(100),

    -- カウンター（リプレイ攻撃防止用）
    counter BIGINT DEFAULT 0,

    -- 最終使用日時
    last_used_at TIMESTAMPTZ,

    -- メタデータ
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- 1ユーザーにつき1つまで（計画に基づく制限）
    -- 複数パスキーを許可する場合はこの制約を削除
    UNIQUE(user_id)
);

-- インデックス: クレデンシャルIDでの認証検索用
CREATE INDEX IF NOT EXISTS idx_passkey_credential_lookup
    ON user_passkeys(credential_id);

-- RLS ポリシー
ALTER TABLE user_passkeys ENABLE ROW LEVEL SECURITY;

-- 既存ポリシーを削除
DROP POLICY IF EXISTS "Users can view own passkeys" ON user_passkeys;
DROP POLICY IF EXISTS "Users can insert own passkeys" ON user_passkeys;
DROP POLICY IF EXISTS "Users can update own passkeys" ON user_passkeys;
DROP POLICY IF EXISTS "Users can delete own passkeys" ON user_passkeys;

-- ユーザーは自分のレコードのみ参照可能
CREATE POLICY "Users can view own passkeys" ON user_passkeys
    FOR SELECT USING (auth.uid() = user_id);

-- ユーザーは自分のレコードのみ追加可能
CREATE POLICY "Users can insert own passkeys" ON user_passkeys
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ユーザーは自分のレコードのみ更新可能（カウンター更新等）
CREATE POLICY "Users can update own passkeys" ON user_passkeys
    FOR UPDATE USING (auth.uid() = user_id);

-- ユーザーは自分のレコードのみ削除可能
CREATE POLICY "Users can delete own passkeys" ON user_passkeys
    FOR DELETE USING (auth.uid() = user_id);


-- ========================================
-- メール確認キーテーブル
-- ========================================
--
-- 新規登録・認証編集時のメール確認用キーを一時保存

CREATE TABLE IF NOT EXISTS email_verification_codes (
    id BIGSERIAL PRIMARY KEY,

    -- 確認対象のメールアドレス
    email VARCHAR(255) NOT NULL,

    -- 6桁の確認コード
    code VARCHAR(6) NOT NULL,

    -- コードの用途（'register' = 新規登録, 'edit' = 認証編集）
    purpose VARCHAR(20) NOT NULL DEFAULT 'register',

    -- 有効期限（10分）
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),

    -- 使用済みフラグ
    used BOOLEAN DEFAULT FALSE,

    -- メタデータ
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス: メール検索用
CREATE INDEX IF NOT EXISTS idx_verification_email_lookup
    ON email_verification_codes(email, code, expires_at);

-- 古いレコードを自動削除するための関数
CREATE OR REPLACE FUNCTION cleanup_expired_verification_codes()
RETURNS void AS $$
BEGIN
    DELETE FROM email_verification_codes
    WHERE expires_at < NOW() OR used = TRUE;
END;
$$ LANGUAGE plpgsql;

-- RLS ポリシー（匿名ユーザーからのアクセスを許可）
ALTER TABLE email_verification_codes ENABLE ROW LEVEL SECURITY;

-- 既存ポリシーを削除
DROP POLICY IF EXISTS "Anyone can insert verification codes" ON email_verification_codes;

-- 匿名ユーザーは自分のコードを挿入可能
CREATE POLICY "Anyone can insert verification codes" ON email_verification_codes
    FOR INSERT WITH CHECK (TRUE);

-- コードの検証は Edge Function で行う（直接SELECTは不可）
-- セキュリティのため、クライアントからの直接アクセスは制限


-- ========================================
-- updated_at 自動更新トリガー
-- ========================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_oauth_providers_updated_at ON user_oauth_providers;
CREATE TRIGGER update_oauth_providers_updated_at
    BEFORE UPDATE ON user_oauth_providers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ========================================
-- ユーザープロファイルテーブル（ロール管理）
-- ========================================
--
-- システムオーナー: 全イベント・全データにアクセス可能
-- イベント管理者: 自身が作成したイベントのみアクセス可能

CREATE TABLE IF NOT EXISTS user_profiles (
    id BIGSERIAL PRIMARY KEY,

    -- Supabase auth.users への外部キー
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,

    -- ロール（system_owner または event_admin）
    role TEXT NOT NULL DEFAULT 'event_admin'
        CHECK (role IN ('system_owner', 'event_admin')),

    -- 表示名
    display_name TEXT,

    -- メタデータ
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);

-- RLS有効化
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- 既存ポリシーを削除
DROP POLICY IF EXISTS "user_profiles_select_own" ON user_profiles;

-- ユーザーは自分のプロファイルを参照可能
CREATE POLICY "user_profiles_select_own" ON user_profiles
    FOR SELECT USING (auth.uid() = user_id);

-- 新規ユーザー登録時にプロファイルを自動作成するトリガー
CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_profiles (user_id, role)
    VALUES (NEW.id, 'event_admin');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- トリガーが存在しない場合のみ作成
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created'
    ) THEN
        CREATE TRIGGER on_auth_user_created
            AFTER INSERT ON auth.users
            FOR EACH ROW
            EXECUTE FUNCTION create_user_profile();
    END IF;
END $$;

-- user_profiles の updated_at 自動更新
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ========================================
-- アカウント削除機能用のカラム追加
-- ========================================
--
-- email: 削除後のメールアドレス保存用
-- deleted_at: 論理削除フラグ

-- メールアドレス保存カラム追加
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email TEXT;

-- 論理削除フラグ追加
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_user_profiles_deleted_at ON user_profiles(deleted_at);
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);

-- 外部キー制約の変更（auth.users削除時にuser_profilesは残す）
-- 既存の制約を削除
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_user_id_fkey;

-- user_id を NULL 許容に変更
ALTER TABLE user_profiles ALTER COLUMN user_id DROP NOT NULL;

-- 注意: auth.users物理削除後もuser_profilesを残すため、外部キー制約は再設定しない


-- ========================================
-- アカウント削除トークンテーブル
-- ========================================
--
-- アカウント削除確認用の一時トークンを保存

CREATE TABLE IF NOT EXISTS account_deletion_tokens (
    id BIGSERIAL PRIMARY KEY,

    -- 削除対象のユーザーID
    user_id UUID NOT NULL,

    -- 削除確認トークン（UUID形式）
    token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),

    -- 有効期限（30分）
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),

    -- 使用済みフラグ
    used BOOLEAN DEFAULT FALSE,

    -- メタデータ
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス: トークン検索用
CREATE INDEX IF NOT EXISTS idx_deletion_token_lookup
    ON account_deletion_tokens(token, expires_at);

-- 古いトークンを自動削除するための関数
CREATE OR REPLACE FUNCTION cleanup_expired_deletion_tokens()
RETURNS void AS $$
BEGIN
    DELETE FROM account_deletion_tokens
    WHERE expires_at < NOW() OR used = TRUE;
END;
$$ LANGUAGE plpgsql;


-- ========================================
-- イベントテーブルのRLSポリシー（ロールベースアクセス制御）
-- ========================================
--
-- system_owner: 全イベントにアクセス可能
-- event_admin: 自身が作成したイベントのみアクセス可能

-- システムオーナー判定関数
CREATE OR REPLACE FUNCTION is_system_owner()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM user_profiles
        WHERE user_id = auth.uid()
        AND role = 'system_owner'
        AND deleted_at IS NULL
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- eventsテーブルのRLS有効化
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- 既存ポリシーを削除
DROP POLICY IF EXISTS "events_select_policy" ON events;
DROP POLICY IF EXISTS "events_insert_policy" ON events;
DROP POLICY IF EXISTS "events_update_policy" ON events;
DROP POLICY IF EXISTS "events_delete_policy" ON events;

-- SELECT: システムオーナーは全イベント、それ以外は自分が作成したイベントのみ
CREATE POLICY "events_select_policy" ON events
    FOR SELECT USING (
        is_system_owner()
        OR owner_id = auth.uid()
    );

-- INSERT: 認証済みユーザーは新規イベント作成可能
CREATE POLICY "events_insert_policy" ON events
    FOR INSERT WITH CHECK (
        auth.uid() IS NOT NULL
    );

-- UPDATE: システムオーナーは全イベント、それ以外は自分が作成したイベントのみ
CREATE POLICY "events_update_policy" ON events
    FOR UPDATE USING (
        is_system_owner()
        OR owner_id = auth.uid()
    );

-- DELETE: システムオーナーは全イベント、それ以外は自分が作成したイベントのみ
CREATE POLICY "events_delete_policy" ON events
    FOR DELETE USING (
        is_system_owner()
        OR owner_id = auth.uid()
    );


-- ========================================
-- 使用例・補足説明
-- ========================================
--
-- ## テーブル設計のポイント
--
-- 1. user_oauth_providers
--    - 各プロバイダー（Google等）との連携情報を保存
--    - provider_email は表示用（連携解除時に「user@gmail.com」と表示）
--    - user_id + provider のユニーク制約で重複連携を防止
--
-- 2. user_passkeys
--    - WebAuthn/FIDO2 のクレデンシャル情報を保存
--    - credential_id はパスキーログイン時の検索キー
--    - counter はリプレイ攻撃防止用（認証のたびに増加）
--    - user_id のユニーク制約で1ユーザー1パスキーに制限
--
-- 3. email_verification_codes
--    - 新規登録・認証編集時の一時的な確認コード
--    - 10分で有効期限切れ
--    - Edge Function で検証後に used = TRUE に更新
--
-- ## セキュリティ考慮事項
--
-- - RLS を有効化し、ユーザーは自分のデータのみアクセス可能
-- - パスキー認証の検証は必ずサーバーサイド（Edge Function）で実行
-- - 確認コードの検証もサーバーサイドで実行（直接SELECTは不可）
--
-- ## Supabase へのデプロイ
--
-- 1. Supabase Dashboard > SQL Editor でこのスクリプトを実行
-- 2. または supabase db push コマンドでマイグレーション


-- ========================================
-- events テーブルへの owner_id カラム追加
-- ========================================
--
-- イベントの所有者を管理するためのカラム
-- system_owner は全イベントにアクセス可能
-- event_admin は自身が所有するイベントのみアクセス可能

ALTER TABLE events ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_events_owner_id ON events(owner_id);
