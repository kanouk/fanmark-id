# 通知受信箱 API 移行準備

## 範囲

通知画面とヘッダーの受信箱 read path、および個別/一括既読操作を、明示的に選択できるCloudflare Worker + business D1 APIとして用意する。D1上の通知イベント処理も別selectorで実装し、合成イベントのstaging検証後、workers.dev stagingで有効にした。未移行のイベント生成元、および他のメール/Web Push送信処理の有無と呼出し経路は引き続き照合対象とする。下記のsource processor確認だけで、サービス全体の配信経路が揃ったとは扱わない。

## 4言語のアプリ内通知を実Safariで受け入れ（2026-10-06 JST）

現在のWorker `471faabe-3aff-4312-ba22-cd326dc821e1`（runtime bdc23da）を保持し、専用合成account1件に
JA/EN/KO/IDの通知を各1件配信。payload.languageを与えず本人profileの優先言語を
APIで変更し、D1 pending INSERTと通常sign-outのpostcommit wakeから実processorへ通した。
各event processed・in-app delivered・正確なtitle/body・literalの## API 契約とJSONB object表記が一致。
同じSafariのreload後は画面の言語も一致し、本文表示・個別既読・read_via=appを確認した。
一覧はbodyを表示する仕様で、titleは保存payloadの照合である。

UI logout後、所有する通知4/event4/rule1/template4/settings1/Auth account1/user1を除去。
独立read-only processで既存全表の全row hash、Auth3/7/2、Master25表、FK0を保持。
wake世代の正当な+4とack一致を残し、世代は巻き戻さず、合成passwordを除去した。
最初のprepare引数はimported旧runnerの既存journal guardでexit1となったが、
旧runnerはmutation前に停止し、目的fixtureは準備済み。別processで保持を再確認し、
引数はseed-ownedへ変更した。再seed・完了runner再実行は不要。
[限定証拠](evidence/staging-notification-locales-native-2026-10-06.json)。

配備/secret変更、追加mail、本番Stripe、実ユーザー移送、DNS変更は0。
曖昧な複数channel・import codec/任意精度・外部caller、他event発生元と外部配信、
実スマホ/standalone・全言語/全フローの最終確認は引き続き別条件。全体移行は未完了。

## API 契約

- `GET /api/me/notifications?limit=1..50`: 本人の通知を `triggered_at DESC, id ASC` で返す。応答は画面用の `id, payload, read_at, triggered_at, priority, channel` に限定する。
- `GET /api/me/notifications/unread-count`: 本人の未読かつ配信済みで、未期限切れの件数を返す。
- `PATCH /api/me/notifications/{uuid}/read`: `{ "readVia": "app" | "menu" }` を受け取り、本人の未読行を既読にする。既存RPC同様、status/expiryでは絞らない。
- `POST /api/me/notifications/read-all`: bodyなし。本人の未読・配信済み・未期限切れ行のみ既読にする。

各操作のowner IDはBetter Auth sessionから取得し、クライアント指定のuser IDは受け付けない。許可Originに限定したcredentials CORS、`no-store`、最大50件、payload 16 KiB、応答全体256 KiBを適用する。エラー時はSupabaseへフォールバックしない。

## クライアント選択

### 既読RPCと現行APIの照合（2026-10-03）

未変更のsource catalogの定義hashと現行経路を照合した。

| Source function / SHA-256 | Targetと契約差 |
| --- | --- |
| get_unread_notification_count / bcf1227815b3e79aa8ff7a0682ef64fa15a7be069cb8c82c8eaefcd9cf05cd8e | GET /api/me/notifications/unread-count。同じdelivered・未読・未期限切れ条件。sourceのcaller-selected user_idと匿名0を置換し、session本人だけ、偽owner query400・匿名401。既存native試験が本人/他人/期限/未配信と3種の偽ownerを確認する。 |
| mark_notification_read / a8e7c9939169c2ce5be06408186395f12e451cd22bf291bf58a1a0bc04e09ec8 | PATCH /api/me/notifications/:id/read。本人かつread_at=NULLの条件は同じで、delivered/期限条件を追加しない。readViaは現行UIのapp/menuに制限。nativeが本人true/他人falseと時刻を確認する。 |
| mark_all_notifications_read / 6d0a04c52d4af2d9e82ce44599903062d83b91c787abb311f4a4289eea131dfd | POST /api/me/notifications/read-all。source同様、本人のdelivered・未読・未期限切れだけを更新。bodyなし、read_via=appに固定する現行UI契約。nativeがpending/expired/read/他人の保持を確認する。 |

