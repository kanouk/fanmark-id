# バックアップと復旧の現在の境界

実ユーザーデータの移送とドメイン切り替えは最後の別工程とする。
過去の節は当時の検証範囲。以下の2026-10-09の方針採用と実装状況を優先する。

## 採用したステージング方針（2026-10-09 JST）

ユーザー回答「その案でOK、まだ未確認」により、バックアップ運用案を採用した。
実スマホ確認は未確認のまま。追加の運用許可は要求しない。

| 項目 | 採用内容・現在の状態 |
| --- | --- |
| 担当 | サービス所有者 |
| 周期・保存期間 | 1日1回、30日。09:05 JST（5 0 UTC）を候補時刻とする。実Cronはまだ0。 |
| 保存先 | 専用R2 `fanmark-backups-staging`を作成。managed/public URL無効、custom domainなしをAPIで照合。 |
| 鍵 | 新規AES-256鍵をMacキーチェーンとVault `10_sensitive/secret-keys/fanmark-cloudflare-staging-backup`へ保存・一致照合。保存ファイルは0600。R2へ鍵を保存しない。Vaultの遠隔Sync完了は今回の検証に含めない。 |
| SDK鍵 | 通常Worker内部で運用鍵により暗号化し、別のescrowとしてキーチェーンとVaultへ保存する。生のSDK鍵をRPC応答・ログへ出さず、既存鍵を変更しない。通常Workerの内部RPCで取得し、復号/hash検証後にキーチェーンとVaultへ保存・読戻し照合済み。 |
| 復旧 | session/MFA assurance/verificationを失効。認証情報・業務情報・マスター・画像の復旧は既存共通形式v1を使用する。 |
| RPO/RTO | 24時間/4時間を目標とする。実測または保証ではない。 |
| 本番 | 今回の採用・配備はstagingのみ。本番ユーザーデータとDNSは最後の別工程。 |

`StagingBackupService`は内部service binding専用のnamed RPC。通常HTTP routerから
capture/鍵/停止操作を呼べない。source binding集合から導出したscopeとschemaをpinし、
独立したwriter終了確認後だけ`STAGING_BACKUP_ADMISSION=writers-verified-v1`を選べる。
現行main1b57012dの新5 store/V2 scope限定で`writers-verified-v1`を採用した。
旧scopeのticket34は未判定のまま保持する。運用許可やactive=0だけを終了確認の代わりにしない。

1. UTC日付のR2 conditional claimを作り、owner UUIDで新規writerを停止する。
2. 計測済み既存処理の終了を最大20回/約20秒待つ。capture/writeをtimeoutとraceして残さない。
3. 同じownerを各storeで確認し、共通collectorの2回capture・AES-256-GCM保存・全partの復号/hash検証を行う。
4. 保存したR2 objectを読み戻して検証する。全処理終了後にownerの停止を解除し、永続receiptへ終了を記録する。
5. 当日の成功archiveのhashが一致した時だけ、30 UTC日付より古い成功receiptとそのexact archiveを削除する。他prefix、未完了、失敗、hash不一致は自動削除しない。

失敗/不明ACK/強制中断した日は再実行しない。receiptとownerを確認し、残った処理の
終了を確認した上でoperatorが復旧する。TTLでwriterやownerを消す機能はない。
失敗時の保存物は隔離して手動処理する必要があり、期限処理の完全自動化とは扱わない。
失敗Cronと永続receiptを監視し、前日以前の成功日時と併せてRPO超過を判断する。
別の毎時monitorと固定宛先の内部RPC通知は実装した候補。まだnative配備・実配送・受信を受け入れていない。

native local検証11件で、RPC接続、既存writer終了待ち/新writer拒否、他ownerの保護、
claim応答喪失、失敗の秘匿、同日の重複拒否、暗号化Auth鍵の復号、R2保存fileからの
5ストア復旧とsession失効、30日の境界/別prefix保護、Cron拒否を確認した。
source R2は空の隔離fixture。通常stagingの実データからのcaptureや運用鍵でのremote復旧を
このlocal証拠へ含めない。初回旧writer終了・外部writer除外、実環境での保存/復旧、
定期実行/失敗監視の受け入れが残る。

## 用途と保存形式

