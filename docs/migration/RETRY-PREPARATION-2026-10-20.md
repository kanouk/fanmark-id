> 履歴・当時の実証記録。現行の入口は[運用](../operations/README.md)と[最終確認状態](../operations/current-state.md)。本文中の「現在」「次の工程」や未マージ/未切替は当時の状態。完了済みhelperを再実行しない。

## 2026-10-20: 再移送は最初の画像処理で中止・旧Supabase復旧済み

[最新の再移送中止・復旧票](CUTOVER-RETRY-ABORT-2026-10-20.md)を最初に読む。
cohort V2はAuth/Master/Business移送後に恒久quarantineした。旧Supabaseは14:15 JSTに公開再開し、
35関数/DB権限/元Cronを独立照合済み。Route/DNS切替・main mergeは行っていない。
本人は復旧後に最大1日の停止を認め、移行完了まで進めるよう指示した。
実際の移送clientを含む画像経路検査・診断保持の修正と、新しい物理5 store/調停scopeを準備してG0から進める。
V1/V2のrun・helper・pending・保存済み操作を再実行しない。以下のV2準備完了記述は開始前の履歴。

# 再移行に向けた準備（2026-10-20）

**再移行開始の確認を依頼できる準備が完了した。** [完了証拠](evidence/production-cohort-v2-prepared-2026-10-20.json)。旧Supabaseは復旧済みで稼働中。本票は閉鎖された新移行先の準備結果を記録する。新しい移行先への実利用者データ移送・旧側の停止・Worker Route/DNS切替・mainへのmergeは、準備後の所有者確認まで実施しない。

## 認証期限と未確定応答の修正

- `cloudflare-credential-lease.mjs` は要求の直前に期限を検査する。通常の残存時間は2分以上とし、metadata確認後・write intent前にも再検査する。期限直前なら既存OAuth grantを更新する。401・通信断・5xxを受けた書込みは再送しない。
- `wrangler-credential-lease.mjs` は既存macOS Keychain鍵と暗号化Wrangler 4.135.0 profileを使用する。同じclient/grant/scopeだけを更新し、intentと暗号化した応答を先にfsyncして、更新前file hashの一致後にprofileを原子的に置き換える。応答不明・scope変化・外部変更はlockと原本を保持して停止する。refresh POSTの自動再送はない。更新済みprofileの読戻し後には固定accountへのGET成功を要求し、初回利用や外部更新を検出した場合も検査する。新grant直後の401には、このデータ変更のないGETだけを最大5回、計7.5秒の間隔で確認する。成功前にleaseを渡さず、更新後の検査失敗ではrotated grantとlockを保持する。
- 本番D1/R2のimport transportは期限付きleaseを必須とする。一式runnerはread側も同じpolicyを要求する。数値HTTP status/provider error codeだけをエラーに保持し、SQL・秘密値・providerの自由文は出力しない。
- Masterには `migrations-master-production/0000_import_operation_commits.sql` を追加した。元SQLとoperation/run/hash/物理target/incarnation/各statementの直接変更件数を同じD1 batch取引で保存する。完了記録はUPDATE/DELETEできず、backupにも含める。
- Masterの応答消失時は同じ生存executor内で、別の読取りとlocal/remote pending・停止owner・active0・executorを照合する。確定記録が完全一致した場合だけ既存operationをACKし、同じ呼出し位置から続ける。元SQLは再送しない。記録欠落・不一致は失敗の証明にせずpendingを保持する。
- 遠隔ACKの応答だけが消えた場合は、同じjournalが正確な遠隔ACKを読み取り、local ACKを追記する。ACK要求も再送しない。local fsync不明時はlockを保持する。
- 終了したprocessの部分stageを一般的に再実行する機能ではない。Auth専用復旧と完了stage境界の既存復旧以外は、未確定状態を保持して独立照合またはquarantineする。

