---
name: denshinkun-enquete
description: "伝心くん（Enquete-system）の回答読み出し・設問の追加/編集・配信操作、スライド連携（reveal.js / PowerPoint）を行うとき。「伝心くん」「でんしんくん」「アンケート設問」「参加者の回答を読んで」「スライドにアンケートを埋める」「操作トークン」等で使用。"
---

# 伝心くん（Enquete-system）の読み書き

セミナー参加者がスマホから回答するリアルタイムアンケート「伝心くん」を、Supabase MCP 経由で読み書きするためのスキル。

## 接続先

| 項目 | 値 |
|---|---|
| Supabase project ref | `fahqkdfrmgkhdcrocllc` |
| プロジェクト名 | `Enquete-system`（東京 ap-northeast-1） |
| 公開サイト | `https://nfukuda56.github.io/Enquete-system/` |
| リポジトリ | `nfukuda56/Enquete-system` |
| 参加者画面 | `index.html?token={events.public_token}` ← **`?event=` ではない** |
| 管理画面 | `admin.html` |
| スライド埋め込み | `embed.html?qid={設問ID}&t={操作トークン}` |
| PowerPoint 連携 | `trigger.html?t={操作トークン}&qid={設問ID}` |

読み書きは `mcp__Supabase__execute_sql`（project_id は上記 ref）を使う。DDL は不要な設計なので `apply_migration` は基本使わない。

**最初に必ずイベントを特定する。** `select id, name, public_token from events order by id;` で、ユーザーの言うイベント／トークンがどの `id` かを確認してから作業する。イベントを取り違えた書き込みは本番データを壊す。

## テーブル構成（必要な分だけ）

### `events`
`id` / `name` / `public_token` / `is_active` / `text_display_enabled` / `image_display_enabled` / `material_url` / `expected_participants`

### `questions`
| 列 | 内容 |
|---|---|
| `event_id` | どのイベントの設問か |
| `question_text` | 設問文 |
| `question_type` | **CHECK制約で5種のみ**：`single` / `multiple` / `text` / `rating` / `image` |
| `options` | jsonb の**文字列配列**。`single`/`multiple` は選択肢。`rating` は**ちょうど5要素**のときだけラベルとして使われる。`text`/`image` は null |
| `sort_order` | 表示順（参加者画面はこの昇順で取得） |
| `is_active` | false にすると参加者側から消える（管理画面には残る）。「映さない設問」に使える |
| `is_required` | 必須フラグ |
| `duplicate_mode` | `overwrite`（1人1回・上書き）／`append`（1人が何度でも追記） |

### `responses`
`question_id` / `session_id` / `answer` / `created_at` / `policy_agreed_at` /
`moderation_status` / `moderation_categories` / `moderation_timestamp`

回答の保存形：
- `single` → 選んだ選択肢の文字列そのもの
- `multiple` → JSON配列の文字列 `["A","B"]`
- `rating` → 1〜5
- `text` / `image` → 本文または画像URL（モデレーション対象）

モデレーション列の読み方：
- `moderation_timestamp` が **null = 未処理**（Edge Function を通っていない）。SQL で直接 insert した回答はこれになる。管理画面・投影画面では薄黄色のカードで表示される
- `moderation_categories` は OpenAI の `category_scores`（カテゴリ名→0〜1の数値）
- 自由記述は、管理画面で結果を開いた時点で未処理分が自動的に審査へ回る（1回20件まで）。**画像は対象外**

### `admin_state`
`event_id`（unique）/ `current_question_id` / `is_presenting` / `updated_at`。**イベントごとに1行**で、いま何番を配信しているかを持つ。

### `event_control_tokens`
`event_id`（PK）/ `token` / `created_at`。スライド連携用の**操作トークン**。

- `public_token`（参加者URL用）とは**別の値**。混同しないこと
- **anon からはテーブル権限ごと遮断してある**（RLS だけでなく GRANT も剥がしてある）。意図的な設定なので「開放されていない」ことを問題として報告したり、開けたりしない
- イベント作成時にトリガで自動発行される
- 取得は MCP 経由の SQL のみ（下記）

