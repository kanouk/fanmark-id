# 取り込み済み画像参照のR2配信

Supabase public Storageの参照を保持した取り込み行を、Cloudflareアプリから
R2画像として表示する。実ユーザー行・既存objectの移送やDNS切替は行わない。

## 設定と経路

`STORAGE_BACKEND=r2`に加え、`STORAGE_LEGACY_ORIGIN`で置換対象の移行元origin、
`STORAGE_PUBLIC_BASE_URL`で配信先originを明示する。originはHTTPSまたは明示した
loopback HTTPで、path・認証情報・query・fragmentを含めない。
stagingの移行元は合成fixture用`https://synthetic-source.example.invalid`のみ。
実データ工程では対象Supabase projectのoriginを別途確定する。

`workers/api/src/storage-image-url.mjs`は、選択したoriginの
`/storage/v1/object/public/{avatars|cover-images}/{owner}/{key}`を
`{配信先origin}/api/storage/public/{bucket}/{owner}/{key}`へ対応させる。
本人プロフィール、ファンマ編集、公開プロフィール、password proof確認後の
プロフィール、管理者のユーザー詳細とOGPの公開プロフィール取得で共有する。
公開可否・session・管理者MFA・password proofの判定順序は維持する。

画像URLはAPIの読み取りDTOで対応させ、D1の取り込み済み行やsnapshotを書き換えない。
編集フォームが同じ画像の配信URLを返した場合、元の保存URLを保持して保存する。
新しい画像参照には既存の所有者検査を適用する。
これにより変更していない画像の保存がsnapshot照合の差分にならない。

timestamp filename、nested key、Unicodeを保持し、一度だけdecodeしてsegmentごとに
encodeする。dot traversal、encoded slash、control文字、異なるbucket、query付き
signed URL、transform URLは拒否する。対象origin以外の画像URLは保持する。
元Supabaseへ画像を取りに行くfallbackはない。

frontendの削除clientは所有者一致・同じ配信origin・安全なkeyを確認し、
取り込み済みのtimestamp/nested filenameも削除できる。新規uploadの応答は
引き続きサーバー発行のUUID filenameを必須にする。

## 合成データによる受け入れ

2026-10-03、現在の25 Business/4 Auth migrationと実session/R2による本人avatar
試験11件、owner fanmark profile10件、public profile15件、protected profile11件、
mapping unit5件、storage client8件が成功。public/privateとpassword proofの境界、
変更しない保存時の元参照保持、別所有者のsource画像の拒否を確認した。
combined recoveryは共通mapperで取り込み行のURLを解決し、実Storage APIの
GET/HEADとbytes/MIME/sizeを確認して成功した。
Worker/application typecheck、変更ファイルlintは成功。
`public-access.ts`の既存control-regex診断2件は変更前と同一で追加診断0件。

`npm run test:staging-profile-editor-local`では、独立したlocal Worker・分離D1/R2、
実Chrome・実ログイン・実APIを使用した。元参照がSupabase形式の合成avatar/coverを
R2へ配置し、編集画面と公開`/a/:shortId`の両画像がdecodeされることを確認した。
失敗した保存→再読込→再試行の後も元画像参照を保持し、既存keyのowner DELETEは204。
元originへブラウザが画像を要求していないことも確認した。
390px viewportであり、実スマホの証拠ではない。
local server停止・loopback port閉鎖・local DB state削除も確認した。

private report: `/var/folders/c4/_087tnms6n95sb58l4rg8vpw0000gn/T/fanmark-local-editor-compose-jWoDHE/report.json`。
同directoryの`imported-images-editor.png`・`imported-images-public.png`を視覚確認した。
API応答のfulfillは0件。R2の合成1px赤PNGが両画面で描画されている。

remote stagingへの反映と現行candidateのCIは、この記載時点では未受け入れ。
実ユーザー画像のinventory/bytes/metadata照合と既存Auth identityは最後のデータ工程で確認する。
