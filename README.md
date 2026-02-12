# Enquete-system
セミナー用リアルタイムフィードバックシステム

Supabaseをバックエンドに使用したリアルタイムアンケートシステムです。GitHub Pagesで無料ホスティング可能。

## 特徴

- **リアルタイム更新**: Supabase Realtimeによる即座の回答反映
- **イベント管理**: イベントごとに質問・回答を管理
- **QRコード生成**: 参加者用URLのQRコードを自動生成
- **一問一答形式**: 参加者は1問ずつ回答（スキップ・再回答可能）
- **多彩な質問形式**: 単一選択、複数選択、自由記述、5段階評価、画像アップロード
- **画像投稿機能**: スマホから画像を投稿、タイル表示で一覧
- **グラフ可視化**: Chart.jsによる見やすいグラフ表示
- **レスポンシブデザイン**: モバイルデバイスに最適化
- **PowerPoint連携**: スライドからURLで質問表示を制御

## 構成

```
Enquete-system/
├── index.html              # 参加者用アンケートページ
├── admin.html              # 管理者用ダッシュボード
├── app.js                  # 参加者ページのロジック
├── admin.js                # 管理ページのロジック
├── config.js               # Supabase接続設定
├── trigger.html            # PPT連携用トリガーページ
├── test-connections.html   # 接続診断ページ
├── style.css               # スタイルシート
├── doc/                    # ドキュメント
│   ├── auth_login_plan.md  # アカウント制御・ログイン実装計画
│   ├── post_control_requirements.md  # 投稿制御機能 要件定義書
│   └── VERIFICATION.md     # 検証レポート
├── sql/                    # データベース
│   └── supabase-setup.sql  # Supabase セットアップSQL（統合版）
├── supabase/               # Supabase Edge Functions
│   └── functions/
│       └── moderate-content/index.ts
└── README.md
```

## セットアップ

### 1. Supabaseプロジェクトの作成

1. [Supabase](https://supabase.com) でアカウント作成・ログイン
2. 新しいプロジェクトを作成
3. SQL Editorで `sql/supabase-setup.sql` の内容を貼り付けて実行
   - テーブル、インデックス、RLSポリシー、Realtime、Storageバケットが一括作成されます

### 2. config.jsの設定

Supabase Dashboard → **Settings** → **API** から以下を取得し、`config.js` を編集:

```javascript
const SUPABASE_URL = 'https://あなたのプロジェクト.supabase.co';
const SUPABASE_ANON_KEY = 'あなたのanon key';
```

### 3. GitHub Pagesへデプロイ

1. GitHubリポジトリにプッシュ
2. Settings → Pages → Source から `main` ブランチを選択
3. デプロイされたURLにアクセス

## 使い方

### 管理者向け（admin.html）

**イベント管理タブ:**
1. 新しいイベントを作成
2. イベントを選択するとQRコードが表示
3. QRコードを参加者に共有

**質問管理タブ:**
- 質問を追加（タイプ選択、選択肢設定）
- 質問の順序変更（▲▼ボタン）
- 質問の編集・削除・表示/非表示切り替え

**回答結果タブ:**
- リアルタイムで回答状況を確認
- 前後の質問に移動して結果を表示
- グラフと統計で可視化

### 参加者向け（index.html?event=ID）

1. QRコードまたはURLからアクセス
2. 1問ずつ表示される質問に回答
3. スキップまたは「回答を送信」をクリック
4. 全問回答後、完了画面が表示

### PowerPoint連携（trigger.html）

スライドにハイパーリンクを埋め込み、プレゼン中にクリックするだけで参加者画面の質問を切り替えられます。管理画面も自動同期されます。

**URL形式:**
```
https://<あなたのGitHub Pages URL>/trigger.html?event={イベントID}&q={質問番号}
```

**パラメータ:**

| パラメータ | 説明 |
|-----------|------|
| `event` | イベントID（必須） |
| `q` | 質問番号（1始まり、必須） |
| `q=0` | プレゼン終了（待機画面に戻す） |

**ハイパーリンク例（イベントID=1の場合）:**
```
質問1を表示: trigger.html?event=1&q=1
質問2を表示: trigger.html?event=1&q=2
質問3を表示: trigger.html?event=1&q=3
プレゼン終了: trigger.html?event=1&q=0
```

**設定手順:**
1. PowerPointのスライドにテキストやボタンを配置
2. テキストを選択 → 右クリック → 「ハイパーリンク」
3. URLに `trigger.html?event=1&q=1` のように入力
4. プレゼン中にクリック → ブラウザが開き質問が切り替わる

**注意事項:**
- 管理画面の手動操作と併用可能（最後の操作が有効）
- 質問番号は管理画面での表示順（sort_order）に対応

## 質問タイプ

| タイプ | 説明 |
|--------|------|
| 単一選択 | ラジオボタンで1つを選択 |
| 複数選択 | チェックボックスで複数選択可能 |
| 自由記述 | テキストエリアで自由入力 |
| 5段階評価 | 1〜5の数値で評価 |
| 画像 | スマホから画像をアップロード（800x800pxにリサイズ） |

## 技術スタック

- **フロントエンド**: HTML, CSS, Vanilla JavaScript
- **バックエンド**: Supabase (PostgreSQL + Realtime)
- **ストレージ**: Supabase Storage
- **グラフ**: Chart.js
- **QRコード**: qrcodejs
- **ホスティング**: GitHub Pages

## セキュリティ

- 現在の設定では誰でもアクセス・回答可能です
- 本番環境では適切な認証機能の追加を検討してください
- Supabase RLSポリシーを必要に応じて調整してください

## ライセンス

MIT License
