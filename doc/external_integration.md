# 伝心くん 外部連携仕様

セミナーのスライドから伝心くん（Enquete-system）の設問配信と結果表示を制御するための仕様書。

**この文書の対象読者**：スライドを作成する人、およびスライド作成を支援する AI セッション。
スライドに伝心くんを組み込むときは、まずこの文書の該当章だけを読めば足りるように書いてある。

## 実装状況

| | 状態 | 章 |
|---|---|---|
| DB側（操作トークンと RPC） | 実装済み。**`sql/slide-control.sql` の適用が必要** | — |
| PowerPoint 連携（`trigger.html`） | 実装済み。**URL形式が変わった**（旧 `?event=&q=` は廃止） | 5章 |
| reveal.js / md スライド連携（`embed.html`） | 実装済み | 6章 |

いずれも**実機確認は未実施**。本番投入前に4章の手順で一度通すこと。

---

## 1. 前提と用語

- 公開URL：`https://nfukuda56.github.io/Enquete-system/`
- バックエンド：Supabase（project ref `fahqkdfrmgkhdcrocllc`）。フロントは素の JS でビルド工程なし
- 画面
  - `index.html` … 参加者画面（スマホ）。`?token=<public_token>` で開く
  - `admin.html` … 管理画面（講師）。設問管理・配信開始・結果表示。ログイン必須
  - `trigger.html` … PowerPoint 連携用。設問を切り替えて自動で閉じる
  - `embed.html` … スライド埋め込み用。結果表示と設問切り替えを兼ねる

| 用語 | 意味 |
|---|---|
| 配信 | `admin_state.is_presenting = true` の状態。参加者画面に設問が出る |
| 設問切り替え | `admin_state.current_question_id` を書き換えること |
| 待機画面 | 参加者画面が設問を表示していない状態 |
| 操作トークン | スライドから設問を切り替えるための秘密の文字列。イベントごとに1つ |

## 2. 連携の中核：`admin_state` 契約

外部連携はすべて `admin_state` テーブル1行（イベントごとに1行）を書き換えることで成立する。参加者画面はこの行を Realtime で購読している。

| 列 | 役割 | 誰が書くか |
|---|---|---|
| `event_id` | 対象イベント | 初回のみ |
| `is_presenting` | 配信中かどうか | admin.html の「プレゼン開始」。外部連携も切り替え時に `true` を立てる |
| `current_question_id` | いま参加者に出す設問 | **外部連携が書き換える対象** |
| `updated_at` | 最終更新時刻。**ハートビート** | admin.html が30秒ごと |

### ハートビートに関する重要な制約

参加者画面は `updated_at` が **90秒**より古いと「管理者不在」と判断して待機画面に落ちる。この `updated_at` を30秒ごとに打っているのは **admin.html だけ**。

**セミナー中は admin.html を開いたままにしておくこと。** 閉じると90秒後に参加者全員が待機画面に落ちる。裏のタブ・裏のウィンドウでよい。

admin.html は `admin_state` の変更を購読して自分の表示も追従させるので、外部から設問を切り替えると**管理画面も同じ設問に移動する**。プロジェクタ出力が落ちたときのバックアップ表示として使える。

## 3. 認証：操作トークン方式

**ログインは不要。スライドをどこに置いてもよい。** ローカルファイル（`file://`）、USB、ローカルサーバ、GitHub Pages、どれでも動く。ブラウザやプロファイルの一致も不要。

### 仕組み

`admin_state` の直接 UPDATE は RLS でイベント所有者に限定されている。外部連携はこれを直接触らず、**操作トークンを検証する関数（RPC）経由で書き込む**。

```
set_current_question(p_control_token, p_question_id) → jsonb
set_current_question_by_order(p_control_token, p_order) → jsonb
```

関数は `security definer` で RLS をバイパスする代わりに、トークンを自分で検証する。トークンが対応するイベント以外は触れないので、イベントを跨いだ操作はできない。

