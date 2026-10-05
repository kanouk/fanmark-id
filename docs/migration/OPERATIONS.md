# Staging運用・有効化・復旧の手順

対象は `fanmark-app-staging`、account `bfc2890741f0b3fb236e2d755b6c9adc` の
Business/Auth/Master D1とavatar/cover/backup R2。実ユーザー移送、DNS切替、
Supabase writer停止は最後の別工程とする。本書の作成から運用受け入れを推定しない。

## 読み取りの運用確認

移行worktreeのrootでNode 22.6を使用する。

```sh
node scripts/migration/staging-operations-status.mjs --read-only
```

このコマンドは固定staging configとWranglerのidentity、remoteの三つのD1 binding、
単一100% deployment、全25 Business migrationを確認してから集計する。
修復・provider接続・ユーザー行のexportは行わない。Cloudflare OAuth tokenは
子プロセスの出力からメモリ内で受け取り、ログやファイルに保存しない。
API/CLI失敗は固定codeと処理段階だけを表示する。出力にはsecret値、通知payload、
メール、user ID、Stripe event/customer ID、ライセンスIDを含めない。

exit 0はその観測時点でattentionが空、exit 2は要確認、exit 1は観測失敗。
disabledJobsは別に表示し、処理停止を正常運用の完了と扱わない。
時刻判定の集計はSQLiteのjuliandayによる秒単位の目安であり、ライセンス変更の
microsecond境界や可用性判定を置き換えない。自由なSQL入力は受け付けない。

| 観測 | 判断と次の操作 |
| --- | --- |
| app/auth healthが200以外、binding/schema/deployment不一致 | 有効化・配備を止める。最後の受け入れversion、配備履歴、対象accountを照合する。 |
| FK違反、wake singleton欠落、ackがrequestedを超える | 自動修復しない。schemaと直前操作を確認し、復旧工程へ移す。 |
| wakeのrequestedとackに差がある | 一時的な差の場合もある。次の観測と管理者wake statusで確認する。2分超のdue通知滞留はalarm/bridgeを調べる。 |
| pending通知がdueから2分超、processingが10分超、failedがある | processorとDOの実行ログを確認。管理画面の同一session MFAから `GET /api/admin/notifications/wake` でstatusを読み、必要な場合だけ `POST` で保存済み世代を再開する。 |
| expiry/finalizationのrunning runがある | 正常なページ分割の場合もある。次の実行が保存済みrunを進めるか確認する。claim、run、抽選入力を削除したり勝者を再抽選したりしない。 |
| 90日超の完了通知がある | archive selectorとCron、partial/conflictsログを確認。履歴と元行の衝突を確認してから同じ処理を再開する。 |
| Stripe due dispatch、期限切れlease、dead_letterがある | providerと署名receipt/dispatch状態を確認。receiptを削除して再送しない。test-onlyの接続受け入れ後に通常dispatcherを再開する。 |

### 監視専用API tokenの経路

配備用Wrangler OAuthを使わない監視は、次の明示modeを使う。
`FANMARK_STAGING_MONITOR_API_TOKEN`は秘密保管先からプロセス環境へ渡し、
値をシェルコマンド・Git・出力へ直接書かない。

```sh
node scripts/migration/staging-operations-status.mjs --read-only --monitor-token
```

このmodeはWranglerを呼ばず、一般の`CLOUDFLARE_API_TOKEN`も参照しない。
専用tokenの欠落・失効・API拒否時は失敗終了し、他の資格情報へ戻らない。
Cloudflareのtoken verificationと固定accountのWorker設定・100%版・三D1 bindingを
照合してから、Business D1のmigration名と固定集計SELECTだけを問い合わせる。
APIのread receiptは`rows_written=0`かつ`changed_db=false`を要求する。
資格情報をpublic app/auth healthの要求へ送らず、token IDや生のprovider errorも出さない。

