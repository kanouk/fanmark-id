**2026-10-20 再準備中:** [新cohort V2・期限管理と確定照合](RETRY-PREPARATION-2026-10-20.md)を優先する。旧Supabaseは稼働中。新5ストアのschema照合済み、閉鎖runtime/backup/CIの準備を進めている。実データ移送・旧側停止・Route/DNS切替・main mergeは次の所有者確認まで行わない。旧quarantineは解除しない。

# 2026-10-20 本番移行の開始前確認票

**同日朝の実行はG2 Master途中で中止し、当該target世代を恒久quarantineした。**
[最新の中止・旧環境復旧票](CUTOVER-ABORT-2026-10-20.md)を優先する。
本票の空target・未移送・未停止という記述は実行開始前の履歴。元runを再開しない。

事前の実装・検査・閉鎖配備・外部設定の準備と、最後の管理者MFA登録を完了した。
本票は当日の実行許可や停止済み証拠ではない。旧Supabaseが引き続き正で、実利用者の
本番target投入・本番host接続変更・一般公開・main mergeは未実施。

## 固定済みの準備

- 継続先はPR #41 / `codex/cloudflare-api-preparation` / 既存migration worktree。
- 閉鎖appはsource `9a2a7400669bec97c52f39491e3743d79c5d8d19`、version
  `fbf9f7cd-9927-41ad-8258-dd442c25f358`。runtime CI39258437749と証拠更新CI39266284696は両job成功。
  後続docs-only commitで再配備しない。最新headのCIはPRで別途確認する。
- appはowner backend disabled、`receipt_only`、backup admission pending、通知disabled。
  app/alias/scheduler/monitorの公開route/Custom Domain/Cron0、workers.dev/previews無効。
  元DNS17件・他7 Worker設定を保持。これらは準備時の観測で、G0で再取得する。
- 管理者票は10月20日00:24:45 JSTの本人登録に結び付く。
  **期限は10月21日00:24:45 JST**。最新source bindingと全Auth投影を独立検証済み。
  旧factorを保持し、新factorは本番target未投入。期限超過やcredential/identity/role変化なら再登録する。
  本番停止後の最終snapshotに同じ票を再照合する。[証拠](evidence/admin-reenrollment-verified-2026-10-20.json)。

| 項目 | 事前準備の根拠 | 当日、準備証拠で代用しないもの |
| --- | --- | --- |
| P1 資源・閉鎖 | [実runtime/全設定/一般4入口・issuer拒否](evidence/production-owner-closed-runtime-2026-10-19.json)、専用3D1/2画像R2/backup、15秘密値、alias/監視Worker | 最新commit/配備100%/全binding・公開経路・容量・鍵の到達性 |
| P2 移送・復旧 | [一括runner/checker](initial-import-set.md)、[atomic Auth](evidence/atomic-auth-import-recovery-2026-10-19.json)、[部分移送の復旧と恒久quarantine](production-import-recovery.md) | 1つの確定snapshot、全batch/journal、未知ACK0、別processによる全件照合 |
| P3 旧側停止 | [停止/再開票](source-stop-and-resume.md)、[実資源に照合した停止候補](evidence/source-stop-preparation-2026-10-19.json)、[Edge候補](evidence/source-edge-preparation-2026-10-19.json)と隔離試験 | 実停止、全入口拒否、開始済み処理のdrain、実行中0/全件照合、外部副作用の境界 |
| P4 決済受信 | [一度だけの登録・鍵保管・設定](production-webhook-activation.md)、[旧受信の移送/逆回収](stripe-receipt-transfer.md) | 実provider全inventory、新旧receiver最終境界、署名付き実receipt、処理済み/未処理と外部決済の照合 |
| P5 Auth/MFA | UUID/subjectを維持するAuth変換と今回の暗号化MFA票、旧session非投影 | 期限内・最終source一致、本番targetでの本人ログイン/管理者MFA、未知identityを作らないこと |
| P6 URL/TLS | [3 Route候補と逆操作](production-route-alternative.md)、[専用hostでのTLS/逆操作](evidence/isolated-route-reversal-tls-2026-10-19.json)、[4 callback保存](evidence/production-oauth-callback-save-2026-10-19.json)、[証明書ID](evidence/production-certificates-readback-2026-10-19.json) | 所有者による方式確定、最新DNS/Route/WAF/TLS/利用枠、実apex/alias・別回線・旧PWA/保護URL |
| P7 backup/監視 | [本番資源から隔離復旧](evidence/production-operational-backup-restore-2026-10-19.json)、[遠隔鍵保管](evidence/production-key-custody-2026-10-19.json)、保持archiveへ初期target全114表照合、[試験1通の実到達](evidence/production-notification-delivery-2026-10-19.json) | 移送後schema pin/実データbackup、公開後の実日次/監視Cron、更新/外部副作用を回収できる復旧点 |
| P8 リハーサル・実行票 | [稼働中sourceの予備コピー](evidence/real-precopy-rehearsal-2026-10-16.json)、隔離import/復旧・実画像配信、各操作票と独立読戻し | 確定snapshotと最新実行値、停止枠/担当の合意、実本番の移送/切替時間。予備結果を停止時間保証へ換算しない |

