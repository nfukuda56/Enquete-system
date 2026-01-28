# Enquete-system
セミナー用リアルタイム参加者アンケート

Google Sheets + Apps Scriptを使用したシンプルなアンケートシステムです。GitHub Pagesで無料ホスティング可能。

## 特徴

- **完全無料**: Google Sheets + Apps Scriptで運用（Googleアカウントのみ必要）
- **リアルタイム集計**: 管理画面で回答状況を5秒ごとに自動更新
- **多彩な質問形式**: 単一選択、複数選択、自由記述、5段階評価に対応
- **グラフ可視化**: Chart.jsによる見やすいグラフ表示
- **静的ホスティング対応**: GitHub Pagesで簡単にデプロイ可能
- **レスポンシブデザイン**: モバイルデバイスにも対応

## 構成

- **`index.html`** - 参加者用アンケートページ
- **`admin.html`** - 管理者用ダッシュボード
- **`app.js`** - 参加者ページのロジック
- **`admin.js`** - 管理ページのロジック
- **`config.js`** - Apps Script URL設定
- **`style.css`** - スタイルシート
- **`google-apps-script/`** - Apps Scriptコードとセットアップ手順

## セットアップ

### 1. Google Sheets + Apps Scriptの設定

詳細な手順は [`google-apps-script/SETUP.md`](./google-apps-script/SETUP.md) を参照してください。

**概要:**
1. Google Spreadsheetsで新しいスプレッドシートを作成
2. 「questions」「responses」の2つのシートを設定
3. Apps Scriptでコードをデプロイ
4. Web App URLを取得

### 2. config.jsの設定

`config.js` を開き、Apps Script Web App URLを設定：

```javascript
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/【あなたのID】/exec';
```

### 3. ローカルでテスト

1. ブラウザで `index.html` を開く
2. 質問が表示されることを確認
3. テスト回答を送信
4. Google Sheetsに回答が保存されることを確認
5. `admin.html` で管理画面を確認

### 4. GitHub Pagesへデプロイ（オプション）

1. GitHubリポジトリにプッシュ
2. Settings > Pages > Source から `main` ブランチを選択
3. デプロイされたURLにアクセス

## 使い方

### 参加者向け（index.html）

1. アンケートページにアクセス
2. 表示された質問に回答
3. 「回答を送信」ボタンをクリック
4. 完了画面が表示されます

### 管理者向け（admin.html）

**回答結果タブ:**
- リアルタイムで回答状況を確認
- グラフと統計で可視化
- 自由記述回答を一覧表示

**質問管理タブ:**
- 新しい質問を追加
- 既存の質問を表示/非表示切り替え
- 質問の削除

## 質問タイプ

1. **単一選択（ラジオボタン）**: 選択肢から1つを選択
2. **複数選択（チェックボックス）**: 選択肢から複数選択可能
3. **自由記述（テキストエリア）**: 自由にテキストを入力
4. **5段階評価**: 1〜5の数値で評価

## 技術スタック

- **フロントエンド**: HTML, CSS, Vanilla JavaScript
- **バックエンド**: Google Apps Script
- **データベース**: Google Sheets
- **グラフ**: Chart.js
- **ホスティング**: GitHub Pages（または任意の静的ホスティング）

## トラブルシューティング

### 質問が表示されない

- `config.js` のURLが正しいか確認
- ブラウザのコンソール（F12）でエラーを確認
- Apps Scriptのデプロイ設定を確認

### 回答が保存されない

- Apps Scriptのログを確認
- CORS設定（「アクセスできるユーザー: 全員」）を確認
- Google Sheetsのシート名とヘッダー行を確認

詳細は [`google-apps-script/SETUP.md`](./google-apps-script/SETUP.md) のトラブルシューティングを参照してください。

## セキュリティ

- 現在の設定では誰でもアクセス・回答可能です
- 本番環境では適切な認証機能の追加を検討してください
- Google Sheetsの共有設定は「リンクを知っている全員」以下にしてください

## ライセンス

MIT License

## 貢献

Issue、Pull Requestを歓迎します。