D1 batchの取引とrollbackの仕様は[Cloudflareの公式文書](https://developers.cloudflare.com/d1/worker-api/d1-database/)を確認した。native D1/DOの失敗注入に加え、別の実Cloudflare合成DBで100件/50件のDMLを202/102 statementへ包み、確定記録の別読取り・trigger変更・全取引rollbackを検証した。[実Cloudflare試験の証拠](evidence/production-atomic-receipt-cloudflare-2026-10-20.json)。合成DBは所有identityを照合して削除した。実利用者データと新本番5ストアへの試験行投入は0件。

[Master全件の再準備試験](evidence/production-retry-master-native-2026-10-20.json)では、過去snapshotのMaster 3,944件をlocal native D1/DOへ投入し、以前止まったstaging ordinal2,151〜2,200で応答を一度失わせた。仮想時計は105分20秒進み、lease更新1回・SQL再送0回で全件照合、26表/12,048行の既存運用鍵backupと空targetへの復元が一致した。実sourceの最新snapshotや実Cloudflareの一式移送証拠には使わない。

## 新しい移行先

[現行資源表](production-resources.json)のcohortGeneration 2を使う。

| store | 新資源 |
| --- | --- |
| Auth | `fanmark-production-auth-20261020` / `d25388d6-fa19-46ba-a128-4fa537210e4b` |
| Master | `fanmark-production-master-20261020` / `ef4cee01-bd28-4fd5-8eb8-6744b4331d07` |
| Business | `fanmark-production-business-20261020` / `a418f597-ff73-40a9-8847-91e3a6dddcf4` |
| avatars | `fanmark-avatars-production-20261020` |
| covers | `fanmark-covers-production-20261020` |

scopeは `d70311e65d8f8205443e9230e4443d485a66c1e99831fe5c189d90fe81c121d3`。
backup pinはAuthだけ `AUTH_RECOVERY_SCHEMA_SQL` でmigration管理表を除外し、Master/Businessは `D1_RECOVERY_SCHEMA_SQL` を使う。全schemaのhashとbackup profileのhashを混同しない。

Auth 4、Master共有9 + 本番確定記録2、Business 27 migrationを適用し、全canonical schemaとseed baselineを照合済み。画像bucketの公開URLは無効、custom domainなし。本番専用の追加schema設定は `wrangler.production-master-import-schema.jsonc`。共有9件の設定と追加2件を分け、stagingのschemaは変更しない。適用済み操作の再実行指示ではない。

DOは `RecoveryWriterCoordinatorProductionV2` と `NotificationWakeCoordinatorProductionV2` の新namespaceを使用する。旧classとmigration履歴は保持し、旧classのfetchは410を返す。旧通知alarmも新ストアへ書き込まない。旧run・ACK・pending・quarantine・物理ストアを初期化しない。

旧資源表とbackup pinは `production-resources-quarantined-2026-10-20.json` / `production-backup-pins-quarantined-2026-10-20.json` に保存した。元のbackup bucket、archive、鍵、MFA票、private journal、解約済み自己テスト契約、登録済みOAuth callbackと通知試験記録を保持する。旧鍵の原Vault note hash・escrow復号・Keychainを照合し、新scopeへの再利用票をprivateに保存した。鍵は作り直さない。

## 閉鎖配備・初回保存・隔離復元の完了

実装commit `14815ae` の [CI39353698738](https://github.com/kanouk/fanmark-id/actions/runs/39353698738) はapplication/Workerの両job成功。appは `d48e0628-77e9-4d3d-92ab-8c420d3c2c11`、schedulerは `dc34fda1-2c13-430d-823b-525a83beae9d`、monitorは `b43c7421-350a-42b2-af0d-55c4a219b368`。新DO namespaceはRecovery `d93f6c3a042944ada645bd10b083d738`、Notification `fa9bf77393a349f8aaaf1fdada69b9d0`。旧namespaceと全旧資源を保持している。

一般HTTPとAuthの503/no-store、両画像bucket0件を内部bindingから確認した。公開Route0、workers.dev/previews無効、全Cron0、`receipt_only`、owner disabled、backup admission pending、通知disabled/宛先空へ戻した。既存15 secret bindingを保持し、app以外の運用2 Workerも新scope/pinへ合わせた。他5 Workerの設定は独立比較で不変だった。

既存の運用鍵で新しいmanual operation `e0f0b50d-8207-4435-b40d-f0eda35322f0` の初回backupを一度だけ保存した。426,931 bytesの暗号化archiveをR2から読戻し、既存Auth secretもescrow復号で一致した。旧の日次claimとarchiveは保持し、当日UTC slotが未使用であることも読取り確認した。新しい3 D1/3 R2の隔離先へ復元し、Auth9/Business80/Master26の全115表・全seed行・schema・FKと画像0件を別checkerで照合した。新本番側の全内容も変わっていない。試験用Worker/3 D1/3 R2を所有identity確認後に削除し、inventoryを元へ戻した。片付け後にR2の同じarchiveをもう一度ダウンロードし、元のbytes/hashを照合した。これは初期schema/seed状態の復旧証拠であり、移送後の実利用者データbackup/G3は当日の別条件である。

最終の独立読取りで、旧Supabase35関数の復元後version/コード、Cron2件/active1、凍結0、通常公開、受信差分0、期限処理対象0を確認した。解約済み自己テスト契約は元snapshotの正確なPKで現在もcanceledとして存在する。保存MFA票も現在のsourceへ一致した。旧5 journal・quarantine proof・未確定lockはbyte単位で不変。DNS17件全属性、apexのactive証明書、現在の旧配信HTTPS、Route競合なし、main維持を確認した。切替後WorkerのHTTPSと本人ログインはG4/G5で受け入れる。

## 所有者確認後の開始条件

準備のみ完了。本番データの再移送、旧側停止、Route/DNS切替はまだ開始しない。新しい開始確認・停止枠を得てからG0を取り直す。元run/helperを再開しない。再移送の接続部は新しいprivate `g2-lease-connections.mjs` に用意し、新run・今回の5 incarnation・runtime・開始確認票・新しい凍結証拠の一致を要求する。確認票はまだ作成していない。旧runの呼出しはネットワーク要求前に拒否する。

停止枠は既存計画の暫定2時間、90分時点の継続判断、15〜30分の復旧枠を維持する。前回実測は停止〜G2開始23.34分、G2開始〜停止3.54分、調停RPC p95 157ms。これは次回所要時間の保証ではない。日次処理の09:00 JST、backupの09:05 JST、請求・期限の重なりを開始時に再確認する。

日次監視はmanual receiptを代用しない。当日のG3で実データbackup/復旧を通し、最終schema pinを更新した後、UTC日次slotの既存claimを読み取る。未使用なら本番日次経路を一度だけ実行してretentionも確認し、監視を有効にする。既存claimがあれば再送・削除せず、当日の開始票で扱いを固定する。準備中は日次claimを作らず、追加の通知試験を送らない。

次回の開始確認後には、旧35関数の復元後versionと原本・稼働中データ・provider効果・受信stream・DNS/TLS/Route競合・最新MFA票を新たに確認する。稼働再開前のsnapshotを最新値として使用しない。保存MFA候補の期限は2026-10-21 00:24:45 JST。G0では停止・復旧を含め少なくとも3時間の残存を要求し、新しい凍結証拠の `administratorMfaValidUntil` へ固定する。G2接続部もこの残存条件を検査し、欠落/不足は移送前に拒否する。必要な本人操作は独立した準備を終えてから依頼する。

元 `production-cutover-2026-10-20/` の実行/停止/復旧helperは再実行禁止。新しいprivate準備記録は `retry-preparation-2026-10-20/`。intentがある操作はACK・実状態を照合してから扱い、作成・schema適用・backupを盲目的に再実行しない。