| 用途 | 実装・受け入れ | 境界 |
| --- | --- | --- |
| Supabaseのpublic表を一貫したtransactionから取り出す準備 | `snapshot-export-encrypted.mjs`、`snapshot-encryption.mjs`、`snapshot-verify.mjs`。manifest v4と暗号化bundle v1。合成データで検証済み。 | 実source行のexportは未実行。Auth/Storageを含む同時点のcaptureは証明しない。 |
| 暗号化source snapshotからBusiness D1へ取り込む | `importEncryptedD1Snapshot()`と`importD1Snapshot()`。明示target/profile、変換・checkpoint・独立照合。 | Credentialは専門writer/profileが必要。converterの4 blocking groupsを自動承認しない。 |
| 暗号化source snapshotのR2往復 | `test-snapshot-r2-staging.mjs`で専用private bucketへの合成2 objectの保存・取得・復号・削除を受け入れ。 | canaryであり、定期ジョブ・保存期間・復旧担当は採用していない。 |
| Cloudflareの全ストアを保存ファイルから戻す | `fanmark-full-combined-recovery-v2`。保存Master25表/12,254行、合成Auth9表/16行、Business40表/15行、合成画像2件。現行27 Business/4 Authで別の2組の実D1/R2へ復旧済み。 | one-offのprivate proof。source exporterのbundle v1とは別形式。実Authを含む汎用の定期collectorとして公開していない。 |

二つの暗号化形式は交換可能ではない。source snapshot用のCLIへ一式復旧bundleを渡さない。
実行済みのprivate proof runnerやjournalを、運用backupのために再実行しない。
詳細は[source export](snapshot-export-design.md)、[D1 importer](d1-import.md)、
[全一式復旧](full-combined-recovery.md)と[現行27の限定証拠](evidence/full-combined-file-remote-recovery-v27-2026-10-06.json)。

## Auth復旧の共通処理（2026-10-06）

`workers/api/src/auth-d1-recovery.ts`を追加し、test内だけにあったcapture/暗号化/復旧を
共通処理へ移した。復旧は空targetと明示session policyを要求する。隔離した完全性検証
だけで旧sessionを保持でき、選択した失効方式ではsession/MFA assurance/verificationを
戻さず、credential・factor・role・停止監査・generationを保持する。実D1のrollback、
commit後ACK喪失時のtarget保持/再実行拒否と実SDKの新規password/TOTP loginを
ローカル合成検証で確認した。[実装と検証範囲](synthetic-auth-recovery.md)。

これは採用可能な共通primitiveであり、本番失効方針の採用やcollector/schedulerの
有効化ではない。全ストアの一貫したcapture・運用鍵・off-host保存・retentionは残る。

## Master復旧の共通処理（2026-10-07）

`workers/api/src/master-d1-recovery.ts`は固定25表のcapture/AES-256-GCM保存・読込/空D1復旧。
独立schema pin、legacy Auth空、chunk/batch制限、履歴後trigger設置、全表照合を要求する。
通常Worker CIのnative local D1回帰7件と、保存済み全Master12,254行/98 objectの
新format復旧・全hash一致を確認。[契約と限定証拠](master-recovery.md)。
旧private runnerの再実行や実source再取得は不要。Master単独primitiveであり、
運用鍵・定期off-host collector・保存期間・全ストア整合性の採用は引き続き残る。

## R2復旧の共通処理（2026-10-08）

whole-bucketの暗号化captureとexact subset再開処理を追加し、local R2のbytes/HTTP/custom
metadata・ACK喪失の不足分再開・実画像GET/HEADを6件で確認した。
[契約](r2-recovery.md)・[限定証拠](evidence/r2-recovery-shared-local-2026-10-08.json)。
実bundleの既知optional metadata差異を修正し、8件へ拡張した。専用7 bucket/Workerの
明示remote runnerを追加したが、このcheckpointではremote未実行。
その後、両CI成功のfcd4812で実Cloudflare専用7 bucket/Workerを実行し、class補完なしの
Standard classと8項目、全資源cleanupと前後inventory一致を受け入れた。
[remote限定証拠](evidence/r2-recovery-shared-remote-2026-10-08.json)。
collector未接続、運用条件は下表の残件。

## 全ストアの共通collectorと保存file（2026-10-08）

`recovery-set.ts`と`recovery-set-files.mjs`を追加し、5 leaf archiveを認証した一つのfileへ
まとめる。native local D1/R2/実file6件で全target事前検証、Business commit後ACK喪失の
exact skip再開、明示session失効を確認。[契約](recovery-set.md)。

collector APIは呼出可能だが、実runtimeを停止/drainするtrusted guard、鍵/保存先/周期/
retention/監視は未接続。既存CUTOVER_WRITE_FREEZEはAuth/Stripeが続くため、そのまま
整合した運用保存点の証拠にはしない。下表の採用待ちは保持する。

## 新collectorの実Cloudflare file復旧（2026-10-08）

