**2026-10-20 再準備中:** [新cohort V2・期限管理と確定照合](RETRY-PREPARATION-2026-10-20.md)を優先する。旧Supabaseは稼働中。新5ストアのschema照合済み、閉鎖runtime/backup/CIの準備を進めている。実データ移送・旧側停止・Route/DNS切替・main mergeは次の所有者確認まで行わない。旧quarantineは解除しない。

# 2026-10-19再開・10月20日更新の本番移行準備

**10月20日朝の実移送は中止し、移行先の当該世代を恒久quarantineした。**
[最新の中止・旧環境復旧票](CUTOVER-ABORT-2026-10-20.md)を優先する。以下は実行開始前の準備記録。

停止時のRESUMEとHANDOFFの過去記録を上書きせず、準備時の状態をここへ固定する。
PR #41・`codex/cloudflare-api-preparation`・既存migration worktreeを継続する。
本番source停止・実利用者の移送・本番hostの接続変更・main mergeは未実施。

## 完了した準備と証拠の範囲

| 項目 | 状態と限界 |
| --- | --- |
| 未公開3commit | 元commitを保持して既存PRへpush。通常CLI認証が今回は成功。古いMCP publish bundleは使用しない |
| CI | runtime入力9a2a740の39258437749と、証拠更新7bce7efの39266284696はapp/Workerとも成功。後続の証拠更新はruntimeを再配備しない |
| 閉鎖app | source9a2a740を一度だけ配備。現versionは`fbf9f7cd-9927-41ad-8258-dd442c25f358`。secret15、本人確認disabled、receipt_only、backup admission pending、公開route/domain/Cron0・workers.dev/previews無効 |
| 全体の独立読戻し | 元DNS17件が全属性一致、他7 Worker設定不変、inventory8。writer0・ownerなし、固定5 store/schema/key ID一致。実画像一覧はavatars/coversとも0件 |
| 保持backupの再照合 | 新しいcaptureをせず、既存daily/manual暗号化archiveへ全114表の行・schema・FKを独立照合。新runtime fbf9f7cdでも再照合。移送後backupではない |
| Webhook | G4再確認・一度だけのPOST・応答先行暗号化・独立GET・unknown候補の読取り・遠隔custody・一度だけの秘密値設定と実binding HMAC照合を実装。実本番endpoint作成/鍵設定/署名付き配送はG4で行う |
| 部分移送の中止 | 同じ終了済みexecutor・全5 journal・元hashを照合して恒久quarantineする。pending/ACK/fenceを保持し、再送や停止解除を拒否。旧側への受信回収とsource復帰は別票 |
| HTTPS/alias | appのHTTP書込み拒否を配備。alias専用Workerは誘導disabledで閉鎖配備済み。実本番hostでは未接続 |
| DNS復旧/TLS | 専用hostで元A保持のRoute追加→trusted TLS/503/HTTP307→Route解除→A保持を実証し、所有物を全削除。旧17DNSを保持。証明書IDの読取りも完了 |
| OAuth | Google/Discord/Appleは既存保存を再実行せず保持。本人承認後に既存GitHub App3230369へ新callbackを追加・reload確認。4 providerの実本番ログインは当日 |
| 監視通知 | 本人承認の1通のみ送信。R2 receiptとResend message ID一致、delivered、対象Gmail受信トレイ・本文・署名元/TLS確認。通知設定をdisabled/宛先空へ復元し一時operator削除。定期Cronの自然実行は未検証 |
| 管理者MFAの事前登録 | 10月20日0:24 JSTに本人が再登録。暗号化票の保存/復号・最新source binding・一時native D1/Better Authでの新MFA fresh session・全Auth投影を独立確認。期限は10月21日0:24:45 JST。旧factor/鍵/期限切れ票を保持し、helperを終了。本番targetログインは移送後 |
| G5の本人確認経路 | 期限/配備版限定の署名cookieで本人だけが通常routerへ進み、一般503を保持する候補を追加。通常認証/MFA/writer/fenceを維持し、新user作成は閉じる。固定Resend署名受信もG5で確認する。CI成功・無効設定で閉鎖配備済み。実bindingでissuer拒否と一般4入口の503/no-storeを独立確認。本番での有効化は当日G5まで行わない |