監視用tokenの作成時に必要な権限候補は対象accountだけの`Workers Scripts Read`と
`D1 Read`。zone/R2/配備権限を追加しない。2026-10-04に本人承認後、二つのRead権限と対象account限定・
有効期限2026-11-04を確認して発行し、Macキーチェーンへ保管、readback後の専用CLIを
実行してexit0・attention空を確認した。[証拠](evidence/dedicated-staging-monitor-credential-2026-10-04.json)。
ゼロ行UPDATEは変更0で成功したが、非ゼロ書込みの許可/拒否は証明しない。tokenがactiveであることや固定要求の成功だけでは
書込み権限がないことを証明できないため、その時点のreportの`leastPrivilegeAccepted`はfalseだった。下記の独立した非ゼロINSERT検証でD1書込み拒否を追加確認した。
`credentialSource`で専用tokenとWrangler OAuthを区別する。
[公式D1 queryの受理権限](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)と
[Worker設定API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/methods/get/)を参照する。

`npm run test:staging-monitor-api`は実コマンドの専用modeを隔離したprovider応答で実行し、
一般token/CLIへのfallback拒否、binding不一致時の問い合わせ停止、秘密を含む拒否応答の
非露出、書込みreceipt拒否を検証する。通常migration CIにも含める。
新tokenの作成・権限変更、保管先、定期実行・通知の設定はこのコード追加から推定しない。

これは手動で実行できる監視コマンドであり、外部への通知や定期監視サービスを
設定した証拠ではない。担当者と監視頻度は運用開始前に決める。


### 監視tokenの実D1書込み拒否を確認（2026-10-04）

CI37195682605/2f45451の両job成功後、専用Wrangler identityを確認し、新しく作成した
使い捨てD1だけを対象に監視tokenの権限を試した。SELECTは成功したが、1行を追加する
正当なINSERTはHTTP400/code7500の認可拒否となり、行は保存されなかった。
同じINSERTを配備用権限で実行すると1行保存でき、SQL自体の問題を除外した。
これは先行のゼロ行UPDATEと異なり、実際の書込み拒否の証拠である。

一時D1はUUID/name/作成時刻の一致を確認して削除した。別processの独立readbackで
元の3 D1 inventoryとの完全一致と一時D1の不在を確認した。Worker495b3ce4、設定、
保持GitHub/Google/Discord/Apple identityとsessionは不変で、アプリDBへ書込みprobeを
送っていない。[値を含まない実検証証拠](evidence/staging-monitor-write-denial-2026-10-04.json)。
二つのRead権限の設定・専用token保管・実読取り・D1 INSERT拒否は確認済み。
定期監視、担当、秘密更新、保存期間、RPO/RTO、最終運用の受け入れは別に残る。

## main日次Cronの読み取り専用監視

`staging-daily-observation.mjs`は固定app configからWranglerのidentityと指定した100% Worker
version、expiry/archiveのselector・周期を確認し、既存Workerのtailを読む。
Cronを手動実行したり、再配備したり、D1へ書き込んだりしない。次のUTC日付と
現在の配備versionを指定し、最大24時間先の日次実行をUTC00:04まで観測する。

```sh
node scripts/migration/staging-daily-observation.mjs --utc-date 2026-10-06 --version b3a770b3-8735-4b31-abdd-f4fca99e05cd --output /tmp/fanmark-main-daily-observation-2026-10-06.json
```

この日付/versionは今回の監視例で、次回は実際の配備と対象日を指定する。
日次Cronと日付・UTC00:00の分を照合し、秒は固定しない。expiry/graceとarchiveの
両結果、競合0・残り0、handler outcome=ok・例外0を確認した時だけ受け入れる。
片方だけの完了、同じjobの重複結果、部分完了やCPU超過では完了にしない。
ログから出力するのは許可したstatusと非負整数の集計だけで、通知payload・URL・
token・ID・例外本文を保存しない。受信前は未受け入れで、待機プロセスの生存と
観測結果を分ける。専用監視tokenをMacキーチェーンから読むが、tail自体は現在の
Wrangler OAuthを用いる。OAuthによるtailを最小権限の定期監視とは扱わない。今回のCLI照合では旧named
profile `fanmark-staging-inapp` は未認証で、app configの現在のOAuthは指定の
fanmark.id@gmail.com/accountと一致した。identityが異なる場合は開始前に拒否する。