`fanmark-recovery-set-v1`を新規6 D1/5 R2/Workerで収集し、Macのprivate fileを読み直して
空targetへ復旧した。現行schemaと小さい合成行・Standard画像2件で全desired hash/FKと
明示session失効、全資源cleanup/inventory一致を確認。[限定証拠](evidence/recovery-set-isolated-remote-2026-10-08.json)。
collector APIのremote実行と保存file復旧は受け入れ済み。通常アプリのwriter停止/drain、
運用鍵/off-host/retention等を採用した定期backupではない。one-off鍵はcleanup後に除去し、
この合成保存fileを将来の運用backupとして配布しない。下表の未採用条件は維持する。

## 新しい書き込みの停止（2026-10-08 JST）

`RECOVERY_WRITE_FREEZE=true`はバックアップ用の独立した停止設定。未設定・空・falseは
通常動作を保持し、不明な値は停止側へ倒す。HTTPの入口で全requestを503/no-store/
Retry-After 60へ返すため、GETのsession更新・OAuth callback・Stripe/Resend通知・
公開参照の副作用もroute実行前に停止する。fetchのfinallyでoutboxをflushせず、Cronは
診断用D1書込みより前に停止する。通知DOのwake/statusは503とし、alarmは再開用の
次回alarmだけを保持し、Businessの処理・generation ACKを行わない。解除後は保存済み
alarmが未処理イベントを再開する。DOのalarm時刻はこの5ストアarchiveの対象外。

これは新しく入るアプリ処理の停止実装。切替前から実行中のrequest/jobのdrainや、
直接D1/R2へ接続する別Worker・CLI・operatorの停止は証明しない。flagだけを
`RecoverySetGuard.assertHeld()`の成功条件にしてはいけない。collectorには未接続で、
通常stagingへの有効化・停止中の実capture・運用方針の採用はまだ行っていない。
既存CUTOVER_WRITE_FREEZEの認証・Stripe継続契約は維持する。読み取り専用monitorは
RECOVERY_WRITE_FREEZEもselector一覧へ出力し、flag存在をdrain完了へ換算しない。

実Worker入口/Cronの16件とnative D1/DO alarmの21件、型検査が成功。新しいnative caseは
停止中のqueue全行/generationが同一、通知0件、次回alarm保持、解除後に2 eventが各1回
だけ配信されてalarmが消えることを確認した。synthetic local証拠で、remote停止/drainや
全体の運用復旧完了とは扱わない。

## 運用にするために残っていること

2026-10-08 JST、利用者はstagingのD1・R2について、既知のfanmark Workerと
このチャットの作業以外のCLI・外部ジョブ・手動書き込み元はないと回答した。
これは現在の書き込み元の確認であり、将来の追加処理や本番環境には適用しない。
一貫した保存点のcaptureでは、この作業の直接書き込みも止め、main/companionの
対象bindingと処理終了を確認する。鍵・保存先・周期・保持期間等の採用待ちは維持する。

Businessの固定79表と採番状態のcapture/AES-256-GCM/空target復旧も共通moduleへ
追加した。現行27 migrationのnative合成復旧5件、Master互換回帰7件、型検査とdry-run
が成功。招待消費/通知wake/削除済みIDを保持する。[Business復旧](business-recovery.md)。
これはcollectorへ接続できる部品であり、全ストアの整合した復旧点や運用採用は下表の残件。

| 残件 | 必要な結果 | 現在の状態 |
| --- | --- | --- |
| 担当・権限・復旧アクセス | 担当者が保存先と鍵へアクセスし、通常環境が使えなくても復旧できる。 | 既存の運用条件の質問が回答待ち。 |
| 鍵の保管・交換 | archive鍵とAuth SDKの暗号化鍵を別途保管し、過去archiveとの対応を残す。 | proofのone-off鍵の分離保管は確認済み。運用保管・交換は未採用。保存したTOTP等は対応するSDK鍵も必要。 |
| 保存先・周期・保存期間 | off-host保存先、周期、保持・削除条件を採用し、失敗を監視する。 | R2往復試験を定期保存と扱わない。保存期間30日/RPO24時間/RTO4時間は未採用の提案値。 |
| 各ストアの一貫したcapture | Business/Auth/Master/R2の整合した復旧点を作る。採用した方法の実測と手順を残す。 | Masterの前後hash一致は安定性確認。全ストアのatomic snapshot保証ではない。source event sequenceも通常のMVCC対象ではない。 |
| Auth再開時の失効 | 復旧後に残す認証状態と失効するsession/verificationを定める。 | 隔離試験では元sessionとcredentialの完全性を検証。これを本番の失効方針に転用しない。 |
| 最終運用構成での復旧 | 採用した鍵・保存先・方針を使って復旧し、所要時間と制約を記録する。 | current27の合成一式復旧は受け入れ済み。one-off所要時間から本番RPO/RTOを保証しない。 |