読み取り（設問・回答・イベント情報）は**元から anon で通る**ので、認証は一切絡まない。

### 戻り値で成否が分かる

```json
{ "ok": true,  "event_id": 9, "question_id": 33, "presenting": true }
{ "ok": false, "error": "invalid_token" }
{ "ok": false, "error": "question_not_found" }
{ "ok": false, "error": "order_out_of_range" }
```

以前の方式は RLS に弾かれても「0件更新で成功扱い」になり、**無言で失敗**していた。現在は `trigger.html` も `embed.html` も失敗を画面に出す。

### 操作トークンの取り扱い

- `public_token`（参加者URL用）とは**別の値**。参加者URLから推測できない
- `event_control_tokens` テーブルに保存され、**参加者（anon）からは読めない**
- スライドファイルに埋め込まれるため、**スライドを公開しないこと**
- 漏れた場合にできるのは「そのイベントの表示設問を変える」ことだけ。回答データの読み書きや他イベントへの影響はない

## 4. 運用手順

1. プレゼン用PCの Chrome で `admin.html` を開き、ログインする
2. 対象イベントを選択する
3. 「プレゼン開始」を押す（`is_presenting = true`、ハートビート開始）
4. admin.html のタブ／ウィンドウは**閉じずに裏に置く**
5. スライドを開いて進行する
6. 終了時、admin.html で「プレゼン終了」を押す

スライドを表示するPCと admin.html を開くPCは、分けても同じでもよい。トークン方式なのでログイン状態を共有する必要はない。**1台にまとめるとバックアップ表示も兼ねられるので単純。**

## 5. PowerPoint 連携

スライドにハイパーリンクを埋め、プレゼン中にクリックすると設問が切り替わる。PowerPoint は HTML を表示できないため、**結果を見るには admin.html へウィンドウを切り替える必要がある**。

### URL 形式

```
https://nfukuda56.github.io/Enquete-system/trigger.html?t={操作トークン}&qid={設問ID}
```

| パラメータ | 必須 | 説明 |
|---|---|---|
| `t` | ○ | 操作トークン |
| `qid` | △ | **設問ID**。`0` で配信終了 |
| `q` | △ | 表示順（1始まり）。`qid` の代わりに使える。`0` で配信終了 |

`qid` と `q` はどちらか一方。**`qid`（ID指定）を推奨**。`q` は設問IDを調べずに手書きできるが、`sort_order` を変更すると対応がずれる。

例：

```
設問を表示:   trigger.html?t=Ab3_xY9z-QwE&qid=33
表示順で指定: trigger.html?t=Ab3_xY9z-QwE&q=2
プレゼン終了: trigger.html?t=Ab3_xY9z-QwE&qid=0
```

`trigger.html` は処理後に自動でタブを閉じようとする。

### 旧URL形式は廃止

`?event=1&q=3` は**動かない**。旧形式で開くと「URL形式が変わりました」と表示される。既存スライドのリンクは張り替えが必要。

旧形式は認証済みセッションを必要とし、既定ブラウザが admin.html と違うだけで無言で失敗していた。新形式にはその問題がない。

## 6. reveal.js / md スライド連携

reveal.js は HTML なので、`embed.html` を iframe で埋め込むことで**ウィンドウを切り替えずにスライド内に結果を表示できる**。

### 設計の要点

スライド側に Supabase クライアントもログインも置かない。`embed.html` が

1. `admin_state.current_question_id` の書き換え（`t` を渡したとき）
2. 結果の表示

の両方を担う。スライドは `iframe` を1つ置くだけなので、エクスポート後のスクリプト処理に連携ロジックを足す必要がない。

### `embed.html` のパラメータ

| パラメータ | 必須 | 既定 | 説明 |
|---|---|---|---|
| `qid` | ○ | — | 表示する**設問ID**。`0` は配信終了のみ行い何も表示しない |
| `t` | — | なし | 操作トークン。**渡すと設問切り替えも行う** |
| `drive` | — | — | `t` を渡しても切り替えたくないとき `drive=0` |
| `cols` | — | `4` | 自由記述カード／画像タイルの横並び枚数 |

