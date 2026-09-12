# cg-exam — 開発サマリー（2026-09-11 〜 2026-09-12）

*[English version here](CHANGELOG.en.md)*

このドキュメントは、2日間の開発セッションで `cg-exam` デモ（CG Creator Certification 模擬試験アプリ、
本番: https://perxona-manabi.netlify.app/ ）に加えた新規開発・実装のまとめです。Git のコミット履歴
（`9987194`〜`54b1c96`、全28コミット）を基に、機能単位で整理しています。

対象ファイル: `samples/express/public/demos/cg-exam/`（`index.html` / `avatar.js` / `avatar.css` /
`analytics.html` / `data/*.json`）、`samples/express/server.mjs`、およびそのミラーである
`deploy/netlify-cg-exam/`（Netlify Functions + 静的ファイル一式）。

---

## 1. AIアバターへの自由質問機能

- 「AIに質問する」フリーテキスト入力フォームをアバターパネルに追加。音声入力（🎤ボタン、Web Speech API）にも対応。
- 質問文の言語に関わらず、**UIの言語トグルに厳密に従って回答**するよう修正（当初は質問文の言語に引きずられて誤った言語で答える不具合があった）。

## 2. 学習者の質問ログ分析機能

- すべての質問・ヒント利用を記録するバックエンドを追加:
  - Express: `POST /api/log-question`（ローカルJSONLファイルに追記）、`GET /api/analytics`（パスワード保護）
  - Netlify: 同等の機能を `@netlify/blobs` ベースの Functions として実装
- パスワードゲート付きの分析ダッシュボード `analytics.html` を新規作成:
  - 総件数・自由質問数・ヒント数・回答成功数・言語別件数の集計
  - 分野別の棒グラフ、直近14日間の日別件数グラフ
  - キーワード検索付きの質問一覧テーブル
  - ホーム画面フッターに控えめなリンクを設置

## 3. 「ヒント」機能（正解を絶対に明かさない設計）

- 押すと設問の意図をAIが解説する「ヒント」ボタンを追加。**正解には一切触れない**よう厳格にプロンプト設計。
- フィードバックを受けて段階的に改良:
  - 冒頭の説明を約200字に簡潔化
  - 一問一答ではなく、同じ入力欄を使った**複数ターンのソクラテス式対話**に進化
  - 選択肢を絞り込む「消去法」を促す問いかけを明示的に追加

## 4. バグ修正（アバター周り）

- **無音バグ**: ヒント表示時にテキストは出るが音声が出ない不具合を修正（`speak()` が Presenter の "Ready" 状態を待たずに発火する競合状態が原因）。
- **発話の割り込み**: ボタン操作のたびに前の発話を止めて新しい発話を開始するよう修正。
- **空白エラーメッセージ**: HTTP/2 では `statusText` が常に空文字列になる仕様に起因する、学習者に表示される空のエラーメッセージを修正。

## 5. アプリの汎用化（データ駆動アーキテクチャへの全面リファクタ）

以前は「CGクリエイター検定」専用にハードコードされていたアプリを、**JSONデータを追加するだけで
新しい検定を追加できる**構造に全面刷新。

- 設問・分野・分野数・1分野あたり問題数・セット数・合格点・制限時間などをすべて `data/<exam-id>.json` に外部化
- `data/manifest.json` で検定一覧を管理し、トップページに検定選択グリッドを新設
- 画面表示テキストを「アプリ共通（言語のみ依存）」と「検定固有（構造の数値に依存して自動計算）」の2層に分離
- アバター（`avatar.js`）も特定の検定名をハードコードせず、`onExamLoad()` で受け取った検定名を動的に使うよう変更

### 追加された検定（データのみの追加で実現）