## G0で所有者と固定する値

1. 実施時刻、担当、停止枠と延長/延期判断、RPO/RTOの目標と測定の限界。
   計画の2時間・拘束3時間は暫定案で、保証ではない。
2. 推奨の `routingMode=worker-route` と、apex→app、www/admin→aliasのexact3 pattern。
   元Aを保持する。Custom Domainへ当日自動変更しない。方式は所有者の確認後に固定する。
3. 最新成功commit/各配備版、source/target ID、原本inventoryと全schema/key pin、各run/operation票、
   独立照合者、秘密の供給元。既存鍵・backup・journalを先に読み、helperを名前だけで再実行しない。
4. source全入口/人手管理操作/外部callerの停止担当と外部効果の終了確認、旧receiverの受信継続と
   dispatcher停止、最終export・画像・Auth・受信streamの境界、実行中やACK不明が残った場合の停止条件。
5. 旧側復帰と前進復旧の限界。G5本人確認モードの有効化前に潜在的業務write開始を記録し、
   以後は旧DBへ戻さず新側を閉鎖して修復する。画面未訪問や一般503を「更新なし」の証拠にしない。

## 当日の順番と止める条件

[本番実行計画](production-cutover-plan.md)のG0〜G5を使う。
G1の停止/drain → G2確定snapshot/5 store移送 → G3独立照合・schema再固定・移送後backup →
G4のapex maintenance/TLS接続と新Webhook登録/遠隔custody/実binding鍵一致/受信引継ぎ →
G5の本人確認/実OAuth・MFA・Resend署名受信 → 一般write/dispatcher/通知/Cron/aliasの順に開く。

G4では画面/Authは503のまま。実画面/画像/保護URLと認証の受入れは一般503を保持する
[G5本人確認票](production-owner-acceptance.md)で行う。G5への進行は所有者が明示し、
モード有効化前に`potentialBusinessWritesStarted=true`と`sourceRevertForbidden=true`を保存する。

各段階で未知ACK・未説明差分・FK違反・未分類caller/外部効果・不正TLS・鍵不一致があれば次へ進まない。
provider作成POST/secret PUT/Route変更/backupの同じclaimを再送して解消しない。
新側業務開始前の中止でも、受信差分を回収・照合してから旧側権限/関数/Cronを復元する。

## 保存物と検証後の扱い

private rootは既存 `fanmark-cutover-2026-10-19`。現MFA票は
`administrator-reenrollment-after-preparation/attempt-2-2026-10-20/`配下。
旧10月16日票と最初の期限切れ試行を保持する。専用helperは保存検証後に終了済み。
QR・秘密・復旧コードを出力しない。現在の有効票を再登録で上書きしない。

Google/Discord/Apple/GitHub callback保存、試験メール1通、alias閉鎖配備、専用host検証、
既存の日次backup claimや鍵保管helperを再実行しない。解約済み自己テスト契約と
`supabase/.temp/cli-latest`の既存変更も保持する。
本番検証完了までmainを維持し、その後に旧デプロイ経路を整理してmergeする。
