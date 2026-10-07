# 全ストアをまとめる保存・復旧処理

`workers/api/src/recovery-set.ts`はAuth/Business/Master D1とavatars/cover-images R2を
`fanmark-recovery-set-v1`としてまとめる管理用coordinator。
`recovery-set-files.mjs`はhost側のprivate file保存/読込。router、Cron、運用鍵保管、
off-host transport、retentionを自動で設定する処理ではない。

## 保存点と鍵

- 呼出元は独立に信頼した3 schema hash、5 source identity、archive key ID、runtime revision、
  元のBetter Auth SDK secretを指定する。schema pinをarchiveから取得して自己承認しない。
- sourceの停止/drainを所有するtrusted adapterの`assertHeld(expectedIds)`が必須。
  guard IDと実際のlive objectを保持し、開始/各store/再取得/終了で確認する。booleanだけは
 受け付けない。再取得で全snapshot hashが異なる場合も完成archiveを返さない。
- guard callbackが存在するだけで実環境の停止を証明しない。adapterは実binding、runtime、
  writer停止/drainとleaseを照合する責任を持つ。local fixtureはAPI/jobなしのowned環境。
  **現行CUTOVER_WRITE_FREEZEはsignin/signout/TOTP/Stripe receiptを許可するため、
  このguardの採用済み実装とは扱わない。** writerが止まる実環境の方式は未採用。
- 5 componentは既存のAuth/Business/Master/R2 formatで個別にAES-256-GCM暗号化する。
  全componentのcipher hash/snapshot hashとsource/schema/key/runtime/guard情報を、小さい
  encrypted manifestへ結び付ける。同じkindの別archiveを混ぜても読込を拒否する。
- archive鍵とSDK secretのraw値は保存しない。元SDK secretがないとfactor等を戻せない。
  archive鍵の交換・過去keyとの対応・off-host保管は呼出元の運用方針に従う。
- Businessの現在プロフィールuser_idがAuth userに存在することも確認する。このチェックは
  任意の履歴・外部provider・全cross-store関係の包括的な照合ではない。

## private file

`saveRecoverySetFile(path, archive, context, key)`は全componentを検証してから、repo外の
本人所有0700 directoryへ0600一時fileを書きfsync、exclusive linkで完成fileを作る。
既存fileは置き換えない。commit後の不明な応答でも完成fileを削除せず、同じpathを確認する。
`readRecoverySetFile()`はsymlink拒否/owner/mode/size・読込中size一致を確認し、全体を検証する。

各partのJSONは128 MiB、合計part/fileは256 MiB、manifest暗号文は64 KiB上限。
leafごとの32 MiB等の上限も維持する。host側の上限であり、Worker128 MiB memoryや
本番最大容量のCPU/所要時間を受け入れた値ではない。JS string/objectの完全なmemory消去は
保証せず、crypto/file byte buffersの消去とprivate永続保存を分ける。

## 復旧と再開

`restoreRecoverySet()`は同じcontext/keyに加え、5 target identity、target隔離/drain guard、
明示mode/session policy、永続checkpoint用`progress` callbackを要求する。
source identityをtargetとして指定することと、重複target identityを拒否する。

1. manifestと全5 componentを認証/復号し、schema/SDK鍵/全hashを検証する。
2. 最初のwrite前に全targetを読み、`new-empty`なら空だけ、`resume-exact`ならD1全体の
   exact一致/R2全objectのexact subsetだけを許す。未知keyや異なるmetadataは全write前に拒否。
3. Master→Business→Auth→avatars→coversの順に、guardとcheckpointのstarted/verifiedを確認する。
   別D1/R2のcommitは単一transactionではない。失敗時は保存済みtargetを削除/巻き戻さない。
4. D1のcommit後ACK喪失では、再開時に全capture/hashを照合し、一致したD1を再INSERTしない。
   R2は不足分だけを条件付き作成する。checkpoint表示だけを完了判定に使わない。
5. 最後に全targetを取得し、選択したsession policyによるdesired hashが全て一致してから完了。
   結果にはcapture ID、適用したsession policyと復旧後のhashを残す。

`isolated-preserve`はisolatedFidelity=trueの試験だけ。
`revoke-local-sessions-and-challenges`はsession/mfaAssurance/verificationを戻さず、credential/
factor/role等を保持する。元archiveのAuth hashと失効後targetのhashは別で記録する。
全targetの照合が終わるまではアプリ/Cron/DO/provider dispatcherを閉じておく。

## 検証と残件

```sh
npm --prefix workers/api run test:recovery-set
```

native local D1（Business現行27、Auth4、Master8+historical Auth）/R2とprivate fileで6件。
guard拒否/live lease失効/観測したsource変化、別part混入/SDK鍵違い/既存file非上書き、
foreign R2による全D1無書込拒否、実Business commit後ACK喪失→exact D1 skip再開、
明示session/challenge失効とcredential bytes保持/FK0を確認する。
local R2 class欠落のみtest adapterで補完する。画像GET/HEADとreal Standard classは
先行R2単体のremote受け入れを参照し、この一式試験の新remote証拠とは扱わない。
Auth SDKの実signin/TOTPは既存leaf検証にあり、ここではcredentialのbytesを照合する。
[限定証拠](evidence/recovery-set-local-2026-10-08.json)。

旧source bundle v1/private combined v2と交換可能ではない。受け入れ済みの旧private runnerを
再実行してこの形式の証拠にしない。実Cloudflareの一式collector/適切な停止方式、運用鍵/
off-host/周期/retention/担当/RPO-RTO採用と最終運用構成は残る。実ユーザー移送とDNSは最後。

## 専用remote rehearsalの準備（2026-10-08）