回帰検証は`node --test scripts/migration/test-staging-daily-observation.mjs`。
通常のmigration-data/CIにも含め、秒ずれ・異なるCron/日付/Worker・部分結果・
機密値の除外と分割JSON受信を確認する。単体検証の合格は自然発火の証拠ではない。

## ジョブの有効化条件

| 処理 | 周期と設定 | 再開・停止 |
| --- | --- | --- |
| 通知イベント | `NOTIFICATION_PROCESSOR_BACKEND=d1`、`NOTIFICATION_WAKE_BACKEND=durable-object`。pending時だけDO alarmが動き、空queueで停止する。常時毎分Cronを追加しない。 | 保存済みD1 wake世代をMFA経路から再開。generationと通知行を保持する。 |
| 期限・grace・抽選 | `0 0 * * *` はUTC 00:00、JST 09:00。`LICENSE_EXPIRY_BACKEND=d1`、固定target incarnation/digest、`MAX_PAGES=4`。 | running runと保存済み抽選入力を再開。上限による分割は次の呼出しで進む。 |
| 通知archive | 日次 `0 0 * * *`、`NOTIFICATION_ARCHIVE_BACKEND=d1`。既存90日cutoff、250行×最大10 batch。 | 元通知を履歴へ原子的に移す。partialなら残行と衝突を確認して再開。履歴を自動削除しない。 |
| Stripe dispatch | 毎分Cronと`STRIPE_DISPATCH_BACKEND=d1`、test keys/署名secret、関連billing selector。 | receipt/dispatch、lease、attempt、projectionを保持して再試行。provider未設定では有効化しない。 |
| broadcast delivery | 毎分Cron、D1 snapshot/send selector、Resend送信設定。Auth emailとは別。 | snapshot/送信履歴を保持。送信先・送信許可の受け入れ前に有効化しない。 |

有効化時は同じ最終candidateでCIの両job成功、account/version/binding/schema、
baseline、CPU/plan適合を確認し、設定を差分でレビューする。
`scheduled-job-coverage.mjs`でrequired jobの周期が実dispatcherに到達することを確認する。
Cron登録と伝播をcontrol planeと実行結果で確認し、selector追加だけで完了にしない。
main expiry/archiveは2026-10-04に配備し、remote selector・CPU・Cron登録を確認した。
[配備証拠](evidence/staging-daily-job-activation-2026-10-04.json)。
2026-10-05のmain expiry/graceはUTC00:00:15の完了台帳を専用Read tokenで確認した。
両phaseは対象0/処理0/競合0で、データのある期限処理の証拠は別の合成検証に限る。
監視helperの00:00:00完全一致が日次ログを捨てたため、archiveとhandler全体の結果は未受け入れ。
次の自然実行ではcronとUTC00:00のminuteを照合し、秒が00とは仮定しない。
再配備・手動ジョブ呼出しは行わず、毎分handlerのokと元の2/6/1・Master/MFA/wake保持を
独立確認した。匿名検索2候補/5eventは所有者不明のまま保持する。
[限定した日次証拠](evidence/main-natural-lifecycle-ledger-2026-10-05.json)。隔離archiveの実Cron受け入れは
[保存済み証拠](evidence/isolated-notification-archive-cron-2026-10-03.json)を使う。

