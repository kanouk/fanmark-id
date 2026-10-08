# R2の保存・再開可能な復旧処理

`workers/api/src/r2-recovery.ts`は、既にCloudflareにあるavatars/cover-images bucket全体の
capture・AES-256-GCM保存/読込・空targetまたはexact subsetへの復旧を行う管理処理。
source Supabase Storageのexport/importとは別で、公開routerやcollectorには接続していない。

## 契約

- prefixで対象を狭めず、200件ずつ全bucketを列挙する。cursorの重複とobject重複を拒否。
  kindを明示し、avatars archiveをcover-imagesとして読込/復旧しない。
- 各画像のkey・全bytes・size・SHA-256・HTTP/custom metadata・storage classを保存。
  Unicode key、改行/literal、空objectも保持する。cacheExpiryはISO日時へ変換する。
  新targetでR2が発行するversion/uploaded/etagは元へ設定できず、保存内容の同一性とは分ける。
- listed etagによる条件付きGETとversion/uploaded/metadata照合、列挙前後の全identity一致を
  要求する。観測した変更は拒否するが、同時writeの停止や複数storeのatomic snapshotを
  保証する処理ではない。multipart未完了のupload、SSE-C objectはこの形式で保存しない。
- 最大1,000 object、各8 MiB、合計raw bytes20 MiB。超過は失敗し、一部だけを完成扱いに
  しない。metadataのJSON上限は各16 KiB。暗号文はGCM tagを含む32 MiB上限で、format/
  kind/object hashを認証。復号後も全bytes hashとmetadataを照合する。
- 復旧は明示modeが必須。`new-empty`は非空targetを拒否。`resume-exact`は既存全objectが
  保存内容のexact subsetであることを、最初のwrite前に照合して不足分だけを作る。
- PUTは`etagDoesNotMatch: '*'`とSHA-256を使う。既存objectを上書き/削除しない。
  writeの応答が失われても保存済みの内容を消去せず、再開時にhash・全metadataを読む。
  exactならそのversionを保持してskipし、異なるobject/未知keyはwrite前に拒否する。
- 最後に全bucketを再取得し、全object hashを確認。R2の複数writeは一つのtransactionでは
  ないため、途中失敗時は部分targetを保持しoperatorが状態を確認する。