`run-isolated-recovery-set.mjs`は固定account/40桁HEAD/同じCI両job・required stepの成功を
要求し、新規6 D1・5 R2・1 Workerだけを作成する。Business現行27/Auth4/Master8+legacy Auth
のschema pinはchecked-in migrationsの独立local runtimeから取得する。source初期化だけを
RESTの80 statement以内に分割し、復旧はnative Workerの単一batchを維持する。

Workerはアプリ/任意SQL/Cron/DO/provider経路を持たず、収集と復旧を別のone-shot claimで
所有する。全binding/Worker version/無Cronをhostで前後照合し、caller-owned isolated guardが
各store間で同じclaimを確認する。これは通常アプリのwriter停止/drain実装ではない。

収集した暗号化archiveをMacのprivate fileへexclusive保存し、全体を認証して読み直した
同じfileだけを別の空targetへ戻す。試験はsession/challenge失効を明示する。
不明なHTTP応答では同じjournal/statusを読み、collect/restoreを自動再送しない。
全owned resourceをidentity一致で片付け、前後inventoryの一致を確認する。未知objectや
進行中phaseを見つけたら削除を止める。one-off request/archive key fileはcleanup後に除去する。
鍵の永続運用・off-host/retention採用や、実ユーザーのbackupとしては扱わない。

```sh
node --experimental-strip-types scripts/migration/run-isolated-recovery-set.mjs <40-character-HEAD> <successful-CI-run>
# 不明な応答後は同じjournal directoryだけを再開する
node --experimental-strip-types scripts/migration/run-isolated-recovery-set.mjs <same-HEAD> <same-CI-run> --resume <private-directory>
```

通常CIのlocal/bundle合計8件と型検査が成功。bundleではprivate file→native全5 store、
別archive拒否、session失効、未認証/nonce/二重claim/処理中cleanup/未知key拒否を確認した。
local class補完はtestだけ。小さいfixtureのnative D1 query数は収集246・復旧623で、
[Paidのinvocation当たり1000件上限](https://developers.cloudflare.com/d1/platform/limits/)内。
全運用容量・全Master12,254行の一式capture・本番CPU/memory/RTOを証明しない。
[限定証拠](evidence/recovery-set-bundled-local-2026-10-08.json)。準備時点ではremote未実行だった。次節はその後の実行証拠。

## 実Cloudflareの限定受け入れ（2026-10-08）

99762af/[CI37649724810](https://github.com/kanouk/fanmark-id/actions/runs/37649724810)両job成功後、
新規6 D1/5 R2/Worker74b7fa6eで同じmodule/CLIを実行した。独立schema pinとnative bindingを
照合し、補完なしのStandard画像2件を含む全5 storeの収集→Macのprivate file→同じfileから
空targetへのnative復旧が成功。全desired hash/FK、session/challenge失効、credential bytes
保持を確認した。queryは収集246/復旧623で、各Worker invocationは1000以内だった。

全owned object/6 D1/5 R2/Workerを削除して前後inventory3/3/2が一致。one-off request/
archive key fileも除去。独立Read tokenと別Wrangler processでmain/元R2を確認した。
[限定証拠](evidence/recovery-set-isolated-remote-2026-10-08.json)。

新collectorのremote boundaryとfile復旧が受け入れ済みになった。小さい合成rowと画像の
試験で、全Master12,254行・最大容量の新collector captureや新Auth SDK loginを証明しない。
isolated guardはアプリ/SQL/Cron/DO経路のない新規owned環境だけ。通常アプリの停止/drain、
定期保存/off-host/運用鍵/retention/担当/RPO-RTO採用は残る。現存main storeへのwrite、
main runtime再配備、mail、source Supabase write、実ユーザー移送/DNSは行っていない。

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
既存CUTOVER_WRITE_FREEZEの認証・Stripe継続契約は維持する。

実Worker入口/Cronの16件とnative D1/DO alarmの21件、型検査が成功。新しいnative caseは
停止中のqueue全行/generationが同一、通知0件、次回alarm保持、解除後に2 eventが各1回
だけ配信されてalarmが消えることを確認した。synthetic local証拠で、remote停止/drainや
全体の運用復旧完了とは扱わない。

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

## 通常SDKと計測済みwriterのlocal接続

`test-application-writer-recovery.mjs`は、最初のrequestからcensusを選ぶ2つの新規アプリ
Worker/別DO namespaceに、現行schemaと合成credentialを置く。通常password login後に
source/targetをfenceし、owner/scope/active=0を検証するguardでprivate fileの収集・復旧を
実行。停止中のlogin拒否、session失効、同じSDK secretの旧cookie拒否と新しいpassword
login、解除後guard拒否を確認する。remote運用adapter/初回未計測writerのdrainを代替せず、
空R2・小さいMaster fixtureなので画像class/全Master容量は別の検証である。

## 実アプリ・全Masterのnative remote受け入れ（2026-10-08 JST）

`ad8f754`/CI37678533990の両job成功後、新規owned Cloudflare資源で通常SDK・別DO fence・
全Master12,254行・5ストアcollector・同じMac保存fileの復旧を受け入れた。旧session拒否、
新login、catalog3,944件/参照4・4・5・16件、hash/FK0と全資源cleanup/inventory一致を確認。
[限定証拠](evidence/application-recovery-transport-full-master-remote-2026-10-08.json)。
R2 data storeは空。通常mainへコードも反映したが停止/計測binding/selectorは未有効化。
[配備証拠](evidence/staging-native-recovery-runtime-rollout-2026-10-08.json)。
隔離runtime接続の残件は解消。main初回の旧writer終了、外部writer lease、容量と運用条件の
採用は残る。過去節の未接続/未配備は当時の記録として読み、この最新観測を優先する。