### md の書き方

reveal.js の Markdown は生の HTML をそのまま通すので、該当スライドに `iframe` を直接書く。`src` ではなく **`data-src`** を使う。

```md
## 皆さんの回答

<iframe data-src="https://nfukuda56.github.io/Enquete-system/embed.html?qid=33&t=Ab3_xY9z-QwE"
        width="1600" height="700" frameborder="0" allowtransparency="true"></iframe>
```

- `data-src` にすると reveal.js が**そのスライドが表示された瞬間に iframe を生成し、離れると破棄する**。これにより
  - 設問の切り替えがスライド送りと同時に起きる
  - Realtime 接続がスライド枚数分たまらない
- `embed.html` の背景は透過なので、スライドの背景がそのまま透ける

### reveal.js の設定

```js
Reveal.initialize({
  preloadIframes: false,   // 必須：現在のスライドになったときだけ iframe を読む
});
```

`preloadIframes: true` だと隣接スライドの iframe も先読みされ、**まだ表示していないスライドの設問が参加者に配信されてしまう。** 必ず `false` を明示すること。

### 配信を止めるスライド

アンケートを使わないスライドでは、参加者画面は直前の設問を表示したままになる。明示的に待機画面へ戻すには `qid=0` のスライドを置く。

```md
<iframe data-src="https://nfukuda56.github.io/Enquete-system/embed.html?qid=0&t=Ab3_xY9z-QwE"
        width="1" height="1" frameborder="0"></iframe>
```

### 禁止事項

- **`t` 付きの iframe を同一スライドに2つ以上置かないこと。** どちらが最後に書くか不定になる
- 結果を複数設問ぶん並べたい場合は、1つだけに `t` を渡し、残りは `t` なし（または `drive=0`）にする

### 表示される内容

`embed.html` は投影専用なので、admin.html とは出すものが違う。

| | admin.html | embed.html |
|---|---|---|
| グラフ・統計 | ○ | ○ |
| 自由記述カード | ○（横幅に応じて自動列数） | ○（`cols` 枚で固定。既定4枚） |
| 未処理カードの薄黄色表示 | ○ | ○ |
| 「非表示」ボタン | ○ | **✕**（投影画面に操作UIを出さない） |
| モデレーション統計チップ | ○ | **✕**（講師は裏の admin.html で見る） |
| `text_display_enabled` の尊重 | ✕（常時表示） | **○** |
| `image_display_enabled` の尊重 | ✕（常時表示） | **○** |

最後の2行が重要。**`embed.html` は表示トグルと緊急停止を尊重する。** 投影画面なので安全弁が必要。緊急停止を押すと投影からは消え、admin.html では見え続ける（講師は中身を確認できる）。切り替えは Realtime で即座に反映される。

## 7. 回線が切れたときの挙動

伝心くん自体は回線なしでは機能しない（Supabase がクラウドのため）。確保できるのは「回線が死んでもスライドは通る」状態。

| | 回線あり | 回線なし |
|---|---|---|
| スライド本体の進行 | ○ | ○（ローカルファイルなら） |
| reveal.js のアセット | ○ | **要確認**（下記） |
| 結果の iframe | ○ | ✕（「結果を取得できませんでした」と静かに表示） |
| 設問切り替え | ○ | ✕ |
| 参加者のスマホ | ○ | ✕ |

`embed.html` は取得失敗時に例外を投げずメッセージを出すだけなので、**スライドの進行を妨げない。**

**未解決**：vscode-reveal の HTML エクスポートが reveal.js 本体をローカル同梱するか CDN 参照かは未確認。CDN 参照だと回線断でスライドが素のテキストになる。必要性が出た時点で対処する方針（エクスポート後スクリプトでのアセットローカル化）。

## 8. 設問タイプ

`questions.question_type` は5種（DB の CHECK 制約）。

