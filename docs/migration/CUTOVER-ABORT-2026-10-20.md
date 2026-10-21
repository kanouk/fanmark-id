> 履歴・当時の実証記録。現行の入口は[運用](../operations/README.md)と[最終確認状態](../operations/current-state.md)。本文中の「現在」「次の工程」や未マージ/未切替は当時の状態。完了済みhelperを再実行しない。

# 2026-10-20 本番移送の中止と旧環境の復旧

**このrunを再開しない。移行先は恒久quarantine済みで、本番移行は完了していない。**
G2のMaster途中で未確定書込みが生じたためG3以降へ進まず、旧Supabaseの復旧を実施した。
復旧の最終時刻・公開確認は本票末尾と証拠JSONを参照する。

## 実施した範囲

- 所有者のWorker Route方式での実行指示と、外部writerなし・本人操作停止の回答を確認した。
- 実行HEADは`8e616e23462104a7a10882f160f5a0171164f2fa`。
  [CI39278517048](https://github.com/kanouk/fanmark-id/actions/runs/39278517048)は両job成功。
  閉鎖appはsource `9a2a740` / version `fbf9f7cd-9927-41ad-8258-dd442c25f358`を保持した。
- G0でsource35関数の原本・Cron・秘密値digest、target全設定・空store、DNS17件、
  証明書・Route競合・利用枠、保存MFA票の最新source一致を再確認した。
- 08:26:52 JSTにG1を開始。旧34関数をmaintenance、Stripeを署名検証付き保存専用へ変更し、
  Cronを停止、71 relationを凍結した。直接REST/Auth/Storageの拒否と原内容保持、
  37実行の終了、DB・外部決済・送信の境界を照合した。
- 凍結後に40 public table、Auth、109画像、seal済み通知streamの最終保存と暗号化往復を確認。
  解約済み自己テスト契約は保持。保存通知・配送は0件だった。
- G2でAuthのatomic batch 1件とMasterの123 batchがACK済み。
  Masterの次の1 batchがlocal/remoteともpendingとなり、一括runnerが停止した。
  Business・avatars・coversの書込みは0件。移送後backup/G3は未実施。
- Worker Route・DNS・本番Webhook登録・G5本人確認・新業務writer・新Cronは開始していない。
  `main`は`e5a553c0bcc938a308def6f3770f1a84db88d389`のまま。

## 未確定操作と原因の限界

runは`bf22744d-e772-4e9e-99c7-e07020b9594c`。
未確定操作は`aa52ba01-5b54-42e6-9499-654578cc3657`、batch SHA-256は
`876406c8a0dd8f87745962d2f8c28a12ca65cf1d01c03738cd386eb656ba25f9`。
同じsnapshotからSQLを送信せずに再構成し、emoji release stagingの44番目、ordinal2151〜2200、
50 statement / 24,847 bytesと一致した。request size上限への到達ではない。

停止後の独立GETでCloudflare管理APIの401/code10000を観測した。
同じ既存Wrangler profileの通常の認証更新後は読取りが成功した。
長時間保持したOAuth access tokenの失効が原因と考えられるが、失敗した書込み要求そのものの
HTTP statusは元transportが破棄していたため、その要求の原因を確定したとは扱わない。
読取り診断でのcompound SELECT上限（400/code7500）は別の事象で、診断SQLをscalar subqueryに
変更して確認した。元の書込みを再送して原因を調べていない。

09:11頃の読取りではcanonical emoji3944、staging2150、公開activation0、reference release0。
これは観測時の部分状態であり、未確定操作を未保存・成功・取消済みに確定する証拠にはしない。

## 恒久封鎖と復旧で保持したもの

終了した同一端末/PIDのexecutor、元5 journal、source evidence hash、全incarnationと遠隔の全ACKを
照合し、`quarantineProductionImportExecution`を一度だけ実施。別inspectでproofと元stateを照合した。
遠隔active0・ACK124・Master pending1、executor・fence・部分データを保持している。
以後、このrunへのclaim/begin/ACK補修/complete/fence解除は拒否される。
一時import/read-only gatewayは所有version確認後に削除し、Worker inventoryを8へ戻した。
元のapp/他7 Worker設定、公開route0、旧DNS17件を保持した。

旧側の再開前には以下を別の読取りで確認した。

- 40 public tableの全row stream/PK hash・sequence・catalogが凍結時snapshotと一致。
- Authの全ユーザー・identity・factor・roleが凍結時の暗号化原本と一致。
- 109画像の全bytes・key・metadataが一致。
- seal済み通知streamの全内容が一致し、receipt/delivery0。
  新receiverは一度も開いておらず、通知の逆送・再送・一括適用は不要だった。
- Stripe live/testの未完了効果は開始時の分類と一致。過去sandboxの未送信intent5件は保持。
  Resendの送信中効果なし。メール・請求・返金・イベント再送は実施していない。

保存済みrun-bound逆SQLで受信streamをreopenし、DB freezeを解除。
75 relationと元の権限を再照合した。35関数は各関数専用の保存原本から一度ずつ復元し、
JWT設定・ID・version増分と他関数不変を確認、別downloadでentryと参照依存fileを照合する。
`manual-expire-grace-licenses`のDocker原本に付属した未参照shared file2件は保存したまま。
entryの全byte一致と、importが外部HTTPS2件のみであることを確認し、参照依存の欠落とは区別した。
download確認で止まった時点の17件は再配備せず、保存ACKと最新inventoryを照合して残りから続けた。

## 次回の開始条件

1. **今回の物理target世代を再利用しない。** 新しい専用5 storeと調停scope/namespaceへの
   identity更新、schema・全binding・閉鎖条件・鍵保管の適合性・backup/復旧を改めて検証する。
   元資源・archive・private journal・quarantine proofを削除/初期化しない。
2. 長時間処理の資格情報を開始時の文字列のまま保持しない。
   有効期限と必要な残存時間をwrite intent前に確認する供給方法を用意し、
   期限間際/期限切れ/更新失敗を隔離環境で検証する。401を受けた書込みの自動再送は認めない。
3. provider失敗の数値HTTP status/error codeを秘密やSQL値なしで保存し、失敗原因を切り分けられるようにする。
4. 復元により旧35関数のversionが増えている。次回G0の原本inventoryとsnapshotは新たに取得する。
   今回の凍結snapshotや旧versionを稼働再開後の最新値として流用しない。
5. MFA票は10月21日00:24:45 JSTまでの候補を保持する。旧Supabaseのfactorは変更していない。
   新factorは隔離されたAuthへコピーされたが、公開採用・本番ログインは未受入れ。
   次回に最新sourceとの一致/期限を検査し、必要な本人操作は独立準備を終えてから依頼する。
6. G0の停止枠と日次処理の時間帯を再確認する。再移行開始の合意後、G1以降の当日条件を再取得する。
   `main`のmergeと旧経路の整理は本番検証後。

private directoryは既存root配下の`production-cutover-2026-10-20/`。
元の`execute-g2-import.mjs`、各capture/停止/復旧helperをそのまま再実行しない。
`abort-*`も実行済みintent・ACK・独立読戻しを確認する。鍵、backup、OAuth callback、
承認済み1通の通知試験を作り直さず、`supabase/.temp/cli-latest`と解約済み契約を保持する。

## 復旧の最終確認

09:16:16 JSTに旧サイトの公開を再開、09:16:39 JSTに元Cronの復元を確認した。
公開停止は約49.4分。独立した最終読取りでも35関数/version/JWT、元Cron2件/active1、
freeze0、maintenance=false、受信差分0、解約済み契約1件、期限処理対象0を確認した。
旧トップとログイン画面をブラウザで表示し、認証API・公開avatar/coverの原bytesを確認。
本人のパスワード/MFAログインや所有者による業務更新の再試験は行っていない。
旧MFA・Auth設定・全Auth内容と関数原本を保持したことを、ログイン成功の証拠とは区別する。

元DNS17件全属性、targetの元全8 Worker設定、route/domain/Cron閉鎖を再照合した。
[秘密を含まない最終証拠](evidence/production-cutover-aborted-source-restored-2026-10-20.json)。
旧サイトは通常利用を再開できる。本番移行は未完了で、次回の新target準備とG0再確認が必要。