呼出し元はuseUnreadNotifications、Notifications、AppHeaderで、Worker選択時は
src/lib/notifications-api.tsを使う。sourceの自由なowner/read_via引数の汎用RPC互換性は
提供しない。既存full25 Business・実Better Authの53件とstaging受入を対応する証拠に
使い、未変更の経路を再デプロイしない。実provider配信、運用、外部consumerは別条件。

既定はSupabase。`VITE_NOTIFICATIONS_BACKEND=worker`を明示すると通知一覧、ヘッダーのpreview、未読数、既読操作がWorkerを使う。Worker選択時はRealtimeを使わず、通知一覧とヘッダーpreviewを30秒間隔で更新する。ヘッダーの定期取得は背景タブでは止まり、タブ復帰時に再取得する。Supabase選択時は現在のRealtime経路を維持する。一括既読後は実際に更新されたデータを再取得し、pending/期限切れ通知を誤って既読表示しない。

## 検証と現在地

- `npm run --prefix workers/api test:notifications-d1`: 合成Better Authとsource-shaped business D1を使う統合試験。
- `npm run test:notifications-api`: フロントAPIクライアント契約試験。
- business staging D1にはsource-shaped schemaが適用済み。Worker/frontend selectorはworkers.dev stagingだけで有効。合成Better Authアカウントでlist、unread count、readを実行し、通知/Auth行がゼロ件に戻ったことを確認した。実ユーザー行は移していない。
- 2026-09-26、合成イベント1件を一時投入し、ローカルscheduled Workerからリモートbusiness D1の通知processorを起動した。日本語in-app templateのrender、delivered通知1件、event processedを確認し、合成event/user_settings/notificationを削除した。前後でmaster/public-setting baselineと保護アクセス状態が一致し、通知関連およびuser_settingsは0件へ戻った。
- 続けてworkers.dev Worker `000d54b4-8a34-4241-a2ce-45f72683581b`へ `NOTIFICATION_PROCESSOR_BACKEND=d1` と `* * * * *` Cronを設定。2026-09-26の実Cron canaryでも合成イベント1件の処理、deliveredの日本語in-app通知1件、baseline/保護アクセス状態の不変、合成行の完全削除を確認した。Cloudflare tailで実際のCron invocationと `notification-events` completedログも確認した。後続Worker `839710a3-3290-46f8-b43c-c3a1e21d89c2`も同じCronを維持している。共有scheduled handlerのうち、license-expiryとStripe dispatchは各backend selectorが未設定のためdisabled。
- 2026-09-26、既存の返却API staging smokeを拡張し、合成ユーザーがファンマークを返したときD1が生成する`fanmark_returned_owner`と`favorite_fanmark_available`の2イベントを実Cronまで通した。両方が`processed`となり、日本語bodyを含むin-app通知がそれぞれ1件`delivered`になった。canaryの通知・イベント・fanmark・license・favorite・Auth行はcleanup後すべて0件。Cron起動待ちに最大90秒を許容する再現可能な手順は`scripts/migration/staging-fanmark-return-smoke.mjs`。
- 2026-09-26、譲渡API staging smokeでは合成ユーザーがissue/applyし、拒否後に同じcodeを再申請してapproveする経路を実Cronまで通した。`transfer_rejected`、`transfer_requested`、`transfer_approved`が`processed`となり、所有者/申請者の意図した宛先に日本語bodyのin-app通知が各1件`delivered`になった。通知をイベントより先に削除し、合成通知・イベント・audit・transfer・license・fanmark・settings・Auth行がcleanup後すべて0件、MFA generation baseline不変を確認した。最大90秒待つ再現手順は`scripts/migration/staging-fanmark-transfer-smoke.mjs`。
- 続けて2026-09-26、stagingに移行した有効なin-appルール10種類すべてへ必須payloadを持つ合成イベントを投入し、workers.dev実Cronで各1件の日本語通知が`delivered`になることを確認した。返却、譲渡申請/承認/拒否、ライセンス猶予/失効、抽選当落/延長キャンセル、お気に入り返却通知を含む。タイトル、受信者、fanmark ID、本文locale、retry countを照合し、通知・イベント・設定行を削除。マスター/公開設定とprotected-access状態は前後一致し、合成通知関連行は0件に戻った。手順は`scripts/migration/staging-notification-processor-smoke.mjs --deployed-cron`。
- これはstagingのscheduler経路を一度検証した結果であり、全イベント生成元の移植、メール/Web Push配信、通知archival、実ユーザー数でのCPU・認可検証、production recurring fitは未完了。本APIやsynthetic canaryの成功もそれらの完了を意味しない。

