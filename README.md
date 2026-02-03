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

## 構成

```
Enquete-system/
├── index.html      # 参加者用アンケートページ
├── admin.html      # 管理者用ダッシュボード
├── app.js          # 参加者ページのロジック
├── admin.js        # 管理ページのロジック
├── config.js       # Supabase接続設定
├── style.css       # スタイルシート
└── README.md       # このファイル
```

## セットアップ

### 1. Supabaseプロジェクトの作成

1. [Supabase](https://supabase.com) でアカウント作成・ログイン
2. 新しいプロジェクトを作成
3. SQL Editorで以下を実行してテーブルを作成:

```sql
-- イベントテーブル
CREATE TABLE events (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    event_date DATE,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 質問テーブル
CREATE TABLE questions (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGINT REFERENCES events(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    question_type TEXT NOT NULL CHECK (question_type IN ('single', 'multiple', 'text', 'rating', 'image')),
    options JSONB,
    is_required BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 回答テーブル
CREATE TABLE responses (
    id BIGSERIAL PRIMARY KEY,
    question_id BIGINT REFERENCES questions(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    answer TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLSポリシー設定
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all access for events" ON events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all access for questions" ON questions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all access for responses" ON responses FOR ALL USING (true) WITH CHECK (true);

-- Realtime有効化
ALTER PUBLICATION supabase_realtime ADD TABLE events;
ALTER PUBLICATION supabase_realtime ADD TABLE questions;
ALTER PUBLICATION supabase_realtime ADD TABLE responses;
```

### 2. Storage バケットの作成（画像アップロード用）

1. Supabase Dashboard → **Storage** → **New bucket**
2. バケット名: `survey-images`
3. **Public bucket**: ON

4. SQL Editorで以下を実行してStorageポリシーを設定:

```sql
CREATE POLICY "Allow public uploads" ON storage.objects
FOR INSERT TO anon, authenticated
WITH CHECK (bucket_id = 'survey-images');

CREATE POLICY "Allow public read" ON storage.objects
FOR SELECT TO anon, authenticated
USING (bucket_id = 'survey-images');

CREATE POLICY "Allow public update" ON storage.objects
FOR UPDATE TO anon, authenticated
USING (bucket_id = 'survey-images');

CREATE POLICY "Allow public delete" ON storage.objects
FOR DELETE TO anon, authenticated
USING (bucket_id = 'survey-images');
```

### 3. config.jsの設定

Supabase Dashboard → **Settings** → **API** から以下を取得し、`config.js` を編集:

```javascript
const SUPABASE_URL = 'https://あなたのプロジェクト.supabase.co';
const SUPABASE_ANON_KEY = 'あなたのanon key';
```

### 4. GitHub Pagesへデプロイ

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