1. **世界遺産検定 2級**（世界遺産検定公式サイトの出題形式を参考に、問題文はすべてオリジナルで新規作成。150問・日英対応）
2. **CGクリエイター検定 ベーシック**（既存データを外部化。のちに300問を全面書き直し — 下記参照）
3. **CGクリエイター検定 エキスパート**（ユーザー提供のPDF問題集の**章構成のみ**を参考に、問題文は100%オリジナルで新規作成。150問・日英対応）

## 6. CGクリエイター検定ベーシックの問題バンク刷新

- ユーザーからのフィードバック「回答が頻出し、ダブりが多い」を受け、既存300問バンクの選択肢の重複を分析
- 分野ごとの語彙プールに基づき選択肢を再構成し、同一用語の出現回数を最大11回→5回に削減
- 同じ知識を2回問う重複問題を検出・新規概念に差し替え
- セット内の設問順を分野ブロック順からシャッフル順に変更（この過程で見つけた、シャッフル後もラベル計算が
  ブロック順を前提としていたバグ、および `view()` がラベル用データを欠落させていたバグも修正）

## 7. 検定選択・ナビゲーションの改善

- 検定選択ページをソート（CGベーシック→CGエキスパート→世界遺産検定の順にグループ化）
- 「検定選択に戻る」ボタンを新設し、当初は各画面に個別配置していたものを、**言語切り替えトグルの直下に
  固定表示される1つのボタン**に統合（問題演習中は確認ダイアログ付き、結果画面は確認なしで即座に遷移）
- 質問ログ分析ページへのリンクを検定選択ページ下部にも追加し、両方とも新規タブで開くよう変更
- 質問ログ分析ページにも検定選択ページを新規タブで開くリンクを追加（相互リンク化）

## 8. 質問ログ分析ページの機能強化

- **英語ローカライズ**: 日英切り替えトグルを追加し、統計・分野別集計・テーブル・タグ・日時表記まで全項目を翻訳
- **分野別集計の統合**: ログに記録される分野名は記録時のUI言語のまま保存されるため、同じ分野が言語違いで
  別々の棒グラフに分裂する不具合を修正。各検定のデータファイルから日英の分野名マッピングを構築し、
  集計時に正規化してから表示言語でラベル付けするよう変更
- **CSVダウンロード**: 検索フィルタ中の絞り込み結果をUTF-8 BOM付きCSVでエクスポートするボタンを追加
  （Excelでの文字化け対策）
- **ユーザー列**: 質問一覧テーブルにログ記録者名を表示する列を追加（下記9.参照）

## 9. ユーザー識別・パーソナライズ機能

- 検定選択ページに**任意の名前入力フォーム**を新設（`localStorage` に保存、以降のすべての質問・ヒントログに
  紐づけて記録）
- 「はじめる」ボタンを追加。クリックすると:
  - このブラウザでの**利用回数**（ローカルカウンタ）をインクリメント
  - サーバー上の**質問した数**を取得（新設の `GET /api/my-stats?sessionId=...` — 自分のセッション分の
    件数のみを返す認証不要のエンドポイント。管理者パスワードは不要）
  - 質問数×2＋利用回数のスコアに基づく**5段階ユーザーランク**（ビギナー→ブロンズ→シルバー→ゴールド→
    プラチナ）を算出
  - アバターが名前・ランク・過去の質問実績を参照しながら**励ましの挨拶**を発話
- 実装過程で発見したバグ: アバターパネル（画面右下固定表示、CSS `z-index:40`）が一部のボタンの上に
  視覚的に重なり、実際のマウスクリックがボタンではなく裏側のiframeに吸われて**クリック不能**になっていた
  （スクリプトの `.click()` 呼び出しでは再現しなかったため見過ごされていた）。全画面のコンテンツラッパー
  （`.wrap`）に `z-index:41` を設定し、恒久的に解消。

## 10. アバターの音声・性格の調整

