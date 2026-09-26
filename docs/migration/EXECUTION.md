# Cloudflare移行の実行・再開手順

## Stripe extension receipt effect on D1 (2026-09-26 JST)

Added a staging-only D1 schema for Checkout intents, one application per
Session, effect evidence, and per-entry lottery cancellation, plus a local
application function guarded by the active receipt lease and immutable intent
terms. The positive paid path applies license extension, lottery cancellation,
notifications, audits, application state, receipt state, and dispatch state in
one D1 batch. Unpaid sessions wait for asynchronous settlement; expired or
failed sessions grant no time; amount/owner/transfer mismatches dead-letter.

The local Miniflare suite uses the generated 40-table D1 schema and synthetic
records. It covers same-Session retries, competing receipts, async success,
expired/failed no-grant, stale-owner/transfer/amount rejection, and full
rollback after an injected audit failure. The D1 Checkout intent endpoint and
scheduled extension dispatcher are now implemented locally; the default-off
frontend selector is also available. The later staging readback recorded below
supersedes this initial setup snapshot: business migrations `0006` and `0007`
have since been applied, and the shared Worker Cron is active for notifications.
Stripe checkout/webhook/dispatch selectors and Stripe secrets remain unset,
and subscription/invoice event handling is incomplete. No real Stripe call,
user data, production routing, or DNS change was made.

