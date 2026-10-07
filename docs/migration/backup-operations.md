# バックアップと復旧の現在の境界

2026-10-06のリポジトリ監査。実ユーザーデータの移送とドメイン切り替えは最後の別工程とする。
この文書は運用方針の採用や定期バックアップの有効化を記録するものではない。

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
local storage-class補完はremote受け入れではない。collector未接続、運用条件は下表の残件。

## 運用にするために残っていること

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
