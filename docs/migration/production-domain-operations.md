# 本番ドメインの操作票（実行前）

2026-10-19時点。G4の準備票であり、実行済みではない。source停止・最終コピー・独立照合・Webhook引継ぎ・閉鎖中の本人確認が完了するまで適用しない。

## 確認済みの対象

| 項目 | 値 |
| --- | --- |
| account | `bfc2890741f0b3fb236e2d755b6c9adc` |
| zone | `6a2c39c92ba1c4106b7c19f87ada0a7e` / `fanmark.id` |
| 新しい配信元 | `fanmark-app-production` |
| apexの現設定 | A / `185.158.133.1` / proxy有効 / TTL自動 |
| www・admin | 各A / `185.158.133.1` / proxy有効 / TTL自動 |
| auth | CNAME / `ppqgtbjykitqtiaisyji.supabase.co` / proxy有効 / TTL自動 |
| 変更しない設定 | レジストラ・NS委任・MX・SPF・DKIM・DMARC、旧authの接続先 |
| 現在のWorker Custom Domain / zone route | ともに0（管理API読戻し） |

DNS画面には全17レコードが表示される。追加の読取確認でapexの編集欄は名前fanmark.id・A・185.158.133.1・proxy有効・TTL自動・コメント空欄だった。画面のレコード属性にもrecord IDは表示されず、保存せずキャンセルした。Git外の `fanmark-cutover-2026-10-19/dns-before.bind` を保存済み。BINDだけではCloudflareのrecord IDや全管理属性を復元できない。現CLI資格情報のDNS APIは403のため、以下のDNS JSON原本取得と逆操作の実地検証は未完了。

## 適用前のプレビュー

Wrangler 4.135.0の実装 `publishCustomDomains` が適用前に使う次のプレビューを、apex1件だけで実行した。

```text
POST /accounts/bfc2890741f0b3fb236e2d755b6c9adc/workers/scripts/fanmark-app-production/domains/changeset?replace_state=true
[{"hostname":"fanmark.id","zone_id":"6a2c39c92ba1c4106b7c19f87ada0a7e"}]
```

結果は追加1件、更新0・削除0・conflict0・影響zone1件。前後のCustom Domains、zone routes、Worker設定・配備版は同一だった。DNS画面を再読込し、17レコードとapex/www/admin/authの元の接続先も確認した。結果原本はGit外 `custom-domain-preview.json`。プレビュー内のdomain IDは適用済みの証拠ではなく、DNS record IDとして使わない。既存Aレコードがあるのにconflict0であるため、これをDNS保持・復元の証明にしない。

[Cloudflare公式のCustom Domains説明](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)では、設定時にDNSと証明書をCloudflareが管理する。旧DNSが削除時に自動復元されると仮定しない。

## G4の順序と停止条件

1. DNS APIでzoneの全recordをページ末尾まで取得し、全17件のID・type/name/content・TTL・proxy・comment/tags/settingsと取得時刻をprivate保存する。apexのA/AAAA/CNAMEを完全一致で絞り、画面/BINDと照合する。余分な同名record、値の変化、取得失敗があれば開始しない。
2. 全Custom Domains/zone routes/redirect rules/TLSの原本、旧配備への到達結果を保存する。`www`・`admin`のpath処理、4 providerの本番callbackと復元値、実施者だけの確認入口も先に確定する。
3. 同じ固定apexのプレビューを再実行し、追加1件・削除/更新なし・影響zone1件と内容を照合する。変更差分を実行票へ固定する。
4. `fanmark-app-production`の配備版と`receipt_only`、一般write停止、source最終境界、G3照合証拠を再確認してから、apexだけをCustom Domainへ登録する。CLIの非対話deployで自動承認させない。Wrangler 4.135.0は非対話時に既存origin/DNSの上書きを有効にするため、当日の操作には検証済みの個別API引数を使う。
5. 応答不明なら登録要求を再送しない。別のGETでapexのdomain・service・zone・配備版・DNS差分を確認し、未確定なら閉鎖を維持する。
6. 証明書のactive化、別resolver/回線でTLS・正しいhost/path/query・API no-store・旧PWA更新・保護URLを確認する。既存Universal証明書がactiveでも新Custom Domainでの到達成功とは扱わない。
7. `www`・`admin`は別の固定票で適用し、apexと一括変更しない。各票には個別の逆操作を付ける。G5の新側write開始は別の判断点。

この票にはまだDNS record ID、実API適用の確定body、証明書/別回線の実測、www/adminの確定票がない。したがってG0/P6完了とは判定しない。

## 新側の業務write開始前の逆操作

