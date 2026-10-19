# 本番用の鍵の保管

2026-10-19、本番用のarchive鍵とBetter Authの秘密鍵を独立して作成した。検証環境の鍵は流用していない。まだCloudflareへ設定しておらず、既存ユーザーの認証・旧環境には影響しない。[実証](evidence/production-key-custody-2026-10-19.json)。

## 保存先と再実行

`production-key-custody.mjs` はmacOSのキーチェーンにarchive鍵、認証秘密鍵、暗号化した認証escrowを別項目として保存する。service名は同moduleの`productionKeyServices`、accountは証拠の`keyId`。値をprocess引数へ渡さず、`security -i`の標準入力で登録し、取得した値をprocess内で照合する。

非公開Vaultの `10_sensitive/secret-keys/fanmark-cloudflare-production-backup/<keyId>.md` にarchive鍵と認証escrowを保存する。directoryは0700、fileは0600。noteとdirectoryをfsyncしてからキーチェーンへ保存する。archive本体はこのnoteに含めない。Markdownを使うのは既存のSync対象形式で保存するためで、Sync設定は変えない。

既存serviceまたは既存directoryがあれば作成を拒否する。途中失敗した場合も新しい鍵を作り直さず、保存済みnoteとキーチェーンの一致を調べる。`openProductionKeyCustody` はprivate process内での復元専用で、返り値の出力は禁止。欠けたキーチェーン項目を補う場合も保存済みの同一鍵だけを使う。キーの交換・古い鍵の削除はこのhelperの対象外。

## 確認した範囲

- 実キーチェーン3項目とVaultを読み戻し、内容の一致とprivate modeを確認した。
- Vaultの `ensure_obsidian_sync.py` でFully syncedとlocal/synced/server hash一致を確認した。
- Syncサーバーの対象versionを直接取得し、ローカルnoteのSHA-256と照合した。その取得内容からWebCryptoで認証escrowを復号し、キーチェーン検証時の鍵IDと一致した。
- 既存鍵の再作成が拒否され、Vault noteが変わらないことを確認した。
- 合成試験でWorkerと同じAES-256-GCM header/nonce/tag形式による復号と改変拒否を検査する。

遠隔Syncの読み戻しは同じMacから行った。Macを失った場合の別端末でのVaultアクセスは未検証。Vaultにarchive鍵と認証escrowの両方を保管するため、Vaultへのアクセス権は両方の鍵へのアクセス権に相当する。

## 次の工程

閉鎖中の本番Workerへ同じ鍵を設定し、内部RPCから得るescrowとの一致を確認する。実際のbackup作成と隔離したD1/R2への一式復旧を行い、既存データ・schema・鍵の組合せを照合する。鍵の保管だけでbackup admissionを成功へ変更したり、公開経路/Cronを有効にしたりしない。管理者MFAの再登録は残りの独立した準備が完了してから行う。

2026-10-19、閉鎖本番Workerへ同じ鍵を設定し、実serviceから取得した暗号化escrowの復号・キーチェーン一致を確認した。[runtime検証](production-backup-preparation.md)。保存admissionはpendingで、実backup/一式復旧は次工程。
