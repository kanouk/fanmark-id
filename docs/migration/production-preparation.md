# #38 本番移行の準備状況と判断事項

2026-10-15。PR #41の`codex/cloudflare-api-preparation`で準備。方針と停止・復旧手順は[本番移行計画](production-cutover-plan.md)を正とする。本番変更、実ユーザーデータ取得、配備、送信、資源作成は今回行っていない。

**準備用の設定一覧・検査コード・操作票を作成した。P1〜P8の本番開始条件はまだ完了していない。** 以下の「未完了」は所有者の承認だけで解消するものではなく、実装・実測・読戻しが必要な作業を含む。

続く[実装・設計レビュー](implementation-review-2026-10-15.md)で、P3/P4向けの`receipt_only`モード、通知wake停止の修正、P5向けのAuth読取preflightを追加した。前回commitのCIは両job成功。追加コードも本番開始条件を完了したとは扱わず、実施者用の確認入口、旧Webhook移行、実Auth対応などを残す。

## 準備できたもの

| 項目 | 今回進めた準備 | 本番開始までに残る作業 |
| --- | --- | --- |
| P1 資源・設定 | Appの84設定を6分類。3 D1、画像2 R2＋backup R2、2 DO、3 rate limiterを一覧化。Business 27 / Auth 4 / Master 9のSQLと重要コードのSHA-256を固定。backup scheduler/monitorも参照を固定 | 専用資源、account/zone、容量、秘密の保管先、originビルド、閉鎖状態の実配備確認。本番専用設定は未作成 |
| P2 データ移送 | 既存D1/R2移送、credential変換の合成試験を再確認。schema選択やコードの変更を検知するローカル検査を追加 | 本番専用transport/runner、独立checker、実データの例外解消。既存isolated-remoteのguardは変更しない |
| P3 更新停止 | 下記の経路別停止票を作成。SupabaseとWorkerの停止対象を区別し、停止済みの判定方法を指定 | source側の正確な停止・drain・逆操作の実装と隔離試験。外部caller、GET副作用、Auth/Storageの停止確認 |
| P4 Stripe | 閉じた境界の受信・効果台帳を比較するローカルcheckerを実装。欠落、余分な行、payloadや適用状態の相違、mode混同、不明な処理を検出 | 旧実配備版の再確認、receipt-only移行、実台帳の投影adapter、保存と適用の分離、最終受信境界の確定、引継ぎと逆方向試験 |
| P5 Auth | 実ユーザーに触れず、下記の照合項目・機密分離・MFAの判定順を固定 | 実Auth集計とUUID/provider対応、パスワード互換、MFA移送または再登録、管理者復旧の確認 |
| P6 ドメイン | 公開DNSを13問い合わせで再確認し保存。変更前・変更後・復元の記録欄を定義 | 管理APIのzone/record/route/redirect/TLS実値、OAuth等の登録値、旧URL保持期間。公開DNSからoriginを推測しない |
| P7 復旧 | 本番で差し替えるresource ID・schema・鍵の項目を分離。backupとmonitorの依存コードを固定し、必要な復旧証拠を指定 | 本番用adapterと別資源への復元、RPO、差分台帳、鍵の別保管、失敗通知、全更新経路の回収証明 |
| P8 リハーサル | オフラインで実行できるコマンド、操作票の必須欄、計測区間、失敗時の扱いを固定 | 許可後の実データ予備コピーと隔離リハーサル。本番移送・切替・復旧時間の実測、CIと最終commitの固定 |

## 設定一覧の使い方

[分類定義](production-preparation-policy.json)と[生成済み一覧](evidence/production-preparation-offline.json)は**Wrangler配備設定ではない**。本番resource IDはnull、`productionReady`と`deployable`はfalseのままにする。

