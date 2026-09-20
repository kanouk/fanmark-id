# Cloudflare移行の実行・再開手順

親イシュー: [#28](https://github.com/kanouk/fanmark-id/issues/28)。親の移行仕様・受け入れ条件を正とする。#26と#27の試作はこの移行へ一括マージしない。

## 役割と使用枠

Astraが設計確定、作業分解、差分レビュー、検証結果の確認を行い、GPT-5.6 Luna（max）が範囲を区切った実装を担当する。設計不明点、認可/課金/ID/原子性に関わる変更はAstraが判断する。

通常Codex枠の残り20%がユーザー指定の下限。各実装単位の開始前とレビュー後に最新残量を取得する。22%以下では新規投入を停止し、実行中の作業を保存して引き継ぐ。残量取得に失敗した場合は新しい大きな作業を開始しない。他タスクの消費・表示遅延により20%を厳密に保証する仕組みではない。

使用量APIにはLunaに関連するgpt-reserve表示があるが、通常枠と独立して消費される条件は未確認。通常枠を使わない前提で作業量を決めない。DeepSeekなどの追加モデルは、この環境で実行可能と確認できた場合に限定した作業で評価する。利用できないモデルを使用済みと記録しない。

## 段階

- [0A: CIと環境境界を分離する](https://github.com/kanouk/fanmark-id/issues/29)
- [0B: 本番棚卸しと移行対応表を確定する](https://github.com/kanouk/fanmark-id/issues/30)
- [0C: Workers・D1上で認証と競合制御を検証する](https://github.com/kanouk/fanmark-id/issues/31)
- [0D: 現行Stripe Webhookの重複適用を防ぐ](https://github.com/kanouk/fanmark-id/issues/32)
- [1: Worker API契約とフロント配信を導入する](https://github.com/kanouk/fanmark-id/issues/33)
- [2A: D1・認証・R2・ジョブを実装する](https://github.com/kanouk/fanmark-id/issues/34)
- [2B: 再実行可能なデータ移行・照合を実装する](https://github.com/kanouk/fanmark-id/issues/35)
- [2C: 絵文字マスターの更新経路を移植する](https://github.com/kanouk/fanmark-id/issues/36)
- [3: 統合試験と切り替え・復旧をリハーサルする](https://github.com/kanouk/fanmark-id/issues/37)
- [4: 本番切り替えと監視・旧基盤終了を実施する](https://github.com/kanouk/fanmark-id/issues/38)

## 作業を渡すとき

対象ファイル、入力/出力、権限、保持するID/制約、変更範囲、依存、検証コマンドと期待結果を指定する。実装者の完了報告だけで段階を閉じず、Astraが差分と検証の証拠を確認する。ローカル実装、staging適用、本番適用、運用確認を分けて記録する。

## 今回の開始状態

- origin/mainから隔離したworktreeで開始。ヒーロー試作側のcheckoutは変更しない。
- #29のCI分離はPR #39でmainへ反映済み（b307dd4）。ローカル型検査・ビルド・workflow否定検査は成功。GitHub workflowはdisabled_manuallyのまま。#30のオフライン棚卸しと#31の初期local proofはPR #40でmainへ反映済み（e5a553c）。棚卸しは構文解析テストと再現性検査まで完了。全体の本番対応表・設定照合は未完了。
- #31は合成ユーザーの認証3テスト、D1同時操作/再試行/rollbackの8テストがlocal runtimeで成功。実OAuth、管理者MFA、既存hash、remote CPU/負荷、実業務全体の受け入れは未完了。
- 本番のread-only観測は [live-observations.md](live-observations.md) を参照。
- 本番データ更新、DNS変更、Cloudflare本番配備、課金操作は未実施。

## 再開時の確認

1. 最新の使用枠とGit状態、親/子イシュー、PRの状態を読む。保存時の残量を現在値と扱わない。
2. 未コミット作業を確認し、作業ツリーと実装者の担当範囲を復元する。
3. 前回の成功した検証と未確認条件を区別し、変更/失敗/未解決の理由がある範囲を検証する。
4. 次の未完了の実装単位を指定して再開する。本番切り替えは確認・監視・復旧までの余裕を確保してから開始する。

## 継続中の作業（2026-09-21）

PR #41は棚卸し・本番設定のread-only確認とWorker API境界を保存するdraft。対応案と再現用集計SQL、公開recent APIはコミット済み。以下の未コミット部分を完成済みと扱わない。

- `workers/api/`: 最近取得一覧の公開APIを6ebdf36で保存。応答列の制限、キー種別、Origin、タイムアウト、redirect、件数上限、実entrypointを含む14テスト、型検査、配備用dry-runがAstraの独立実行でも成功。remote未配備。フロントの明示的な接続先切り替えは394a9d0で保存し、9テスト・型検査をAstraも独立実行して成功。設定したWorkerが失敗してもSupabaseへ戻らない。合成Worker originを指定したViteビルドも成功し、値が生成物へ反映されることを確認。Workers Static Assetsの一体配信構成を80a56feで保存。新規Viteビルドに対する13件のlocalテスト・実HTTP smoke・配備用dry-runを確認し、CIへ組み込んだ。API/欠落アセットの404とSPA navigationの境界を維持する。OGP/Auth/admin/PWAの実環境確認とWorker起動コストは未検証。
- live recent-listのview/RPC定義をread-onlyで取得し、active licenseのみ・created_at降順・同時刻の順序未指定などの現行条件を記録（43f5e12）。再現SQLも実行済み。D1版の公開recent repositoryをe8ffc0eで保存。明示切り替え、microsecond保持、実D1 entrypointを含む4テストと既存API14件・静的配信13件・実HTTP smoke・型検査・dry-runが成功。取得可能判定APIとフロントの2箇所の判定を43f7207で接続。API21件・D1 availability7件・recent D1 4件・フロント6件、型検査、未設定/Worker指定build、静的配信13件+実HTTP smoke、dry-runが成功。本番公開RPC5ケースの応答も両validatorを通過。詳細取得/登録/Auth等は既存経路。全体の本番D1 schema/importは未完了。
- `experiments/cloudflare-auth/`: bcrypt/TOTPと管理者APIのセッション/factor-bound MFA proofを7a11d4dで保存。6件のlocal runtimeテストをAstraも再実行して成功。テスト用ログイン経路は通常Workerに含めない。7e37827でsingleton MFA generationとguard付き保存を追加。同じ因子のsecret変更、無関係な因子変更、generation欠落、置換・sign-outをlocal D1のbarrierで検証し、Astraの独立実行も6テスト成功。remote multi-Worker raceは未確認。実OAuth/既存因子移送/remote CPUは未完了。
- `docs/migration/stripe-ledger-design.md`: 現行Webhookの全分岐を受信・適用台帳とoutboxへ写す設計をf0b3a05で保存。BasilのInvoice.parentとD1 batchの境界もレビュー済み。receipt+dispatch保存のPostgreSQL基盤をe63152dで保存し、PGliteによる14テストをAstraも再実行して成功。署名付き受信factoryと正規化adapterを78d51e2で保存。実Stripe SDKの署名、サイズ/時間制限、重複/不正保存結果、PGlite保存経路を含む29テストとSDK型互換性をAstraも実行して成功。受信後のdispatch claim/renew/retryのlease制御を1f4246dで保存。古いtoken/generationの拒否、SQL時刻による期限、途中失敗のrollback、実SQL roleのACLを含む39件がAstraの独立実行でも成功。独立接続のPostgres競合・業務適用/最終化は未完了。現行Webhookへの接続・本番適用は未実施。
- 移行用4パッケージのlocalテストを秘密情報なしのCIへ追加し、deployの依存条件にした（361d5b9）。workflow設定の構文検査・否定検査は成功、GitHub workflow自体はdisabled_manuallyを維持。
- PWAのAPI runtime cacheを廃止し、新Service Workerのactivate時に旧supabase-cacheのみ削除する。APIへのnavigationにはSPA fallbackを返さない（53072a2 / adef0c8）。アプリビルドと生成物検査が成功。本番配備・既存端末の更新確認は未実施。

CloudflareのCLI認証先はfanmark対象アカウントと異なり、対象を明示したread-only呼び出しも認証エラー。対象側はWorkers Free（10 ms/request）。remote配備権限とbcrypt CPU/プラン判断は未解決。ブラウザではSupabase SQL Editorによる秘密値を返さない集計、既存Google/Apple callback、Resendドメインを確認できた。詳細はlive-observationsを参照。

Storageの2 bucketについて、認証付きAPIによる元ファイルの読出し・metadata size照合・SHA-256作成・ローカルファイルの再検証を完了。取得前後の一覧も一致。非公開の一時baselineであり、確定snapshotやR2コピーとは扱わない。詳細は[storage-baseline.md](storage-baseline.md)。

Storage exporter/verifierの再利用可能な実装を追加。23件のオフライン検証に加え、新実装による両bucketのread-only取得と独立verifierの検証が成功。詳細は[storage-export.md](storage-export.md)。非公開一時保存であり、R2転送は未実施。

本番の列・制約・index定義をread-only catalogから取得した（a567ab1）。40表・406列・144制約・139indexの変換条件を[変換境界](schema-conversion.md)へ記録。実測結果は非公開。これをD1 schema適用済みと扱わない。

絵文字カタログ生成はUUID付きJSONの明示入力を追加。Supabase環境変数が存在しても明示入力時はネットワークを使わず、ID・肌色sequenceを保持する。Unicode更新・D1へのmaster書込み・公開配信は未完了。

絵文字の版付きlocal artifact builderを追加。旧UUIDの削除/再割当て、manifest/moduleの混在を拒否し、検証完了後に版別directoryへ保存する。生成系7テスト・型検査が成功。本番emoji_masterをread-onlyで新規取得し、生成版との全UUID/emoji/codepoints照合と取得前後一致を確認。成果物は非公開一時保存。D1 import・APIの版切替・公開rollbackは未実装。

値変換codecを追加。PostgreSQL text入力から正確なcents、安全範囲bigint、UTC microsecond、decimal/JSON text、順序付き配列へ変換する。Storageと合わせ28テスト成功。実D1 bind/readbackで型・値・microsecond順序を検証し、既存競合試験と合わせ9件成功。全表importは未完了。

catalogから全表DDLと列codec対応・未解決条件を生成する[schema converter](schema-generator.md)を追加。NULL許可、整数型/範囲、文字列内のSQL構文、変換できない式/列型/外部Auth参照を検証。Astraの独立実行でStorage・値codecを含む32テストとCI境界検査が成功。実catalogから生成した同一SQLの104文がローカルD1で成功し、40表・131indexを読み戻した。20群の未解決条件があり、`deployable: false`を維持。全表のデータ移送、RLS/trigger/関数相当の業務実装、本番適用は未完了。

指定Node 22.6.0でStorage verifierの`readableWebStream()`完了と明示closeによるnative abortを再現し、64 KiBずつの明示read/closeへ修正。空ファイル・複数buffer・末尾改変の検証を加え、指定版で移行データ33テストが成功。保存済み非公開Storage baselineも新verifierで再検証済み。シェルの既定Nodeは25.5.0だったため、以後は指定版を明示して検証する。

Stripeの請求状態同期を追加。API版をBasilへ固定し、現在のInvoicePayment・顧客・subscription・最新invoiceを検証する。customer fence取得後に読出し、payment fields・台帳・receipt/dispatch完了を同一SQL transactionで更新する。古いイベントから現在状態を推測せず、不明/voidは60秒後の再試行へ戻す。Astraの指定Node 22.6.0による独立実行でStripe全63テスト・型互換性が成功。SQL内の遅延でleaseが失効するケースも、業務更新/台帳がrollbackされることを確認。詳細は[stripe-invoice-projection-validation.md](stripe-invoice-projection-validation.md)。既存Webhook接続・本番migration・独立Postgres接続の競合検証・他の課金効果は未完了。

全表catalogに従う行変換bridgeを追加。PostgreSQLの値を文字列/SQL NULLとして取り出し、列順・enum・NOT NULL・配列次元を検証してD1 bindingへ変換する。UTC microsecondとJSONB textを保持し、BC/infinity/範囲外日付を拒否する。指定Nodeで行変換5テストと合成PostgreSQL投影が成功。consistent snapshotの保存・再実行可能なimport・全行照合は未実装。詳細は[row-conversion.md](row-conversion.md)。

公開アクセスAPIのD1実装を追加。short ID・絵文字・公開profileの読み取りを明示設定で有効にする。公開可否と本文は同一SQLで取得し、password保護時と非選択の表示方式の本文を返さない。既存画面の空画像URL、日本語の文字数、長いZWJ絵文字、表示方式変更後に残る設定を検証。Astraの指定Node 22.6.0による独立実行でD1 entrypoint 11テストと型検査が成功。既存API21件、recent D1 4件、availability D1 7件、静的配信13件・実HTTP smoke・配備dry-runも独立実行で成功。CI項目も追加し、workflow隔離検査が成功。未設定時は503で、frontend接続・password検証経路・本番配備は未実施。