条件付きGET/PUT、listとmetadataの契約は[Cloudflare Workers API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)。
R2個別操作の[整合性](https://developers.cloudflare.com/r2/reference/consistency/)を、D1/Auth/
Masterを含む一式の同時点保証へ拡張しない。

## 検証と残る境界

```sh
npm --prefix workers/api run test:r2-recovery
```

実local workerd R2でavatar3 object（PNG2件と空object）/cover1 object、Unicode key/metadata、2ページを
前後2回、暗号化往復、改変/鍵/別kind拒否、実アプリ画像GET/HEADを確認した。
同一内容の再開、異なるbytes/metadataや未知keyの無書込拒否、commit後ACK喪失から
不足2件だけの再開と保存済みversion不変、source変更/不正cursor拒否も確認する。

固定Miniflare5.20260918.0-alphaは明示Standard PUT後もstorageClassを空で返す。
local testはこの欠落fieldだけをStandardとして補うfixture adapterを使う。bytes・全HTTP/
custom metadata・条件付きwrite・paginationはnativeのまま。通常実装は未知classを拒否し、
productionでこの補完をしない。**この試験はremote storage classの受け入れではない。**

新しいremote R2復旧、保存先/鍵/off-host/retention、全ストアcollectorと整合した復旧点、
同一最終candidateの統合は残る。実ユーザーのStorage移送や公開domain/DNSは後工程。

## 実Worker内のmetadataと隔離remote runner（2026-10-08）

bundleしたnative workerd内では、HTTP metadataの未設定`contentEncoding`もenumerableな
`undefined`で返る。captureは既知の未設定fieldだけを省略し、未知keyや不正な定義済み値は
拒否する。従来のNode側binding proxyではこの違いを観測できなかった。

同じ通常CIコマンドは8件へ拡張。実bundleの無補完試験ではclass欠落を拒否し、再実行claim/
statusを保持する。全bucketの未知keyを見つけるとcleanupの最初の削除前に拒否する。
別のtest専用entrypointではclass fieldだけを補い、実Worker内のcapture/暗号化/両kind復旧/
画像GET・HEAD/ACK後再開/異なるmetadata拒否を確認した。
[限定証拠](evidence/r2-recovery-bundled-local-2026-10-08.json)。

`run-isolated-shared-r2-recovery.mjs`は固定account/正確なHEAD/両CI成功/clean checkoutを
前提に、専用7 R2 bucketと専用Workerを作る明示CLI。`isolated-shared-r2-recovery-worker.mjs`
にはclass補完を入れない。APIのbinding/version/resource creation identityとprivate journalを
照合し、Bearer tokenとnonceで実行を限定する。既存stagingへrouteやbindingを追加しない。

```sh
node scripts/migration/run-isolated-shared-r2-recovery.mjs <full-HEAD> <successful-CI-run>
# 不明な応答や観測timeoutは、同じjournalを読み取り再開する。POST /runは再送しない。
node scripts/migration/run-isolated-shared-r2-recovery.mjs <full-HEAD> <successful-CI-run> --resume <private-run-directory>
```

claimは条件付きcreateで1回に限定。同期requestの応答が不明ならstatusを取得し、未完了時は
resourcesを保持する。terminal receipt取得後のみ全bucketのowned keyを検証・削除し、
APIのbucket/Worker identityと消失、前後D1/R2/Worker inventory一致を確認する。
これは合成Standard objectの限定試験で、InfrequentAccess・容量上限のCPU/memory・
全ストアの整合した復旧点や定期運用を受け入れるものではない。remote実行結果は別途記録する。

## 実Cloudflareの限定受け入れ（2026-10-08）

候補fcd4812/CI37643375901の両job成功後、新規の7 bucket/専用Workerで、補完なしの
Standard classを確認した。実R2も未設定contentEncodingはundefinedで返り、今回の
既知optional fieldのみ省略する処理でcaptureと復旧が成功した。

avatar3/cover1の暗号化往復、全bytes/metadata、Unicode/空object、native画像GET・HEAD、
本物のPUT commit後に応答を捨てる注入→不足2件だけの再開とversion保持、異なるmetadata
を持つ既存objectへの無書込拒否、source不変の8項目を確認。
[限定証拠](evidence/r2-recovery-shared-remote-2026-10-08.json)。

全owned objectと7 bucket/Workerを削除し、元のD1/R2/Worker inventory（3/3/2）に戻った。
別CLIのbucket一覧と独立Read tokenのmain Worker17fdbf39/Business27/wake34/34/FK0/
queue滞留0/API200も一致。retained staging bucketへのwriteやapp runtime配備は0。

proof自体は約18秒、作成/配備/cleanupを含むone-off全体は約98秒だった。合成4 objectの
所要時間であり、実データ量や新規鍵/off-host/retentionによる運用RTOを保証しない。
InfrequentAccess/最大容量のCPU・memory/全ストア整合点/運用collectorの受け入れは別。

## R2の容量上限でメモリ超過を確認・修正候補（2026-10-08 JST）

通常stagingを保持し、新規7 bucket/専用Workerで8 MiB・8 MiB・4 MiBの合成objectを
扱った。補完なしStandardの合計20 MiB captureは通ったが、`open-maximum`で応答が
不明になり、同じscript/version・開始時刻のCloudflare監視データにexceededMemory1件を
確認した。未完了receiptを成功扱いにせず、呼出終了の確認後だけoperator failureを
記録し、同じjournalの読取再開で全owned資源を削除した。POSTの再送は0。
別Read processで元inventory・main全表hash/Auth3・7・2/FK0・設定/namespaceを保持照合。
[不合格の限定証拠と候補](evidence/r2-recovery-maximum-capacity-failure-2026-10-08.json)。

容量8/20 MiBとarchive v1を維持し、base64の巨大なbinary/canonical文字列コピーを
chunk処理に変更。immutableなpayload文字列を共有し、snapshot/metadata等のmutable
containerはコピーする。chunk境界・不正padding/pad bits/空白と呼出後input変更の拒否/
分離を加え、R2 9件・一式復旧16件・型/bundleとlocal実workerd20 MiB検証が通った。
修正候補の両CIと、新しい隔離remoteで同じ容量の受け入れはまだ必要。main再配備は0。
1000 object上限、InfrequentAccess、全ストア同時の最大容量/運用RTOへは拡張しない。
実ユーザー移送とdomainは最後の別工程、六項目と既存の回答待ちは維持する。