2026-10-04、契約画面の「無料プラン／現在のプラン」でWorkers Freeを確認した。
subscriptions APIは現OAuthで403/10000、workers/account-settingsの
`default_usage_model=standard`だけではPaid契約を判定できなかった。
FreeのHTTP/Cron CPUは10msで、ネットワーク・DB待ち時間とは異なる。
[公式CPU制限](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)。
その後、ユーザーがWorkers Paidを有効化した。対象accountの契約画面でPaidの
「現在のプラン」とFreeの「ダウングレード」を確認した。
[契約確認](evidence/workers-paid-plan-2026-10-04.json)。エージェントは購入していない。
checked-in app configでCPU設定30,000ms、日次expiry/archive selectorを準備した。
CI・配備・remote readback・日次実行の確認前に定常運用を完了扱いしない。
既存の合成rehearsal guardはactive jobを拒否し続け、試験用の停止fixtureと区別する。
Stripeのtest key/署名secret・19料金・test default Portalは2026-10-04にstagingへ設定した。87b61ef/CI37200812928両job成功後のWorkerca971193で6 billing selector/毎分dispatchと専用test Webhookを有効化した。実test Checkout/Portal/Creator→Business→Free、重複/処理済みevent逆順再送/自然retryとdrain後の専用合成fixture cleanupを確認した。同じWorkerで延長Checkoutの拒否時未延長・3DS成功・自然署名反映・delivery2/効果各1と独立cleanup/元状態保持を確認した。定期請求の実拒否/失敗投影・古い成功の初回逆順配信で失敗を保持・成功復旧・独立cleanupも確認した。定期請求の実追加認証待ち、hosted3DS完了、同じInvoice/PaymentIntentの復旧と独立cleanupも確認した。2026-10-05には12fa13f/Workercc6d9da7で同一合成userの実購読画面（Checkout→Creator/Portal→Business/Free/logout）・自然署名反映・独立cleanupを確認した。license/延長/上限超過選択/有料退会を含む全UIは未受け入れ。[画面の証拠](evidence/stripe-staging-subscription-ui-2026-10-05.json)。Resendは送信限定・fanmark.id限定のstaging専用キーをMacキーチェーンとWorkerへ保存・読み戻し済み。runtime00fc6e7/CI37285576515両job成功後、Worker92413959を100%配備し、新規登録・メール確認・再設定capabilitiesと既存2/6/1・Master全履歴・MFA/wake・匿名検索2/5・16認証テンプレート・他binding/Cronの保持を確認した。[設定と保持の証拠](evidence/resend-staging-configuration-2026-10-05.json)。その後、指定先の実新規登録・確認メール受信の本人申告・emailVerified=trueを確認し、同じ登録ユーザーへの再設定要求も200で成功した。専用stagingキーのResend画面では確認と再設定の2通ともDelivered。本人から再設定メール受信とログイン画面への転送が報告され、旧route条件を修正したruntime0ed4213/CI37298341592両job成功・Workerb3a770b3へ配備。通常reload後、同じ有効リンクで新パスワードの入力フォームを確認した。本人による新パスワード保存後、credential更新日時の進行と再設定トークン消費を読み取り専用で確認し、保存は受け入れ済み。その後、Safariの専用プライベートウィンドウで同じ検証ユーザーのダッシュボードと表示メールアドレス、再設定後に作成された有効session1件を独立確認し、メール/パスワードログインまで受け入れ済み。実登録・確認・再設定・ログインの機能経路は確認できたが、テストaccount cleanupとメール検証の完全終了は未受け入れ。[ログインの証拠](evidence/staging-email-password-login-2026-10-05.json)。[保存の証拠](evidence/staging-email-password-reset-completion-2026-10-05.json)。[route修正の証拠](evidence/staging-password-recovery-route-fix-2026-10-05.json)。[配信と認証の証拠](evidence/resend-staging-verification-delivery-2026-10-05.json)。一斉送信は無効のまま。R2とは別契約である。

## 秘密の管理と権限