[最新の閉鎖環境](evidence/production-owner-closed-runtime-2026-10-19.json)（[先行観測](evidence/production-resumed-closed-runtime-2026-10-19.json)） / [OAuth保存](evidence/production-oauth-callback-save-2026-10-19.json) /
[証明書](evidence/production-certificates-readback-2026-10-19.json) / [実通知](evidence/production-notification-delivery-2026-10-19.json) /
[管理者MFA保存確認](evidence/admin-reenrollment-verified-2026-10-20.json)。

`REFERENCE_MASTER_SERVICE_SECRET`は旧Supabase server-reference caller向けHTTP入口用で、
新本番の`ProductionEmojiMasterPublicationService`は使用しない。この旧callerを採用しない
現構成では未設定をunusedとして扱い、不要な秘密値を生成しない。新本番Webhook用2秘密値はG4後。

## 当日の準備票

切替候補は[旧Aを保持するWorker Route票](production-route-alternative.md)を推奨する。
Custom Domain方式の旧A再作成・apex NS共存の未実証を解決済みとしない。
G0で`routingMode=worker-route`と3つのexact pattern/Workerを承認・固定するまでは接続しない。
Custom Domainへ当日自動で切り替える経路は設けない。

1. 本人以外に依存しない準備を揃えた後、管理者MFAを10月20日に再登録・保存検証済み。
   当日は期限（10月21日0:24:45 JST）内かつ最終source binding一致を再確認する。期限切れや
   資格情報の変化なら本人の再登録が必要。保存票は当日の移行許可を代行しない。
2. G0で実施時刻・担当・経路方式・元inventory・旧sourceへの復帰限界を固定する。
3. 旧全入口の停止、drain、DB/Storage/Stripe/Resendの外部効果とreceipt境界を実確認する。
   稼働中の過去exportや準備時の件数を当日の確定snapshotとして使わない。
4. 最終exportと管理者capsule照合、5 store移送、G3独立全件照合、schema再固定、移送後backupを行う。
5. G4でapexだけをreceipt_onlyへ接続し、実TLS/503/no-storeを独立確認してWebhookを登録する。
   遠隔custody・実binding鍵一致・Stripe署名付きreceipt保存・旧側受信引継ぎを確認する。
6. G5進行を所有者が明示してから[本人確認モード](production-owner-acceptance.md)を有効にする。
   有効化を潜在的な新側write開始として記録し、前進復旧側へ移る。一般503を保持したままOAuth各subject/UUID、
   通常ログイン・管理者MFA、画像/保護URL、Resend署名受信を確認する。その後、一般write・dispatcher・Cron・
   監視・aliasを順序通り開け、実外部効果と自然実行を検証する。
7. 新側の業務write/外部副作用開始後はRoute削除だけで旧DBへ戻さず、閉鎖して前進復旧する。
   本番検証完了までmainを保持し、その後に旧配備経路を整理してmergeする。

## 再実行しないもの

- private `owner-runtime-9a2a740`のdeployは1回のみ。初回照合がJSONの項目順相違で停止した後、
  元upload ACKと独立GETから値/型の一致を確認してresultを保存済み。再配備しない。
  `runtime-status-after-owner-runtime`の一時operatorも削除済み。
- private `resumed-runtime-758641c`、`alias-closed-preparation`、`approved-alert-delivery`、
  `route-rehearsal-9369bd92-b7b5-449e-a874-b8f55362489a`のintent/journal/resultを保持する。
  helperの名前だけで再配備・再作成・再送しない。通知の同日delivery-test claimも保持する。
- appのversionが変わったのは実装配備と通知試験設定のenable/restoreによる。docs/operatorだけの
  後続commitでruntimeを再配備しない。通知試験の最初の停止からは同じjournalを続け、設定保存/
  operator作成/送信を重複していない。記録していなかった最初のunauth応答失敗原因は不明のまま。
- 2026-10-19日次backup slot、既存archive/receipt、鍵、解約済み自己テスト契約を保持する。
  課金・返金・過去イベント再送は行わない。`supabase/.temp/cli-latest`の既存変更も保持する。

- 管理者MFAの10月20日保存済み票を上書き・再登録しない。最初の20分画面は期限切れ/票なしを
  確認してから、本人の更新指示で次の試行へ進んだ。両記録と旧10月16日票を保持する。

独立して進める準備とMFAの事前登録は完了。これらだけでは`productionReady=true`にしない。
残るのは[当日の開始票](CUTOVER-ENTRY-2026-10-20.md)に列挙した所有者の開始判断とG0〜G5の実受入れ。
