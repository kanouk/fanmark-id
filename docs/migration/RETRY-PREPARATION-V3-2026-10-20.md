> 履歴・当時の実証記録。現行の入口は[運用](../operations/README.md)と[最終確認状態](../operations/current-state.md)。本文中の「現在」「次の工程」や未マージ/未切替は当時の状態。完了済みhelperを再実行しない。

# 第3世代の移行先準備（2026-10-20）

旧Supabaseは通常稼働中。本人は最大1日の停止枠で移行完了まで進めるよう指示した。
第1・第2世代を再利用せず、新しい5ストア・調停namespaceを用意する。
**現在はschema/鍵の検証済み候補で、まだ閉鎖配備・初回運用backup/隔離復元は未完了。**
本番データの再移送・Route切替は最新G0と当日の開始条件を満たしてから実施する。
mainは本番検証が終わるまで維持する。

| store | 新資源 |
| --- | --- |
| Auth | `fanmark-production-auth-20261020-v3` / `bbb878d3-40eb-4755-b57b-f723f0dd901b` |
| Master | `fanmark-production-master-20261020-v3` / `f7aadd85-701e-4625-92ce-879d5939dab8` |
| Business | `fanmark-production-business-20261020-v3` / `5af38beb-efe6-4f2b-8f59-af0070f37551` |
| avatars | `fanmark-avatars-production-20261020-v3` |
| covers | `fanmark-covers-production-20261020-v3` |

scopeは`01c9f04b4679081b56a66754f041faa2df8533e8f911299f6eb67315d524f4b4`。
Auth4・Master共有9+本番2・Business27 migrationを新D1へ一度だけ適用し、全canonical schemaとseedを照合した。
[schema証拠](evidence/production-cohort-v3-schema-2026-10-20.json)。
Authのbackup hashは管理ledgerを除く専用profileを使用し、schema表数と
snapshotに含む内部`sqlite_sequence`の件数を区別する。
[元鍵の再利用証拠](evidence/production-cohort-v3-key-reuse-2026-10-20.json)では
元Vault note・Mac Keychainの3項目・暗号化escrowを照合した。鍵の新規作成・再発行は0件。
新runtimeからのremote escrow読戻しは閉鎖配備後の条件とする。

## 画像経路の実Cloudflare検査

[隔離した実クライアント検証](evidence/production-r2-client-cloudflare-2026-10-20.json)で
保存済み画像109件/13,285,729 bytesを所有する専用Worker/DO/2 bucketへコピーした。
実際の移送client・local journal・遠隔調停・import/read-only gateway・R2 serviceを通し、
109 PUT/109 ACK、全key/bytes/HTTP/custom metadataの独立読戻しを確認した。
clientの固定identity確認は試験用の明示変換を用いたため、本番target identityの受け入れとは分ける。
実際のデータHTTP要求は所有する試験host/bucketだけに限定し、旧source/本番storeへの書込みは0件。
全コピーと専用3 Worker/namespace/2 bucketを所有identity確認後に削除し、inventoryを元へ戻した。

元の失敗要求のHTTP情報は残っていないため、具体原因は引き続き断定しない。
同じ画像のコピーと109件全体が実Cloudflareで成功した事実と、元要求の結果確定は別である。
新しい診断は停止段階・数値HTTP状態・固定service stage/通信コードをprivate sidecarへfsyncし、
元journal/pendingを変更しない。拒否応答を受けても再送を許可しない。
新規workers.devが管理API有効化後も一時404を返す現象を別に観測したため、
固定runtime/scope/storeのidentity GET成功を待ってからgatewayを返す。
再確認はこの読取りだけで、claim・データ要求の再送は行わない。

## 世代分離と残りの条件

`RecoveryWriterCoordinatorProductionV3` と `NotificationWakeCoordinatorProductionV3` を使用する。
旧2世代のclass/migration/namespace/全物理データと操作記録を保持し、旧classのfetchを410、
旧通知alarmを処理なしにする。native試験で両旧世代の保持データと拒否を確認した。
旧資源表・pinは`production-resources-quarantined-v2-2026-10-20.json`と
`production-backup-pins-quarantined-v2-2026-10-20.json`へ保存した。第1世代の保存物も保持する。

CI成功後に新scopeを閉鎖配備し、8 Workerのbinding/secret/namespace/非公開経路と
初回運用保存・実隔離復元・所有資源のcleanupを確認する。
その後に最新source原本/状態、保存MFA票の期限とbinding、provider効果、DNS/TLS/Routeを取り直してG0から進む。
保存済みcallback、前回の試験メール、元鍵/backup、解約済み契約、2世代の未知pending/journalを再実行・削除しない。
本人のパスワード・MFA操作と新しいメール試験が必要な場合は、独立準備後にまとめて依頼する。
