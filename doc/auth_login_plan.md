# アカウント制御・ログイン機能の実装計画

## Context

現在のEnquete-systemは認証機構がなく、管理画面（admin.html）は URL を知っている誰でもアクセス可能。
RLS ポリシーも `USING(true)` で全開放状態。本計画では以下を実現する：

- **管理者ログイン保護**（Google OAuth + マジックリンク）
- **DBスキーマ分離**（`tenant` スキーマを別リポジトリでも再利用可能に）
- **テナント機能**（Phase 2、個人アカウントでは透過的に無効化）
- **将来の決済連携・ホスティング移動**を考慮した設計

参加者（回答者）はログイン不要。QRコード経由の匿名アクセスを維持する。

## 前提条件

- Supabase Auth を使用（組み込み SMTP、4通/時の無料枠で十分）
- Google OAuth を有効化（Supabase Dashboard > Authentication > Providers で設定）
- 現在のホスティング（GitHub Pages）を Phase 1-2 で継続
- フロントエンドは Vanilla JS のまま（ビルドツール未導入）

---

## フェーズ構成

| Phase | 内容 | 実装タイミング |
|-------|------|:-----------:|
| **Phase 1** | 認証 + ログイン保護 + 基本RLS | **今回実装** |
| **Phase 2** | テナント（組織）機能 + 完全RLS | 次回 |
| **Phase 3** | ホスティング移行 + 決済準備 | 将来 |

---

## Phase 1: 認証 + ログイン保護（今回実装）

### 1. Supabase Dashboard 事前設定

**1a. Google OAuth プロバイダー有効化:**
- Supabase Dashboard > Authentication > Providers > Google
- Google Cloud Console で OAuth 2.0 Client ID 取得
- Redirect URL: `https://fahqkdfrmgkhdcrocllc.supabase.co/auth/v1/callback`

**1b. マジックリンク有効化:**
- Authentication > Providers > Email で「Magic Link」有効化
- 組み込みSMTP使用（追加設定不要）

**1c. サイトURL設定:**
- Authentication > URL Configuration > Site URL: `https://nfukuda56.github.io/Enquete-system/admin.html`
- Redirect URLs に追加: `https://nfukuda56.github.io/Enquete-system/login.html`

### 2. DB マイグレーション — `sql/migration-auth-phase1.sql`

Phase 1 の認証用DBマイグレーションは `sql/migration-auth-phase1.sql` に記載。

### 3. 新規ファイル: `auth.js`（認証ユーティリティ）

**主要関数:**
- `checkAuth()` — セッション確認、未認証なら `login.html` にリダイレクト
- `getCurrentUser()` — 現在のユーザー情報取得
- `signOut()` — ログアウト + login.html にリダイレクト
- `onAuthStateChange(callback)` — 認証状態変化リスナー
- `getAuthToken()` — 現在の JWT トークン取得（fetch + keepalive 用）

### 4. 新規ファイル: `login.html` + `login.js`（ログインページ）

**UI構成:**
- メールアドレス入力 → マジックリンク送信
- Google OAuth ボタン
- 認証成功 → admin.html にリダイレクト

### 5. `admin.html` の変更

- `<script src="auth.js"></script>` を `admin.js` の前に追加
- サイドバー下部にログアウトボタン、ユーザー情報セクション追加

### 6. `admin.js` の変更

- 初期化に認証ゲート追加（未認証 → login.html にリダイレクト）
- `addEvent()` に `owner_id` 追加
- `beforeunload` の Authorization ヘッダーを認証トークンに変更
- 初回ログイン時の既存イベント所有権クレーム

### 7. `trigger.html` の変更

- ブラウザセッション共有方式（管理者が同じブラウザでログイン済みなら動作）
- 未認証の場合はエラーメッセージ表示

### 8. `config.js` の変更

- `getAuthToken()` ヘルパー関数を追加

### 9. `app.js`（参加者側）— 変更なし

### 10. `style.css` — ログインページ用スタイル追加

---

## Phase 2: テナント機能（次回・概要のみ）

### `tenant` スキーマ作成（別リポジトリ再利用可能）

```
tenant.organizations  — 組織/テナント
tenant.memberships    — メンバーシップ（ユーザー × 組織 × ロール）
tenant.invitations    — 招待（メール、トークン、有効期限）
```

- `profiles` を `public` → `tenant` スキーマに移動
- `events` に `tenant_id` カラム追加
- 個人アカウント: サインアップ時に「個人テナント」を自動作成（透過的）
- 組織作成: 管理画面の設定ビューから
- RLS: `tenant.is_member_of(tenant_id)` ヘルパー関数でポリシー制御

---

## Phase 3: ホスティング移行 + 決済準備（将来・方針のみ）

### ホスティング移行候補

| 候補 | 利点 | 欠点 |
|------|------|------|
| **Cloudflare Pages** | 無料枠大、Edge Workers、高速 | Workers の学習コスト |
| **Vercel** | デプロイ簡単、Edge Functions | 無料枠制限あり |
| **Netlify** | シンプル、Functions | Build分数制限 |
| **GitHub Pages 維持 + Edge Functions のみ** | 移行不要 | 環境変数管理が弱い |

### 決済連携準備
- `tenant.organizations` に `stripe_customer_id`, `stripe_subscription_id`, `plan` カラム
- Stripe Webhook 用 Edge Function 作成
- プラン制限: `max_events`, `max_members` を RLS で強制

---

## 変更ファイル一覧

| ファイル | 操作 | Phase |
|---------|------|:-----:|
| `sql/migration-auth-phase1.sql` | **新規作成** | 1 |
| `auth.js` | **新規作成** | 1 |
| `login.html` | **新規作成** | 1 |
| `login.js` | **新規作成** | 1 |
| `config.js` | 修正 | 1 |
| `admin.html` | 修正 | 1 |
| `admin.js` | 修正 | 1 |
| `trigger.html` | 修正 | 1 |
| `style.css` | 修正 | 1 |
| `app.js` | **変更なし** | - |
| `index.html` | **変更なし** | - |

## 検証方法

1. login.html → Google OAuth → admin.html にリダイレクト
2. マジックリンク: メール受信 → リンククリック → admin.html
3. 未認証で admin.html → login.html にリダイレクト
4. 新規イベントに owner_id が設定されること
5. 別ユーザーのイベントが見えないこと
6. 参加者: index.html?event=ID でログイン不要、回答送信可能
7. trigger.html: ログイン済みブラウザで動作確認