1. 新側を閉鎖し、業務writeがまだ始まっていないことを台帳で確認する。停止中に保存したStripe受信は失わず、旧側へ戻す対象を別途照合する。
2. 当該runで追加したapex Custom Domainの**実際の**ID・hostname・zone・serviceをGETで確認する。同名でも別Worker・別runのものは削除しない。
3. その1件だけを解除する。応答不明時は再送せずGETで有無を確認する。
4. DNSを再取得し、保存したapexのA/AAAA/CNAME集合との差分を計算する。残っている所有recordを照合し、欠けた旧Aのみ `185.158.133.1` / proxy有効 / TTL自動と保存済み属性で復元する。新しいIDが発行された場合も記録する。zone全体のBIND再importや他recordの削除は行わない。
5. 全17件の内容、MX/TXT/NS保持、Custom Domains/routeが元の状態であること、別回線から旧配備へ届くことを確認する。HTTP/TLS成功だけで旧DBのwrite再開は認めない。
6. 旧receiverの引継ぎ照合・source停止解除・Cronの元active状態復元を各票で完了し、旧サービスを再開する。

新側で業務writeを開始した後は、このDNS逆操作だけで旧DBへ戻さない。差分を回収する前進復旧の手順へ移る。

## OAuthの登録票

本番設定の `BETTER_AUTH_URL=https://fanmark.id` と既存のBetter Auth callback構造から、追加候補を次の4本へ固定する。実provider管理画面での追加・照合と本番ログインは未実施。

| Provider | 本番へ追加するcallback |
| --- | --- |
| Google | `https://fanmark.id/api/auth/callback/google` |
| GitHub | `https://fanmark.id/api/auth/callback/github` |
| Discord | `https://fanmark.id/api/auth/callback/discord` |
| Apple | `https://fanmark.id/api/auth/callback/apple` |

既存client ID・Apple Services ID/Team/App groupingを先に旧設定と照合する。同じproviderの別appを新規作成してユーザーIDの一致を仮定しない。旧 `https://auth.fanmark.id/auth/v1/callback` と既存staging callbackは保持し、登録前後の全URL一覧を保存する。新しい登録先だけを差分として取り消せるようにする。secretを文書・チャットへ転記しない。

- Googleは登録済みredirect URIとの一致が必要。既存clientへ正確な1本を追加する候補とし、originや末尾slashも区別する。[公式Web Server OAuth説明](https://developers.google.com/identity/protocols/oauth2/web-server)
- GitHubは2026-08-14からOAuth Appにも最大10 callback URIを登録できる。旧callbackの置換を前提にせず、既存Appへの追加を優先する。token期限やwildcardの設定変更を今回のcallback追加へ混ぜない。実App画面の現設定を保存してから決める。[GitHub公式変更記録](https://github.blog/changelog/2026-08-14-multiple-redirect-uris-and-token-refresh-for-oauth-apps/)
- Discordは同じdeveloper applicationの登録redirectへ追加し、実際のauthorizeとtoken交換が同一URIを使うことを照合する。[Discord公式OAuth2説明](https://docs.discord.com/developers/topics/oauth2)
- Appleは既存Services IDのWebsite URLsでdomain `fanmark.id` と上記return URLを確認する。既存のprimary Appとの関連付けを保持し、旧側のdomain/return URLを消さない。[Apple公式Web設定説明](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web)

登録完了と認証成功は分けて記録する。providerからの戻り、state/PKCE、Apple form POST、旧provider subjectと移行済みaccountの一致、重複userが作成されないこと、MFAが必要な管理者の判定まで本番受け入れに含める。管理者MFAの再登録依頼は、これらの準備を含む他の条件がそろってから行う。

## www・adminの現行入口の調査

2026-10-19の認証なしGETではapex/www/adminの `/` はすべてHTTP 200、Locationなし、同じ公開JS asset pathを返した（HTML本文はhostごとにhashが異なる）。JavaScript実行やログイン後の確認はしていない。private記録は `public-host-routing-before.json`。

repositoryの `src/hooks/useSubdomain.tsx` と `src/App.tsx` はadmin hostだけ `AdminApp` を選択する。`src/components/AdminApp.tsx` は `/` を管理画面に割り当て、ほかのpathを `/` へ戻す。`AdminDashboard` の選択tabはcomponent stateであり、URLからは読み取らない。apex側の管理入口は `/admin/*`。この実装上の対応と、配信中のビルドの同等性は分ける。

推奨候補はadminの既知の入口 `/` をapex `/admin` へ一時誘導し、本番認証をapex originへそろえること。wwwはpath/queryを保ってapexへ誘導する候補。ただし旧認証のcode/token、API POST、未調査pathを一律転送しない。alias用handlerと検証、変更前後のCustom Domain/redirect票が必要であり、まだ有効化していない。既存Supabase cookieがapexのBetter Auth sessionになるとは扱わない。