- 英語・日本語それぞれのアバター音声を、より若く聞こえる声質（"cute and fast" シリーズ）に変更
- シーン選択の初期値を「Outdoor school（屋外の学校）」に変更（`.env` の変更・再デプロイ不要）
- **アバターの性格を「家庭教師」から「学習に付き添う応援アバター（友達）」に変更**。すべてのLLMプロンプトの
  人格設定を統一的に書き換え、対等でフレンドリーな口調になるよう調整

## 11. 検定選択ページのビジュアル刷新

- ユーザー提供のCSSデザインパック（3検定それぞれ専用のグラデーション背景＋インラインSVGモチーフ）を統合:
  - CGクリエイター検定 ベーシック — アイソメトリックな立方体
  - CGクリエイター検定 エキスパート — ワイヤーフレームの球体
  - 世界遺産検定 — 山＋古典建築のモチーフ
- 各検定カードの横に「解説」ボタンを追加。押すとアバターが約400字（英語は60〜70語）でその検定の概要を紹介
- 名前入力フォームを検定選択グリッドの**上部**に配置し直し

---

## 技術的な設計ノート

- **著作権への配慮**: 世界遺産検定・CGクリエイター検定エキスパートの問題は、公式サイトや外部のPDF/note記事
  から実際の問題文を一切転用せず、分野構成などの構造情報のみを参考にしてすべて新規に執筆した。
- **データ駆動設計**: 検定を追加する際にコード変更は不要（`data/<id>.json` を追加し `manifest.json` に
  1行加えるのみ）。
- **Express / Netlify の二重メンテナンス**: `samples/express/` が開発の一次ソースで、変更のたびに
  `deploy/netlify-cg-exam/` へ手動でミラーしている（サーバーサイドのルートは `server.mjs` と
  `netlify/functions/*.mjs` を個別に実装）。
- **検証方針**: 各機能はローカル環境（`npm run dev`、ポート8083）で実機ブラウザ操作により動作確認した上で
  本番（Netlify）へのデプロイ反映を確認してから完了としている。

## 主要コミット一覧（時系列）

```
9987194 Add free-text "ask the AI" question form to cg-exam avatar panel
9960123 Merge feature/cg-exam-ask-question: free-text AI question form for cg-exam
99c101e Fix ask-question form answering in the wrong language after a lang toggle
b423f3e Force ask-question answers to strictly follow the UI language toggle
f021be6 Add voice input (mic button) to the ask-question form
c1c1eb7 Add learner question analytics: logging + a password-gated view
44d4319 Add a discreet analytics.html link to the cg-exam home screen footer
fc15552 Add a "Hint" button that never reveals the answer
22afea0 Fix blank error messages (requestJson's statusText fallback is always "" over HTTP/2)
b65b438 Fix silent Hint audio: speak() could fire before the presenter was Ready
6f31d4b Turn "Hint" into a multi-turn Socratic dialogue instead of a one-shot answer
af01425 Tighten the opening Hint to ~200 characters total
348d1bc Stop the avatar's current speech whenever a new action is triggered
b8f665d Nudge Hint's guiding questions toward process-of-elimination reasoning
818121e Generalize the mock-exam app: data-driven exams selected from a picker
d7911cb Add World Heritage Study Certification (世界遺産検定) Level 2 mock exam
95078eb Add CG Creator Certification Expert mock exam
1305ea8 Rewrite CG Creator Certification Basic question bank
8b999d0 Sort exam picker: group CG Creator certs before World Heritage
0edbcc4 Reduce answer repetition in CG Basic bank; randomize set order
886dbf2 Use a younger-sounding voice for the English avatar
7e633b2 Add "Choose another exam" button to the quiz and result screens
83bbb45 Add English localization to the question-log analytics dashboard
290c754 Fix analytics domain translation; move exam-switch button under lang toggle
3edde10 Add cross-links between picker/analytics, per-exam Explain button, younger JA voice
57f6151 Default outdoor scene, optional username field, CSV export
f9be44d Add "Get Started" button with personal stats and a track-record-aware greeting
54b1c96 Colorful exam banners, name form reorder, 5-tier rank, companion persona
```
