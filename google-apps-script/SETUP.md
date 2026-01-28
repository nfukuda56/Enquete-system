# Google Sheets + Apps Script セットアップ手順

このドキュメントでは、アンケートシステムのバックエンドとしてGoogle SheetsとApps Scriptを設定する手順を説明します。

## 前提条件

- Googleアカウント（無料）
- Google Sheets、Apps Scriptへのアクセス権限

## ステップ1: Google Spreadsheetsの作成

1. [Google Sheets](https://sheets.google.com/)にアクセス
2. 新しいスプレッドシートを作成
3. スプレッドシート名を「セミナーアンケート」などに変更

## ステップ2: シートの設定

### シート1: questions（質問データ）

1. シート名を「questions」に変更
2. 1行目（ヘッダー行）に以下を入力：

| A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|
| id | question_text | question_type | options | is_required | is_active | sort_order | created_at |

3. サンプルデータを追加（オプション）：

```
1 | 本日のセミナーの満足度を教えてください | rating |  | TRUE | TRUE | 1 | 2024-01-01T00:00:00Z
2 | 特に印象に残った内容を選んでください | multiple | ["講演内容","実践ワークショップ","Q&Aセッション","ネットワーキング"] | FALSE | TRUE | 2 | 2024-01-01T00:00:00Z
3 | 今後取り上げてほしいトピックはありますか？ | single | ["AI・機械学習","クラウド技術","セキュリティ","プロジェクト管理","その他"] | FALSE | TRUE | 3 | 2024-01-01T00:00:00Z
4 | ご意見・ご感想がありましたらお聞かせください | text |  | FALSE | TRUE | 4 | 2024-01-01T00:00:00Z
```

**フィールド説明:**
- `id`: 質問ID（数値）
- `question_text`: 質問文（テキスト）
- `question_type`: 質問タイプ（single / multiple / text / rating）
- `options`: 選択肢（JSON配列形式、single/multipleの場合のみ）
- `is_required`: 必須回答かどうか（TRUE / FALSE）
- `is_active`: 表示するかどうか（TRUE / FALSE）
- `sort_order`: 表示順序（数値）
- `created_at`: 作成日時（ISO 8601形式）

### シート2: responses（回答データ）

1. 新しいシートを追加（「+」ボタン）
2. シート名を「responses」に変更
3. 1行目（ヘッダー行）に以下を入力：

| A | B | C | D | E |
|---|---|---|---|---|
| id | question_id | session_id | answer | created_at |

**フィールド説明:**
- `id`: 回答ID（数値）
- `question_id`: 質問ID（数値）
- `session_id`: セッションID（テキスト）
- `answer`: 回答内容（テキスト / JSON配列）
- `created_at`: 回答日時（ISO 8601形式）

## ステップ3: スプレッドシートIDの取得

1. スプレッドシートのURLを確認
   ```
   https://docs.google.com/spreadsheets/d/【このID部分をコピー】/edit
   ```
2. IDをメモしておく（後で使用）

## ステップ4: Apps Scriptの設定

1. スプレッドシート上部メニューから **拡張機能 > Apps Script** をクリック
2. 新しいタブでApps Scriptエディタが開く
3. デフォルトのコード（`function myFunction() {...}`）をすべて削除
4. `google-apps-script/Code.gs` の内容をすべてコピーして貼り付け
5. 2行目の `YOUR_SPREADSHEET_ID_HERE` を、ステップ3で取得したスプレッドシートIDに置き換え
   ```javascript
   const SPREADSHEET_ID = 'ここに実際のIDを貼り付け';
   ```
6. 上部の「保存」アイコンをクリック（またはCtrl+S）

## ステップ5: Web Appとしてデプロイ

1. Apps Scriptエディタ右上の **デプロイ > 新しいデプロイ** をクリック
2. 「種類の選択」で **⚙️ ウェブアプリ** を選択
3. 以下のように設定：
   - **説明**: 「セミナーアンケートAPI」など
   - **次のユーザーとして実行**: 「自分」
   - **アクセスできるユーザー**: 「全員」
4. **デプロイ** をクリック
5. 初回は承認画面が表示されるので、以下の手順で承認：
   - 「アクセスを承認」をクリック
   - Googleアカウントを選択
   - 「詳細」→「（プロジェクト名）に移動」をクリック
   - 「許可」をクリック
6. デプロイ完了後、**ウェブアプリのURL** が表示されるのでコピー
   ```
   https://script.google.com/macros/s/【ここが長いID】/exec
   ```

## ステップ6: config.jsの更新

1. プロジェクトの `config.js` ファイルを開く
2. `APPS_SCRIPT_URL` の値を、ステップ5でコピーしたURLに置き換え
   ```javascript
   const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/【実際のID】/exec';
   ```
3. ファイルを保存

## ステップ7: 動作確認

1. ブラウザで `index.html` を開く
2. 質問が正しく表示されることを確認
3. テスト回答を送信
4. Google Sheetsの「responses」シートにデータが追加されることを確認
5. `admin.html` を開いて管理画面を確認

## トラブルシューティング

### 質問が表示されない

- ブラウザのコンソール（F12）でエラーを確認
- `config.js` のURLが正しいか確認
- Apps ScriptのデプロイURLが「/exec」で終わっているか確認
- Google Sheetsの「questions」シートにデータがあるか確認

### 回答が保存されない

- Apps Scriptのログを確認（Apps Script エディタ > 実行ログ）
- CORS エラーが出ている場合は、デプロイ設定で「アクセスできるユーザー: 全員」になっているか確認

### Apps Scriptの実行エラー

- スプレッドシートIDが正しく設定されているか確認
- シート名が「questions」「responses」で正確に一致しているか確認
- ヘッダー行が正しく設定されているか確認

## デプロイ更新時の手順

Apps Scriptのコードを変更した場合：

1. Apps Scriptエディタで変更を保存
2. 右上の **デプロイ > デプロイを管理** をクリック
3. 既存のデプロイの✏️（編集）アイコンをクリック
4. **バージョン** を「新バージョン」に変更
5. **デプロイ** をクリック

注意: URLは変わらないので、`config.js` の変更は不要です。

## セキュリティに関する注意

- 現在の設定では誰でもアクセス可能です
- 本番環境では、適切な認証機能の追加を検討してください
- Google Sheetsの共有設定は「リンクを知っている全員」以下にしてください
- Apps Script実行ログには個人情報が含まれる可能性があるため、定期的に確認・削除してください
