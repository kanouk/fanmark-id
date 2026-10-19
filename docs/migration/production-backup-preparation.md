# 閉鎖中の本番バックアップ準備

`production-backup-pins.json` は実D1の定義を2回読み取り、一致したhashと、遠隔から復元確認済みの鍵IDを固定する。値は本番app/monitorの閉鎖configへ設定する。秘密鍵はconfigに入れず、appだけのsecret bindingへ登録する。

この段階では `STAGING_BACKUP_ADMISSION=pending`、scheduler/monitorはdisabled、公開route・workers.dev・preview・Cronは0のまま。DB定義は移送前の初期状態なので、Businessの移送台帳を作った後は再取得が必要。`production-runtime-config.mjs` はこの段階を検査し、hash/鍵IDの不一致や先行した保存・公開の有効化を拒否する。

## 内部の確認経路

`production-backup-inspection.mjs` は短時間だけ使うoperator Workerのソースを生成する。独立したランダムbearerと有効期限を必須にし、固定本番service bindingの `/status` GETと `/escrow` POSTだけを許す。slot・期待runtime版・鍵ID・scope・DB定義hashは配備時に固定し、呼出側から変更できない。statusで同一runtimeを照合してから、暗号化された認証escrowを返す。

保存run、期限削除prune、writer fenceの取得・解除、任意RPCはHTTPに公開しない。operatorは本番のD1/R2 bindingを直接持たない。返るescrowはprivate process内で保管済みarchive鍵により復号し、認証鍵IDとキーチェーンを照合する。通常のドメインへの公開や管理者MFAは必要ない。

operatorの作成・削除はUUID名、配備版、owner、期限、固定serviceをprivate journalへ記録し、API応答と別の読取りで照合する。作成応答不明なら同名へ再送せず、現状を調べる。削除対象も保存した版と設定が一致する場合だけに限定する。公開URLが存在してもbearerなしでは401、有効期限後は410となる。

## 未完了の条件

鍵とDB定義の設定・読戻しだけでは保存の有効化を認めない。移行先へ到達する全writerの調査、実際の停止状態の読取り、本番の内部保存と隔離復旧、全内容照合、通知の到達確認を別途行う。閉鎖中の初期DBを保存できても、移送後の実データ量を受け入れた証拠にはならない。

検証は `test-production-runtime-config.mjs` とnative Workerの `test-production-backup-inspection.mjs`。当初は閉鎖configとoperatorだけを追加した。後述の同日手動保存は共通保存engineと本番専用RPCも変更するため、配備前にWorker CIを再確認する。

## 2026-10-19の実確認

閉鎖app/monitorへpinsを配備し、全binding・公開/Cron閉鎖と既存Worker設定の保持を確認した。内部RPCから得たescrowを復号し、実runtimeの認証秘密鍵と保管済み鍵の一致を確認した。全7 Workerの設定から、本番の3D1/画像R2へ直接接続するWorkerが閉鎖appだけであることも照合した。保存はまだ有効にしていない。

operatorはDNSラベル上限63文字以内の名前を使う。最初の64文字名は作成後のactivationで止まり、独立検査と所有資源の削除後に短い別名で進めた。成功後のoperatorも削除し、両方の削除を別読取りで確認した。[限定証拠](evidence/production-backup-configuration-2026-10-19.json)。

## 手動保存と実資源への復旧（2026-10-19）

`production-backup-capture.mjs` は検査専用経路と別の、固定UTC slotを一度だけ保存するoperator。認証・期限・runtime・scope・schemaを固定し、保存済みreceiptや実行中writerがあれば実行しない。R2のslot占有とwriter停止は既存の保存serviceが原子的に行う。runの応答が不明な場合は同じPOSTを再送せず、statusと保存済みintentで確認する。pruneやfence解除は公開しない。

今回だけ閉鎖appのadmissionを有効にし、実3D1/2画像R2を424,468 bytesの暗号化archiveへ保存した。別のCLI downloadでも全byte hashを照合した。保存成功とfence解除後はoperatorを削除し、admissionをpendingへ戻した。公開経路・Cronは通して0。

新しい隔離3D1/2画像R2と作業用R2へ復旧し、別processでAuth9/Business80/Master25表のschema・全行hash・FKを照合した。元3D1の全行も保存物と一致した。復旧先の画像bucketは独立GETでも空を確認した。旧session/challengeを失効させる復旧方針を適用した。作業用Worker・3D1・3R2を削除し、前の資源inventoryとの一致を確認した。[限定証拠](evidence/production-operational-backup-restore-2026-10-19.json)。

これは移送前の初期状態（Auth1/Business30/Master10行、画像0件）の実資源復旧であり、実ユーザーを移送した証拠や、本番停止時間の保証ではない。保存4.806秒・復旧5.382秒はこの初期状態の1回の値。

## 同日追加保存の経路

日次serviceのUTC2026-10-19 slotは使用済みで、既存receipt/archiveを削除して再利用しない。`ProductionBackupService.runManual(operationId)` は小文字UUID v4を一度だけ占有し、同じ共通engineでwriter停止・全5store収集・暗号化・読戻し照合・停止解除を行う。日次保存と別の操作IDなら同日にも保存できる。通常scheduler/monitorは日次経路を使い続ける。

手動receiptは `recovery/manual/v1/runs/<operationId>.json`、archiveは `recovery/manual/v1/archives/<operationId>/<owner>.json`。receiptには専用format、操作ID、取得日、runtime、source/schema、鍵ID、hash、進行状態を保存する。日次receiptとの混用を拒否し、日次pruneの対象外として保持する。復旧は既存の共通archive形式と同じで、保存時のcontext/鍵・空の隔離先・session失効方針を指定する。

operatorの `productionManualBackupCaptureSource()` は操作IDと実行日を配備時に固定し、要求body/queryからの変更を拒否する。保存開始はadmission有効・writer0・ownerなし・完全なcensus・receiptなしが必要。statusはadmissionをpendingへ戻した後でも読める。runtimeが変わった場合は新しい版を独立確認し、同じ操作IDの読取り用設定へ更新する。

実行前に操作ID・期待runtime/schema・目的をprivate intentへ保存する。応答不明なら `statusManual(operationId)` と独立R2読取りで確認し、同じPOSTを再送しない。claimed/collecting/stored/failedが残る場合は元処理とwriter状態を調査する。失敗を迂回するためだけに新しい操作IDを発行しない。別IDの次操作は、元処理の終了とfence解除を確認した後に行う。

2026-10-19にCI39205951900の両job成功後、閉鎖runtimeへ配備して実R2保存・別CLI取得・復号・114表照合を確認した。日次archive/receiptは不変、一時operatorを削除してadmissionをpendingへ戻した。[限定証拠](evidence/production-manual-backup-2026-10-19.json)。

**残件:** 移送後はBusiness台帳を含むschemaを再固定し、移送した実データの確定backupを手動で保存する。既存の初期状態backupをその代用にはしない。