| タイプ | 参加者側 | 結果表示 |
|---|---|---|
| `single` | ラジオボタン | 円グラフ＋内訳バー |
| `multiple` | チェックボックス | 円グラフ＋内訳バー |
| `rating` | 1〜5の評価 | 棒グラフ |
| `text` | テキストエリア | カード一覧（`cols` 枚） |
| `image` | 画像アップロード | タイル表示（`cols` 枚） |

グラフは**回答率が30%を超えるまで表示されない**（`events.expected_participants` が設定されている場合）。それ以下では案内文が出る。未設定なら常に表示。

回答率は「イベント全体のユニークセッション数 ÷ `expected_participants`」で、admin.html と `embed.html` で同じ条件。`text` と `image` はこの制限を受けず常に一覧表示される。

## 9. ID・トークンの調べ方

Supabase の SQL エディタで実行する（`event_control_tokens` は anon から読めないため、管理画面やブラウザからは引けない）。

```sql
SELECT e.id            AS event_id,
       e.name,
       e.public_token  AS 参加者URL用,
       t.token         AS スライド操作用,
       q.id            AS question_id,
       q.sort_order,
       q.question_type,
       q.question_text
  FROM events e
  LEFT JOIN event_control_tokens t ON t.event_id = e.id
  LEFT JOIN questions q ON q.event_id = e.id AND q.is_active = true
 WHERE e.is_active = true
 ORDER BY e.id, q.sort_order;
```

操作トークンはイベント作成時にトリガで自動発行される。

`qid` には `is_active = true` の設問IDを使う。`is_active = false` の設問を指定すると RPC が `question_not_found` を返し、画面に警告が出る。

## 10. 失敗モードと切り分け

| 症状 | 最初に疑うこと |
|---|---|
| スライドを送っても参加者画面が変わらない | `t`（操作トークン）を渡しているか。`embed.html` の右上に警告が出ていないか |
| 「操作トークンが不正」と出る | トークンの転記ミス、またはイベントが `is_active = false` |
| 「設問が見つからない」と出る | その設問が `is_active = false`、または別イベントの設問IDを指定している |
| `trigger.html` が「URL形式が変わりました」と出る | 旧形式のリンク。5章のとおり張り替える |
| 参加者全員が突然待機画面になった | admin.html を閉じていないか。ハートビートが止まると90秒で落ちる |
| まだ表示していないスライドの設問が配信された | `preloadIframes: false` を設定したか |
| グラフが出ず「30%」の案内が出る | 回答率不足。`expected_participants` の設定値を確認 |
| 自由記述が1枚も出ない（投影のみ） | `events.text_display_enabled` が false（緊急停止を押した状態）。admin.html では見える |
| 「結果を取得できませんでした」 | 回線断、または `sql/slide-control.sql` 未適用 |

参加者画面のコンソールで進行を追える。

- `admin_state変更:` … 切り替えを受け取った
- `未知の質問IDのため質問を再取得します: <ID>` … 会期中に追加された設問を取り直している
- `admin_state が古い（タイムアウト）` … ハートビートが止まっている（admin.html を確認）

## 11. 既知の問題

- **`admin.html` の `beforeunload` クリーンアップは機能していない。** 退出時に `is_presenting = false` を送る処理が anon キーを明示指定しているため RLS に弾かれる。実害は「閉じても配信フラグが残る」だけで、90秒後に鮮度切れで参加者は待機画面になる。RPC 方式に寄せれば直せる
- **操作トークンを admin.html から確認できない。** 現状は SQL エディタで引く必要がある（9章）
- **画像設問の未処理データは自動モデレーションの対象外。** 自由記述のみ、結果表示時に未処理分を自動で審査に回している
- **集計ロジックが2箇所にある。** `admin.js` の `calculateStats()` と `embed.html` の同名関数。片方だけ直すと管理画面と投影画面で数字が食い違う。両ファイルに相互参照のコメントを置いてある
