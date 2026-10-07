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