| 分類 | 件数 | 扱い |
| --- | ---: | --- |
| 実装を再利用し、新bindingで確認 | 60 | D1/R2/Auth等のbackend selector。設定の再利用だけで本番動作を保証しない |
| 本番origin・送信元に合わせる | 5 | Auth URL、画像URL、CORS、メール送信元等 |
| 資源ごとに作り直す | 7 | incarnation、scope/schema digest、backup source ID、key ID、通知宛先 |
| 本番用adapterのレビューが必要 | 4 | emoji publication、backup、backup admission、alert |
| 停止・schedule・modeを確認 | 6 | freeze、Stripe policy、no-index、cron、batch上限 |
| fixture除去前にfallbackを調べる | 2 | 合成Supabase URL/key。実本番の値への単純置換はしない |

設定値・秘密・メールアドレスは一覧に出さない。App外のbackup schedulerとmonitorはファイルhashで追跡するが、別途本番のservice bindingとscheduleの確認が必要。App Workerだけを配備して監視まで完成したとは扱わない。

新規Workerの提案名は`fanmark-app-production`、D1は`fanmark-production-business/auth/master`。R2、DO namespace、rate limiter namespace、補助Worker名、account/zoneの実値は作成票で固定する。staging V4のID・DO移行履歴・service bindingはコピーしない。SQLファイル集合のdigestは、実DBの`sqlite_schema`や復旧guardのdigestとは異なる。

特に次のコード上の制約がある。

- `STRIPE_MODE_POLICY`は現在、未設定でdual、明示値は`test_only`のみ。`dual`や`live_only`という文字列は無効。本番の鍵選択・live/testの取り扱いを合成試験で確定する。stagingの`test_only`のまま本番請求を扱わない。
- `emoji-publication-service.ts`はstaging target一覧を参照する。本番専用targetを、実IDとreadbackに基づいて追加・レビューする必要がある。
- backupは5 storeのID・schema hash・scope digestと暗号鍵を照合する。名前だけを変更して動作確認を省かない。
- `CUTOVER_WRITE_FREEZE`はSupabaseを止めず、受信Webhookや一部Auth、GET/HEADを許す。一般利用者の閉鎖と全更新の停止を別に証明する。
- 上の限定停止は値`true`の契約。追加した`receipt_only`はWebhook以外のHTTPを閉じる。一般画面の閉鎖・受信継続をローカル検証済みだが、実施者のasset/API確認と本番の停止/drainは未検証。

秘密の実値はGitに置かない。取得前に、Better Auth、OAuth各provider、Resend、Stripe generic/test/live・Webhook、保護アクセス、backup暗号鍵について、保管場所・注入先・復旧時の取扱者を操作票に記す。今回の一覧は秘密が設定済みであることの証明ではない。

## P3 更新経路ごとの停止・再開票

全行で、対象ID、実配備hash、停止前の設定、停止操作、拒否確認、drain確認、逆操作を記録する。**まだ本番で実行できる停止コマンドは確定していない。** UIのメンテナンス表示やcron inactiveだけで合格にしない。