親イシュー: [#28](https://github.com/kanouk/fanmark-id/issues/28)。親の移行仕様・受け入れ条件を正とする。#26と#27の試作はこの移行へ一括マージしない。

## 役割と実装体制

Astraが設計確定、作業分解、差分レビュー、検証結果の確認を行い、GPT-5.6 Luna（max）が範囲を区切った実装を担当する。設計不明点、認可/課金/ID/原子性に関わる変更はAstraが判断する。

ユーザーは2026-09-23に残量確保を停止条件にしないよう指示した。使用量の割合を理由に作業を止めない。実装は段階ごとに保存・検証し、実際のツール制限や未解決のデータ整合性・セキュリティ条件を停止理由として扱う。

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

1. Git状態、親/子イシュー、PRの状態と、利用する実行環境の状態を読む。
2. 未コミット作業を確認し、作業ツリーと実装者の担当範囲を復元する。
3. 前回の成功した検証と未確認条件を区別し、変更/失敗/未解決の理由がある範囲を検証する。
4. 次の未完了の実装単位を指定して再開する。本番切り替えは確認・監視・復旧までの余裕を確保してから開始する。

## 継続中の作業（2026-09-21）

PR #41は棚卸し・本番設定のread-only確認とWorker API境界を保存するdraft。対応案と再現用集計SQL、公開recent APIはコミット済み。以下の未コミット部分を完成済みと扱わない。

- `workers/api/`: 最近取得一覧の公開APIを6ebdf36で保存。応答列の制限、キー種別、Origin、タイムアウト、redirect、件数上限、実entrypointを含む14テスト、型検査、配備用dry-runがAstraの独立実行でも成功。remote未配備。フロントの明示的な接続先切り替えは394a9d0で保存し、9テスト・型検査をAstraも独立実行して成功。設定したWorkerが失敗してもSupabaseへ戻らない。合成Worker originを指定したViteビルドも成功し、値が生成物へ反映されることを確認。Workers Static Assetsの一体配信構成を80a56feで保存。新規Viteビルドに対する13件のlocalテスト・実HTTP smoke・配備用dry-runを確認し、CIへ組み込んだ。API/欠落アセットの404とSPA navigationの境界を維持する。OGP/Auth/admin/PWAの実環境確認とWorker起動コストは未検証。
- live recent-listのview/RPC定義をread-onlyで取得し、active licenseのみ・created_at降順・同時刻の順序未指定などの現行条件を記録（43f5e12）。再現SQLも実行済み。D1版の公開recent repositoryをe8ffc0eで保存。明示切り替え、microsecond保持、実D1 entrypointを含む4テストと既存API14件・静的配信13件・実HTTP smoke・型検査・dry-runが成功。取得可能判定APIとフロントの2箇所の判定を43f7207で接続。API21件・D1 availability7件・recent D1 4件・フロント6件、型検査、未設定/Worker指定build、静的配信13件+実HTTP smoke、dry-runが成功。本番公開RPC5ケースの応答も両validatorを通過。詳細取得/登録/Auth等は既存経路。全体の本番D1 schema/importは未完了。
- `workers/api/` にBetter Authの `/api/auth/*` を接続。Better Auth実装を共有moduleへ移し、signup/OAuth/password-reset/verification-email経路を閉じた状態で、synthetic verified userのログイン、session読戻し、誤password・未verified email拒否、4並列sign-in、credentialed CORSを5件のMiniflareテストで確認。認証schema migrationはuser/account/hash/factor/sessionの行を含めない。`experiments/cloudflare-auth/` の既存MFA/admin-assurance suiteも6件成功。アプリ側のadmin/business authorization、招待・メール配信、OAuth、remote CPU、実因子移送は未完了。詳細は[auth feasibility](auth-feasibility.md)。
- Node 22.6.0のclean installでVitestが解決したVite 8/Rolldownのnative bindingが欠落する問題を確認。Workers/API・Auth・D1 concurrencyのテストpackageをVite 6.4.3へoverrideし、3 packageの`npm ci`を成功させた。Auth/concurrency testもclean install後に再実行して成功。これはテストtoolchainの互換性修正であり、GitHub hosted workflowは引き続きdisabled。
- `experiments/cloudflare-auth/`: bcrypt/TOTPと管理者APIのセッション/factor-bound MFA proofを7a11d4dで保存。7e37827でsingleton MFA generationとguard付き保存を追加。同じ因子のsecret変更、無関係な因子変更、generation欠落、置換・sign-outをlocal D1のbarrierで検証。既存proofは今回共有moduleへ移し、6件のlocal runtimeテストが成功。remote multi-Worker raceは未確認。実OAuth/既存因子移送/remote CPUは未完了。
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

独立接続のPostgreSQL 17.10でStripe競合5テストを追加。未commitの重複受信とcustomer fenceで実際のlock待ちを観測し、SKIP LOCKEDは先行transactionを開いたまま別接続が異なる行を取得することを検証した。期限切れの最終適用拒否と業務更新失敗時のrollbackも成功。AstraのNode22独立実行でも5件成功・skipなし、終了後のpostgresプロセスと一時clusterは0件。管理対象の17.6環境・本番設定の検証とは区別する。詳細は[postgres-concurrency.md](postgres-concurrency.md)。

パスワード付き公開アクセスの[移行設計](verified-access-design.md)を5aca0e4で保存。short ID・絵文字・profileのselectorに結び付けた短期proof、同一SQLでの本文保護、D1による試行予約と世代番号の検証を定義した。アカウント認証とは別の認可経路として扱う。隔離したlocal proofは実装中で、既存password値の互換性・全writerの失効処理・remote CPU・frontend切り替えは未検証。

Storage exportからR2へ移す[再実行可能なimport core](storage-r2-import.md)を追加。既存/新規objectを本文hash・size・metadataで読み戻し、再開時にも全対象を再検証する。条件付き作成により競合objectを上書きせず、応答停止や途中失敗を未完了として保存する。AstraのNode22独立実行で移行データ52テストとloopback Miniflareの実R2検証が成功。16 MiBの競合転送でも上書きなし・停止を確認した。local R2は条件不一致でも本文を全消費するため、早期キャンセルやremoteのmemory/CPUは証明していない。CIへ追加し隔離検査が成功。remote runner・bucket設定・本番upload・URL切り替えは未実施。

DB動作定義のread-only棚卸しを追加。40表のRLS設定、77 policy、36 user trigger、1 view、58 function/procedureの定義・権限情報を非公開artifactへ保存した。収集できたことはD1への変換・認可同等性を証明しない。schema converterの未対応scopeと業務移植の条件は維持する。既存password設定も値を返さない形式/参照関係の初期集計を実施し、UUID/ライセンス対応の異常は観測されなかった。形式変換・本人の既存入力による動作同等性・最終snapshotは別途検証が必要。

public全表を同一read-only repeatable-read transactionから保存する[snapshot exporter/verifier](snapshot-export-design.md)を追加。列・制約・index・enumのcatalog fingerprint、行順序・hash・件数・値codecを検証し、途中失敗を完了として扱わない。partition/inheritanceを明示拒否する。AstraのNode22独立実行で移行データ63件、CIと同じStripe npm test 65件、実psqlとPostgreSQL 17のtransport検証2件が成功（いずれもskipなし）。一度の全体実行停止は単独実行と全体再実行で再現せず、原因は未確定。テストの失敗時cleanupとtimeoutも追加した。sourceの実データexport、暗号化backup、Auth/Storageを含むfreeze、unique/FKの全体照合、二つのsnapshot間比較は未完了。

パスワード付き公開アクセスの隔離local proofを追加。selector/licence/世代に結び付けた短期cookie、D1による二重の試行制限、世代変更・削除再作成時の失効、同一SQLによる本文保護を検証する。AstraのNode22独立実行で専用17件と既存認証6件が成功。遅延要求による期間巻き戻し、finalization再実行、失敗時の部分カウント、Originなし同一site GETも検証し、専用suiteをCIへ追加した。実password変換・全production writer・remote CPU・frontend接続・本番配備は未完了。詳細は[verified access design](verified-access-design.md)。

DB動作の非公開gap inventoryを作成し、元catalogの77 policy・36 trigger・1 view・58 functionの全名称が対応表に含まれることと0600権限をAstraも確認した。暫定分類はpolicyがlocal対応済み0/部分4/未対応73、triggerが0/0/36、viewが0/1/0、functionが3/11/44。対応済みも限定的なlocal実装の証拠であり、本番parityやRLS全体移植を意味しない。次は期限ジョブの状態遷移・競合・付随効果を整理する。

verified snapshotからの[D1 import core](d1-import.md)を追加。parent-first順、全batchのcheckpoint guard、同時実行/ACK不明後の再開、移送先incarnation、application/ledger双方のDDL検証、全値・SQLite保存型・PK・件数・hash・FKの読み戻しを行う。AstraのNode22独立実行でCIと同じコマンドの12件と明示Miniflare integrationが成功し、CI隔離検査も成功。初回report書込失敗からの復旧、改変検知、query/SQL/変換後row上限も含む。結果はpublic_rows_reconciledに限定し、deployable/fullMigrationReconciledはfalse。実40表の行移送、credential変換、外部Auth参照、業務動作の同等性、remote適用、backup/restoreは未完了。

[credential transform設計](credential-transform-design.md)を追加。immutableな非公開sourceと変換後digestを分け、prepared時点でbcrypt結果を固定し、lease/fence付きの再開と全行カバレッジを定義した。Supabase/D1の二重writerは許容せず、freeze後に単一authorityへ切り替える。通常row importerへの変換descriptor統合、変換実装、暗号化sourceによるrehearsalは未完了。[期限ジョブ設計](license-expiry-design.md)も保存し、active→graceのlocal proofに着手。grace→expired/lottery等のparity gateは未解決。

実catalogの40表構造で、各表0行のsynthetic snapshotを新規Miniflare D1へ移すprivate rehearsalが成功。40表/40checkpoint・source/targetとも0行、20群のschema gateを維持したpublic_rows_reconciledを確認し、runtime/temp cleanupの記録も確認した。これはschema接続の検証であり、実データや業務parityではない。既存Supabase CLI権限でlive-only期限処理と定期期限処理のsourceをread-only取得し、非公開0600/0700領域に保存した。body未取得の条件は解消したが、実装差分・呼出運用・認可の同等性は別途確認中。

実catalogの40表に各1行のsyntheticデータを用意したnonzero rehearsalも成功。40 source行→40 D1行、40 checkpoint・complete・readback、内部FK/CHECK/enum/NOT NULL/uniqueと各値型を検証したprivate結果を確認。外部Authはsynthetic UUIDと未解決条件のまま、20群のschema gate、deployable/fullMigrationReconciled=falseを維持する。これは実source行のparityではない。取得した定期期限処理と共有helper計3ファイルがrepoとbyte-for-byte一致することも、Astraがhash付き非公開記録に保存した。

Astraが復元済みのsynthetic generatorを確認し、Node 22.6.0で40表・各1行のnonzero rehearsalを独立再実行した。40行の移送、40表のcomplete/readback、public_rows_reconciledを再確認。cleanup失敗を成功扱いしていたprivate helperの記録を修正し、runtime dispose成功と一時directoryの不存在も確認した。20群の未解決schema条件、deployable/fullMigrationReconciled=falseは維持し、実source行・credential変換・業務parityの証拠とは扱わない。

active→graceの[期限処理local proof](license-expiry-proof.md)を追加。UTC microsecondの期限境界、元設定のparseInt/fallback、owner/end/generation付きCAS、audit/outboxとの同時commit、durable run-itemによる停止後の再開を検証する。ACK再確認でprocessedを変更せず、同runの並行再開でも件数を保持する。AstraがNode22.6の専用npm scriptを独立実行して成功し、CI隔離検査も成功。65行のkeyset traversalと最大32件の返却sampleを確認した。fixtureは縮小したsynthetic schemaで、全schema統合、grace→expired、lottery、cron接続、本番動作の同等性は未完了。

credential変換の[隔離local proof](credential-transform-proof.md)を追加。source envelopeの入力/identity結合、prepared bcrypt結果の再利用、lease/fence、config・generation・台帳の同時適用、ACK不明後の復旧、移送先incarnationと値の再照合を実装した。実clockでD1 batch送信を期限後まで遅らせるprepare/apply拒否も確認。AstraのNode22.6独立実行で17件成功・skipなし、前後のcore/fixture/test hash一致、CI隔離検査成功。合成データ1行単位のproofであり、全行descriptor/importer統合、実credential移送、remote CPU、全writer、本番切替は未完了。

期限処理の必須effect確認を同一D1 batch内のCHECK-backed guardへ補強。audit/outbox/run-itemが0行で成功しても状態変更をrollbackし、guard cleanup欠落も最終SQLでabortする。Node22専用suiteで4種類の欠落と正常再開、ACK/競合後のclaim・guard cleanupを検証して成功。初版7文の補強は独立静的reviewでblocking指摘なし、その指摘を受けcleanup保証を追加した。全schema統合は引き続き未完了。

generic D1 importerはverified catalogにcredential列があれば、report/ledger/target mutation前にcredential_transform_requiredで停止するよう変更。local/allowUnresolvedGatesでも迂回不可。AstraのNode22独立実行で13件成功・skipなし。従来40表synthetic rehearsalも今後はdescriptor統合まで意図的に停止する。認証変換と[lifecycle schema統合設計](lifecycle-schema-integration.md)を揃え、同じsource行へのhash保存、retained incarnation、独立したstate/access/password世代、import前の厳密target profile作成を定義した。設計であり全schema統合は未実装。

disabled credentialの既存UI/RPC/read/delete経路を、repoと取得済みlive catalogで静的調査し、非公開0600文書へ記録した。調査範囲では再有効化は新入力方式だが、全operator/service-role writerとruntime同等性は未証明。disabled行を自動的にdiscard/dummyで完了とせず、未確認範囲が解消するまでdeferred_disabledを維持する。実source credential値の取得やremote変更は行っていない。

credential descriptorのmetadata compilerを追加。6列の対応、PK・validated UNIQUE・license FK、型、bcryptの版/costを検証し、immutable mappingとcanonical digestを生成する。親レビューでnon-enumerableな既知設定がdigestから欠落するケースを拒否し、回帰検証を追加した。Node22.6の親独立実行で移行データ70件が成功・skipなし。source行やDB bindingは受け取らず、変換/importer統合は未完了。credential_transform_requiredの停止条件は維持する。

[lifecycle target schema](lifecycle-target-schema.md)の生成・適用・厳密readbackを追加。全source DDLとextensionを照合し、部分適用、quoted literal/制約変更、未知index/view/triggerを拒否する。親の実catalog検証で4列のNULL条件の誤りを検出・修正し、40表構造の空local D1へ5表・4索引を追加、再適用no-opとreadback、runtime disposeを確認した。Node22.6の親独立実行で2 test group成功・skipなし、実行前後hash一致、CI隔離検査成功。source row import、credential/generation mutator統合、expiry実行接続、本番適用は未完了。

追加reviewでread-only schema inspectionにもsource fingerprintとSQL/inventoryの整合性検証を追加。catalog/report fingerprint・SQL・inventoryの個別改変を拒否し、専用2 test groupと実40表構造rehearsalの再実行が成功。これは入力plan内部の整合性確認であり、外部由来planの真正性やsourceデータ移送完了を保証しない。

世代管理の接続reviewでcredential proofのincarnation台帳欠落を0とみなすfallbackを除去。target read・prepare/apply/finalizeのSQLで台帳の存在を必須にした。予約前の欠落とreconcile read後の削除を検証し、Node22.6のcredential suiteは19件成功・skipなし。source-shaped世代triggerとの接続自体は未完了。

[世代管理trigger](lifecycle-generation-schema.md)を追加し、同日にsourceアクセス内容の失効対象を拡張。license作成時の初期化、削除時のretained incarnation更新、PK変更拒否、password変更、fanmark selector/status、基本設定、redirect URL、messageboard本文、公開profile変更で世代を進める。計24 triggerがlicense incarnationとaccess-versionの整合性、overflow、cascade削除を検査し、失敗時は同じD1 statementをrollbackする。親reviewでinspectionのbase plan結合も追加。Node22.6のschema/generation suite 9/9と、最新40表source catalogを含むexpiry統合12/12が成功。credential applyの二重increment除去、すべての業務writerとの接続、protected runtime、remote適用は未完了。

protected-access proofにもlicense incarnationを独立して保存・照合する境界を追加。同じUUIDの削除/再作成でpassword/access世代が同値になっても古いverificationを拒否する。全体実行の停止を調査し、追加列を反映していなかったreplayテストINSERTを修正、診断ログを除去した。親のNode22.6独立実行で17件成功（4.33秒）、実行前後の3ファイルhash一致。source-shaped runtimeとの接続や本番移行は未完了。当時の20%/22%停止ルールによる保留は、2026-09-23のユーザー指示で撤回された。


ユーザーの「もう少し進めていいです」を受けた当時の1単位。credential import projectionはcanonical snapshot recordの6列とrow hash/PK/ordinalを検証し、通常5列と一度だけ消費できる非公開入力handleへ分離する。parserの秘密値がerror causeへ出ないよう拒否時は固定codeとし、設定変更・handle偽造/複製/再利用も検証。Luna Maxへ委任したが成果物が戻らず中断し、親Astraが実装・検証した。Node22.6のmigration-dataは74件成功・skipなし、実40表catalogと合成1行でも成功、CI隔離検査成功。統合設計の「5列INSERT後にhash UPDATE」を、NOT NULLとtrigger二重更新を避ける単一INSERTへ訂正。実source値取得・hash生成・D1書き込み・importer接続・本番変更は未実施。以後の作業に残量の下限は適用しない。

2026-09-23の順序変更: ユーザー指示により、旧20%/22%停止ルールを解除。基本アプリ・Workers/D1/R2/Auth（合成ユーザー）と許可済みマスターを先行し、#37 synthetic rehearsal後、#38で実ユーザーデータを最後に移送・照合し、公開DNS/ホスト名を最終操作とする。ユーザー数が少ないため計画メンテナンスと個別サポートは許容するが、アカウント/権利/課金の誤紐付け、秘密漏えい、復元不能な欠損は許容範囲に含めない。Supabase本番は最終切替まで唯一の業務書き込み先とする。

認証移行の最新確認: `docs/migration/auth-feasibility.md` に記録済みのlocal workerd + D1 proofでは、Better Auth 1.7.5とbcryptjs 3.0.3を用い、synthetic `$2a$10$`/`$2b$10$` password、UUID維持、誤password拒否、並行sign-in、TOTP challengeを検証済み。Supabaseのread-only observationはhash形式が`$2a$10$`であることのみを確認し、hash本体・user対応・MFA secretは取得していない。実sessionはBetter Auth移行時に失効し、実OAuth callbackとMFA factor移送は未確認。

絵文字マスター先行準備: `workers/api/migrations/0001_emoji_master_release_staging.sql` と `scripts/migration/emoji-master-release-stage.mjs` でverified releaseを既存D1 masterとidentity照合し、別version stagingへbounded batch投入、独立readback後だけ`ready`にする。`0002_emoji_master_release_activation.sql` と `emoji-master-release-activate.mjs` はrelease hash/readbackを再検証してprivate pointerを世代管理で切り替え、履歴とactive行をimmutableにする。metadata-only rollbackは通り、追加されたUUIDを落とすrollbackと改変stagingは拒否する。live public master 3,944件も別途local D1へstaging/readback一致。詳細なAPI/frontend接続と検証結果は[emoji release記録](emoji-releases.md)。hosted CIは未実行。canonical `emoji_master`、remote D1、公開/運用rollbackは未実施。

続けて2026-09-23、Supabase SQL Editorから公開マスターの明示8列だけを2回独立にread-only取得。3,944行の正規化SHA-256は両方とも`84a67b361adf96534bc6e564ec7510249758c2b20492e4d0b97acc7fd88309c0`、UUIDと絵文字はそれぞれ全件一意。版`10ec42c1a562197c1e66c5fd10316c904188cdfb274ca5b8852c99ba240d3bed`をsource-shaped canonical fixture付きの一時Miniflare D1へstagingし、canonical 3,944行・staging 3,944行をreadback。全staging行がverified releaseと一致して`ready`になった。Node 22.6.0で実カタログ検証と関連suiteを再実行し成功。Supabaseへの書込み、remote D1、ユーザー/Authデータ、公開版切替はなし。成果物は非公開一時領域に保持し、リポジトリへ含めていない。詳細は[emoji release記録](emoji-releases.md)。

2026-09-23、#34の`active → grace`をsource-shaped D1へ接続するローカル統合コアを追加。source名の`is_returned`、nullable `user_id`、retained incarnation、別々の`lifecycle_generation`/`access_generation`、既存`audit_logs`/`notification_events`を使い、access世代更新は同じoperation claimに結び付いた共有SQL builder経由で一度だけ行う。Node 22.6.0 + Miniflareの10チェックで成功、nullable owner、password/access世代の分離、ACK不明後の完全readback、audit/notification/access-version/run-item/guard-cleanup欠落時のstate/effects全rollbackと再開、競合記録、厳密な期限境界を確認した。通知は`normalized_emoji`、stable `short_id`、`/f/:shortId` linkをdurable run itemから再現する。fixtureは5つのsource-shaped tableとtarget extensionからなる合成subsetで、全40表へのimport接続、他のlifecycle操作、route/cron接続、本番同等性は未完了。workflowにsuiteを登録したがGitHub hosted CIはdisabledのまま。Cloudflare remote、Supabase本番、user data、domainへの変更なし。

同日、期限処理統合テストを拡張し、同一synthetic D1へsource DDL・lifecycle extension・generation triggers・descriptor-bound credential artifact/coverage schemaを順に適用した。credential schema inspectorでprofile全体のreadbackを確認し、期限runにも当該profileのextension digestが保存されることを読戻した。さらにgeneric importerのpreflightをこのprofileへ接続し、余分なviewは拒否、完全一致profileではreport/ledgerを作らずcredential importを拒否することを確認した。Node 22.6.0 + Miniflareで11チェック成功、skipなし。これは5 source tableのsubsetであり、実40表profile・credential row変換との統合や本番データ移行の証拠ではない。Cloudflare remote、Supabase本番、user data、domainへの変更なし。

2026-09-23、Wrangler login後に`fanmark-emoji-master-staging`をAPACへ作成し、`0000`〜`0002`の絵文字用schemaだけをremote適用。remote `0002`でWrangler SQL splitterがnested `CASE ... END`を誤分割する問題を条件付き`RAISE ... WHERE`へ修正し、7 Miniflare release testsを再通過。`0003_better_auth_core.sql`はremote適用で`incomplete input`となったため今回のmigration patternから除外し、Auth schemaを適用していない。Node 22.6.0で検証したrelease `10ec42c1a562197c1e66c5fd10316c904188cdfb274ca5b8852c99ba240d3bed`をcanonical D1へ3,944件、private stagingへ3,944件投入。別プロセスのremote readbackがcanonical/staging双方の全行一致、`recordsSHA256=84a67b361adf96534bc6e564ec7510249758c2b20492e4d0b97acc7fd88309c0`、`identitySHA256=dddd7cf13528dd44f2bb1329ed1167f83fb30e63504fdd1c673845467ab402fc`、status=`ready`、active pointer/activation history/Auth table各0件を確認。初回Node 25生成版はNode 22.6.0の`verifyRelease`に失敗したためfailedへ隔離し、そのstaging rowsを削除、failure metadataのみ保持。D1はWorker未接続で、deployment、Supabase write、user/Auth data、public activation、domain/DNS変更なし。

続けて、公開絵文字APIだけを持つ`fanmark-emoji-master-staging-api` Workerを`https://fanmark-emoji-master-staging-api.fanmark-id.workers.dev`へ配備。remote D1を通じて版固定ページを全取得し、3,944件の内容、`recordsSHA256`、`identitySHA256`を独立成果物と照合して一致。CORS拒否、versionless時のinactive応答、GET以外の拒否、Auth pathの非公開を確認した。active pointerは引き続き未設定で、SPAは未接続。本番ドメイン、Auth/user data、Supabase書込みは未変更。`wrangler r2 bucket list`はCloudflare error 10042（DashboardでR2有効化が必要）となったためbucketやobjectの移行は未実施。

続けて同日、`0003_better_auth_core.sql`を`fanmark-app-staging`用のmigration patternへ追加。通常のremote `d1 migrations apply` query経路は`incomplete input`で失敗したが、同じSQLはisolated local D1でWranglerのsplitter経由でも25 query成功。通常の`d1_migrations` rowを含むSQLをWranglerのremote `--file` importでtransactionalに適用し、remote readbackでAuth table 8件、MFA generation trigger 6件、generation singleton 1件/generation=0、migration ledger row 1件を確認。user/account/session/verification/twoFactor/adminRole/mfaAssuranceは全て0行。

`fanmark-app-staging` Worker version `b69bdc6b-7faa-4dca-b994-53251eca3fbe`を`https://fanmark-app-staging.fanmark-id.workers.dev`へdeployし、staging専用ランダムBetter Auth secretをCloudflare Secret Storeへ登録（secret値は読み戻さず、出力もrepo保存もしていない）。許可originからのAPI ok/session、許可外origin 403、signup 403を確認。synthetic `example.invalid` userのsign-in 200、session read 200、logout 200、誤password 401を確認後に削除し、全Auth user-owned rowsが0であることを再readback。UI authはまだSupabase context、signup/email/OAuth、業務・管理API認可も未接続。アプリSPAのnoindex/robots/sitemap設定、版固定catalog全3,944件のremote fetchと両artifact hash一致を確認。production app/DB、Supabase write、public domain/DNSは未変更。R2はerror 10042で引き続き未有効。

2026-09-23、絵文字マスターremote staging scriptをBetter Auth schema適用後も安全に再実行できるよう更新。8つのAuth表すべてが存在し、user-owned行が全て0、MFA generationが0であることを確認し、release stagingの前後でactive pointer/activation historyが不変であることを検査する。再実行はcanonical 3,944行、ready release 3,944行を一致確認し、既存releaseを再利用、active/history各0のまま完了。D1のcompound SELECT上限に合わせてAuth count検査はscalar subqueryへ変更。専用テストを加え、migration-data suite 79件成功。

同日、既存Supabase `avatars` / `cover-images` を置き換えるWorker-side R2 APIを追加。Better Auth sessionを確認してからowner UUID配下の新規keyをサーバー生成し、avatar 1 MiB / cover 2 MiB、画像signature、許可Origin、owner-only deleteを検証する。公開GET/HEADには1時間cacheと`nosniff`を付ける。Miniflare D1/R2で5統合テストと既存Better Auth 5テスト、API typecheckが成功。テスト用合成画像/アカウントのみで、R2アカウント有効化・remote bucket・frontend切替・実object移行は未実施。frontendは依然Supabase Auth/Storageを使用中。詳細は[Storage API準備](storage-r2-app-api.md)。

続けて`fanmark-app-staging` Workerをversion `c45c7085-387b-44e6-9038-b1d52382dc7f`へ更新。remote D1にpending migrationなしを確認してから配備し、Better Auth health 200、版固定emoji catalog 200、root `X-Robots-Tag: noindex, nofollow`を確認した。Storage upload/public readはいずれも503 `storage_unavailable`でfail closed。配備bindingsにR2はなく、Cloudflare R2は引き続きerror 10042、remote bucket/objectは未作成。Supabase production、user data、public domain/DNSは変更なし。

移行作業中の変更を反映し、オフラインrepository inventoryをHEAD `f359c3fae0934f425839f34a5166860f33a1640e`基準で再生成した。現checkoutのfrontend scanは211 callsites（35 Edge invoke、40 RPCを含む）。`node scripts/migration/test-inventory.mjs`が成功。これは静的checkout inventoryであり、live schema/production inventoryの代わりではない。

続けてremote activation CLIを追加。現在版の明示指定を必須にし、今回は`none`をpreconditionとして初回promote。coreに楽観的な版一致guardを追加し、7件のrelease integration testsが全て成功。隔離APAC D1で版`10ec42c1a562197c1e66c5fd10316c904188cdfb274ca5b8852c99ba240d3bed`をgeneration 1として有効化、activation historyは1行。専用`workers.dev` catalog APIは版なしGETが503から200へ遷移し、全8ページ・3,944行のreadbackでversion、`recordsSHA256=84a67b361adf96534bc6e564ec7510249758c2b20492e4d0b97acc7fd88309c0`、`identitySHA256=dddd7cf13528dd44f2bb1329ed1167f83fb30e63504fdd1c673845467ab402fc`が成果物と一致。再実行時はchanged=falseで履歴を増やさない。Better Auth user-owned行は引き続き0。production app/DB、Supabase write、R2、user data、custom domain/DNSは変更していない。

## 非ユーザー参照マスターの移行（2026-09-23）

`fanmark_tiers`、`languages`、`reserved_emoji_patterns`を明示allowlistとし、Supabase SQL Editorからread-only exportを作成した。型付きsnapshotは非公開一時領域にあり、各4・4・5行、USD decimal text、UUID、microsecond timestampsを保持する。system settings、Auth、user rows、Storageは取得していない。

`workers/api/migrations/0004_reference_master_releases.sql`でimmutable staging release、3つのactive views、atomic pointerとappend-only activation historyを追加。USD値はdecimal textから正確なinteger centsに変換し、既存availability repositoryの境界と合わせる。stage/retry/readback、immutability、promotion、money codec、JSON object key順に依存しない照合、生成SQLのMiniflare integration 5件、API typecheck、build dry-runがNode 22.6.0で成功。手順は[参照マスターの移行](reference-master-data.md)。

Wrangler local D1へ`0000`–`0004`をすべて適用し、実snapshotから生成した20文を実行。stage表・active viewの計13行、3つのsource hash/count、generation 1、migration ledgerを独立read-only comparisonし全件一致。これはlocal persistent D1の証拠でありremote適用ではない。

その後、対象APAC staging D1へのWrangler query/writeが回復し、`0004_reference_master_releases.sql`を適用した。非公開snapshotから3参照表13行をstageしてsource hash・全列・件数を照合し、release `5be91463bd0429cc9fc7a280892a80a922deb2dd9224325374171a4ce7bdc88e`をgeneration 1へ有効化した。active viewsの再照合は成功し、Auth user-owned行は0、既存絵文字releaseは不変。app-staging Workerもversion `caebcf9a-236a-4e1d-a89d-8940ad461c44`へ更新し、noindex、Better Auth health、3,944件の絵文字catalog hash一致、R2未設定時の503を確認。詳細は[live observations](live-observations.md)。

## Better Auth staging UI接続（2026-09-23 JST）

staging modeの認証画面を、同一workers.dev origin上のBetter Authへcookie付きHTTP接続した。ログイン後に`/api/auth/get-session`を再取得し、logoutは`/api/auth/sign-out`へ送る。セッション取得/更新では`credentials: include`と`cache: no-store`を指定し、SupabaseのBearer tokenや擬似Supabase sessionは作らない。stagingではsignup、social OAuth、forgot/reset-password、password-setupを非表示またはauth画面へredirectし、これらからSupabase Authへ誤接続しない。

Node 22.6.0でfrontend client 5テスト、TypeScript typecheck、staging buildが成功。Wrangler deploy dry-run後、`fanmark-app-staging`をworkers.dev限定のversion `36183ffc-bfa4-4d64-b2ff-42ea9a7392dc`へdeploy。read-only HTTP確認はroot 200 + noindex、robots全体Disallow、`/api/auth/ok` 200、cookieなし`/api/auth/get-session` 200/null、固定絵文字catalog 200、R2 public read 503 `storage_unavailable`。bundle scanはBetter Auth endpointsを含み、production Supabase URLは含まず、synthetic Supabase fixture URLのみを確認。remote Auth user/account/session/verification/twoFactor/adminRole/mfaAssurance rowsは全て0。

この確認ではブラウザからの成功ログインを実施していない。frontend helperのrequest/error/session契約とWorkerの未認証経路は確認済みだが、credentialを使ったend-to-end UI、業務API認可、プロフィール/Storage接続は未完了。production Worker/DB、OAuth provider、billing設定、R2 subscription、public domain/DNS、実ユーザーデータには変更なし。R2開始手順はsubscription checkoutを要求するが、Standard monthly allowanceは10 GB-month storage、Class A 1M、Class B 10M、egress freeで、超過usageが従量課金となる。詳細は[Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)と[setup](https://developers.cloudflare.com/r2/get-started/)。

## Recent fanmarks Worker API integration (2026-09-23 JST)

/api/fanmarks/recent now retains the public fanmark_short_id as shortId and the existing fanmark_id as fanmarkId, while keeping the previous license-first id contract. RecentFanmarksScroll and useFanmarkSearch use the shared Worker loader; the search view still uses fanmarkId for its existing operation and shortId for the public page URL. Supabase remains the legacy fallback only when the frontend Worker origin is unset. Both call sites cancel requests on unmount.

Node 22.6.0 validation passed: frontend recent contract 9 tests, Worker Supabase contract 14 tests, local D1 contract 4 tests, frontend and Worker TypeScript typechecks, Cloudflare staging build, and app Worker Wrangler dry-run. Targeted ESLint reported no errors and one pre-existing missing dependency warning in the search-query effect. The dry-run showed the staging config still has no explicit recent backend; the remote D1 contains no business tables. The change was not deployed, and no user data or production service was read or written.

## Public fanmark read frontend adapter (2026-09-23 JST)

`VITE_PUBLIC_ACCESS_READ_BACKEND=worker`を明示した場合に、短縮IDアクセス、絵文字パスの照会、QRページ、公開プロフィール照会が既存Workerのversioned public projectionを使うよう接続した。既定はSupabaseのまま。選択後のHTTP/timeout/JSON/network失敗は別データソースへフォールバックしない。HTTP(S) origin検査、credentials omit、no-store、5秒timeout、64KiB応答上限、DTO検証を持たせた。公開プロフィールDTOは具体型にし、既存Hookの条件付きuseMemoと型エラーも解消した。

Node 22.6.0でfrontend API契約7件、TypeScript typecheck、変更ファイルESLint、Cloudflare staging buildが成功。Worker public-access/D1 integration 11件も成功。staging buildはselectorを未設定のままで、Worker stagingも`PUBLIC_ACCESS_BACKEND=d1`未設定、business D1 schemaなしのため、デプロイやlive-route確認はしていない。Worker選択時はpassword-protected recordのredacted内容をfail closedし、Supabase検証へ混在させない。password検証、アクセス解析、`/f/:shortId` owner/history detailsのWorker移行、source short-id最大長と既存値の再照合が残る。実ユーザーデータ、本番DB、ドメイン/DNS、R2 checkoutは変更なし。

## R2 frontend storage client (2026-09-23 JST)

`src/lib/storage-api.ts`でR2 image API clientを追加し、`useAvatarUpload` / `useCoverImageUpload` の書込み・削除先を`VITE_STORAGE_BACKEND=r2`で選べるようにした。既定はSupabaseで、R2選択はBetter Auth mode以外では拒否。Workerへのcookie credentials、no-store、15秒request timeout、8 KiB JSON上限、responseのowner UUID/key/same-origin URL照合を実装し、R2 HTTP失敗時にSupabaseへ戻らない。Storageはpublic image dataのため、パスワードやBearer tokenは送らない。

Node 22.6.0でfrontend contract 7件、Better Auth client 5件、frontend TypeScript、変更ファイルESLint、Cloudflare staging buildが成功。Worker Miniflare D1/R2 API 5件、Worker TypeScriptも成功。buildでは`VITE_STORAGE_BACKEND=supabase`を明示し、R2 selectorはstagingに設定していない。プロフィールmetadataはSupabase経由のまま、R2 subscription/bucketsは未設定で、この変更はadapter準備に限る。remote deploy、R2 object、ユーザーデータ、production service、domain/DNSに変更なし。

## 参照マスターWorker API接続（2026-09-23 JST）

`GET /api/reference-masters/{fanmark_tiers|languages|reserved_emoji_patterns}`を追加した。D1 active pointer、ready release、table manifest、release-bound rowsを一つの問合せで読み、release version・row count・UUID・domain fieldを検査して最小DTOだけを`no-store`で返す。3マスターを一つのactive release versionに固定し、tier priceはinteger centsで返す。`useLanguages`には明示selector `VITE_LANGUAGE_READ_BACKEND=worker`を追加し、既定Supabaseを維持。Worker障害時にSupabaseへ戻らない。

Node 22.6.0でfrontend contract 5件、Miniflare Worker/D1統合3件、frontend/Worker TypeScript、変更ファイルESLint、staging build、Wrangler deploy dry-runが成功。APAC `fanmark-emoji-master-staging`を読むWorkers.dev app Workerをversion `3f597b51-f8b5-490c-bd0f-b2a0929de03e`へdeploy。read-only HTTPはtier 4、language 4、reserved-pattern 5行すべてでactive release `5be91463bd0429cc9fc7a280892a80a922deb2dd9224325374171a4ce7bdc88e`を返し、`no-store`を確認。app root noindex、Better Auth health、CORS拒否、未知route 404も確認。production app/DB、ユーザー行、Storage、R2、domain/DNSには変更なし。tier / reserved patternのフロント管理画面は引き続きSupabaseのため、アプリ全体のマスター切替ではない。

2026-09-24、`AdminExtensionCoupons`に版付きtier read clientを接続した。`VITE_REFERENCE_MASTER_READ_BACKEND=worker`の明示時のみ4つのtier optionをactive Worker releaseから読む。release digest、4段階の一意性、UUID・項目型、`no-store`、16 KiB上限を検証し、Workerが利用できない場合は新規クーポン作成を止める。クーポン書込みと`AdminTierExtensionPrices`の編集はSupabaseに残る。専用client 5件、既存language client 5件、Miniflare API/D1 3件、root typecheck、変更ファイルESLint、Cloudflare buildが成功。selectorを明示したstaging buildとdry-runの後、app Worker version `82ce7520-1977-470a-89fd-c875c5ef116c`を配備し、root noindex、bundle、active tier API levels 1–4とno-storeをread-onlyで確認した。D1/R2書込み、実ユーザーデータ、production、DNS変更なし。`AdminTierExtensionPrices`のtier日数更新経路とreserved-pattern画面接続は未完了。

## App Workerのadmin session gate（2026-09-24 JST）

`GET /api/admin/session`を追加し、現在のBetter Auth session、admin role、現在verifiedのfactor、同じuser/session/factorにひもづく未期限切れMFA assuranceを確認する。結果は`{"authorized":true}`だけで、admin CRUDや業務データAPIはまだ実装していない。認証テーブルにread-onlyで、route以外の`/api/admin/*`は404を維持する。合成D1テスト8件、Worker typecheck、Wrangler staging dry-runが成功。staging Worker `73b2724e-4abd-4ab6-a0bd-8e3a66cb7760`へ配備し、live unauthenticated GETは401、許可origin OPTIONSは204/credentialed CORS。ユーザー行・業務データ・D1 schemaに変更なし。remote authorized-admin sessionとadmin CRUDの確認は未実施。

## D1 role分離準備（2026-09-24 JST）

`D1_TOPOLOGY=split`では業務`FANMARK_DB`、Better Auth`AUTH_DB`、emoji/reference master`MASTER_DB`を個別に選び、必要bindingの欠落時にfallbackしないselectorを追加した。legacy modeは既存single-D1 local/staging configを維持する。可用性repositoryはemoji masterとtierを`MASTER_DB`、fanmark/licenseを`FANMARK_DB`から読む。catalogとreference-master repositoriesもmaster roleを使う。local fixturesは別D1へ分割し、availabilityのmissing-binding fail-closedを追加。

read-only remote schema inspectionで既存staging D1上の`emoji_master`、`fanmark_tiers`、`languages`、`reserved_emoji_patterns`名のmaster object、およびBetter Auth schemaを確認した。source-shaped 40-table business target/importerはexact object-setを要求するため同DBへ適用しない。Node 22.6.0でWorker typecheck、availability 8件、catalog 3件、reference-master API 3件、Better Auth 8件、emoji master release integration 7件が成功した。その時点ではremote Worker/D1 binding、schema、R2、user data、domain/DNSは変更していなかった。

## Split D1 and R2 staging deployment (2026-09-24 JST)

Created APAC `fanmark-business-staging` and `fanmark-auth-staging`. The business DB remains empty; the Auth DB has only the `0003` Better Auth/MFA schema and migration ledger. Wrangler's regular remote `migrations apply` path returned `incomplete input` for the trigger-bearing migration; read-only verification showed rollback/no application tables, then the previously validated remote file-import path applied 25 statements. Readback confirmed 8 Auth tables, 6 MFA generation triggers, generation 0, one migration record, and zero user-owned rows. No rows were copied from the original master/Auth staging DB.

After the user enabled R2, created empty APAC Standard avatar and cover-image buckets. `fanmark-app-staging` version `2dd73277-d1db-4b4a-a7da-0a82815791de` now has split D1 roles and both R2 bindings with `STORAGE_BACKEND=r2`. Local typecheck and focused availability (8), catalog (3), reference-master API (3), Auth (8), Storage/R2 (5), and emoji release (7) tests passed. Live smoke checks passed for noindex, Auth health/session, anonymous admin denial, master APIs, R2 missing-object 404, and unauthenticated upload 401. A temporary synthetic Auth account exercised live sign-in, 16-byte PNG upload/read/delete and was removed; final Auth row counts were zero and the object returned 404 after deletion. Frontend storage selector remains Supabase; no actual Supabase Storage inventory or objects, real Auth/business data, production service, or domain/DNS were touched. R2 usage from the synthetic test is within included Standard free allowances; the invoice dashboard was not inspected.

## Password-protected public access connected to the source-shaped profile (2026-09-24 JST)

Connected `workers/api/src/verified-access.mjs` to the application Worker behind the explicit `VERIFIED_ACCESS_BACKEND=d1` flag. The route resolves business D1 through the split topology and fails closed when the flag, binding, or secret is absent. Added `scripts/migration/verified-access-schema.mjs` to produce and verify the proof/rate-limit extension against exact source, lifecycle, access-generation, and credential-transform descriptors. This extension is used only in disposable local D1 tests; the remote business D1 remains empty and staging keeps the route flag unset.

Node 22.6.0 verification passed: 9 focused protected-access Miniflare tests, 14 full source-profile checks (including synthetic credential-artifact provenance, protected-text verification/read, and old-proof denial after active-to-grace), Worker TypeScript, and frontend TypeScript. The latest real-password format inventory, credential transform/import flow, Cloudflare CPU/plan and multi-instance abuse checks, deployed-origin CSRF/cookie checks, and frontend canary remain open. No real password/user row, remote business DDL, production service, or domain/DNS was changed.

## Protected-access frontend connection (2026-09-24 JST)

Added `src/lib/verified-access-api.ts` behind `VITE_VERIFIED_ACCESS_BACKEND=worker` and connected the existing password prompt on short-ID and emoji access pages. The client verifies once, reads protected text/redirect/profile content with the proof cookie, validates the exact DTO, bounds response size/time, and never falls back. Public-read and protected-verification selectors must match; otherwise the page fails closed. Protected profiles use the nested authorized projection rather than a second anonymous profile lookup. Supabase remains the default and both staging selectors remain unset.

Seven client contract tests, frontend typecheck, targeted ESLint, Worker typecheck, and Cloudflare staging build pass. No password values, real user data, staging selector, remote business schema, production service, or domain/DNS was changed.

## Cloudflare staging admin authentication connection (2026-09-24 JST)

The `cloudflare-staging` frontend mode now uses Better Auth for the admin sign-in path and `GET /api/admin/session` for the authoritative role/MFA decision. The screen handles Better Auth's TOTP sign-in challenge and first-time enrollment, including its returned recovery codes. The Worker distinguishes missing/unverified TOTP setup (`mfa_enrollment_required`) from a verified factor without valid same-session assurance (`mfa_required`). Supabase-mode admin login and MFA remain unchanged; admin CRUD and business-data authorization are still separate work.

Node 22.6.0 verification passed: 9 Better Auth client tests, 9 Worker Auth/D1 tests, frontend and Worker typechecks, targeted ESLint, CI-isolation check, Cloudflare staging build, and Wrangler deploy dry-run. `fanmark-app-staging` was deployed to version `161de18f-44ea-4016-9267-39688619df9b`. Read-only HTTP smoke returned root 200/noindex, JS 200 containing the new admin-auth flow, anonymous `/api/admin/session` 401, and no-cookie `/api/auth/get-session` 200/null. A Wrangler read-only D1 migration-history query returned Cloudflare API 7403; deployment itself succeeded. The deployment uploaded Worker/assets only and made no D1/R2 writes. Remote synthetic-admin login/TOTP completion is unverified; no real Auth/user data, production service, or domain/DNS changed.

## Availability against the versioned reference-master release (2026-09-24 JST)

Added a separate local Miniflare integration that applies the checked-in
`0004_reference_master_releases.sql`, stages and activates a synthetic
release, then calls the availability Worker through the real `fanmark_tiers`
active view. It verifies the integer-cent view value and USD response, another
tier selection, and the inactive-tier result. This closes a fixture gap: the
older focused availability suite still covers request and lifecycle cases,
but it uses a simplified tier table. The new suite is registered in the local
package script and isolated CI job.

Node 22.6.0 verification passed: three new release-backed cases, eight
existing focused availability cases, three reference-master API cases, Worker
typecheck, targeted ESLint, CI isolation, and `git diff --check`. No remote
D1/R2 write, real user data, deployment, production service, or domain/DNS
change occurred.

## Owner-scoped dashboard list API (2026-09-24 JST)

Added `GET /api/me/fanmarks` backed by split business D1 and authenticated with
the existing Better Auth session resolver. The SQL uses only the resolved
session user ID for ownership, includes active/grace/expired dashboard rows,
and returns the minimum view model without email or user ID. Duplicate basic
configs and malformed target values fail closed. Credentialed CORS is
origin-allowlisted; the route is no-store and has no Supabase fallback.
`VITE_OWNED_FANMARKS_BACKEND=worker` is opt-in. The staging-mode build forced
this selector to `supabase`, and no deployment was performed because business
D1 has no application schema or rows. Wrangler staging dry-run successfully
bundled the updated Worker with the split D1 and both active R2 bindings.

The separate Miniflare suite applied Better Auth and a source-shaped synthetic
business fixture. It proved that two synthetic sessions see only their own
rows, a supplied `userId` query parameter cannot select another user, and
ambiguous duplicate configs, malformed projections, anonymous, forbidden-origin,
unsupported-method, and disabled-backend requests are rejected. Four Worker
cases and four frontend contract cases pass. Worker
and frontend typechecks, the Worker base plus verified-access suites (30
tests), the Storage/R2 suite (5), CI workflow-isolation checks, and `git diff
--check` pass. Existing lint errors in `FanmarkDashboard.tsx` are on unrelated
existing `any` expressions; new API files pass targeted ESLint. The staging R2
bucket list still contains both enabled buckets. No remote D1/R2 writes,
deployment, real user data, production changes, or DNS/domain changes occurred.

## R2 staging deployment and extension-price schema (2026-09-25 JST)

Cloudflare confirmed both APAC staging buckets already exist. Applied Master D1
migration `0006_reference_master_extension_prices.sql`; migration readback now
contains `0000`–`0006`. The active reference release remains generation 1 at
`5be91463bd0429cc9fc7a280892a80a922deb2dd9224325374171a4ce7bdc88e`. The
extension-price active view has zero rows until a fresh explicit-column source
snapshot is staged and promoted.

Deployed `fanmark-app-staging` version
`1d1bae79-5793-4341-9b1f-540a55376695` with `STORAGE_BACKEND=r2` and both
staging bucket bindings. Live smoke returned Auth health 200, root 200/noindex,
missing public object 404, and no-session upload 401. No upload or user object
transfer occurred; production and domain/DNS remain unchanged. The
R2/extension-master notes in [live observations](live-observations.md) record
full response and migration evidence.

## Reference master refresh and schema inventory (2026-09-25 JST)

Using Supabase CLI `db query --linked`, a read-only catalog query refreshed the
private 40-table schema metadata: 406 columns, 144 constraints, 139 indexes,
15 enum labels, 36 public triggers, 77 policies, 58 functions, and one view.
Snapshot format version 3 now fingerprints all eight catalog scopes, including
the behavior/security definitions. The version-2 D1 converter generated 40
tables with 20 unresolved gate groups, so business DDL remains unapplied; the
four behavior scopes are explicitly `unsupported_catalog_scope`. The
schema-only DDL artifact lacked trigger DDL, so the catalog query is the
trigger inventory source. Query outputs and generated reports remain under
`/private/tmp` with mode `0600`.

A separate explicit-column read-only query refreshed only the four approved
reference masters. The private snapshot contained 29 rows: 4 tiers, 4
languages, 5 reserved patterns, and 16 extension prices. The exact snapshot
was staged and promoted to active reference generation 2 in the APAC master
D1. Remote row/view comparison passed; all user-owned Auth tables remained
empty and the prior emoji release remained unchanged. The live Worker returned
all four master routes with HTTP 200 and `no-store`; the extension-price DTO
contains no Stripe IDs. The AdminTierExtensionPrices editor and checkout
consumer remain on Supabase until their read/write migration can be completed
together. No user rows, Storage objects, production service, or domain/DNS
settings were changed.

## Better Auth own-profile API (2026-09-25 JST)

Added `GET/PATCH /api/me/profile` behind explicit `PROFILE_BACKEND=d1`.
The Better Auth session supplies the only profile-row identity. Response fields
omit billing and invitation data; PATCH accepts only display name, preferred
language, and a same-owner R2 avatar URL. Plan, password-setup, and billing
fields are not writable. The frontend adapter is opt-in through
`VITE_PROFILE_BACKEND=worker`; `useProfile` and language preference updates
select it only when explicitly enabled, with no Supabase fallback. Existing
R2 upload client remains independently opt-in.

Local synthetic Better Auth/D1 verification passed five Worker integration
tests and four frontend client tests, covering owner scoping, privileged-field
rejection, avatar ownership, CORS, no-store, and fail-closed behavior. Worker
TypeScript checking passed. Business staging D1 remains empty, so this selector
was not enabled or deployed. No real profile rows, R2 objects, production
service, or domain/DNS state changed.

## Notifications inbox API (2026-09-25 JST)

Added a Better Auth session-scoped Worker/D1 path for listing a user's
notifications, unread count, individual read, and eligible bulk read. The
response is limited to the UI DTO, 50 rows, 16 KiB per payload, and 256 KiB per
page. The frontend can explicitly select it with
`VITE_NOTIFICATIONS_BACKEND=worker`; Supabase remains the default and there is
no fallback between backends. Synthetic D1 integration and frontend client
tests pass (six Worker cases and four client cases). Worker/type checks,
targeted ESLint, `npm run check:ci`, and `npm run build:cloudflare-staging`
passed for this change. The build reports the existing large application
chunk warning; it does not fail. The selector remains off because business
staging D1 has no application schema.
Notification generation/delivery and Cron remain on Supabase; no deployment,
user-row import, production change, or domain/DNS change occurred. See
[notifications API migration](notifications-api.md).

## App Worker/Static Assets staging redeployment (2026-09-25 JST)

Rebuilt and deployed the current Worker and staging SPA to the isolated
workers.dev service as version
`77668344-429b-43f4-81e5-0d2f8b3c74ef`. Wrangler dry-run showed split business,
Auth, and master D1 bindings plus the two enabled R2 buckets. The deployment
uploaded Worker/assets only; no D1 migration or R2 object operation ran.

Node 22.6.0 verification passed: root and Worker TypeScript checks, CI
isolation, Cloudflare staging build, 86 migration-data tests, 37 focused Worker
integration tests across Auth/profile/owned-fanmarks/R2/notifications/reference
masters/availability, and 69 frontend client tests across their corresponding
adapters and recent/public/verified access. Wrangler deploy dry-run also
passed. The SPA build retains the existing >500 KiB main-chunk warning.

Read-only live smoke confirmed root 200 with `noindex`, robots disallow, Auth
health 200, null unauthenticated session 200, anonymous admin session 401, and
four versioned reference-master APIs returning 4/4/5/16 rows with `no-store`
at release `49d582cfc482da61f5394fc83ea9d1bb67820a8d47d493dfdfb74218dd4b4c12`.
Disallowed-origin master access returned 403. Profile, owned-fanmark, and
notification routes are deployed but return their expected fail-closed 503
codes while their D1 backend selectors remain unset and business D1 is empty.
The SPA route fallback returned 200 for `/plans` and a synthetic short-ID URL;
the PWA manifest and service worker returned 200, the worker script excludes
`/api/*` from navigation fallback, missing JS stayed 404, and unknown API
routes stayed JSON 404. Both referenced favicon files returned 200.
A fresh remote catalog query found only Cloudflare's internal `_cf_KV` table;
all seven user-owned Auth tables read back zero rows. No real data, production
service, or public domain/DNS was touched.

## D1 UUID and event-sequence defaults (2026-09-25 JST)

The schema converter is now version 3. PostgreSQL `gen_random_uuid()` defaults
on source UUID columns compile to a D1-native expression that returns canonical
RFC 4122 version-4 UUID text. Source/imported IDs remain explicitly bound and
are never regenerated. This closes the UUID-default gate without weakening the
row-import UUID validator. The `fanmark_events.id` `nextval()` default now
compiles to `INTEGER PRIMARY KEY AUTOINCREMENT`, with the exact PostgreSQL
sequence value retained as a final-snapshot import gate. The conversion
contract and snapshot example were updated.

Node 22.6.0 verification passed: migration-data tests 89/89, schema-converter
tests 10/10, lifecycle/credential-schema tests 9/9, D1 importer tests 13/13,
Worker D1 runtime tests 6/6, and Worker TypeScript. The D1 runtime created 256
UUIDs through the generated default and verified canonical version/variant
bits and uniqueness. A sequence test verified monotonic allocation after an
explicit imported ID and deletion. A fresh private conversion of the
2026-09-25 catalog parsed all 40 tables and 66 indexes in isolated SQLite;
foreign-key check returned no errors and `integrity_check` returned `ok`. The
report has 18 blocking groups (10 import, 8 schema/operation) and remains
`deployable: false`. The source database locale is `en_US.UTF-8`; the three
regex-based format checks remain gated until equivalent locale behavior is
proven. No business D1 DDL, user data, production service, or domain/DNS state
was changed.

## Locale-guarded regex CHECK conversion (2026-09-25 JST)

Schema converter v4 now has narrowly allowlisted SQLite equivalents for the
three known ASCII regex checks, but emits them only when the catalog says both
source locale settings are `C`, the column has no explicit non-default
collation, and the table/column/operator/pattern all match exactly. The current
source locale is `en_US.UTF-8`, so all three checks stay gated and the v4 report
remains at 18 unresolved groups with `deployable: false`. Reprocessing the
current private catalog produced 40 tables and 66 indexes; isolated SQLite
reported zero foreign-key violations and `integrity_check=ok`. No generated
DDL was applied to business staging. On Node 22.6.0, `npm run test:migration-data`
passed 90/90 and `npm --prefix workers/api run test:d1-import` passed 13/13.

## Tier/extension-price admin path preparation (2026-09-25 JST)

Added a fail-closed Worker admin route for reading and editing only
`fanmark_tiers.initial_license_days` and extension-price fields. It reuses the
current Better Auth admin-role and same-session TOTP-assurance gate. Every
single-field edit stages a new four-master release, verifies exact D1 row
readback, then compare-and-sets the active pointer against the screen's
expected release version. Public price responses continue to exclude Stripe
IDs. The frontend adapter uses credentialed `no-store` requests and has no
Supabase fallback after an explicit Worker selection.

Synthetic verification passed: reference-master Miniflare/D1 API suite 5/5,
frontend admin API contracts 6/6, Better Auth role/MFA route checks 12/12,
Worker and app TypeScript, targeted ESLint, CI isolation, Cloudflare staging
build, Worker deploy dry-run, and `git diff --check`. The five R2
Miniflare/D1 API tests also pass. No remote D1 edit was
performed. The staging selector remains explicitly disabled because checkout
still reads these settings from Supabase; enabling only the admin writer would
split the source of truth. R2 remains enabled and bound to the existing staging
Worker, with its separate synthetic upload/read/delete smoke already recorded
in [R2 Storage API](storage-r2-app-api.md). No production, user data, or
domain/DNS change was made.

## Paired extension-pricing read path (2026-09-25 JST)

Added a separate HMAC-protected Worker service endpoint for a single extension
price, plus strict Supabase Edge client validation. It selects the test/live
Stripe ID only for the checkout caller; the coupon-based direct extension asks
for price and active state without any Stripe ID. The public extension-price
API remains Stripe-ID-free. The checkout and direct-extension Edge Functions
now support `REFERENCE_MASTER_PRICING_BACKEND=cloudflare` while retaining
Supabase user/license reads and writes, and they fail closed after selecting
Cloudflare. `ExtendLicenseDialog` also has its own disabled D1 pricing selector.
The checkout path no longer writes full pricing rows, Stripe Price IDs, user
IDs, or checkout URLs to function logs.

Validation passed: HMAC helper-to-Worker integration 4/4, private service
endpoint suite 5/5, reference-master D1/API suite 6/6, frontend reference
master contracts 7/7, Worker typecheck, and Deno checks for both Edge Functions.
The app Worker was deployed to staging as version
`763c798c-8e37-456b-a720-54f75be1270b`; a separate staging-only HMAC secret is
stored in Cloudflare and in a mode-0600 local file outside the repository. A
live signed read verified the current release and active tier-2/one-month
record through both checkout and price-only projections. The backend selectors
and Supabase Edge Function secret remain unset, so checkout and license
mutations still use Supabase. No Stripe call, D1 schema/row write, user-data
change, production change, or domain/DNS change occurred.

## Local migration-suite isolation and distribution verification (2026-09-25 JST)

The default Workers Vitest config was also discovering the profile, notification,
and favorites integration files that require their own split-D1 Wrangler
bindings. Those three files are now excluded from the generic config and remain
run by their dedicated CI commands. The static-assets integration expectation
was updated to include the already-reviewed `fanmarkId` and `shortId` fields in
the recent-fanmarks DTO.

On Node 22.6.0, the frontend/Edge contract suite passed 88 tests and migration
data passed 90. The default Worker suite passed 26 plus 9 verified-access tests;
the split-D1 API suites passed: auth 12, storage 5, owned-fanmarks 4, profile 5,
notifications 6, favorites 4, recent D1 6, availability 8, versioned-master
availability 3, public access 11, reference-master API 6, and private reference
service 5. Versioned emoji/reference master integrations passed 7 and 5 cases;
lifecycle/credential schema passed 9; generic D1 importer passed 13; source
license-expiry integration passed 20, scheduler contracts 8, and local R2 import
smoke passed. Static Assets passed 14 cases and its Wrangler HTTP smoke.

The application and Worker type checks, normal and Cloudflare-staging Vite
builds, PWA cache-boundary check, and Worker/Static Assets Wrangler dry-runs
passed. Builds report existing large-chunk and stale browser-data advisories.
The Cloudflare business D1 remains without application DDL; no remote data,
production, or DNS/domain state was changed by these local checks.

## Owner fanmark profile API (2026-09-25 JST)

Added an authenticated Worker/D1 owner profile endpoint and wired the profile
edit/preview screens behind `VITE_FANMARK_PROFILE_BACKEND=worker`. The route
resolves ownership from Better Auth session identity, accepts only profile
fields, applies bounded URL/theme/JSON validation, and supplies UUID/timestamps
at write time. Its active finite-license predicate matches the current edit
screen and source profile INSERT policy. Frontend selection remains disabled
while staging business D1 has no application schema or user rows; the overall
fanmark settings page and its access configuration are still Supabase-backed.

Local validation: dedicated synthetic split-D1 Worker integration 5/5,
frontend API contract 5/5, Worker TypeScript and application TypeScript pass.
No remote database/schema writes, user-data migration, production change, or
domain/DNS change occurred. Contract details are in
[`fanmark-profile-api.md`](fanmark-profile-api.md).

## Empty business-staging schema bootstrap (2026-09-25 JST)

The generated v4 DDL now has its own `workers/api/migrations-business`
directory, configured only for the staging `FANMARK_DB` binding. Cloudflare's
[D1 migration configuration](https://developers.cloudflare.com/d1/reference/migrations/)
supports a per-binding `migrations_dir`, keeping this schema history separate
from Better Auth and master-data migrations.

Before writing, a read-only query confirmed `fanmark-business-staging` held
only Cloudflare's `_cf_KV` table. Wrangler local rehearsal applied all 108
statements; SQLite readback found 40 application tables, 66 indexes, no
foreign-key violations, and `integrity_check=ok`. Wrangler then applied
`0000_business_schema_v4_staging.sql` to the remote APAC business database. A
read-only follow-up confirmed 40 application tables, 66 indexes, the migration
ledger entry, no pending migrations, and an empty `PRAGMA foreign_key_check`.

This applied DDL only: the migration has no row-insert/update/delete/copy
statements. The schema report remains `deployable: false` with 18 unresolved
gates; selectors remain disabled, and the Worker was not redeployed. No
Supabase rows or Auth records, R2 objects, production service, or domain/DNS
state changed. Full details are in [`live-observations.md`](live-observations.md)
and [`schema-generator.md`](schema-generator.md).


## Recent and availability read paths on staging D1 (2026-09-25 JST)

The workers.dev staging Worker now explicitly selects D1 for recent-fanmark
reads and availability; the staging SPA's shared Worker base URL selects the
matching clients. The app code was redeployed as version
`c9d51d92-3b7a-49e9-b152-b210d24a36f1` after a Wrangler dry-run. A temporary
remote synthetic fixture exercised active ordering, grace exclusion, limits,
DTO mapping, exact CORS, no-store, and invalid input; all inserted rows were
removed and remote total counts are zero. Availability resolved a canonical
emoji from Master D1 and returned a valid tier-4 result against empty business
D1. No real rows, Supabase writes, production resources, or DNS were involved.
Tests and evidence are in `recent-api-contract.md`,
`availability-validation.md`, and `live-observations.md`.


## Public access reads on split staging D1 (2026-09-25 JST)

The staging SPA was built with `VITE_PUBLIC_ACCESS_READ_BACKEND=worker`, and
the app Worker config sets `PUBLIC_ACCESS_BACKEND=d1`. A local test using
distinct business and master databases found that emoji normalization was
incorrectly querying the business D1. The repository now selects
`MASTER_DB` for canonical emoji lookup and `FANMARK_DB` for fanmark and
license projections. The split-D1 Worker suite passes 11/11; Worker typecheck,
targeted ESLint, staging build, Wrangler dry-run, and `git diff --check` pass.

Worker version `3733c771-2903-40cd-8bdc-5a0f94412c82` returned HTTP 200 and
`Cache-Control: no-store` for synthetic short-ID, emoji-ID, and published-
profile reads. The input used a canonical emoji present in Master D1 while the
business D1's `emoji_master` remained empty. Four temporary synthetic rows
were deleted and exact-ID readback found zero in each table. No real rows,
Supabase writes, production routes, R2 objects, or domain/DNS settings changed.
The public-read selector is staging-only; protected-password verification,
access analytics, owner/history detail, and complete business API parity
remain outside this slice.

## Authenticated owner APIs on staging (2026-09-25 JST)

The staging Worker config now selects D1 for own profile, owned fanmarks,
owner fanmark profile, favorites, and notifications. The
`build:cloudflare-staging` script sets the matching five
`VITE_*_BACKEND=worker` selectors so a normal staging build reproduces the
deployed frontend. The staging SPA build and Wrangler dry-run passed; deployment
updated `fanmark-app-staging` to version
`70cb8111-2a25-4e43-8662-e59dfd8add8d` with split business/Auth/master D1
and both R2 bindings.

A temporary Better Auth user created only in staging exercised profile
GET/PATCH, owned-fanmark listing, owner fanmark profile GET/PATCH, favorite
add/list/remove, and notification list/unread-count/read. An unauthenticated
profile request returned 401. The initial synthetic credential fixture used
the email for Better Auth `accountId`, which returned 401; cleanup ran and
readback showed zero rows. Using the existing test convention, with the user
ID as `accountId`, passed sign-in and all owner API checks. The Auth
user/account/session and business profile/license/fanmark/config/notification/
favorite/event/discovery rows were deleted; exact-ID/composite remote readback
showed zero. No real user rows were present in the canary and no source writes
were made.

Seven focused local suites passed 31/31: Worker favorites 4, Worker
notifications 6, and frontend profile 4, owned-fanmarks 4, fanmark-profile 5,
favorites 4, and notifications 4. The staging build emits existing stale
browser-data and large-chunk advisories. The canary proves these API routes and
session ownership against the current staging schema; it does not cover the
complete browser acceptance flow, notification generation/delivery, all
business operation/security parity, production data, or DNS/domain cutover.
Those remain outside this stage.

## R2 image uploads on staging (2026-09-25 JST)

The staging build now sets `VITE_STORAGE_BACKEND=r2` along with the five
owner API selectors. Server `STORAGE_BACKEND=r2` and both APAC Standard
buckets were already bound. The new SPA build and Wrangler dry-run passed;
deploying updated the app Worker to `3246cbf2-642f-47f2-a107-0a8a116a8f8a`.

A synthetic Better Auth account uploaded a valid 1×1 PNG to the avatar route,
read identical bytes through its public URL, deleted it through the
owner-checked route, and confirmed the URL returned 404. The synthetic account
and session were removed; D1 readback found no associated canary rows. Local
storage client tests pass 7/7, Worker D1/R2 API tests pass 5/5, Worker
typecheck passes, and staging build/deploy dry-run pass. The bucket object was
deleted; no existing Supabase objects were copied. Production builds continue
to default to Supabase. Profile metadata and overall settings saves are still
split, so this is a staging upload-path check rather than complete profile
cutover.

## Remote emoji release rollback command (2026-09-25 JST)

The remote emoji release activation runner now accepts `--action promotion`
(default) or `--action rollback`. Both require the exact current active version;
rollback also requires a verified immutable artifact for a previously active
release. After activation, readback checks the pointer, generation, action, and
new immutable history entry. A stale `--expected-active` is rejected even if
the candidate is already active, so an uncertain retry must first use the
observed current version. Three synthetic argument/readback tests pass,
`npm run test:migration-data` passes 93/93, and the local Miniflare release
suite passes 7/7. The remote rollback command was not invoked and no Cloudflare
state changed in this step.

## Owner fanmark settings API and runtime password evidence (2026-09-25 JST)

Added local `GET/PATCH /api/me/fanmarks/:fanmarkId/settings` with Better Auth
session ownership, latest-license resolution, active/unexpired write guards,
bounded allowlisted input, and D1 batch writes. The client selector remains
unset. Raw access passwords are not stored in session drafts or returned by the
API; new four-digit passwords are bcrypt-hashed in the Worker. To keep
protected public reads verifiable after a later owner password change without
rewriting the immutable import ledger, the v2 verified-access extension adds
`fanmark_password_runtime_evidence`, which stores only the current license
incarnation, password generation, enabled flag, pinned codec, and timestamps.
The verifier accepts exactly one matching import artifact or runtime evidence
row and rejects stale generations.

The settings Worker suite passed 6/6, the client API suite 5/5, the protected
access D1 suite 10/10, and the full source-profile integration 20/20. The latter
now exercises fresh apply, idempotent apply, and exact v1-to-v2 extension
upgrade/readback. Worker and frontend TypeScript checks pass, as does
`git diff --check`. No staging settings schema or Worker deployment was made:
the remote extension still requires the exact plan-bound base inventory
readback before applying v2, and the feature selectors remain off. A live
check confirmed the account is `fanmark.id@gmail.com` with D1 write permission;
`wrangler d1 list` sees the business D1 and a read-only query succeeds on the
master D1, but querying `fanmark-business-staging` returns Cloudflare error
7403. The logged-in D1 Studio opens that business database and lists its base
application schema, but not the verified-access extension tables. This
CLI-vs-dashboard discrepancy remains unresolved; no DDL was attempted. No user
data, production, or domain/DNS state changed. Details are in
[`fanmark-settings-api.md`](fanmark-settings-api.md) and
[`verified-access-design.md`](verified-access-design.md).

## Live schema refresh and single-return staging canary (2026-09-25 JST)

Linked the migration worktree to the authenticated `fanmark.id` Supabase
project and retrieved the current public schema only. The CLI wrote no row
data. The resulting public schema contains 40 tables, one view, 58 functions,
77 policies, 36 triggers, and 70 indexes. The checked-in business D1 base
migration has matching table and column names; types, defaults, constraints,
indexes, policies, triggers, and function semantics still need separate parity
review.

Added `POST /api/me/fanmarks/return` with Better Auth ownership and D1
transition, audit, and notification-event behavior. Local Worker tests pass
12/12, client tests 4/4, Worker typecheck and staging build pass, and Wrangler
dry-run passes. Deployment `83629969-f48f-4f68-beeb-7b2ef47724c6` is active on
`fanmark-app-staging` at 100%. Live unauthenticated POST returned 401 and GET
returned 405. A synthetic Better Auth owner was blocked by an active transfer
code, then returned successfully after that synthetic code was removed. The
license transition, audit, owner event, and favorite event payload were read
back; exact cleanup returned zero synthetic business and Auth rows. Bulk return and
notification delivery are still on Supabase. No Supabase rows, production
routes, or domain/DNS settings were changed.

## Fanmark registration D1 transaction on staging (2026-09-25 JST)

Implemented and selected the registration API for the Cloudflare staging SPA
and Worker. The Worker validates the submitted ordered IDs against the ready
active emoji release in Master D1, derives normalized IDs from the release's
codepoints, reads the active tier row, and uses one D1 batch for the fanmark,
initial license, requested license-scoped configuration/profile, and audit
record. Reuse checks and the final mutation reject active licenses, unexpired
grace, or pending lottery entries on an expired grace license. Competing
registrations cannot both issue a license. The client sends Better Auth cookies,
uses `no-store`, and does not fall back to Supabase after a selected Worker
failure. Supabase remains the default outside the explicit staging selector.

Verification on Node 22.6.0: `npm run test:fanmark-registration-api` passed
6/6; `npm --prefix workers/api run test:fanmark-registration-d1` passed 8/8;
frontend and Worker typechecks, `npm run check:ci`, the Cloudflare staging
build, Wrangler 4.139.0 deploy dry-run, and `git diff --check` passed. The
staging bundle contains the registration selector and the route config binds
only the existing staging D1/R2 resources. Deployment
`29dd848d-604c-4405-9bf5-58aff04a00f2` is active at 100%.

Live staging rehearsal used a disposable Better Auth identity and the active
catalog's rose emoji. Registration returned 201 and readback verified tier 4,
an active initial license, basic configuration, profile, and audit row. A
duplicate returned 409; unauthenticated access returned 401. Cleanup removed
the Auth user/account/session and all related D1 rows. Exact readback returned
zero for the fanmark, license, config, profile, and audit tables, and the sum
of all 40 business-table row counts was zero. This synthetic staging proof
does not establish Supabase-user behavior, source-row parity, or production
operation parity. The current source function calculates pattern pricing but
does not enforce its `requiresPayment` flag; no new payment policy was added
and no Stripe call was made. No source rows, production service, or domain/DNS
were modified. Contract: [`fanmark-registration-api.md`](fanmark-registration-api.md).

## Fanmark lottery application/cancellation D1 routes (2026-09-25 JST)

Added `POST /api/fanmarks/lottery/apply` and `/cancel`, selected through
`VITE_FANMARK_LOTTERY_BACKEND` only in the Cloudflare staging build. The D1
routes resolve the Better Auth session user server-side, preserve the source
grace/license-plan checks, and guard entry uniqueness and current capacity in
the mutation batch. Apply/reapply/cancel audit rows are written atomically
with their state change, matching the source `log_lottery_entry_changes`
trigger; notification creation is best effort after the saved application.
The default plan capacity remains three when the corresponding setting is
missing, and `admin` remains unlimited. Perpetual active licenses remain
excluded from this lottery query because the source uses a strict `license_end
> now` filter.

Local verification: Worker D1 suite 11/11, frontend Worker-client suite 6/6,
frontend and Worker typechecks, CI isolation check, staging build, and Wrangler
deploy dry-run passed. The local cases cover configured/default limits,
existing and concurrent applications, cancelled-entry reuse, owner-only
cancellation, audit rollback, and notification enqueue failure.

Deployed `513d9cba-2424-4528-814a-3b1d83425b73` to
`fanmark-app-staging` at 100% on workers.dev. A disposable Better Auth user
completed the registration+lottery HTTP rehearsal: register 201, apply 200,
duplicate application 400, cancel 200, unauthenticated application 401. D1
readback verified the lottery row and cleanup verified zero Auth user/account/
session, user settings, fanmark/license/entry/audit/event rows, and zero rows
across all 40 business tables. The first canary exposed missing cleanup for
trigger-equivalent lottery audit rows; cleanup now removes and checks those
exact entry-scoped rows, and the complete rerun passed. This does not cover
winner selection, active-license issuance, imported users, notification
delivery, production routing, or domain cutover. Contract:
[`fanmark-lottery-api.md`](fanmark-lottery-api.md).

## Grace-expiry lottery finalization journal (2026-09-25 JST)

The isolated business-staging D1 now has `0005_lottery_plan_journal_staging.sql`
with exact schema and ledger readback; both lifecycle journal tables remain
empty and the 40 business tables still contain zero rows. The local expiry
finalizer now stores and replays the exact lottery seed, input snapshot, and
selection plan, then applies winner/loser effects with expiration and cleanup in
one guarded D1 batch. Source integration passes 25/25, lottery selection 10/10,
scheduled expiry 8/8, Worker typecheck, and `git diff --check`. A one-shot
synthetic staging canary and transfer canary are recorded below. The deployed
scheduled backend and Cron remain disabled. Real user-data migration and
domain/DNS cutover remain last.

## Transfer lifecycle canary on staging (2026-09-25 JST)

Deployed Worker version `929280ae-3285-4936-af67-a6f146aae03e` to
`fanmark-app-staging` at 100%. The first live approval returned `409` even
though its D1 batch had committed all transfer rows. The handler previously
trusted per-statement change metadata; approval now performs an exact terminal
state readback before returning success. The rerun passed issue, apply, and
approve, including owner/requester scoping, config reset, transfer lock,
pending lottery cancellation, audit/outbox creation, and cleanup.

`npm run test:staging-fanmark-transfer-smoke` passed. Its `finally` cleanup
returned all 40 source business tables and every user-owned Auth table to zero;
the pre-existing global `mfaGeneration` counter was unchanged. The test used
only disposable synthetic identities and rows. It copied no Supabase users,
did not touch production, and did not alter domain/DNS.

## One-shot grace-expiry lottery canary on staging (2026-09-25 JST)

`scripts/migration/staging-license-expiry-lottery-smoke.mjs` invoked Wrangler's
`--test-scheduled` event from the local Worker runtime with the explicitly
remote `FANMARK_DB` binding. Before seeding it checked that all 40 business
tables, user-owned Auth tables, and lifecycle run/item/effect journals were
empty. A single synthetic pending applicant won. Readback confirmed the
old license expired, the winner received an active license, the weighted
history and durable seed/input/plan were saved, audit and both notification
events were written, and there were no conflicts. The four source access
configuration projections were removed; the profile row remained as in the
source function.

The cleanup returned all 40 business tables and lifecycle run/item/effect
journals to zero and matched both retained lifecycle tables to their exact
pre-canary snapshot (including the existing 16-row incarnation registry).
The deployed app still has no `LICENSE_EXPIRY_BACKEND` selector or Cron
trigger, so this was a one-time staging proof, not scheduled activation. No
Auth identities, Supabase rows, production routes, or domain/DNS settings
changed.

## Bulk plan-downgrade return on staging (2026-09-25 JST)

The Cloudflare Worker now implements `POST /api/me/fanmarks/bulk-return` and
the two plan-selection screens route to it under the existing
`VITE_FANMARK_RETURN_BACKEND=worker` selector. The route accepts 1–50 distinct
license IDs, resolves the owner from Better Auth, blocks inactive/expired or
transfer-locked licenses, and processes each item independently. It preserves
the existing 207 partial-result contract and best-effort audit/notification
event behavior. Production still selects Supabase.

The Worker D1 integration suite passes 17/17 and the frontend client suite
passes 7/7; both typechecks, targeted ESLint, staging SPA build, Wrangler
deploy dry-run, and `git diff --check` pass. Staging version
`186255d9-c8ec-47bf-a8e0-32b3296a6ab3` is active at 100%. The live canary
returned HTTP 207 for one successful return plus one transfer-locked license,
then HTTP 200 after the synthetic transfer code was removed. Cleanup confirmed
zero rows in all 40 source business tables and all user-owned Auth tables,
unchanged access-version state and `mfaGeneration`, plus two newly retained
synthetic license-incarnation tombstones. The registry has 21 rows total: 16
pre-existing tombstones and five from the current return-canary attempts. The
one earlier setup attempt hit a duplicate normalized-emoji key and was cleaned
up; it left only the expected non-user anti-reuse tombstone. No Supabase rows,
production route, Cron trigger, or domain/DNS state changed.

## Earlier checkpoint: Stripe extension payment settlement guard (2026-09-25 JST)

The extension Checkout Session now carries the server-selected expected JPY
total and explicitly disables zero-total Stripe fulfillment, consistent with
the Admin free-extension path bypassing Stripe. The webhook processes a paid
completed Session or the async-payment-success event, leaves an unpaid
completion without a grant, and treats async failure/expiry as no-grant events.
Amount/currency changes fail closed for newly created Sessions. Seven new
settlement tests cover positive pricing metadata and paid, unpaid, asynchronous,
zero-total, and mismatch states. Billing tests pass 70/70 under Node 22.6; Deno
checks, Stripe module typecheck, and `git diff --check` also pass.

At this checkpoint the Checkout Session effect was not yet deduplicated or
atomic. The later transaction and webhook integration are recorded below.

## Stripe extension receipt-to-effect transaction (#32, 2026-09-25 JST)

Connected only the paid-license-extension checkout events to the durable
receipt path. The webhook now verifies the raw request bytes under a 256 KiB
streaming cap, stores the redacted normalized receipt, and invokes a
service-only PostgreSQL function. That function keys the effect by live/test
mode plus Checkout Session ID and commits license extension, pending lottery
cancellation, LICENSE_EXTENDED audit, effect-ledger state, receipt status, and
dispatch status in one transaction. It also creates the product-required
lottery cancellation audit and one notification event per canceled applicant.
It rechecks current owner, finite active or grace license state, fanmark tier,
and transfer locks. Unpaid completion is
stored as awaiting payment; a later async success can apply once. Expired or
failed sessions cannot grant time, conflicting metadata or amount/currency
mismatches fail closed, and a repeated event/session cannot extend twice.

Validation: the focused Stripe receipt, payment-settlement, effect-transaction,
and RPC-result suites pass 35/35 under Node v25.5.0. PGlite executes the new
SQL against an isolated source-shaped fixture, including duplicate Session
IDs, DST-boundary UTC rounding, terminal-state rejection,
rollback after synthetic audit and notification failures, per-applicant
notification payloads, and client-role ACLs. Deno checks
pass for both changed Edge Functions and the shared modules; the Stripe
experiment typecheck, CI workflow-isolation check, and `git diff --check` pass.
This migration is local and was applied only in PGlite: it is not applied to
Supabase or D1, and neither Edge Function is deployed. Stripe endpoint/event
settings, production, user/Auth/object data, and domain/DNS were not changed.

Open work remains: Checkout intent creation and Stripe idempotency keys,
non-extension webhook receipt/application paths, independent Postgres
concurrency checks, and Cloudflare D1 porting are outside this slice. A
payment reported after a failed/expired Checkout is dead-lettered without a
license grant; there is no automatic refund or operator alert yet, so add a
monitored reconciliation path before enabling this in production.

## Stripe Checkout intent and idempotency (#32, 2026-09-25 JST)

Added the local Checkout command boundary. The browser supplies a UUID request
ID persisted in `sessionStorage`; a service-only Postgres RPC validates the
current owner and stores the license, tier, months, selected Stripe Price ID,
positive JPY total, and live/test mode before the API call. The Edge Function
reuses an existing intent and its pinned terms, sends an intent-derived
Stripe idempotency key, stores the returned Checkout Session ID, and retrieves
an already bound open Session on retry. The signed webhook associates the
Session with that exact intent and verifies all immutable metadata before
applying the extension.

The local retry window is 20 hours. Stripe says keys may be pruned after they
are at least 24 hours old; an unbound intent past the local window returns a
reconciliation-required result and cannot create another Session. This
retention boundary is documented in the [Stripe API reference](https://docs.stripe.com/api/idempotent_requests).

Validation: the full Stripe receipt experiment passes 90/90, including the
PGlite intent transaction tests; root TypeScript, Deno checks, Stripe experiment typecheck,
CI workflow-isolation check, and `git diff --check` pass. ESLint passes on the
changed files when existing unrelated `any` and hook-dependency findings in
`FanmarkDashboard.tsx` are suppressed. The SQL ran only in PGlite; it is not
applied to Supabase or D1, no Edge Function was deployed, and Stripe or
production state was not changed. User-enabled R2 was not needed for this
Stripe slice.

Remaining: monitored manual reconciliation when Stripe created a Session but
the response and webhook were both lost beyond the local key window;
non-extension webhook and outbound billing commands; independent Postgres
concurrency testing; and the D1 port.

## Fanmark search details read API (#33/#34, 2026-09-25 JST)

Moved the search screen's `get_fanmark_complete_data` detail read behind
`POST /api/fanmarks/search/details` for the Cloudflare staging build. The Worker
reads business D1 and derives the optional lottery-entry projection from the
Better Auth session; caller-supplied user IDs are not accepted. Its versioned
allowlist omits protected redirect/message/password configuration. Frontend
Worker errors do not fall back to Supabase. Search-history writes remain on the
Supabase RPC for the deferred user-data stage.

Frontend contract tests pass 5/5, Worker default suites 30/30, and
verified-access suites 10/10. Root and Worker typechecks, the Cloudflare staging
build, Worker dry-run, and staging-config dry-run pass. Staging deployment
`e3d47df4-eb20-4ade-8857-398cde3aab0d` returned anonymous search details as
`{schemaVersion:1,result:null}` while business D1 remains empty; Better Auth
health returned 200 and unauthenticated admin returned 401. Business D1 has no
pending migrations. User-specific live details against imported rows, history
write migration, real data import, production routing, and domain/DNS are not
proven by this slice.

The related messageboard-preview screen had one remaining direct call to this
RPC. It now selects `getOwnerFanmarkSettings()` under the existing
`VITE_FANMARK_SETTINGS_BACKEND=worker` staging selector and keeps the RPC only
for regular Supabase builds. The settings frontend suite passes 5/5; app
typecheck and staging build pass. Deployment `e3d47df4-eb20-4ade-8857-398cde3aab0d`
returned 401 for the owner-settings GET without a Better Auth session. A
populated-row browser preview remains unverified because staging D1 is empty.

## Lifecycle settings Worker path (#34, 2026-09-25 JST)

Split the grace-period setting from the generic settings hook. The dashboard
and admin page now use one lifecycle hook; the staging frontend reads the
single public D1 value through `GET /api/system/lifecycle`, while
`PATCH /api/admin/system-settings/lifecycle` requires the existing Better Auth
administrator and session-bound MFA check. The patch accepts only an integer
from 1 through 365, uses a 1 KiB body limit, refuses a private-key collision,
and verifies the saved value by readback. Production builds remain on
Supabase. Product and architecture docs record the configured range and the
dedicated API contract.

A direct read-only Supabase query returned one public
`grace_period_days=1` value. After confirming staging D1 had no licenses or
lifecycle journals, inserted only that one public config row. No user rows or
other settings were copied. The current staging Worker is
`bf951bd0-4aee-42f2-a9a7-997beffe06de`; live public GET returned 200/no-store
with the exact value, anonymous admin PATCH returned 401, root returned
200/noindex, and Better Auth health returned 200.

Frontend client tests pass 4/4; combined settings D1 tests 9/9; Worker standard
and verified-access suites 30/30 and 10/10. Both TypeScript checks, focused
ESLint, staging build, Wrangler dry-run, and `git diff --check` pass. Full-file
lint of `FanmarkDashboard.tsx` continues to report existing `any` and hook
dependency findings. A rerun of the scheduled canary with safe setting
preservation failed at the local Wrangler test-scheduled transport
(`ECONNRESET`); cleanup restored the setting, zeroed canary license/journal
rows, and preserved 22 retained incarnation records. No Cron was enabled.
Authenticated admin browser use and the scheduler Cron remain unverified.
# 2026-09-25: 空き状況APIをactive emoji releaseへ統一

空き状況D1 repositoryがmutableな`emoji_master` mirrorを参照していたため、登録・お気に入りと同じversioned active releaseを参照するよう変更した。ready metadataのないpointerはupstream errorでfail closedし、mirrorにだけ残る旧IDは`invalid_emoji_ids`となる。canonical値がactive releaseと異なる場合もactive releaseのemoji identityを使う回帰テストを追加した。

Node 22.6.0でfocused D1 tests 10/10、versioned emoji/reference-master integration 4/4、Worker default suite 30/30、Worker/Frontend TypeScript、staging build、変更ファイルESLint、Wrangler staging dry-runが成功。Staging app Worker `b381e0b3-7e03-41c2-a217-aeb1d5c5cf68`を100%配備。GET-only live smokeでroot/auth health、3,944件のactive catalog version、同catalogから得たIDによるavailability 200を確認。remote D1、R2、Supabase、production、user data、domain/DNSへの書込み・切替なし。詳細は`docs/migration/availability-validation.md`。

## Maintenance settings Worker path (#34, 2026-09-25 JST)

`maintenance_mode`、`maintenance_message`、`maintenance_end_time`だけを扱う公開GETと管理者PATCHを追加した。staging buildは`VITE_MAINTENANCE_SETTINGS_BACKEND=worker`を選び、Workerは`MAINTENANCE_SETTINGS_BACKEND=d1`とsplit business D1を使う。admin PATCHは既存のBetter Auth管理者・session-bound MFA検証へ接続した。未取得やWorkerエラーをSupabaseへフォールバックせず、一般ユーザーの画面を閉じる。管理画面のメンテナンス項目は1回のPATCHにまとめ、猶予日数設定だけは従来のSupabase経路に残した。

Node 22.6.0でフロント契約テスト4/4、専用Worker D1テスト5/5、Worker標準suite 30/30、verified-access suite 10/10、root/Worker型チェック、対象ESLint、staging build、Wrangler dry-run、`git diff --check`が成功。Worker version `b7b208c7-68f8-4918-bfd9-b785ef66003d`をstagingへ配備し、公開GETがmaintenance offの既定値を`no-store`で返すこと、未認証PATCHが401となること、後続GETで値が変わらないことを確認した。認証済みPATCH、設定行の作成、maintenance modeの切替は実施していない。Supabaseや本番、ユーザーデータ、ドメイン/DNSにも変更なし。

## Deployed grace-expiry lottery Cron canary (2026-09-26 JST)

Ran `scripts/migration/staging-license-expiry-lottery-smoke.mjs` with
`FANMARK_STAGING_CRON_CANARY=1` against the APAC `fanmark-business-staging`
D1. Preflight verified the 40-table business profile had only its public
`grace_period_days=1` row, the user-owned Auth tables and lifecycle journals
were empty, and retained lifecycle rows could be snapshotted. The script seeded
only synthetic IDs, temporarily changed that public setting to `14`, and
deployed the workers.dev Worker with `LICENSE_EXPIRY_BACKEND=d1`, a unique
target-incarnation/schema digest, a four-page bound, and `* * * * *`.

The deployed scheduled event completed the expiry and lottery finalization.
Exact D1 readback confirmed the old license expired, the single pending entry
won, one active winner license was issued, history and durable seed/input/plan
were stored, the four old access-config rows were removed while the profile
remained, both notification events and an audit row were written, and there
were no conflicts. An initial short wait had no journal; Cloudflare documents
Cron changes can take up to 15 minutes to propagate, so that attempt was
inconclusive. The rerun used a 17-minute bound and succeeded.

The script redeployed immediately from the staging config, whose
`triggers.crons` is now explicitly `[]`, and removed the temporary backend
selector before detailed readback and cleanup. The final exact checks restored
`grace_period_days=1`, all non-settings business tables and lifecycle journals
to empty, the retained lifecycle state to its pre-canary snapshot, and all
Auth user tables to empty. Independent remote readback confirmed zero
fanmarks, settings users, licenses, notifications, audits, expiry/finalizer
runs/items, and effect guards. Cloudflare Settings now reports no Cron trigger;
the current app version `507c5143-0bd5-476a-b29f-22c646db1652` serves `/` with
HTTP 200. This proves one synthetic scheduled execution on staging only; no
Supabase user rows, production resource, or domain/DNS setting changed. It does
not enable recurring Cron or prove populated-user behavior/production CPU fit.

## Supabase schema refresh and notification master seed preparation (2026-09-26 JST)

The earlier “latest Supabase schema waiting for terminal input” status was
incorrect: it described an earlier `db dump` attempt that needed a local Docker
daemon. The current `npx supabase@2.118.0 db query --linked` path uses the
Management API and reads catalog metadata without Docker. The fresh private
catalog contains 40 base tables/406 table columns, 144 constraints, 139
indexes, 15 enum labels, 36 triggers, 77 RLS policies, one view, and 58
functions. The separate 411-column information-schema total includes five view
columns. Converter v4 still has 18 blocking groups; its table and column names
match the checked-in 40-table staging baseline. No application rows were read.

Exported the global notification masters into a private source snapshot and
prepared `scripts/migration/staging-notification-master-seed.sql`: 10 in-app
rules and 40 active in-app templates (10 per locale for en/id/ja/ko). Auth-owned
`created_by` was excluded. Local SQLite rehearsal matched every projected
source field exactly, confirmed repeat safety and a clean FK check, and left
preferences/events/notifications empty. The remote staging D1 still has zero
rows in the master tables. Wrangler remote D1 query/list-migrations returned
Cloudflare API 7403 even though `whoami` confirms the configured account and
`d1:write`; a read-only query in Dashboard D1 Studio succeeded. At this
checkpoint the seed was not applied. The D1 write-path blocker was resolved
later the same day; see the successful application and exact readback below.

## D1 notification event processor local slice (2026-09-26 JST)

Added `workers/api/src/notifications-scheduled.ts` and connected it to the
existing Worker scheduled entrypoint. With the explicit
`NOTIFICATION_PROCESSOR_BACKEND=d1` selector, it claims due events, applies
enabled rules, user preferences, segment filters, cooldown and per-user limits,
renders locale templates with the source function's date-placeholder behavior,
and atomically writes notifications plus the processed event state. Immediate
in-app items are marked delivered; delayed and other channels remain pending
for their channel delivery path. A stale processing claim is bounded to a
10-minute lease before recovery.

The notification D1 suite passes 12/12 and the Worker TypeScript check passes.
Local synthetic tests cover rendered in-app content, immediate/delayed status,
repeat polling, and the disabled selector. At this checkpoint the processor had
not run against remote D1; a later one-shot staging canary is recorded below.
The staging selector remains unset and no Cron trigger is configured. Email and
Web Push delivery, event creation parity, notification archival, and populated-
user CPU/authorization review remain open.

## Remote notification-master seed and exact readback (2026-09-26 JST)

The earlier Wrangler D1 7403 failure was retried from the authorized account;
read-only queries and the staging-only write both succeeded on the exact
`fanmark-business-staging` database ID
`d4bb0c48-f24a-491f-8693-fa393ab0b873`. Before the write, the migration ledger
was confirmed at `0000`–`0005`, and rules, templates, preferences, events,
notifications, user settings, fanmarks, and licenses were all empty. Applied
the two-statement staging seed, which only inserts global templates and rules;
Wrangler reported two executed statements.

`scripts/migration/verify-staging-notification-master-seed.mjs` then compared
all projected rows against the private Supabase master snapshot with source
SHA-256 `900f9f3a00bd5d0e68de541a0ad2a10a47c24def6613b89be69739b34584b3fb`.
Readback matched all 10 rules and 40 templates exactly, with `created_by` NULL.
Preferences/events/notifications, user settings, fanmarks, and licenses remain
zero, and the singleton public `grace_period_days=1` setting was preserved.
The remote notification master-data stage is complete. The processor has also
passed a one-shot scheduled-handler canary against remote staging D1, but no
deployed selector or recurring Cron is enabled; channel delivery and full app
verification remain separate.

A wider table-count audit found the expected six migration-ledger rows, the
50 notification masters, and one public settings row. The access-security
extension also has its singleton policy plus one failed synthetic audit, one
finished reservation, and one resource rate-limit bucket dated 2026-09-25.
These are the documented protected-access canary's digest/counter state, not
source user rows; they were preserved rather than cleared.

## Remote D1 notification processor canary (2026-09-26 JST)

`npm run test:staging-notification-processor-smoke` inserted one random
synthetic user-settings row and one due `favorite_fanmark_available` event in
the exact business staging database, then invoked the Worker `scheduled`
handler locally with `NOTIFICATION_PROCESSOR_BACKEND=d1`. Remote readback
confirmed the event reached `processed`, generated exactly one delivered
Japanese in-app notification with the synthetic fanmark name, and did not
increment retries. Cleanup removed the notification, event, and user-settings
row. All notification event/notification/preference/user-settings counts
returned to zero; the 10 rules, 40 templates, public grace-period setting, and
protected-access state matched their pre-run baselines. Worker tests passed
12/12, Worker typecheck, targeted ESLint, staging SPA build, smoke-script syntax,
and `git diff --check` passed. This exercised a local Worker against remote
staging D1; it did not deploy code, change Cron configuration, or process real
user data. The reusable script is
`scripts/migration/staging-notification-processor-smoke.mjs`.

## Staging Better Auth TOTP and emoji-admin integration (2026-09-26 JST)

Ran `workers/api/test/staging-admin-totp-smoke.mjs` with its explicit staging
write/database/master-roundtrip flags. Against the currently deployed
workers.dev app it provisioned a random synthetic administrator, signed in,
enrolled and verified a first TOTP factor, verified session rotation and
session-bound MFA assurance, then edited a release-protected emoji draft. The
deletion guard returned 409 as required; the script restored the original
draft and read back an unchanged active public catalog/version. It deleted the
synthetic account, factor, assurance, and session; all seven user-owned Auth
tables read back zero. A separate read-only Auth D1 query found the singleton
`mfaGeneration` row intact at generation 6. No actual user credential or factor
was used.

Read-only requests to the same deployed app returned 200 for `/`,
`/manifest.webmanifest`, `/sw.js`, and `/robots.txt`; the manifest identifies
`fanmark.id` with standalone display, and robots disallows indexing. This
verifies deployed asset and PWA-shell routes only; browser installation, offline
operation, signup/email/OAuth, and broad admin workflows remain unverified.
The staging SPA build, Worker typecheck, and targeted ESLint passed. No Worker
deployment, production route, real user data, or domain/DNS setting changed.

## Initial Stripe ingress schema port to local D1 (2026-09-26 JST)

Added a local-only business-D1 migration for Stripe webhook receipts and their
one-to-one durable dispatch rows, a signature-verifying `POST
/api/stripe/webhook` route behind an unset backend selector and signing secret,
and D1 claim/renew/retry lease primitives. It carries over live/test event
uniqueness, redacted normalized JSON, raw-body hashes without raw-body storage,
composite receipt binding, terminal-state rules, and lease/fencing constraints.
A fresh Miniflare D1 integration passes 20/20 cases, including concurrent
duplicate delivery and claim convergence, terminal-state repair, immutable
event conflict handling, valid SDK-signed request handling, stale/invalid
signature rejection, expired-lease fencing, retry transitions, and atomic
rollback on dispatch/receipt write failures. Worker API typecheck, targeted
ESLint, Node 22.6.0 tests, and Wrangler staging dry-run pass.

The D1 migration was not applied remotely; the route was not deployed or
enabled. No processing worker, Stripe API call, Stripe Dashboard change, or
billing effect was added. This is local schema, ingress, and lease evidence only, not
completion of issue #32. Details: [Stripe D1 ingress validation](stripe-d1-ingress-validation.md).
The read-only staging Worker secret inventory contains no Stripe webhook
secret. A read-only remote D1 migration-list call returned error 7403; the
remote ledger therefore remains unrefreshed for this checkpoint.

## Local Stripe Checkout dispatcher and notification-master admin slices (2026-09-26 JST)

Added a D1 extension Checkout endpoint and frontend client behind independent
selectors. It pins the active versioned Master D1 price, derives the caller
from Better Auth, checks license ownership/transfer/grace limits, persists an
intent before calling Stripe, and reuses an open Session with a stable key.
The D1 scheduled dispatcher claims test/live receipts sequentially, applies
extension events, retries transient errors with bounded backoff, and
dead-letters unported subscription/invoice events for review. Four synthetic
Checkout integration cases, five existing/new D1 receipt/application/scheduler
cases groups totaling 30, and five client contracts pass; fake Stripe clients
were used, with no real Stripe request.

Added an MFA-gated admin API/client for listing and editing only global
notification rules and translated templates. DTOs omit `created_by` and
template payload schema; updates compare `updated_at` to prevent stale
overwrites. The initial master-only screen change passed five D1 API tests,
four client contracts, and 13 Better Auth admin authorization tests. This
worktree now also routes manual event creation and event/delivery logs to the
same MFA-gated D1 API; the expanded suites pass six Worker tests and five
client tests. That new route/client slice has not been deployed or remotely
exercised. Details: [Stripe D1 validation](stripe-d1-ingress-validation.md)
and [notification API](notifications-api.md).

The initial R2 inventory confirmed the avatar and cover staging buckets. Since
that read-only inventory, later dated sections document the D1/R2 selectors,
notification Cron, applied business migrations `0006`/`0007`, and synthetic
staging canaries. Those staging changes did not touch Stripe APIs, real user or
Auth rows, production routes, or domain/DNS state. Historical test counts in
the earlier local-only snapshot above describe that earlier checkpoint, not
the current suite.

## Local invitation-code admin API slice (2026-09-26 JST)

Added a separate MFA-gated D1 admin API and frontend selector for invitation
code list/create/update/active-state/delete operations. The Worker creates
random codes when the admin leaves code generation automatic, owns initial
usage fields and creator attribution, returns a DTO without creator IDs, and
uses `updated_at` compare-and-set for edits. Existing user-settings references
prevent deleting a code.

The D1 integration suite passes 5/5; frontend client contracts pass 4/4.
Root/Worker typechecks and focused ESLint pass. `VITE_INVITATION_ADMIN_BACKEND`
and `INVITATION_ADMIN_BACKEND` remain unset for staging because invitation
codes have not been imported. The invitation-mode toggle, signup validation
and consumption, Better Auth signup, and email verification are still on the
existing Supabase path or closed. No remote D1 write, Worker deployment,
production, real user/Auth data, or domain/DNS state changed. Details:
[invitation admin API](invitation-admin-api.md).

## Remote Stripe schema preparation on staging (2026-09-26 JST)

Following successful local Worker/client/migration-data suites, Wrangler
read-only checks showed that only business migrations `0006` and `0007` were
pending on the intended APAC `fanmark-business-staging` database. The existing
lottery table required by the DDL was present. Both additive schema migrations
applied successfully. Remote readback found the six Stripe receipt,
dispatch, intent, application, effect, and lottery-entry tables empty;
`fanmarks`, `fanmark_licenses`, and `user_settings` also remained empty. The
next migration-list query returned no pending work.

The staging Worker was not redeployed, and the Stripe secrets, selectors, and
Cron remain absent. No Stripe API call, production state, real user data, or
DNS/domain setting changed. The empty schema is staging preparation only;
subscription/invoice parity and sandbox transaction rehearsal remain open.

## Transfer-generated notification events through the deployed Cron (2026-09-26 JST)

Extended and ran `scripts/migration/staging-fanmark-transfer-smoke.mjs` on the
current workers.dev staging app. The synthetic owner issued a code, a second
user applied, the owner rejected the request, and the code was reapplied and
approved. The deployed one-minute Cron processed `transfer_rejected`,
`transfer_requested`, and `transfer_approved`, producing exactly one Japanese
in-app notification in `delivered` state for each intended recipient.
The smoke waits up to 90 seconds and fails on failed events, duplicate
notifications, wrong recipients, missing Japanese text, or timeout.

Cleanup removed notifications before events and deleted all synthetic transfer,
fanmark, license, audit, settings, and Better Auth rows. Exact post-run readback
reported zero synthetic business and Auth rows and left the MFA generation
baseline unchanged. Only Cloudflare staging and synthetic users were used;
real user data, production, and domain/DNS state were untouched.

## Return-generated notification events through the deployed Cron (2026-09-26 JST)

Extended and ran `scripts/migration/staging-fanmark-return-smoke.mjs` against
the current workers.dev app. The synthetic account first confirmed an active
transfer code blocks return, then returned its fanmark successfully; D1
contained exactly one `fanmark_returned_owner` event and one
`favorite_fanmark_available` event from the two event-producing paths.

The deployed one-minute Cron processed both events. Each generated exactly one
delivered in-app notification with a Japanese-rendered body and the expected
synthetic fanmark metadata/link. The test waited up to 90 seconds for Cron and
failed if an event became failed or delivery was missing. Cleanup removed the
notification children before events and then removed all associated synthetic
business/Auth rows; exact readback returned zero notifications, events, audit,
fanmark, license, transfer, favorite, discovery, user, account, and session
rows. Read-only master inspection before the run confirmed enabled rules and
active translated templates for both event types. No user data, production
resource, or DNS/domain setting changed.

## All migrated in-app notification rules through deployed Cron (2026-09-26 JST)

Extended `scripts/migration/staging-notification-processor-smoke.mjs` to submit
one synthetic payload for each of the 10 active in-app rules. The staging Cron
processed all events and produced exactly one delivered Japanese notification
per rule, with expected title, recipient, fanmark ID, and zero retries. The
canary cleaned notification/event/settings rows and read back zero; global
notification masters, public settings, and protected-access state were
unchanged. No worker config change or deployment was needed; the Cron remains
enabled for staging.

## Authenticated whois details and R2 staging verification (2026-09-26 JST)

Implemented `POST /api/fanmarks/details` on the integrated Worker. Anonymous
requests use a separate SQL projection that does not select owner identities,
history, favorite rows, or lottery entries. Authenticated requests resolve the
caller from Better Auth and return bounded ownership history plus derived
caller state without user IDs, emails, or license IDs. The staging frontend
selects this route explicitly; the normal build keeps the existing Supabase
RPC and Worker errors do not fall back.

Worker D1 tests passed 3/3; client DTO/fetch tests passed 4/4; frontend and
Worker typechecks and Cloudflare staging build passed. The full Worker package
suite passed 84 tests. Wrangler dry-run showed the split D1 bindings and both
R2 buckets, and remote Business/Auth/Master D1 checks found no pending
migrations. Staging deployed as version
`44d56b91-dbcf-46ce-ac9a-900431b143f9`; readback returned SPA 200, Auth health
200, and a no-store null result for an absent short ID.

The staging registration smoke confirmed the anonymous whois projection
omits history and personal state while a synthetic Better Auth owner receives
one history row and their pending lottery state. Cleanup read back zero
business/Auth rows. The staging R2 profile smoke uploaded, read, and deleted
one synthetic image in each bucket and confirmed both public object URLs
returned 404 after cleanup. These are workers.dev synthetic checks only; no
user-data import, production route, or domain/DNS change occurred.

## Availability rules and registration configuration on staging (2026-09-26)

Seeded four read-only-verified Supabase availability rules into staging D1;
all remained disabled and the source admin UUIDs were omitted. The staging
frontend now uses the Worker admin API guarded by current-session admin MFA;
its live TOTP canary listed the rules, performed a CAS update, rejected a stale
revision, restored the original value, and confirmed all four remain disabled.

Copied only the public `max_emoji_characters=5` system setting after confirming
the key was absent in staging. Readback shows that setting and the existing
`grace_period_days=1`; `system_settings` remains an explicit allowlist rather
than a table-wide copy. The deployed registration Worker reads the configured
maximum from D1. A synthetic staging registration/lottery/details and R2
cover-profile canary passed and cleaned its Auth, business, and object rows.
The registration route also rejects six distinct emoji IDs with
`invalid_emoji_count`. The Worker is version
`00ebddee-9f63-4840-abc8-f00dfe847ff5` at 100% on
workers.dev.

The full Worker package suite passes 88/88; registration D1 tests pass 10/10
and migration-data tests pass 93/93. Frontend/Worker typechecks, rule-admin
client tests 5/5, baseline validation 2/2, CI workflow isolation, targeted
lint, staging build, and Wrangler dry-run pass. Production, real user/Auth
data, Stripe, and domain/DNS remain untouched.

## Public OGP routes on workers.dev staging (2026-09-26 JST)

Added `/a/:shortId` crawler HTML and `/api/ogp-image` SVG generation to
`workers/api/src/ogp.ts`. Metadata uses the shared public D1 access/profile
projection. Published profile names are included only for an eligible,
unprotected profile; protected profile data is not queried. The existing
browser route still serves the SPA. Crawler HTML is `no-store` with
`Vary: user-agent`, and the staging response carries `X-Robots-Tag`.

Deployed Worker version `767ff630-81c2-4b01-bf89-012fc43e8a29` to the existing
workers.dev app. Read-only live checks returned crawler fallback 200, browser
SPA 200, SVG 200, six-character image input 400, root 200, and Auth health
200. The crawler fallback URL used the workers.dev host. No business row or R2
object was written. Local D1 public-access tests passed 13/13, the full Worker
suite 88/88, Worker/frontend typechecks, targeted lint, staging build, and
Wrangler staging dry-run passed. Remote staging has no public profile row, so
live profile-name/protected-profile rendering remains locally verified only.
The production Supabase OGP functions and public domain remain unchanged.

## Emoji-path OGP parity on workers.dev staging (2026-09-26 JST)

Extended crawler metadata to the legacy `/:emojiPath` URL. The Worker resolves
one exact active spelling to its short ID and then reuses the shared public D1
projection; duplicate active spellings fail closed to generic metadata. The
canonical crawler URL uses `/a/:shortId`, while non-crawler browser navigation
continues through Static Assets to the SPA.

Deployed `fanmark-app-staging` version
`4988be1e-5f1b-4839-8f3f-511d0a4238f6`. Live empty-D1 crawler fallback for an
emoji path returned 200 with `no-store`, `Vary: user-agent`, and staging
no-index. A browser-style navigation request for the same path returned the SPA
with 200. Local synthetic D1 verifies canonicalization, duplicate rejection,
protected-profile redaction, HTML/XML escaping, and navigation fallback. The
focused public-access suite passed 13/13; the full Worker suite passed 88/88;
Worker/frontend typechecks, staging build, targeted ESLint, CI isolation,
Wrangler dry-run, and `git diff --check` passed. Staging has no public fanmark
rows, so only generic remote OGP fallback is claimed. No D1 or R2 row/object,
user data, production routing, or domain/DNS setting was changed.

## Snapshot sequence-state rehearsal (2026-09-26 JST)

Snapshot format 4 now records the reviewed `fanmark_events.id` PostgreSQL
sequence definition, exact decimal watermark, and `isCalled` state. Export and
offline verification reject unsupported, missing, extra, or changed sequence
metadata. The local D1 importer seeds and reads back `sqlite_sequence` after
row import; Miniflare confirms the next generated ID for both called and
unused source sequences. The import report records exact source and target
watermarks. The migration-data suite, now including the D1 importer, passes
111/111 with no skips. A final source snapshot still requires event writers to
be frozen because sequence advancement is outside PostgreSQL MVCC. No source
event rows or live sequence values were read and no remote D1/R2 write was
performed; the schema remains `deployable: false` with 18 blocking gates.

## Encrypted snapshot archive rehearsal (2026-09-26 JST)

Added a Git-external backup bundle containing one AES-256-GCM ciphertext and a
small private-mode header. Source paths, table/file counts, and exact file
sizes remain inside the authenticated archive; only total ciphertext size
rounded to 64 KiB is exposed. Restore authenticates the complete ciphertext
before unpacking into a private temporary directory, verifies the snapshot,
and publishes it only after verification. The local D1 importer composes this
restore path and removes its plaintext scratch tree after the import attempt.
Key mismatch, ciphertext tampering, private modes, bundle metadata exposure,
snapshot verification, and synthetic D1 import all pass. The migration-data
suite passes 115/115 with no skips. No live source rows or sequence values
were read, no remote D1/R2 write was made, and the schema remains
`deployable: false` with 18 blocking gates. Operational backup destination,
separate key custody, retention/deletion policy, and restore from a persisted
artifact remain open; a real snapshot remains in the final user-data stage.

## Public access analytics D1 write path (2026-09-26 JST)

Added a Worker `POST /api/fanmarks/access` endpoint and an opt-in frontend
adapter for the existing public short-id access event. The endpoint bounds and
validates input, confirms the active fanmark ID/short-ID pair, resolves the
current active/grace license, and preserves the source's daily user-agent hash
without collecting IP addresses. A single D1 batch gates the five-minute
duplicate window, inserts the raw event, and updates daily device/referrer/type
counts and unique-visitor count atomically. Six concurrent identical synthetic
requests produced one log and one aggregate increment. Worker D1 tests pass
5/5; frontend adapter tests pass 3/3; frontend and Worker typechecks, staging
build, Worker deploy dry-run, CI workflow isolation, and `git diff --check`
pass. The staging selectors remain off because `/analytics` and dashboard
aggregate reads still use Supabase; no staging analytics rows or production
data were written. The raw referral and user-agent retention contract, public
ingress abuse controls, and owner-authorized read API remain open.

## Paired access-analytics staging enablement (2026-09-26 JST)

Follow-up to the local-only writer checkpoint above: added session-scoped D1
read APIs for the analytics page and dashboard, connected both frontend
surfaces, and enabled the writer and readers together in the workers.dev
staging build. The deployed Worker selects `FANMARK_ACCESS_ANALYTICS_BACKEND=d1`
and `FANMARK_ANALYTICS_BACKEND=d1`; the SPA selects the corresponding
`VITE_*_BACKEND=worker` adapters. Production/default selectors remain Supabase.

The synthetic staging smoke wrote one event, suppressed four repeats, checked
owner fanmark/metrics/summary responses and anonymous 401, then deleted its
temporary Auth and business rows. Readback found zero business rows after
cleanup and the baseline masters/settings unchanged. Worker integration tests
passed 8/8; both frontend client suites passed 3/3; frontend/Worker typechecks,
Cloudflare staging build, and `npm run check:ci` passed. App Worker version
`2d23439f-359a-4e0b-8ed2-c91c523dd44f` is active at 100% on workers.dev.
Historical analytics were not copied; abuse controls, retention policy,
populated-user authorization, and production CPU/plan fit remain open. No
production route or domain/DNS setting changed.

## Reference-master editor paired-cutover gate (2026-09-26 JST)

The existing versioned D1 editor is tested, but its writer selector must move
with the Supabase Edge checkout reader because both depend on the same tier
amounts and Stripe IDs. The Edge Function secret and checkout selectors remain
unset. An interim staging deployment briefly included the editor selectors;
no authenticated request or edit was sent. It was immediately replaced by
version `7a2a780d-3fed-476b-a84e-905fc6d29aad` with both editor selectors
unset, leaving the final staging editor on its Supabase path and preserving the
active reference release unchanged.

Admin client tests pass 6/6, reference-master Worker/D1 tests pass 6/6, and the
same-session admin authorization suite passes 13/13. Frontend typecheck, CI
workflow isolation, staging build, and Wrangler dry-run passed. After redeploy,
public masters returned 4 tiers, 4 languages, 5 reserved patterns, and 16
extension prices with `no-store`; the gated admin API returned 503. The
authenticated editor and paired checkout cutover remain open. No user data,
Stripe object, production route, or domain/DNS setting changed.

## Notification admin logs moved to staging Worker (2026-09-26 JST)

`AdminNotificationManager` now selects D1 for manual event creation and the
event/delivery logs when `VITE_NOTIFICATION_MASTER_BACKEND=worker`. The
MFA-gated Worker endpoint accepts only the three event types offered by the
screen, caps JSON input at 16 KiB, returns bounded 100-row logs, excludes
payloads, and returns only an eight-character user ID preview. Six Worker D1
tests and five frontend API contract tests pass; Worker/frontend typechecks,
the full Worker package test command, staging build, Wrangler dry-run, focused
lint, and `git diff --check` pass.

Deployed workers.dev staging version
`938f880d-f3db-46d5-9634-60612e4e2814`. Anonymous reads of both new log routes
returned 401; `/api/auth/ok` and the SPA returned 200. The synthetic
administrator sign-in/TOTP/MFA canary then read 10 rules, 40 templates, and
both logs; before/after notification counts were unchanged and synthetic Auth
rows were removed. Manual event POST passed only the synthetic local D1 test;
it was not called remotely because the staging Cron can process pending events.
No real user data, production route, or domain/DNS state changed.

## Worker Cron schedule separation (2026-09-26 JST)

The Worker now dispatches by `ScheduledController.cron`: `0 0 * * *` selects
the source-compatible daily UTC license-expiry job, while `* * * * *` selects
notification processing and Stripe receipt dispatch. The staging config
contains both triggers and sets `LICENSE_EXPIRY_CRON=0 0 * * *`; it deliberately
does not set `LICENSE_EXPIRY_BACKEND`, so daily lifecycle invocations exit
before opening D1. The expiry canary overrides the lifecycle cron only for its
temporary synthetic run. Unit tests cover default routing, custom test routing,
and unrelated triggers.

Deployed workers.dev version `1413b726-0930-45f4-b779-67865fffa24d`. The
staging TOTP/MFA canary passed on that version, and read-only probes returned
Auth health 200, anonymous admin/log routes 401, and SPA 200. Remote aggregate
readback showed zero licenses, lifecycle runs, notifications, notification
events, and invitation rows. The Worker package test command passes all 152
tests; Worker/frontend typechecks and Wrangler dry-run pass. The new daily
trigger is configured but has not yet fired in production-like operation; the
existing synthetic lifecycle Cron canary remains the runtime evidence. No
license/user row, production route, or domain/DNS state changed.

## Conditional Better Auth email and social-provider wiring (2026-09-26 JST)

The current worktree adds Resend verification and password-reset callbacks,
same-origin HTTPS URL validation, and a capability endpoint that returns only
configured provider names/booleans. Google, GitHub, Discord, and Apple OAuth
are wired behind a separate selector and complete credential pairs. New-user
signup and Better Auth social signup remain disabled; this only supports
pre-existing Better Auth identities. Frontend reset/social actions are shown
only when the Worker reports the corresponding capability.

Local verification passed for auth-email 3/3, auth-social 3/3, auth D1 15/15,
and Better Auth client 13/13. The full Worker suite, both TypeScript checks,
CI isolation check, and Cloudflare staging build passed on Node 22.6.0. No
Resend or OAuth credentials are configured and no mail or provider callback
was executed. Version `bc5ad53e-5f08-492b-81fb-8046c9be9600` is deployed at
100% to workers.dev staging. Live capability readback returned all email and
signup flags false with no social providers; synthetic signup, reset,
social-sign-in, and callback requests returned 403. Auth health returned 200,
anonymous admin session 401, and browser navigations to `/auth`,
`/forgot-password`, and `/reset-password` served the SPA with 200. No real
users, production routes, or domain/DNS settings were changed. See
[auth feasibility](auth-feasibility.md).

## Stripe invoice payment-state projection on D1 (2026-09-26)

Added the additive staging migration `0008_stripe_invoice_projection_staging.sql`
and a D1 runtime for the existing pinned-Basil invoice reconciler. The Worker
re-fetches the source invoice and current subscription/latest invoice from
Stripe under a customer-generation fence. It requires the exact D1 customer
and subscription mapping and never joins by email. One D1 batch updates only
payment-failure fields plus the application ledger, fence, receipt, and
dispatch terminal state. It does not change plan, subscription entitlement,
license, or notification data. Runtime lease checks use the current clock after
provider reads; Stripe requests are limited to 10 seconds with no SDK retries.

Nine Miniflare cases pass for paid/failure/action-required projection, both
stale-event directions, missing mapping, fence contention/recovery, database
rollback followed by retry, scheduled dispatch, a provider call that outlasts
the dispatch lease, and the disabled-by-default scheduled path. The full Stripe
ingress/application/projection suite passes 39/39, Worker typecheck passes, and
the Wrangler dry-run bundles the new runtime. Migration `0008` is applied to the
empty APAC `fanmark-business-staging` database, and Worker version
`68a2e0bf-3236-444c-9c7a-a46294037855` is deployed at 100% to workers.dev
staging. Stripe selectors/API secrets remain unset, so the feature stays
disabled. No Stripe call, user data, production route, or domain/DNS change was
made.

## 2026-09-26 subscription reconciliation staging deployment

PR #41 commit `0ed264a` added subscription deleted handling and guarded Free-plan license returns. Worker typecheck, Stripe integration tests (54/54), staging frontend build, Wrangler deploy dry-run, and `git diff --check` passed. Business D1 migration `0011_stripe_subscription_free_return.sql` was applied and read back before deploy; Wrangler reports no pending migrations.

Workers.dev staging now runs version `cec31381-d388-492d-906c-879b70d03cf3` at 100%. The staging config retains the existing `* * * * *` notification/Stripe-dispatch trigger and `0 0 * * *` expiry trigger. Notification processing remains selected; expiry is disabled because `LICENSE_EXPIRY_BACKEND` is unset. Stripe selectors and Stripe secrets are absent, so webhook GET returns 404 and dispatch stays disabled.

Read-only canaries after deploy returned 200 for `/`, `/robots.txt`, and `/api/auth/ok`, and 404 for `/api/stripe/webhook`. Remote business-D1 readback found zero users, fanmarks, licenses, return batches/items, and notification events. No Stripe API call, real user data, production route, or DNS/domain setting was changed.


## 2026-09-26 Customer Portal D1 API staging rollout

Added an authenticated Worker endpoint for opening Stripe Customer Portal from the profile page. It reads only the signed-in owner’s exact D1 stripe_customer_id, refuses email-based customer search, pins return_url to the allowlisted Better Auth origin at /plans, and validates Stripe’s HTTPS response URL. The client is enabled for the staging build and does not fall back to Supabase on Worker errors.

The endpoint requires STRIPE_CUSTOMER_PORTAL_BACKEND=d1, the D1 webhook/dispatch selectors and signing secret, a matching STRIPE_SECRET_KEY plus test/live dispatcher keys, and a Better Auth session. Those Stripe selectors and secrets remain unset, so POST /api/billing/customer-portal returns 404. Stripe webhook remains 404.

Worker version d895ec75-76fb-457e-a74d-fd8102ff7110 is active at 100% on workers.dev. Post-deploy read-only checks returned 200 for / and /api/auth/ok, 404 for both billing routes. No Stripe call or D1 write occurred. Local verification passed the Stripe Worker suite 59/59, Customer Portal client tests 5/5, both TypeScript checks, staging build, and Wrangler deploy dry-run.


## 2026-09-26 Free-to-paid plan Checkout D1 rollout

Added a Better Auth-owned `POST /api/billing/plan-checkout` path for the
Free-to-paid subscription flow and connected `/plans` to its Worker client in
the Cloudflare staging build. The request is limited to an allowlisted HTTPS
origin and `creator`/`max`/`business` plans. The Worker reads the exact owner's
email from Auth D1, requires one matching free-plan row in business D1, selects
the mode-specific plan Price, and verifies that Stripe returns an active
monthly JPY Price in the same mode. It never searches Customers by email and
does not grant a plan; subscription reconciliation remains authoritative.

Business migration `0012_stripe_plan_checkout_commands.sql` adds a durable
Customer creation fence and owner/plan/Price/mode-bound Checkout command ledger.
An unknown Stripe Customer response is retried with the same provider key; if
the local result remains unresolved past the provider idempotency window, the
route stops for reconciliation instead of blindly creating another Customer.
Repeated requests return the same open Checkout Session, and request UUID reuse
with changed terms fails closed.

The migration was applied only to APAC `fanmark-business-staging` and read back:
both command tables, `user_settings`, and `user_subscriptions` each contain zero
rows; Wrangler reports no pending migrations. Worker version
`a67b6abe-0080-4784-bcf2-87efed59f83a` is active at 100% on workers.dev staging.
Read-only checks returned 200 for `/`, `/robots.txt`, and `/api/auth/ok`, and
404 for Stripe webhook, Customer Portal, and plan Checkout routes. Wrangler's
secret-name list contains no Stripe secret, and no Stripe selector is present
in the staging Worker config, so these billing paths remain closed.

The full Worker package suite, the 116-case migration-data suite, the 8-case
plan Checkout D1 suite, the 6-case frontend client suite, both TypeScript
checks, CI workflow isolation check, targeted ESLint, staging build, Wrangler
deploy dry-run, and `git diff --check` passed. No Stripe API transaction, user
data migration, production route, or DNS/domain change occurred. Paid-to-paid
plan changes and Stripe sandbox acceptance remain incomplete; see the
[D1 plan Checkout contract](stripe-plan-checkout-api.md).


## 2026-09-26 current Supabase catalog / local D1 import rerun

Re-ran the read-only schema catalog query against the linked Supabase project;
the private catalog contains 40 tables, 406 columns, 144 constraints, 139
indexes, one view, 58 functions, 36 triggers, and 77 RLS policies. It was
written outside the repository with mode `0600`; no application rows were
queried. Version-4 conversion still reports 18 unresolved gate groups and
`deployable: false`.

`node scripts/migration/test-d1-import-current-schema.mjs` passed against that
exact catalog using a disposable local D1 and three synthetic rows. All 40
checkpoints completed after injected acknowledgement loss; exact readback,
foreign-key check, transformed synthetic credential, and tampered-coverage
rejection passed. The result remains `public_rows_reconciled`, with
`deployable` and `fullMigrationReconciled` false. No Cloudflare D1, production,
user data, or DNS/domain state changed.