```sql
select e.id, e.name, e.public_token, t.token as control_token
from events e left join event_control_tokens t on t.event_id = e.id
where e.is_active order by e.id;
```

## 読み出しの作法

- **`moderation_status = 'blocked'` を必ず除外する。** 管理画面は除外して表示しているので、SQLで直接読むと除外を忘れてブロック済み投稿を拾う。
- **`duplicate_mode='append'` の設問は1人が複数行を持つ。** 集計前に「session_id ごとに最新1件へ寄せる」か「全件を意図して使う」かを決める。
- **個人の追跡は `session_id` で行う。** localStorage 由来なので、同じ端末なら設問をまたいで同一値。設問Aと設問Bを session_id で突き合わせれば個人の流れを復元できる（ブラウザ変更・履歴削除で切れる）。

集計の基本形：

```sql
select q.id, q.sort_order, q.question_type, q.question_text,
       count(r.id) filter (where r.moderation_status is distinct from 'blocked') as n
from questions q left join responses r on r.question_id = q.id
where q.event_id = :event_id
group by q.id order by q.sort_order;
```

自由記述の一覧：

```sql
select session_id, answer, created_at from responses
where question_id = :qid and moderation_status is distinct from 'blocked'
order by created_at;
```

## 設問の追加・編集

```sql
insert into questions (event_id, question_text, question_type, options, is_required, is_active, sort_order, duplicate_mode)
values (:event_id, :text, 'single', '["選択肢1","選択肢2"]'::jsonb, false, true, :sort_order, 'overwrite')
returning id;
```

- `options` は必ず `::jsonb` でキャストした**文字列配列**。オブジェクトの配列は参加者画面が描画できない。
- `rating` のラベルは**5個ちょうど**。それ以外の個数だと既定ラベルに落ちる。
- `sort_order` は既存の最大値+1 を基本に。途中に差し込むときは既存を空けるか小数を避けて振り直す。
- **会期中の追加はそのまま使える。** 参加者が画面を開いたあとに追加した設問も、講師が配信に切り替えた時点で各端末が自動で取り直す（リロード不要）。
- **`is_active=false` の設問を配信すると参加者は待機画面になる**（「映さない設問」として意図的に使える）。あとから `true` に戻せば、次の `admin_state` 更新（ハートビートは30秒間隔）で自動復帰する。
- 設問IDを使うスライドリンクがある場合、**`sort_order` の変更は表示順指定（`q=`）のリンクを壊す。** ID指定（`qid=`）なら影響しない。

## 配信操作（admin_state）

### `admin_state` を直接 UPDATE しない

参加者画面は `admin_state.updated_at` が **90秒**より古いと「管理者不在」とみなして待機画面に戻る。管理画面は開いている間 **30秒ごと**に `updated_at` を打ち続けている。

つまり **`is_presenting=true` を書いても、管理画面を閉じていれば90秒で配信が切れる。** 逆に管理画面が開いていれば向こうが同じ行を上書きしうる。

### 切り替えが必要なときは RPC を使う

直接 UPDATE ではなく、操作トークンを検証する関数を呼ぶ。戻り値で成否が分かる。

```sql
select set_current_question(:control_token, :question_id);  -- question_id = 0 で配信終了
select set_current_question_by_order(:control_token, :order); -- 表示順（1始まり）、0 で配信終了
select touch_admin_state(:control_token);                    -- ハートビートのみ（通常は不要）
```

戻り値：

```json
{ "ok": true,  "event_id": 9, "question_id": 33, "presenting": true }
{ "ok": false, "error": "invalid_token" | "question_not_found" | "order_out_of_range" }
```