方針が確定した後、collector・scheduler・retention・監視をその方針で構成し、
同じ保存形式と運用鍵を使う復旧手順を採用する。現在のCLI群がそれを自動で行うとは扱わない。
実ユーザーを含むcapture・移送や本番writer停止は、最後のデータ移行工程の対象となる。

## 今回の監査結果

専門credential writerと現行schemaの一式復旧は実装・合成受け入れ済み。
古い「未実装」「未確認」という説明は修正した。残る運用採用を閉じるために、
合格済みの復旧を目的なく再実行したり、未回答の条件を採用済みとして扱ったりしない。
全体の完了判定は引き続き[六項目](COMPLETION.md)で行う。

## 計測済みwriterの終了確認（2026-10-08 JST）

`recovery-writer-drain.ts`は内部binding専用のSQLite Durable Object coordinator。
`RECOVERY_DRAIN_BACKEND=durable-object`、`RECOVERY_DRAIN` bindingと、5ストアのidentity集合に
対応する`RECOVERY_DRAIN_SCOPE_DIGEST`を明示した環境で、HTTP・Cron・通知DOの処理を
ticketへ記録する。未指定時は通常動作を保持し、不明selector・欠落binding・scope不一致は
新しい処理を拒否する。public control routeやcredentialは追加していない。

owner UUIDによるclaimは先に新規enterを閉じる。既存ticketがある間はdrained=falseで、
assertは拒否する。開始/終了ticketと件数はDO storageの同じtransactionで更新し、
処理・ticketをTTLで終了扱いにしない。enter応答喪失では処理を始めずticketを保持する。
操作や終了ACKが不明なticketを機械的に消す手順はない。owner以外の解除と別scopeは拒否し、
解除後に通常処理を再開する。HTTP選択時はoutbox wakeもawaitしてからticketを消す。
Cronの1件が失敗しても、他のjobと各wakeのsettlementを待ってからticketを終了する。

native localの5件では、実Worker HTTP/後続wake、Cron・通知alarmの拒否、native D1へ
書く既存処理の終了待ち、並行2件、enter ACK喪失、別owner/scope、1 job失敗中の他job
継続を確認。既存Worker/Cron16件・通知D1/DO21件と型検査・bundle dry-runも成功。
[限定証拠](evidence/recovery-writer-drain-local-2026-10-08.json)。通常CIに5件を追加した。

これは**最初から計測したwriter集合**の停止・終了確認。追跡開始前から動いている旧version、
直接D1/R2を書くCLI・別Worker・operatorはcensusに含まれない。scope digestは実bindingの
独立readbackやruntime pinを代替しない。初回有効化時の旧処理終了、全writer inventory/
外部writerの停止、collectorへのtrusted adapter、実Cloudflareでの配備/停止/capture/復旧、
運用鍵/off-host/retention/監視の採用は未完了。通常stagingには新binding/selectorをまだ
追加していない。未回答の運用方針を採用済みとせず、実ユーザー/DNSは最後の範囲を保つ。

選択時は各処理のenter/leaveでDOのRPCとtransactionが増え、HTTPはwake終了まで応答を
待つ。中断したticketは保存の安全性を優先して停止を継続するため、停止解除には所有者が
不明処理の終了を確認する必要がある。これらの運用/latency条件をremote採用時に検証する。

## 実アプリ・全Masterのnative remote受け入れ（2026-10-08 JST）

`ad8f754`/CI37678533990の両job成功後、新規owned Cloudflare資源で通常SDK・別DO fence・
全Master12,254行・5ストアcollector・同じMac保存fileの復旧を受け入れた。旧session拒否、
新login、catalog3,944件/参照4・4・5・16件、hash/FK0と全資源cleanup/inventory一致を確認。
[限定証拠](evidence/application-recovery-transport-full-master-remote-2026-10-08.json)。
R2 data storeは空。通常mainへコードも反映したが停止/計測binding/selectorは未有効化。
[配備証拠](evidence/staging-native-recovery-runtime-rollout-2026-10-08.json)。
隔離runtime接続の残件は解消。main初回の旧writer終了、外部writer lease、容量と運用条件の
採用は残る。過去節の未接続/未配備は当時の記録として読み、この最新観測を優先する。

## 書き込み件数の停止を伴わない確認（2026-10-08 JST）

内部bindingの`inspectRecoveryWriters(env)`で、初期化済みか、実行中の件数、停止owner、
そのownerが停止を保持して全件終了したかを読み取れる。未初期化の状態を初期化せず、
ticket・件数・停止状態を変更しない。件数0でも停止ownerがなければ`drained=false`となる。
selector/binding/scopeの検証は停止操作と共通で、公開HTTPの操作口は追加していない。