## 本番processorの照合と真偽値条件の修正

2026-10-02T22:15:39.799Zに、linked source projectの
`process-notification-events`をread-onlyでdownloadした。前後のmetadataが一致する
ACTIVE version209、verify_jwt=falseで、entrypointは12,390 bytes / 419 lines、
SHA-256 `986b46f37eb62ecf656e80ac357db406975e56ec5ad9b99d64a63b974cc0a301`。
checked-in sourceと同じbytesであることを確認した。source側への関数呼出し、
deploy、設定変更やユーザー行のexportは行っていない。

このprocessorが`delivered`にするのはdelay_seconds=0のin-app通知だけで、
他channelと遅延通知はpendingになる。直接fetch/functions.invokeはなく、この確認は
別の送信処理や外部callerの不在を証明しない。sourceの公開設定を移植せず、targetの
processorは引き続き内部Cron/alarm経路に限定し、手動復旧には管理者MFAを要求する。

sourceのsegment_filterはuser_settingsの値を厳密比較する。PostgreSQLの
`requires_password_setup`はboolean、canonical D1は0/1のため、targetはその列だけを
booleanへdecodeして比較する。数値0/1や文字列への暗黙変換はせず、他の列の比較は
変更しない。移行側で0対false / 1対trueが誤って不一致、0対0 / 1対1が誤って一致する
4ケースを全25 Business migrationのnative D1 suiteで再現し、修正後は一致/不一致と
数値拒否の6ケースを含め26/26が成功した。通知起動suite20/20、Worker typecheckと
変更ファイルのlintも成功。invalid D1 booleanは処理を拒否する。

これはlocal検証済みのruntime修正で、stagingへのdeploy/remote acceptanceは未完了。
最新deploy前確認もBusiness D1の日次読み取り上限（API7500）で書込み前に停止した。

## 言語・回数制限とrender RPCの照合

source version209は空のpayload.languageを既定値として扱い、settingsの言語を使う。
移行側も空文字を指定言語として採用しない。空文字/nullのpayload言語で日本語templateを
使う2ケースを追加した。preferred_language自体はsource/targetの4言語制約で空文字を
拒否するため、不正なsettings行を作って言語fallbackの証明には使わない。

sourceのcooldown/max_per_userはfanmark_idが空文字/nullなら利用者・rule全体を数え、
非空なら同じfanmarkだけを数える。移行側もこのscopeを保つ。両制限について
同じID/別ID/空文字/nullの8ケースを追加した。空languageと2つの空ID制限で
修正前の3失敗を再現し、修正後はnative通知36/36が成功した。fixtureの初回実行では
必須triggered_atを欠くprior通知と禁止された空settings言語も失敗したが、これらは
fixtureの問題として修正し、runtime不具合の件数に含めていない。

source catalog 2026-10-02T21:03:48.240925+00:00の
`render_notification_template(uuid,integer,jsonb,text)`はSTABLE/SECURITY DEFINER、
定義SHA-256 `730aaec79e000cb375ad6d98005a2c908973efce3a6fd605db7f13c2830c987e`。
sourceはtemplate ID/version/language/activeでLIMIT 1を選び、5種類のdate placeholderを
残してpayloadの非null値を置換する。targetもdate placeholderを残し、templateが
取得できなければevent type/raw payloadへfallbackする。

sourceのSELECTはchannelで絞らず、同じID/version/languageで複数channelがある場合の
選択順を保証しない。targetもID/version/language/activeのLIMIT 1へ合わせた。唯一の
in-app templateをemail/webpush ruleから使う場合もsource同様に本文を描画し、その通知は
pendingのまま保持する。source/targetとも複数の該当行から特定のchannelを選ぶ保証は
追加しない。異なるengineでの曖昧な複数行選択の実データ契約は引き続き要確認。

