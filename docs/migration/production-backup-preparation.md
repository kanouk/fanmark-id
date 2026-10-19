# 閉鎖中の本番バックアップ準備

`production-backup-pins.json` は実D1の定義を2回読み取り、一致したhashと、遠隔から復元確認済みの鍵IDを固定する。値は本番app/monitorの閉鎖configへ設定する。秘密鍵はconfigに入れず、appだけのsecret bindingへ登録する。

この段階では `STAGING_BACKUP_ADMISSION=pending`、scheduler/monitorはdisabled、公開route・workers.dev・preview・Cronは0のまま。DB定義は移送前の初期状態なので、Businessの移送台帳を作った後は再取得が必要。`production-runtime-config.mjs` はこの段階を検査し、hash/鍵IDの不一致や先行した保存・公開の有効化を拒否する。

## 内部の確認経路

`production-backup-inspection.mjs` は短時間だけ使うoperator Workerのソースを生成する。独立したランダムbearerと有効期限を必須にし、固定本番service bindingの `/status` GETと `/escrow` POSTだけを許す。slot・期待runtime版・鍵ID・scope・DB定義hashは配備時に固定し、呼出側から変更できない。statusで同一runtimeを照合してから、暗号化された認証escrowを返す。

保存run、期限削除prune、writer fenceの取得・解除、任意RPCはHTTPに公開しない。operatorは本番のD1/R2 bindingを直接持たない。返るescrowはprivate process内で保管済みarchive鍵により復号し、認証鍵IDとキーチェーンを照合する。通常のドメインへの公開や管理者MFAは必要ない。

operatorの作成・削除はUUID名、配備版、owner、期限、固定serviceをprivate journalへ記録し、API応答と別の読取りで照合する。作成応答不明なら同名へ再送せず、現状を調べる。削除対象も保存した版と設定が一致する場合だけに限定する。公開URLが存在してもbearerなしでは401、有効期限後は410となる。

## 未完了の条件

鍵とDB定義の設定・読戻しだけでは保存の有効化を認めない。移行先へ到達する全writerの調査、実際の停止状態の読取り、本番の内部保存と隔離復旧、全内容照合、通知の到達確認を別途行う。閉鎖中の初期DBを保存できても、移送後の実データ量を受け入れた証拠にはならない。

検証は `test-production-runtime-config.mjs` とnative Workerの `test-production-backup-inspection.mjs`。通常app/Worker runtimeはこの準備では変更せず、閉鎖configとoperatorを追加する。

## 2026-10-19の実確認

閉鎖app/monitorへpinsを配備し、全binding・公開/Cron閉鎖と既存Worker設定の保持を確認した。内部RPCから得たescrowを復号し、実runtimeの認証秘密鍵と保管済み鍵の一致を確認した。全7 Workerの設定から、本番の3D1/画像R2へ直接接続するWorkerが閉鎖appだけであることも照合した。保存はまだ有効にしていない。

operatorはDNSラベル上限63文字以内の名前を使う。最初の64文字名は作成後のactivationで止まり、独立検査と所有資源の削除後に短い別名で進めた。成功後のoperatorも削除し、両方の削除を別読取りで確認した。[限定証拠](evidence/production-backup-configuration-2026-10-19.json)。