native local試験は、未初期化、実行中、終了後、停止保持中、解除後の保存状態と実D1書込みを
照合した。別scopeの拒否も含めて既存5件と追加1件の計6件、型検査、eslintが成功した。
[限定証拠](evidence/recovery-writer-inspection-local-2026-10-08.json)。
通常stagingの計測有効化・初回旧writer終了・外部writer停止や運用採用は、この読み取り機能の
ローカル検証に含めない。復旧collectorは引き続きowner付きの停止と終了確認を要求する。

## 通常stagingのwriter計測設定（2026-10-08 JST）

通常staging用configへRecoveryWriterCoordinatorの専用SQLite DO、内部binding、
計測selectorを追加した。scopeは独立readbackしたBusiness/Auth/Master D1と
avatars/covers R2のidentity集合から導出する。通知DOとHTTP/Cronは既存の共通
wrapperでenter/leaveを記録する。停止selectorとpublic操作routeは追加しない。

設定前に現行Workerと既存全表hash/Auth3・7・2/FK0を照合した。実配備と
計測readbackはこのcheckpointでは未実行。件数0だけではbackup整合点とせず、
初回の旧writer終了、外部writerの停止・lease、owner付きfenceとcollector、
運用方針の採用は引き続き別条件とする。

通知単独rehearsalのfixtureは、通常configから独立した通知DOだけを選ぶ。
計測selector/scope/停止flagが残る場合はrehearsalのguardが拒否する。
初回CI37747859530ではfixtureが通常configの新DOを引き継いで2件失敗した。
このprojectionと混入拒否を修正し、selector coverageと合わせてlocal9件成功。
通常アプリの計測設定を拒否するものではなく、旧単独rehearsalの分離境界である。

local全migration-data試験では、同じ旧config projectionを使うexpiry/archiveの
3件も不一致になった。3つの単独rehearsal fixtureを同じ分離境界へ揃え、
legacy Cronでも計測設定の混入を拒否する。修正後のlocal307件が成功した。
招待登録とeditorのlocal fixtureもmainのscope/selectorを引き継がず、
各試験のowned storeだけを使う構成を保持する。

## 通常stagingの処理件数計測を有効化（2026-10-08 JST）

