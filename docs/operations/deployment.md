# 本番更新

本番はCIから自動配備しない。docs-onlyの変更はCI・mergeまでで、Workerの配備は不要。
以下は実行コードまたはfrontendの変更を本番へ反映する時の手順。通常設定と[状態](current-state.md)を先に読む。

## 1. 対象と現在値を固定する

main/PR/変更HEADと依頼範囲を確認し、関係するtestとCI両jobが成功したcommitを対象にする。
[アクセス](private-access.md)で現在のCloudflareアカウント・権限・認証期限を確認する。
rootと`workers/api`はlockfileでinstallし、Node 22.6.0と同梱Wranglerを使用する。

Worker directoryでの読み取り例（`fanmark-staging-inapp`は名前にstagingがある既存profileで、本番accountも扱う）:

```sh
./node_modules/.bin/wrangler deployments list --config wrangler.app-production.jsonc --profile fanmark-staging-inapp --json
./node_modules/.bin/wrangler versions view ACTIVE_VERSION_ID --config wrangler.app-production.jsonc --profile fanmark-staging-inapp --json
```

`ACTIVE_VERSION_ID`は直前のdeployment一覧で100%になっているversionへ置換する。split配備なら先に割合と意図を確認する。
versionからbindings・秘密設定名・保存先・runtimeを取得し、APIまたはdashboardでschedules/routes/subdomainも保存する。
Cloudflare APIでは`/accounts/{account}/workers/scripts/{name}/deployments`→
`.../versions/{activeVersion}`の順に読み、最後にdeploymentが変わっていないことを再確認する。
一般`.../settings`だけでは未配備候補を現在値と誤認する場合がある。

## 2. 静的資産を保持してbuildする

現在の完全なbuild directoryとmanifestをGit外へ保存してから`npm run build`する。
新しい端末に前buildがなければ、最終確認状態に対応する資産manifestを使って公開HTTPSから各fileを取得し、
全byteのSHA-256を照合してprivateな前build directoryを復元する。
現在のactive versionがmanifestの対象と一致しない場合は、現在の配備記録とmanifestを先に取得する。
`robots.txt`はCloudflare管理のcontent signalsが配信時に追記される。manifestのsource byte/hashとは区別し、
既存artifactまたは固定frontend sourceの`public/robots.txt`が記録済みSHA-256と一致する場合だけ復元する。
公開応答の相違も操作journalへ保存し、元hashを配信結果に合わせて書き換えない。

現時点の[資産manifest](deployed-assets-2026-10-24-auth-readiness.json)は公開静的fileだけを列挙する。
取得先は固定`https://fanmark.id/`＋manifestの相対nameに限定し、query・別host・`..`・symlinkを許可しない。
欠落やhash相違を推測で埋めず、既存artifactの保管先を確認する。

```sh
npm run build
node scripts/migration/retain-staging-hashed-assets.mjs /ABSOLUTE/PRIVATE/PREVIOUS_BUILD dist-cloudflare-production
npm run check:production-live-config
npm run build:cloudflare-production-live:dry-run
```

helper名にstagingを含むが本番directoryにも使える。旧hash付きassetを保持し、HTML/SW/manifestは新buildとする。
同名異内容は上書きしない。変更後の完全manifestを新operationへ保存する。

## 3. 候補uploadと有効化を分ける

以下は書込み操作であり、各操作の新intentを保存して1回だけ実行する。引数のIDを事前に確定する。
通常app以外が変更対象なら、対象Workerに対応する通常production configと、そのworkerのbaselineを別に使う。

```sh
# cwd: workers/api。成功CIと対象HEADを固定したoperationでのみ実行する。
./node_modules/.bin/wrangler versions upload --config wrangler.app-production.jsonc --profile fanmark-staging-inapp --keep-vars --message "Reviewed production update COMMIT_SHA"
./node_modules/.bin/wrangler versions view CANDIDATE_VERSION_ID --config wrangler.app-production.jsonc --profile fanmark-staging-inapp --json
```

候補はまだ実稼働ではない。候補のcode/assets、全binding・秘密設定名・D1/R2/DO保存先、runtime、公開設定を
baselineと比較する。変更対象以外を保持し、秘密値の再PUTや鍵の生成を通常更新へ混ぜない。
`--keep-vars`だけで全設定保持の検証が済んだと扱わない。

```sh
./node_modules/.bin/wrangler versions deploy CANDIDATE_VERSION_ID@100% --config wrangler.app-production.jsonc --profile fanmark-staging-inapp --yes --message "Verified production update COMMIT_SHA"
```

応答不明ならupload/deployを再実行しない。deployment一覧・version詳細・保存済みintentを別GETで照合する。
`*-production-closed.jsonc`、旧private deploy helper、通常の`wrangler deploy`で無確認に上書きしない。
versions有効化でCron/Route等の別資源は更新されない。必要な設定変更は別intent・別readbackで扱う。

## 4. 公開状態・merge・記録

独立GETでactive version/割合、全保存先、秘密設定名、runtime、Cron/Routeを確認する。
`/`、`/api/auth/capabilities`、`/api/system/maintenance`のHTTPS正常、未認証の個人/管理API拒否を照合する。
frontend変更ならPC/モバイル・PWA・旧asset、業務変更なら影響する認証/所有権/保存結果も確認する。
UI表示やHTTP200だけでDB更新完了を推測しない。決済・送信・削除の試験には合成環境を優先する。

受け入れ後に対象PRをmergeする（作業依頼でmergeが許可されている場合）。新PRは既存PR番号を使い回さない。
mainのtreeと検証済みcommitの一致・main CIを確認する。mainのHEADと実配備のソースは別々に記録する。
[最終確認状態](current-state.md)と資産manifestを更新し、Git外journalへ完全な証拠を保存する。
失敗時の判断は[障害対応](incident-response.md)へ進む。