| 更新経路 | 停止とdrainで確認すること | 再開条件・実装時の参照 |
| --- | --- | --- |
| 旧SPA/PWA・直接REST/RPC | 古いasset/session/anon JWTでも書込が拒否される。DBへの既存transaction終了を確認。公開GET経由の計測や履歴更新も分類 | [frontend callsite map](frontend-callsite-map.md)、[source authorization](source-authorization-review.md)。画面だけ戻してDB権限の復元を忘れない |
| Supabase Edge | 実配備35本のinventoryを更新し、書込/送信/外部決済を起こす呼出しを分類。停止前に始まったinvokeと外部応答不明を回収 | [実配備版との差](source-edge-bodies-review.md)。ローカルの停止guardが配備済みだと仮定しない |
| Auth | 登録、OAuth作成、reset/更新、MFA、admin APIを停止・drain。ログインやtoken refreshの内部更新も含め、export前後のAuth状態を照合 | 旧sessionを移さず新側で再ログイン。本人確認・管理者復旧を確保してから再開 |
| Storage | upload/upsert/deleteと署名URLを使った更新、既に開始したuploadを止めて完了確認。公開画像の読み取り保持は別判定 | bucket/key/件数/bytes/hashをexport前後とR2で照合 |
| pg_cron・trigger・DB関数 | notification pollingを起動し直すtriggerも対象。ジョブ停止と実行中transaction終了を別確認 | [scheduled writers](source-scheduled-writers.md)。daily expiryとnotificationの元の状態・schedule・command hashを保存 |
| Stripe/Checkout/Portal | 新規決済入口と業務dispatcherを閉じる。既存Session、非同期決済、請求、旧Webhookの遅着を受信台帳へ分類 | P4。receiverの継続保存を止めない。旧新dispatcherの同時起動禁止 |
| メール・通知 | 送信queue、Edge、DO alarm、再試行、Resend callbackと送信ACK不明を分類。単なる送信済みフラグで再送しない | 受信と送信副作用を分け、所有者確認済みの宛先で検証 |
| 外部caller・service role・管理操作 | Dashboard SQL、CLI、連携・外部schedulerと人による変更を棚卸し。未分類callerがあれば停止完了としない | 秘密を表示せず呼出元・権限・停止担当を記録。再開は単独writer確立後 |
| 新WorkerのGET/Auth/DO/cron | 一般HTTPを閉鎖したうえで全副作用を分類。既存alarm/queueと受付中操作の終端を確認 | [cutover guard](../../workers/api/src/cutover-write-freeze.ts)。`RECOVERY_WRITE_FREEZE`はWebhook受信も止めるため代用不可 |

## P4 Stripe引継ぎcheckerの契約

[stripe-handoff-check.mjs](../../scripts/migration/stripe-handoff-check.mjs)は、**同じ閉じた受信境界**の2つのJSON投影を読む。sourceからdestinationへDBを書き込む機能、Stripe呼出し、秘密読込みはない。通常引継ぎと旧側への回収の双方で同じ比較を使えるが、書込後の旧側復帰を許可するものではない。

両投影のheaderは`format: fanmark-stripe-handoff-v1`、同じ64桁hexの`boundaryId`、`captureComplete: true`、`dispatcherPaused: true`、`inFlight: 0`。これらは収集側の宣言であり、checkerは実環境の停止や全件取得を証明しない。独立収集側で、旧receiverの停止、最終commit、進行中0、全件count、最終読取り境界を証拠化する。

| 配列 | 必須fieldと扱い |
| --- | --- |
| `receipts` | `livemode`はboolean、`eventId`は`evt_…`、`payloadSha256`は64桁hex、`state`はpending/applied/ignored、`effectKeys`は配列、`proofSha256`はpendingならnull・終端なら64桁hex |
| `effects` | `livemode`、`effectKey`、pending/appliedの`state`、`proofSha256`。適用済みは証拠hash必須。例:`extension:cs_…`。同じCheckout Sessionの効果キーは複数eventに共有される |

`payloadSha256`は同じ署名検証済みpayloadに対するdigest、`proofSha256`は移送前後で安定した正規化済み業務効果またはignore理由の証拠digestとする。単なる「applied」という文字列のhashではない。schema上異なるrow IDや取得時刻をそのままhashに含めない。正規化仕様と実台帳adapterはまだ未実装で、旧live handlerには新intentがないため、履歴・Stripe現在値との対応確認が必要。

未処理eventに適用済み効果が含まれる場合も記録を保持する。処理中、dead letter、ACK不明、証拠なし、対応するeffect欠落は停止理由。checkerは状態を書き換えたり、欠落を補完したり、適用済みeventを再送したりしない。

同じmode/event IDの重複行は収集ミスとして拒否。欠落・余分な行・payload/状態/効果の相違は不一致。新receiverが境界後に受けたイベントは別streamに保持し、この閉じた投影へ混ぜない。別streamの全件分類・永続保存・後続回収もG3/G5の必須条件であり、checkerの成功だけで満たしたとは扱わない。

## P5 Auth照合とMFA