2026-10-02T22:35:53.411044+00:00に、linked source PostgreSQLへ7種類の合成literalだけを
使うBEGIN READ ONLY / 10s timeoutのクエリを実行した。application/Auth行は読まず、
application functionも呼び出していない。render RPC本文と同じjsonb_object_keys / ->> /
replaceの結果を`workers/api/test/fixtures/notification-render-source.json`へ保存した。
元クエリは`scripts/migration/notification-render-oracle.sql`で再現でき、fixtureの
source.querySha256がこのSQLを固定する。payloadの入力JSON順も保持し、sourceが返す
canonical順に並べ直したfixtureで差を隠さない。

`notification-template-values.ts`はsource EdgeのJSON round trip後のJSONB textを描画する。
UTF-8 byte長/値でkeyを順序づけ、nested object/arrayのspaceを含む表記と有限JS数値の
指数表記をdecimalへ展開する。title/body/summaryの置換はcallbackでliteralを返し、
`$&`/`$$`/ドル記号のprefix/suffix tokenをJavaScriptの置換指定として解釈しない。
7 oracleケース（ドル記号、nested JSON、cascade、Unicode key順、指数数値、null/bool/array、
5 date placeholder）と3 channelケースで8失敗を再現し、修正後は全53ケースが成功した。
4言語のsettings/明示payload overrideとinactive/version/localeのfallbackもnativeで確認した。
PostgreSQLで拒否されるUnicodeと、元データの任意精度数値の変換は、既存converter gateで
別途確認する。これを全source callerの互換性、remote受け入れやprovider送信の完了と扱わない。
source RPCを実ユーザーpayloadで呼び出したり、公開権限をtargetへコピーしたりはしていない。

CI37072572541のapplication失敗は、archive writer testが固定line365を期待し、
boolean修正で実位置374へ移ったためだった。testは実INSERT位置から期待lineを求め、
唯一のhistory writer、archived_at列、bind値とnative timestampの検証を維持する。
修正後の全test:migration-dataは277/277、Worker typecheck/lint/diffも成功した。

## 通知イベント生成とwake

`create_notification_event`の未変更source定義hashは
`dd6c274f7ceafc8fa6ccf59ba386356eccc01a294ac1d8500cfdb3c408a101f2`。
sourceは任意のevent/payload/source/dedupe/trigger時刻を受け、pending/processingの
同じdedupeを再利用し、なければpending行を挿入してUUIDを返す。
現行リポジトリの呼出し元は抽選申込、coupon、transfer申請/承認/拒否、期限処理、
返却helper、退会、管理者失効、旧延長Edge。targetではそれぞれのowner/MFA保護された
業務API、Business0015 coupon適用、lifecycle/Stripe適用が、操作固有のreceipt/transaction
と共にイベントを生成する。汎用の任意payload/source/dedupe RPCは公開しない。
旧sourceの通知RPCと別transactionになる操作を、そのまま原子的処理と推定しない。

管理画面の直接イベント作成はnotification-master-d1-api.tsでMFAを確認し、
pending・admin_manual・version1・server UTC時刻とUUIDを設定する。0024 triggerの
更新件数を混ぜず、RETURNING idで実挿入を確認する。HTTP完了時とscheduled job完了時の
flushNotificationWakeSafelyが保存済みwake世代をDOへ届け、失敗時もD1 markerは保持する。
各業務APIの既存受入と、実管理者MFA/作成/alarm排出/空queue停止/未来通知の復旧という
既存のwake受入を対応する証拠に使う。全Edgeの本番versionや任意外部RPC consumer、
メール/Stripe providerの成功まで、この対応から推定しない。

## D1 通知履歴アーカイブ

`workers/api/src/notifications-scheduled.ts`は、90日より古い`delivered`/`failed`
通知を`notifications_history`へ移して元行を削除するD1処理を実装する。
staging設定では`NOTIFICATION_ARCHIVE_BACKEND`を選択しておらず、実WorkerのCronは
この処理を実行しない。履歴の長期保存・削除方針とSupabase本番側の実呼出し有無は
引き続き未確認。