候補450ec08/[CI37748771478](https://github.com/kanouk/fanmark-id/actions/runs/37748771478)は
アプリ・Worker両job成功。通常Workerを`1071896f-7e6c-4218-818d-6b1eceeea9f3`へ一度配備し、
内部SQLite DOと計測selectorを追加した。元の通知namespace/全bindingと公開6 assetを保持。
並行catalog GET6件でactive6を観測し、完了後0へ戻った。専用合成actorのsignin/
authenticated session/signoutとexact-owned cleanup後も0。同versionに絞ったLive Tailで
自然の毎分Cronがoutcome=ok/例外0と確認し、tailを終了した。追加メールは0。

一時検査Workerの初回HTTP assertはstatusを保存しておらず再構成しない。
検査Workerだけ再配備した後、同じURLの404→401を観測し、同じmainの検査を再開した。
一時Workerとfixtureは除去済み。別Read processで既存全表hash、Auth3・7・2、
Business79/Auth10/Master25表、FK0、設定/namespaceを照合した。
[限定受け入れ](evidence/staging-writer-tracking-2026-10-08.json)。

停止flagは未設定、owner=null/drained=falseのまま。これは計測有効化と対象処理の
終了確認であり、初回旧writer終了/外部writer lease/owner付き停止/整合capture/定期backup
採用の証拠ではない。source・provider・運用方針・実端末/最終統合の残件と、
実ユーザー移送・ドメインを最後にする範囲は保持する。

## 通常stagingへ無効状態で配備（2026-10-09 JST）

`b32fb9c`/[CI37810140113](https://github.com/kanouk/fanmark-id/actions/runs/37810140113)は
アプリ・Worker両job成功。通常Workerを`79e75f89-8121-4d4a-8ec0-1df4f9f94383`へ配備した。
バックアップbinding・version metadata・新規archive keyを追加し、既存binding/secret名・
D1/R2・DO namespaceを保持した。SDK鍵は変更せず、内部RPCの暗号化escrowを実際に
復号/hash検証してMacキーチェーンとVaultへ保存・読み戻した。鍵/元のSDK秘密値を
HTTP routerやR2へ公開していない。

`fanmark-backup-staging`はservice bindingを持つが、daily selectorはdisabled、Cronは0。
通常Workerのcapture admissionはpendingのまま。内部statusでは実version/key ID/
source identity/schema/scopeが一致し、ownerなし・**active27・drained=false**を観測した。
27件が現在も処理しているのか、終了応答が不明なのかは未判定。数だけで削除/失効しない。
最初のprivate検査がactive0を期待して止まったため、status観測とcaptureの終了条件を
分けた。実アプリの停止/整合captureの受け入れは行っていない。

別の読み取り専用processで既存の全表hash・Auth3/7/2・FK0・公開6 asset・全DO namespaceを
保持照合し、一時probeの除去とscheduler Cron0を確認した。配備前のprivate検査では
既知のSPA routeへHTML Acceptを付けず404になり、正しいheaderで同一hashを確認後に
配備した。新probe配備後の最初の検査失敗ではHTTP statusを保存していないため、
具体的な失敗statusや原因を再構成しない。同じ配備済みprobeを独立照合して再開し、
app/probe配備・secret登録・鍵取得を重複していない。

Macがロックされ、Safariの旧接続確認はproviderに拒否された。手動unlockを依頼済み。
未終了ticket27の調査、旧writer/外部writerの終了確認、最初の実source archiveと同じ
運用鍵によるisolated remote復旧、定期Cron・失敗監視が残る。実スマホも未確認。
[配備・鍵保管の限定証拠](evidence/staging-backup-provision-2026-10-09.json)。

## ロック解除後の調査と終了通知の保護（2026-10-09 JST）

Safariの開いているウインドウはスタートページ1件で、現在のタブも1件。
接続済みChrome/in-app browserにもアプリoriginを開いたタブはなかった。
閲覧履歴の候補は接続中タブとして数えない。この確認はブラウザの現在状態の確認であり、
Cloudflareの旧処理全件の終了証明ではない。

通常main `79e75f89`の内部RPCを新しい読み取り専用probeから観測した。
idle時active30、認証ok/capabilitiesの完了後30、未認証get-session後31、root完了後30。
一時的な31から30への戻りを確認したが、今回のHTTPと減ったticketの対応は未記録。
前回27から30への増加原因や、残る30件の処理状態は未判定。probeは削除・独立確認済み。
初回probeはassertで停止したがHTTP status未保存のため原因を推定しない。
2回目は別journalで新規作成し、最初の無認可アクセス401と認可status200を保存した。

HTTP/Cron入口の`withRecoveryWriter`は、enterから処理・後続wake・leaveまでの同じpromiseを
`ctx.waitUntil`に登録してからawaitする。これによりHTTP切断時もプラットフォームの猶予内で
終了通知を続けられる。HTTPの猶予は最大30秒で、完了保証や長時間処理の終了証明ではない。
DO自身はpending I/Oで存続するため、DOのwaitUntilを追加しない。
[Cloudflare context契約](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil)。

新しいticketはDO側開始時刻と呼出元runtimeRevisionを持つ。inspectは最大1001件を集計し、
1000件超ではcomplete=falseを返す。旧boolean ticketをlegacyとして区別し、IDやrequest内容を
返さない。既存記録は保持し、経過時間・runtime変更・ブラウザ閉鎖でexpireしない。
既存記録の原因調査と実archive/isolated復旧・Cron/監視の受け入れは残る。
local nativeの終了追跡8件、通知21件、バックアップ11件、停止/Cron16件を確認した。
この節の新しいコードのremote配備・帰属観測は、後続の結果を確認するまで未受け入れ。

### 同じコードのnative配備・独立照合

`e53558b`/[CI37856413174](https://github.com/kanouk/fanmark-id/actions/runs/37856413174)は
アプリ・Worker両job成功。mainは`97826bff-6d43-49d2-bd4e-8ffb7f1a328e`を100%配信。
配備直前active34。配備後、認証ok/capabilities/未認証session/root/index/checkout戻り先/
Service Worker/cache-clearの8種類のGETとidle観測で、legacy34・attributed0が続いた。
旧記録を消しておらず、新しい未終了ticketはこの観測で残らなかった。開始時刻/versionを
持つnative実処理の途中観測や、切断時の終了継続のremote再現は今回の範囲に含めない。
開始・leave遅延中のcontext登録と旧形式保持は前述のlocal nativeで検証した。

配備後guardがbindingのJSON項目順を差分と判定した。値を名前順に独立照合し直し、
全111 bindingと2 DO namespace、既存全表hash、Auth3/7/2・FK0を保持確認した。
配備は1回のみ。最初と独立観測用のprobeはそれぞれ削除・inventory照合済み。
配備前の同version Live Tailは自然の毎分Cron1件とenter/leaveが各outcome=ok、例外0。
これは旧記録34件の終了・原因を証明しない。capture admission pending、backup Cron0、
実source backup未実行を保持する。
[限定証拠](evidence/staging-writer-lifecycle-remote-2026-10-09.json)。

### 2026-10-09: fresh staging scope candidate

帰属不明の旧ticket34件は保持する。旧5 storeの終了を証明できないため、新しい
Business/Auth/Master D1とavatar/cover R2の全5 storeを別に作成した。censusだけの
交換ではない。旧resource/namespaceは削除せず、旧runtimeのbindingから新storeへ
書き込めない構成にする。新しい通知・writer DOはV2 classの別namespaceを使う。
通知DOは自分のobject IDと現在選択されたnamespaceの固定object IDを照合し、
旧namespaceのfetch/alarmは新Businessに触れない。writer DOも同じ照合で拒否する。
新scopeの最初のアプリ処理から追跡を有効にする。旧ticketの終了確認には換算しない。

新Authは全4 migration・ユーザー/session0、新Businessは全27 migration・許可した
共通6表106行のみ、新Masterは保存済み暗号化マスター25表12,254行から初期化した。
旧Masterとの全行照合、共通設定の全行hash、FK0、account/resource identity、
既存全表保持を独立確認した。system_settingsは20keyのallowlistと非公開Price ID設定を
保持し、Authや利用者行をコピーしない。旧ステージング認証/利用者データは旧DBに残る。
新AuthではWranglerが六つのMFA triggerの`begin`を`BEGIN`で保存した。その他のSQLと
全object identityの一致を確認し、新Authの実DDL hashを個別にpinした。

初回initializerのGET/statusは404で停止し、POST前・新Master空を確認した。
別journalから空の新Masterだけを初期化し、12,254行のreceipt/readbackを照合した。
一時initializerは削除済み。共通seedもtransport method名の誤りで書込前に停止し、
空のtargetと旧全表保持を確認後、別journalの6 bounded batchで完了した。
source archiveの初回運用保存、同鍵の隔離復旧、定期Cron/監視はまだ未受け入れ。
現行mainは97826bffの旧scopeのまま。新configは配備前のcandidateで、admissionは
pending・backup Cron0を保持する。CI後の新scope配備と独立readbackを先に行う。
[candidate evidence](evidence/staging-resource-scope-v2-candidate-2026-10-09.json)。

新scope用の読み取り専用監視も3 D1の固定ID/Business名を更新した。実配備が旧scopeの
間はremote binding guardで停止し、旧Businessを新scopeの健全性として報告しない。
actual commandの5回帰で異なるbindingのquery前拒否・書込receipt拒否・資格情報不足時の
CLI fallback禁止・新BusinessだけのSELECTを確認した。実monitor readbackは配備後に行う。

最初の新scope CI37865665138では、旧fixtureを現行configから複製していた6 assertionsが
DB/class/incarnationの差で失敗した。旧rehearsal guardは緩めず、3 guard試験のfixtureを
元の3 DB/通知classへ明示的に戻し、現行selector試験だけ新incarnationをpinした。
現行configのlegacy rehearsal拒否は保持する。全migration-data307件がlocalで成功した。

### 2026-10-09: fresh scopeの実配備・初回運用保存と隔離復旧

205b168/[CI37866060471](https://github.com/kanouk/fanmark-id/actions/runs/37866060471)は
両job成功。新5 store/V2 namespaceをa8e55756へ配備し、全binding・旧namespace保持・
公開6 asset・7回の内部状態と6 GETを照合した。新scopeのlegacy/未終了ticketは0、
旧全表hash/Auth3・7・2は保持。probeは除去済み。旧ticket34を終了・削除していない。
別Workerに新5 storeへのbindingがないこととbootstrap終了を確認後、admissionだけを
採用した1b57012dへ配備。mainの実configとチェックイン済みconfigをwriters-verified-v1へ
揃えた。旧scopeにこのadmissionを適用しない。rollback configは旧store/classとpending
admissionを選び、V2 migration/namespaceも保持する形でprivateに保存した。

UTC2026-10-09のconditional claim/owner停止で、共通collectorによる全5 storeの2回capture・
暗号化保存・読戻し/復号/各hash・owner解除を実行。保存は8.56秒、6,739,307 bytes。
同じR2保存物と、Keychain/Vaultで一致する採用鍵/SDK escrowから別3D1/2R2へ復旧した。
復旧は14,591ms、全store hash一致、FK0、session/assurance/verification0。
独立したprocessで暗号化ファイルを開き、Auth9/Business80/Master25の全回復表をRESTで
読み戻して行数/全行hashを照合した。別readonly WorkerでR2の空集合と保存archiveの
exact hash/bytesを照合し、所有したtarget3D1/3R2と全operator/probeを削除した。
復旧前のinventory・旧全表hash・main versionを保持確認。source archiveとprivate fileは保持。

保存元のAuth user/credential/sessionは0、画像R2も空。今回の運用鍵を使う実保存/復旧は
マスター/共通設定と空のAuth/画像領域での受け入れであり、実Supabase利用者・既存の
認証情報/画像を復旧した証拠にはしない。復旧時の失効選択は採用したが、非ゼロの
失効/SDK再ログインは既存のlocal合成/隔離証拠と区別する。14.6秒を本番RTO保証にしない。

読み取り専用監視tokenで新Business27 ledger/FK0/queue等のattention0と公開200を確認した。
定期backup Workerの実Cronはまだ0。日次候補は09:05 JST（5 0 UTC）へ変更した。
00:00 UTCのlifecycle batchと分け、今回00:56 UTCの初回保存から次のUTC日付00:05への
間隔を24時間未満にするためで、同UTC slotの再実行はしない。local backup11件成功。
自然の定期実行、失敗通知/担当者への実通知、残るprovider/端末の最終統合は未受け入れ。
[限定native結果](evidence/staging-resource-scope-v2-operational-2026-10-09.json)。


### 2026-10-09: 日次失敗・保存漏れの監視候補

保存は09:05 JST、別monitorは毎時35分。monitorは復号鍵とsource DB/画像bindingを持たず、
非公開backup R2のreceipt/HEADだけを確認する。保存失敗、未完了、日次receipt欠落、
source/schema/key ID違い、停止未解除、24時間超過、archive欠落/容量差、期限処理の
未完了を区別する。通知専用service bindingは保存/期限処理/status/鍵escrowを呼べない。日次期限処理のsettled結果をreceiptへ追記し、通知の失敗やscheduler
の中断後もmonitorから未完了を検出できる。通常HTTPから操作口を呼べない。

mainの通知専用`StagingBackupAlertService`から既存Resendで、本人許可済みの番号付き宛先
`fanmark.id+staging-test05@gmail.com`へ静的な状態/日付だけを通知する。scope/date/code単位の
R2 conditional claimでprovider requestを一度に限定。ACK不明なら自動再送せず、operator
の調査が必要。同じ正常日付の定期メールは送らない。provider-acceptedはdelivery/受信と
別に確認する。monitor自体/Cloudflare/R2/service/Resend全体の障害ではこの経路だけの
通知保証はない。alertの失敗記録は30日archive削除の対象外で、手動調査まで保持する。

local native22件で保存/復旧/期限処理とmonitor/通知の欠落検知・identity/30分境界/24時間・
重複抑止・claim/provider ACK喪失・失敗秘匿を確認。schedule guard12件、Worker typecheck/
lintを確認する。通常mainは1b57012d、既存backup schedulerはdisabled/Cron0のまま。
新monitor configもdisabled/Cron0。実環境での再配備・当日保存への期限処理追記・通知
経路の実配送/受信・定期運用・自然Cronは、このlocal候補証拠に含めない。

運用化後の停止はdaily/monitorのselectorをdisabled、Cronを空に戻し、mainのalert selectorも
disabledへ戻す。archive・鍵・claim・未終了ownerはその操作で削除しない。過去のruntimeへ
戻す場合もV2 namespaceのmigration履歴を保つ。

### 2026-10-09: 実配備・通知受信・日次/毎時の登録を受け入れ

前節の未配備候補をc1cc1e2/CI37869826082両job成功後に採用した。mainは98160d0f。
既存111 bindingの値を保ち、alert selector/固定宛先の2 bindingだけを追加した。
同じUTC10/09 archiveへ30日期限処理のsettled receiptを追加（削除0件）し、保存を再実行せず、
監視evaluatorの正常判定を確認した。通知専用内部RPCからdelivery-testを1回送信し、
Resend署名sent/deliveredの同じprovider IDと本人の「来てます」を確認した。
これは通知経路の受け入れであり、実backup故障を誘発した証拠ではない。

monitorを先に、その後dailyを登録。dailyは`daily-v1`/`5 0 * * *`、monitorは
`hourly-v1`/`35 * * * *`。独立読取で各100% version、全binding/周期、workers.devとpreviewの
無効を照合した。mainの既存secret/4 namespace/6 asset、旧全表hashを保持し、新sourceは
この通知の署名event2件だけを許容して他の全表hashを照合した。temporary operatorは削除。
canonical configも実登録へ合わせた。自然monitor/dailyは未確認。次の自然dailyは
UTC10/10 00:05（09:05 JST）予定。UTC10/09 captureを再送しない。

[限定証拠](evidence/staging-backup-monitor-adoption-native-2026-10-09.json)。
保存元Auth/画像が空という初回復旧の範囲は変わらない。広域障害・本番RPO/RTO保証・
Vault遠隔Sync・残るprovider/実端末と最終統合まで完了したとは扱わない。