| 秘密 | 用途 | 交換時の扱い |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | Better Authのserver secret | 現SDKの暗号化・session/MFAへの影響と再ログイン/復旧方法を確認してから交換する。単に元の値へ戻せば全状態が復旧するとは扱わない。 |
| `VERIFIED_ACCESS_SECRET` | 閲覧password proof | 交換後は旧proofの拒否と新規検証を確認。D1のlicense incarnation/access/password世代は保持する。 |
| `REFERENCE_MASTER_SERVICE_SECRET` | 内部マスターサービス認証 | callerと受け側を揃えて交換。旧secretで拒否、新secretで必要経路成功を確認する。 |
| Stripe/Resend/OAuth secrets | providerごとのserver認証 | provider側とWorker側を揃える。test/liveとstaging/productionを分け、旧secretの失効も確認する。 |
| `FANMARK_SNAPSHOT_KEY_B64` | AES-256-GCM snapshot暗号化 | Worker認証鍵とは分離する。32-byte鍵はリポジトリ外の秘密保管先へ置き、bundle headerのkeyIdに対応する旧復号鍵を保持する。新しい鍵だけでは旧bundleを開けない。 |

secret値をVite変数、Git、PR、出力、通常ログへ入れない。鍵の実保管先、アクセス可能な
担当者、交換間隔、緊急失効・復旧の担当は未確定。合成復旧用の使い捨て鍵と資源を
削除した証拠は、本番の鍵保管・復旧担当の証拠にはならない。

配備者、監視者、復旧担当の権限を分ける。監視には対象accountのWorkers/D1読み取りを
基本とし、配備・migration・R2変更権限を与える役割を限定する。
現在のWrangler OAuthは書込み権限を持つため、最小権限の監視用tokenとは扱わない。
2026-10-04の監視tokenは上記の限定scopeで発行・保管済み。D1 bindingとaccountの照合は、IAMによる
権限制限の代わりではない。

## 復旧の実行順

1. 障害の対象、最後の正常version/bookmark、provider receipt、Master active releaseと
   hash、R2参照、合成か実データかを記録する。秘密と利用者データを記録へ複製しない。
2. Worker側のwrite freezeとjob停止を対象configへ反映し、実binding/versionを確認する。
   読み取り可否と書込み拒否を確認する。Supabase本番writer停止は今回の範囲では実行しない。
3. 復旧先incarnationを分け、Business/Auth/Master/R2を一式で照合する。
   Businessだけを戻してAuth、receipt、Master、画像、DO状態も戻ったと推定しない。
4. encrypted bundleのkeyId、hash/count/型/credential descriptor、対象資源を確認し、
   保存済みcheckpointから復旧する。row/objectの上書きを無条件に再送しない。
5. FK、R2実GET/HEADのbytes/MIME/参照、Auth/session/MFA、保護参照、通知wakeと
   Stripeの二重適用防止を確認する。DOのackを手動で進めて未処理を隠さない。
6. 合成canaryと独立readbackの結果を確認し、同じcandidateで書込みとjobを再開する。
   失敗時はfreezeを保ち、checkpointから再開する。

合成一式remoteの手順・所有資源のcleanupは
[隔離復旧](isolated-combined-recovery.md)とそのconductorにある。
旧candidateの90,726msと、現行4c2a8c5/CI37246478014での96,988msは小さなfixtureの
provision/restore実測であり、本番RTOではない。現行候補の二つの復旧先はcleanupと
独立した3 D1/3 R2/2 Worker inventory一致まで確認済み。
[現行候補の復旧証拠](evidence/isolated-combined-recovery-2026-10-05.json)。
RPO、停止時間目標、RTO、snapshot周期/保存期間、復旧担当は合意と最終構成での実測が
必要。Auth credential backupと実ユーザー行の復旧は最後のデータ工程へ残す。

## この工程でまだ必要なもの

監視コマンド・手順の用意と、定常運用の受け入れは別である。残るのはデータ量に対するCPU適合、
main archiveの自然実行確認、provider残件、担当/権限運用/鍵保管先/保存期間/
RPO・RTOの確定、同じ最終candidateでのPC・実スマホ・言語・旧PWAと障害復旧の通し確認。
[COMPLETION](COMPLETION.md)の項目4・6を閉じるまで運用完了としない。