通知API/processor/archiverのnative D1 suiteはcanonical Business migration全25件を
順に適用する。簡略fixtureを廃止し、event/ruleの参照元、必須timestamp、実FKと
0024 wake triggerを含めて19ケースを確認した。アーカイブでは全19フィールドと
JSON payload、cutoffの1us前/一致、selector未設定、ID衝突、削除失敗時のbatch全体の
rollbackと再実行、既存の同内容履歴のtimestamp保持、2,500行上限と残行の再開を扱う。

Auth fixtureもstagingで選択するcore/0007 signup marker/0008 suspension migrationを
適用し、`AUTH_USER_STATUS_BACKEND=d1`を選ぶ。停止・session失効後の古い署名Cookieで
一覧/未読数/個別既読/全件既読が401となり、通知行が不変、別sessionの利用者は正常、
停止中の新signinは403かつsession生成0を確認した。最新native suiteは上記のboolean/言語/制限scope/renderケースを含め53/53。
このケースは停止後のAPI境界を検証し、管理者MFA/audit/停止transaction自体の試験は
既存admin-user-management suiteが別に担当する。

2026-10-02T21:03:48.240925+00:00のsource catalogでは
`archive_old_notifications(days_old integer)`はSECURITY DEFINERで、effective EXECUTEは
service_roleのみ（anon/authenticatedはfalse）。定義SHA-256は
`d207d6ccb0010a5dc1f4525b005e533894a696ea7ef32bd61c9741c1cdc9cb9f`。
履歴のSELECT policyは`is_admin()`で、helperはauth.uid()とuser_settingsのadmin planを確認する。
policy式SHA-256は`f0fa793ce9eac245f80cb36c1e202ab3f68594d111e7025274d1b0ab6cb9dc82`。
table grantだけではRLSを通る権限の証明と扱わない。現在のWorkerは履歴を内部archiver
だけで操作し、履歴本文を読むHTTP APIを実装していない。frontend/Edgeのliteral callsiteも
generated type以外に見つからないが、外部/動的呼出しやcustom days_oldの利用は未確認。
targetの90日固定・default-off運用を全source呼出しの互換性としては扱わない。

`npm run test:staging-notification-archive-smoke`は、確認済みのstaging account、Worker、
business/Auth D1を照合し、通知マスターと公開設定のseed状態、40業務テーブルの行数、
Auth user rows、通知/履歴の空状態を確認してから実行する。`0020_notification_archive_index.sql`
適用後だけを許可する。staging設定を書き換えず、ローカルscheduled Workerへ一時的に
`NOTIFICATION_ARCHIVE_BACKEND=d1`を渡して合成通知6件を処理し、90日cutoff、status、
保存JSON、timestamp、cleanup後のbaselineを照合する。既存の通知や履歴がある場合、
identity/binding/scheduleが異なる場合、またはindexがない場合は書込み前に停止する。
このremote staging smokeは2026-10-02に成功した。`0020`適用/readbackとhosted CI成功後、
ローカルscheduled Workerからstaging business D1を実行し、eligible 2件を履歴へ移し、
対象外4件を保持した。cleanup後は通知/履歴0件で、業務/master/public-settings baselineは
一致、Auth rowsは0件。実Worker deployment、実Cron、Supabase側の定常運用は証明しない。

## 管理画面のグローバルマスター編集

`AdminNotificationManager`の通知ルール切替とテンプレート本文/有効状態の編集は、明示的な`VITE_NOTIFICATION_MASTER_BACKEND=worker`で `/api/admin/notification-masters` のD1 APIを利用できる。Worker側は独立した`NOTIFICATION_MASTER_BACKEND=d1` selector、Better Authの管理者roleと同一session/factorに結び付いた期限内MFA assuranceを要求する。`notification_rules`と`notification_templates`だけを明示列で返し、`created_by`やtemplate payload schemaは公開しない。PATCHは編集可能列に限定し、`updated_at`比較で古い画面の上書きを拒否する。

同じselectorで以下の管理機能もWorkerへ接続できる。

- `GET /api/admin/notification-masters/events`: 最新100件のイベント履歴。payloadは返さない。
- `POST /api/admin/notification-masters/events`: UIが選べる3種類のイベントだけを受け付け、object payload（最大16 KiB）を`admin_manual`のpending eventとして作成する。
- `GET /api/admin/notification-masters/notifications`: 最新100件の配信履歴。payloadは返さず、画面表示用にuser IDの先頭8文字だけを返す。

