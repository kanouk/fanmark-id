# 2026-10-20 再移送の中止と旧環境復旧

12:57 JST開始の2時間枠でG0を再確認し、G1停止・drainと確定snapshotを取得した。
Auth 1・Master 165・Business 261、計427 batchをACKし、Businessの全40表を照合した後、
最初の画像処理が未確定になって停止した。Worker Route/DNSは切り替えていない。
[独立照合と復旧の証拠](evidence/production-retry-cutover-aborted-2026-10-20.json)。

14:15 JSTに旧Supabaseの公開を再開し、35関数の原本コード・全依存ファイル・JWT設定、
DBの全75関係の権限、元のCron2件/active1を復元した。通知Cronは元どおり無効。
トップ/ログイン画面、認証API、公開画像を確認した。旧Supabaseが唯一の通常稼働先で、
mainは`e5a553c0bcc938a308def6f3770f1a84db88d389`を維持している。
本人のパスワード・MFAによる再ログイン試験は行っていない。

## 画像処理の分かったことと未確定事項

run `a660921a-bfd6-4a90-8ea5-552606ac44cf` の最初のavatars操作
`69e479e6-5485-4ecb-8d8b-8725926c6061` がlocal/remote pendingとして残った。
別の読取りではdispatch記録とACKがなく、両R2 bucketは0件だった。
元の要求のHTTP statusを保存していないため、拒否・通信失敗の具体原因は断定しない。
利用者操作が原因だとする証拠もない。同じ画像要求は再送していない。

同じ元画像のコピー1件と合成画像は、別の所有Cloudflare Worker/DO/R2を使った
同じgateway・service経路では保存と全bytes読戻しが成功した。
この試験は元の要求の結果を確定せず、本番targetのpending解除も許可しない。
実際の移送clientを含む検査と、HTTP診断情報の保持が次の作業である。

## 保存と再実行禁止

cohortGeneration 2は恒久quarantine済み。全移送データ、pending/ACK、5 journal、
終了済みexecutor、writer fenceを保持した。proof SHA-256は
`e66b008743cef45ed8693a28677b6e691c16f766812eaa1521a5b29170180fb4`、
state SHA-256は`62f8b0fe663074e6a26550be3dacab76fa99509ace8181528e270f3559fcaf28`。
両移送gatewayは削除し、通常Worker inventory8・全設定・Route0・Cron0・DNS17件を照合した。
新Webhook登録、追加メール、callback再登録、G5通常書込みは0件。

旧側を再開する前に、全40表の全行/PK/sequence/catalog、全Auth内容、
画像109件の全bytes/metadata、sealed通知0件を最終snapshotと独立比較した。
解約済み自己テスト契約、元鍵/backup、先行cohortの5 journal/quarantine/未知lockも保持した。
既存`supabase/.temp/cli-latest`変更を保持している。

private実行記録は`production-retry-cutover-2026-10-20T0357/`。
このrunのG1/G2/abort helper、逆SQL、35関数復元、公開解除、Cron復元を再実行しない。
最初のclaim transportが未確定だった原記録も保持し、初期状態の別読取り後に行った
controlだけの継続と区別する。データSQL・画像PUTの再送はない。
先行run `bf22744d-e772-4e9e-99c7-e07020b9594c` も再開しない。

## 継続指示

復旧後、本人は「最悪1日止めてもいいから、移行完了させてほしい」と明示した。
最大24時間の停止枠を認める新しい指示をprivateへ保存し、先の2時間制限を更新した。
原因調査・修正/検証と新しい物理5 store/調停scopeを準備し、最新G0から移送を行う。
隔離済み世代を初期化・再利用しない。現在の旧環境は準備中も通常稼働させる。
保存MFA票の期限とsource bindingは再確認し、必要な本人操作は独立準備後に依頼する。
本番検証が終わるまでmainを維持する。