取得前に[auth-readiness.sql](../../scripts/migration/auth-readiness.sql)の集計で、パスワード形式・provider・MFA種類を確認する。これは今回未実行。集計結果もGit外に保管する。実投影ではUUID、provider subject、確認済み状態、停止状態、role、Business参照を照合し、メール一致による自動統合を禁止する。重複identity・孤児参照・未対応hash・管理権限の不一致を個別に解決する。

移送先の検査には[Auth identity preflight](../../scripts/migration/auth-identity-preflight.mjs)を追加した。既存unique制約の欠落、identity/credential/factorの重複、MFA不整合等を集計するが、sourceとの同一性は別の独立checkerが必要。実ユーザーでは未実行。

既存credential変換試験にはfanmarkの保護パスワードも含まれる。これをSupabase AuthログインパスワードやTOTP移送の成功と取り違えない。導入済みBetter Authの固定版で、実形式と同じ合成credentialのログイン・停止中拒否・管理者MFAを確認する。

MFAはまず形式と変換可否を技術調査する。移送できない場合に限り、保護状態を保った本人確認付き再登録と個別案内を提案する。未登録状態で通常権限を付与しない。既に合意した再ログイン方針は維持し、追加の再登録負担が発生するときだけ所有者判断へ戻す。

## P6 変更前・変更後・復元票

[公開DNS記録](evidence/production-public-dns-2026-10-15.json)でCloudflareのNS、apex/www/admin/authの公開A/AAAA、apex MXを読み取った。既定の再帰resolverからの観測であり、Cloudflare管理画面のrecord ID、隠れたorigin、route、TLS、所有accountの確認ではない。CNAME応答なしを、設定なしと解釈しない。

| 対象 | 変更前に保存する項目 | 変更後の案・確認 | 復元票に必要な項目 |
| --- | --- | --- | --- |
| `fanmark.id` | account/zone/record ID、type/content/proxy/TTL、routeとredirect、現origin、TLS状態 | 同一hostの専用Worker Custom Domain。G3照合後、一般閉鎖でTLS・asset・APIを確認 | DNS/Custom Domain/routeの差分と正確な逆操作、旧originの証明 |
| `www.fanmark.id` | 現path/query/redirectとTLS | 現契約調査後、apexへpath/queryを保持する案 | 元のrecord/redirect設定一式 |
| `admin.fanmark.id` | 現path変換・認証・入口URL | 現契約を確認後に同等な管理入口を確定 | 管理者用の直接復旧入口と元設定 |
| `auth.fanmark.id`と旧Auth URL | Supabase custom host、callback、未失効リンクの最大期限 | 旧リンクの互換または案内、新Authは同一origin `/api/auth`。旧tokenを新Authへ転送しない | 旧provider/callback/リンク処理の復元値 |
| Google/GitHub/Discord/Apple | 使用providerのclient/service ID、callback/return URL、allowed origin、鍵保管参照 | providerごとに新callback・既存アカウント紐付けを確認 | 追加/削除したURLの正確な逆操作。秘密そのものは記録しない |
| Stripe/Resend | endpoint ID、署名鍵参照、mode/API version/event種別、送信元、受信host | apex切替前にも到達する固定receiverを決定。受信→永続化→回収を確認 | 未処理差分の回収を含む逆引継ぎ。設定だけ戻さない |
| 旧Storage URL | 公開/署名URL、最大期限、外部埋込の利用状況 | 内部DTO変換と外部URL保持を別検証 | source保存・互換経路の保持条件 |
| NS/レジストラ/MX等 | 管理設定の原本と公開DNS記録 | 今回のWeb移行では変更しない | 誤差分があれば切替中止・元設定確認 |

## P7・P8 操作票と測定

各操作票の必須欄は、`operationId / gate / exact commit / actor / source ID / target ID / before-state evidence / exact command / expected readback / timeout / failure action / resume rule / inverse command / private evidence location`。未確定欄があれば実行票ではなく下書きとして扱う。資源作成、source停止、export、import、独立照合、受信引継ぎ、domain変更、新writer開始、旧側回収、前進復旧に分ける。