これらも管理者roleと有効な同一session/factorのMFA assuranceを要求し、許可Originに限定したcredentials CORSと`no-store`を適用する。通常ビルドの既定は引き続きSupabase。デプロイ`938f880d-f3db-46d5-9634-60612e4e2814`で新routeと画面接続をworkers.dev stagingへ反映し、続くスケジュール分離版`1413b726-0930-45f4-b779-67865fffa24d`にも保持した。最新deployment上で匿名イベント/配信ログは401、合成管理者のサインイン・同一session TOTP/MFA後の読み取りは成功した。stagingの通知行数は読み取り前後で不変。手動イベントPOSTはローカル合成試験のみで、リモートstagingにはイベントを投入していない。

- Worker D1 API合成試験: `npm --prefix workers/api run test:notification-master-admin-d1` (6 tests)
- フロントAPI契約試験: `npm run test:notification-master-api` (5 tests)
- Worker/frontend typecheckは成功。2026-09-26のdeployment `938f880d-f3db-46d5-9634-60612e4e2814` に対し、合成管理者のBetter Authサインイン、TOTP enrollment/verification、同一sessionのMFA認可後にrules/templatesを10件/40件読み、event/delivery logsも読み取った。通知ログDTOにpayloadがなく、user IDは8文字へ短縮される。匿名GETは401。master行と通知行は読み取りのみで変更なし。合成Auth行は削除後0件、MFA generation singletonは単調増加状態を保持した。
- このスモークは合成Auth identityと絵文字draftのround-tripを使う。絵文字draftは元の値に復元し、active releaseは変更していない。2026-09-27には別の明示フラグ付きTOTP smokeで、空のevent/delivery/profile baselineを確認後、MFA認可された手動イベントPOSTを1件実行した。workers.devのCronが合成宛先向け日本語in-app通知を1件生成し、通知・イベント・profile・Auth行を削除して各baselineが0件へ戻った。再現コマンドは `node workers/api/test/staging-admin-totp-smoke.mjs --run-live-staging-write --database=fanmark-auth-staging --notification-manual-event`。絵文字draftとactive releaseは変更せず、実ユーザー行、production、domain/DNSは対象外。

## 通知管理のルール切替・テンプレート編集を実Safariで受け入れ（2026-10-06 JST）

現行Worker `471faabe-3aff-4312-ba22-cd326dc821e1`を保持し、専用合成管理者1件の
既存TOTPを`/admin`で検証。同一session/factorのMFA assuranceをD1で確認した。
`AdminNotificationManager`から専用rule1件を有効→無効へ切り替え、各`updated_at`が
進んだ。専用日本語in-app template1件のtitle/body/summary/activeを保存し、D1の
正確な値と、UIの「更新」後に再表示した編集フォームの全入力値が一致した。
本文の絵文字・`{{fanmark_name}}`・literal `$&`も保持した。

初回の通常signinで残った合成MFA challenge/attempts2行をfixtureが除外しておらず、
保持チェックは一度失敗した。SDKの識別子/value/同じ期限/作成日時で所有を確定し、
exact2 IDだけをpinして再照合した。全verification行を除外する緩和は行っていない。
UI logout後、専用rule/template/settings各1件とAuth user/所有cascade・上記2行を除去。
独立read-only processで既存全表row hash、Auth3/7/2、Master25表、FK0を保持した。
MFA世代の正当な+2は残し、wake世代とWorker versionは不変。合成password/TOTP secret、
UI入力ファイルと操作セッション内の認証情報も除去済み。再seed/再runnerは不要。
[限定証拠](evidence/staging-notification-admin-native-2026-10-06.json)。

この管理画面の編集操作は受け入れ済み。通知送信UI・他の管理画面、provider新規登録、
運用採用と実端末/最終統合は別の残件。配備/secret変更、追加mail、実ユーザー移送、
DNS変更は0。六項目全体は未完了。

## グローバルマスターデータ