- イベントを跨いだ操作はできない（トークンに紐づくイベントの設問のみ）
- `is_active=false` の設問は `question_not_found` になる
- **配信の主役は講師の管理画面**。このスキルが切り替えるのはユーザーが明示的に頼んだときだけで、**作業前の `current_question_id` / `is_presenting` を記録し、終わったら戻す**
- RPC では「`current_question_id` を保持したまま `is_presenting=false`」は作れない。元の状態に厳密に戻す必要があるときは管理画面から操作してもらう

## スライド連携

**詳細はリポジトリの `doc/external_integration.md` を読む。** スライドに埋め込む構文、reveal.js の設定、失敗モードの切り分けがまとまっている。このスキルから生成するときも、まずそれを参照する。

要点だけ：

- **reveal.js**：該当スライドに `iframe` を1つ置く。`src` ではなく **`data-src`**
  ```html
  <iframe data-src="https://nfukuda56.github.io/Enquete-system/embed.html?qid=33&t=TOKEN"
          width="1600" height="700" frameborder="0" allowtransparency="true"></iframe>
  ```
- **`Reveal.initialize({ preloadIframes: false })` を必ず明示する。** `true` だと隣接スライドが先読みされ、まだ映していない設問が参加者に配信される
- `t` を渡すと設問切り替えも行う。**`t` 付きの iframe を同一スライドに2つ置かない**
- スライドはどこに置いてもよい（ローカルファイルでも動く）。ログインも同一オリジンも不要
- `embed.html` は投影専用。操作ボタンを出さず、`text_display_enabled` / `image_display_enabled`（緊急停止）を尊重する
- **PowerPoint**：`trigger.html?t=TOKEN&qid=33`。旧形式 `?event=1&q=3` は廃止済みで動かない

### 操作トークンの扱い

- **公開されるものに書かない。** GitHub の公開リポジトリ、公開スライド、Artifact などに埋め込まない
- ローカルのスライドファイルに埋めるのは想定内の使い方
- 漏れてもできるのは「そのイベントの表示設問を変える」ことだけ。回答データの読み書きや他イベントへの影響はない

## 書き込み前の確認

- **本番イベントに書く前に必ず確認を取る。** テスト環境（名前に `test` が入るイベント）以外への insert/update/delete は、対象イベント名・設問文・形式を提示して承認を得てから実行する。
- **検証目的の設問には識別できる印を付ける**（例：設問文の頭に `【テスト】`）。作業後に消せるようにしておく。
- **削除は範囲を明示してから。** `responses` は `questions` を参照しているので、設問を消す前に紐づく回答を消す必要がある。何件消えるかを先に数えて伝える。

テスト環境：`event_id = 9`（`生成AIセミナー_実用事例_test`）。

## 実機で確かめたいとき

ブラウザツールが使える場合、参加者URL（`?token=`）を開いて `get_page_text` で画面を読むのが確実。検証中は管理画面を閉じない（90秒で待機画面に戻り、失敗と紛らわしい）。

参加者画面のコンソールログ：

- `admin_state変更:` … 切り替えを受け取った
- `未知の質問IDのため質問を再取得します: <ID>` … 会期中に追加された設問を取り直している
- `後続の admin_state に追い越されたため中断します` … 高速切り替え時の保護が働いた
- `admin_state が古い（タイムアウト）` … ハートビートが止まっている

## 既知のセキュリティ状況（ユーザー把握済み・対応不要）

- `questions` / `responses` / `admin_state` / `events` の RLS ポリシーが anon に対して実質全開になっている。指摘済みなので、依頼されない限り蒸し返さない
- `set_current_question` 等3つの RPC は **anon から実行可能な `security definer` 関数**。これは設計意図そのもの（トークン検証を関数内で行う）。Supabase のアドバイザが WARN を出すが対応不要
- `event_control_tokens` だけは**意図的に anon から遮断してある**。上記の「全開」の例外なので、他テーブルに合わせて開けない
- `account_deletion_tokens` の RLS 未有効（アドバイザ ERROR）は未対応の既存課題。依頼されたときだけ扱う