準備検査は`.node-version`のNode 22.6.0で、repoのrootから実行できる。

```sh
npm run migration:prepare-production
npm run test:production-preparation
```

前者の成功は保存済み一覧と現在ファイルの一致のみ。設定やSQLを意図的に変更した場合は、分類とdiffをレビューしてから`node scripts/migration/production-preparation-audit.mjs`の出力で一覧を更新する。自動更新して未レビュー差分を消さない。

投影checkerはGit外のprivate fileのみを入力する。標準出力は件数と一致判定だけで、event IDやpayloadを出さない。どちらのコマンドにもremote/applyモードはない。

```sh
node scripts/migration/stripe-handoff-check.mjs --source "$TASK_SOURCE_PROJECTION" --destination "$TASK_TARGET_PROJECTION"
```

実データの予備コピーは別途実施指示を得てから行う。まずGit外0700/0600の暗号化保管と隔離先を固定し、snapshot/export、Auth→Master→Business→R2 import、独立照合、受信差分取込、TLS/到達確認、書込前の旧側復帰、書込後の前進復旧を別々に計測する。途中終了、成功応答不明、重複入力、再開、backup破損、鍵欠落も試す。

本番RPOは、アカウント・権利・課金に復元できない欠損を認めない前提。最後のbackup以後のAuth/画像を含む更新、送信や決済の外部副作用まで回収できる最終操作点を示す。現状の日次backupだけでRPO 0を達成したとは言えない。owner確認済み通知先への失敗通知、鍵の別保管、専用の復旧先、5 storeと台帳の照合がそろうまで公開しない。

## 所有者の判断が必要な点

今すぐ本番実行を承認する必要はない。次の段階ごとに判断する。技術的に未確認の項目は、承認で代用せず先に調査・実装する。

| 判断する時点 | 判断事項 | 提案と未確定条件 |
| --- | --- | --- |
| 実データリハーサルの直前 | 実Auth・DB・画像の予備取得、暗号化保管、隔離資源への投入範囲と費用 | staging V4と分離。保存場所・取扱者・削除期限・見積りを実行票で示してから実施判断 |
| MFA調査後、必要な場合のみ | 既存MFAを移せない利用者への本人確認・再登録と案内 | 安全な個別再登録案を先に用意。MFA解除だけで移行しない |
| 実測リハーサル後 | 停止日程、告知、延長/中止の判断者、連絡手段 | 通常停止2時間、90分/105分で中止判断、失敗時最大135分の旧側再開目標、作業者3時間枠。すべて現時点では暫定 |
| 復旧試験後・G0前 | 復旧可能な最終操作点、障害時の連絡と復旧時間の受け入れ | 欠損なしの前提を維持。書込後4時間の復旧目標は未実測。満たせなければ延期または設計見直し |
| 本番安定確認後 | 旧Supabaseの保持期間・費用、廃止の実施指示 | 最低7日を案とし、旧URL/リンク最大期限、遅延決済、外部consumer、日次backup2回と隔離復元の条件を優先 |

専用資源の名前、schema/binding、mode設定、DNS復元方法、台帳adapterなどは技術側で具体化する。所有者へ未調査の技術選択を丸投げしない。本番実行、旧経路整理、mergeはそれぞれ実施条件を確認してから行い、今回は行わない。

## 今回の検証

Node 22.6.0で、新規検査9件と既存D1 importer・R2 importer・credential projection・migration selectorの合計54件が成功した。追加のwildcard schema変更ケースでテストfixtureの対象ディレクトリ誤りを修正し、新規9件を再実行して成功。workflow isolationの6件、保存済みinventoryとの一致、Markdown参照、`git diff --check`も確認した。[記録](evidence/production-preparation-validation-2026-10-15.json)。ローカル合成試験の結果であり、実Auth・実台帳・本番リハーサルの証拠ではない。