2026-09-26にSupabaseから読み取り専用で通知ルール10件と有効な翻訳テンプレート40件を取得した。ルール・テンプレートのchannelはすべて`in_app`で、テンプレートはen/id/ja/koが各10件。ルールの`created_by`はSupabase AuthユーザーIDを参照するためエクスポートから除外した。ユーザー設定、通知イベント、生成済み通知は対象外。

ステージング用seedは[`scripts/migration/staging-notification-master-seed.sql`](../../scripts/migration/staging-notification-master-seed.sql)。source-shaped D1を使うSQLiteリハーサルで50行すべての値を照合し、再実行しても件数が変わらないことを確認した。2026-09-26にbusiness staging D1へ適用し、private source snapshot（SHA-256 `900f9f3a00bd5d0e68de541a0ad2a10a47c24def6613b89be69739b34584b3fb`）と全フィールドを照合した。結果は10ルール/40テンプレートで完全一致。再現用readbackは[`scripts/migration/verify-staging-notification-master-seed.mjs`](../../scripts/migration/verify-staging-notification-master-seed.mjs)。`created_by`はNULLのまま。通知設定・通知イベント・生成通知・user settings・fanmarks・licensesはいずれも0件で、公開`grace_period_days=1`設定1行も保持している。以前のWrangler API 7403は今回のread/writeで再現しなかった。

合成stagingスモークは、マスターデータが未投入の0/0状態または確認済みの10/40状態のみを許可し、部分投入とその他のbusiness行は拒否する。

## Wake/sleep counterpartのlocal準備

常時毎分Cronからpending時だけのDurable Object alarmへ切り替える経路を、Business 0024、
`workers/api/src/notification-wake.ts`に準備した。native D1 outbox、HTTP/scheduled終了時flush、
空queue停止、future/stale lease/障害/freeze継続、MFA保護の状態確認/再起動を含む。
現在のremote stagingは旧Cronで、0024/namespace/selectorは未適用。移行済みとは扱わない。
契約、source hash、post-commit gapと次の合成検証は`notification-worker-wake.md`参照。

## 2026-10-03：手動イベントとalarmのstaging合成受け入れ

Worker `ea309178`で実signin/TOTP/MFA後の手動POST 201、実alarm起動、日本語in-app配信、
空queueでの停止を確認した。native future eventの未ack世代はGETで変えず、MFA repairで
復旧し、due-time変更後にも配信/停止した。各通知はexact 1件、journal/retained baselineを
照合してAuth/業務fixtureを削除済み。手動作成は`INSERT ... RETURNING id`のexact receiptで
確認する。remote D1の`meta.changes`はwake trigger更新を含み2件となるため、1件と比較しない。
詳細と残るdelayed/他channel/provider/CPU等の境界は[通知起動・停止](notification-worker-wake.md)。

### 実Cronの隔離受け入れ — 2026-10-03

`a2d09dd`/CI37120631839両job成功済みのruntimeを変更せず、新しいWorker/D1と
全25 Business migrationを使い、実Cloudflare Cronからarchiveを実行した。
毎分と等価な`*/1 * * * *`をarchive専用の明示設定にして、実schedule/bindingを照合。
`scheduledTime=1791031804000`でreceived/selected/start/completedをD1で確認した。
古いdelivered/failedの2件だけを履歴へ移し、pendingと新しいdeliveredの2件を保持。
履歴ID/payload、残るID/status、FK違反0を確認した。

最初のfixtureは`* * * * *`がnotification/Stripeのdisabled処理も選ぶことを
「archiveだけ」の期待値に含めず、実archive2件完了後のassertで失敗した。
一時資源は削除済み。これはアプリ不具合の発見や修正とは扱わない。
修正したfixtureの2回目はverified-and-cleanedでterminal/exit0。
元の3 D1/2 Workersのinventoryへ戻り、独立12:52:07.842Z metadata readで
所有した一時資源の不在とbaseline一致を確認した。
[evidence](evidence/isolated-notification-archive-cron-2026-10-03.json)。

この証拠で実Cron→archiveの配線と対象選択を受け入れる。同じ隔離検証を理由なく
繰り返さない。main stagingの`NOTIFICATION_ARCHIVE_BACKEND`は依然未設定で、
日次有効化・保存期間/監視/CPU/planを含む定常運用の受け入れは別の残件。
実ユーザーデータ、既存staging業務/Auth行、provider、ドメインは変更していない。
