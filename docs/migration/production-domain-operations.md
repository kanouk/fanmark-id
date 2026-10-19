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

DNS画面には全17レコードが表示される。追加の読取確認でapexの編集欄は名前fanmark.id・A・185.158.133.1・proxy有効・TTL自動・コメント空欄だった。画面のレコード属性にもrecord IDは表示されず、保存せずキャンセルした。Git外の `fanmark-cutover-2026-10-19/dns-before.bind` を保存済み。BINDだけではCloudflareのrecord IDや全管理属性を復元できない。従来CLI資格情報のDNS APIは403だったが、10/19の所有者の継続指示後にfanmark.id限定・DNS編集・10/26期限の専用tokenを作成し、Mac Keychainへ保存・独立読戻しした。全17件のAPI原本をGit外 `dns-before-api.json` へ0600保存し、別processのGETで全recordが不変であることを確認した。DNS更新は0件。逆操作の実地検証は未完了。

## 取得済みDNS原本と操作票

API原本のSHA-256は `f3da2468fee6afe4f612635ed265a6952d1ba757144d4f7f823f440e715aaa57`。apex Aのrecord IDは `5170d5d64e924bd5206e4a5e751a6d07`、TTLはAPI値1、proxyはtrue、commentはnull、tagsは空配列、settingsは空objectだった。全体はA3・CNAME1・MX4・NS2・TXT7。秘密値やTXT原文はGitへ保存しない。

Git外 `domain-operations-candidate.json` に、固定Worker/apexのPUT候補と所有domainのDELETE、旧A欠落時だけのPOST bodyを作成した。`override_existing_origin` と `override_existing_dns_record` はfalse。競合時に自動で上書きを許可しない。commentはnullなので新規作成bodyから省き、比較時は未指定/空の扱いを区別する。候補は実行していない。

API原本にもapexのNS2件が残る。DNS公式API説明にはNSと同名の他typeの共存制限があるため、この既存状態でAを再作成できるかは未検証。NSを削除して試さない。旧Aの自動復元も仮定しない。既存Aを保持するWorker Route案も調べたが、[CloudflareはWorker自体が配信元の場合にCustom Domainを案内](https://developers.cloudflare.com/workers/configuration/routing/routes/)しており、現時点では方式を変更しない。

専用tokenは2026-10-26 23:59:59 JSTに失効する。Keychain serviceは `fanmark-cutover-dns-2026-10-19`、accountは `fanmark.id`。再開時は有効性と全DNSの変化を確認し、取得済みの原本を現在値として使い回さない。

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

DNS record IDと保存原本・API body候補は取得済みだが、逆操作のprovider受け入れ、証明書/別回線の実測、www/adminの確定票がない。したがってG0/P6完了とは判定しない。

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


## alias専用Workerの候補（未配備）

`workers/api/src/production-domain-alias.mjs` と
`workers/api/wrangler.alias-production-closed.jsonc` を追加した。DB・画像・秘密値・
アプリservice bindingを持たず、外部fetchもしない。初期設定は無効、公開route・Cronは0。
当日のapex受け入れ後、wwwとadminをこの専用Workerへ1件ずつ接続する候補とする。

有効時もGET/HEADだけを一時的な307で案内する。wwwは通常のpath/queryを保ち、
adminはqueryなしの `/` だけを `/admin` へ案内する。API・認証callback・パスワード設定/
リセット、認証情報に関係するqueryは転送せず、apexでの再ログインを案内する。
未調査のadmin path/queryは404。Location末尾の明示的な空fragmentは、旧Supabaseの
hash tokenが新URLへ引き継がれることを防ぐ。no-store/no-referrerを付け、恒久redirectは使わない。
これにより通常のページ内anchorも引き継がれない。

逆操作は当該runで追加したalias domainだけを解除し、保存した各A recordの属性へ戻す。
apexの逆操作と同じ所有ID確認・応答不明時のGET・NS共存制約が適用される。
候補実装はDNS復元APIの受け入れや公開TLSの実証ではない。

10/19のGitHub管理画面では `fanmark.id Cloudflare staging`（application 3902960）だけが
個人所有OAuth App一覧にあり、Client IDのhashは旧Supabase設定と一致しなかった。
この検証用Appへ本番callbackを追加せず、旧本番Appの所有先特定を残件とした。
Supabase設定APIの4 provider secretは64文字の不透明な値で、取得できた認証用秘密値とは
扱わない。非空であるだけではsecretを移送できる根拠にならない。


## 2026-10-19の追加読取りと資格情報の準備

Supabase管理APIの不透明値とは別に、ログイン済み管理画面の正規Revealで4 providerの実秘密値を取得できた。元Client IDと照合し、値は非公開領域へ暗号化保存した。Google/Discord/GitHubは既存値を保持し、Appleは旧JWTが2026-05-25に失効していたため、旧署名と一致する既存鍵で同じTeam/Services IDの候補を作成した。候補の有効期限は2027-03-18、別processのWebCryptoで署名を確認済み。Apple側での鍵の有効性や実ログインの証拠ではない。[限定証拠](evidence/production-oauth-material-preparation-2026-10-19.json)。

Googleのfanmark-id projectとDiscordのfanmark.id applicationは元Client IDに一致し、旧本番・stagingのcallbackを確認した。新本番callbackはどちらも未登録で、設定は変更していない。GitHubの承認済みOAuth Apps一覧から、旧本番Appの所有者は [fanmark-id](https://github.com/fanmark-id) と判明した。kanouk所有のstaging Appとは別である。所有者での管理画面ログインとApple Developerへのログインは本人に依頼中。

Custom Domainの解除時は、関連するAdvanced Certificateが自動削除されない点も復元票へ含める。[Cloudflare公式説明](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/#certificates)。元証明書一覧を保存し、当該runで新規発行した証明書だけをhostname/IDで対応付ける。既存Universal証明書は削除しない。DNS原本の復元可能性・証明書読戻しは引き続き未検証。


## 2026-10-19の管理画面読戻しと追加前の確認

Google/Discord/Appleの既存設定へ、新本番callbackだけを追加する案を入力した。旧本番・stagingのURLは保持し、まだ保存していない。ブラウザ操作の規則に従い、認証結果の新しい返送先を許可する保存操作について本人の確認待ち。GitHubの旧App所有者fanmark-idでのログインも未完了。Appleのログイン待ちは解消し、NYM8ZP23HA鍵が既存primary AppでSign in with Appleに有効であることを管理画面から確認。暗号化候補のkid/Team/Services IDとの一致は別processで確認したが、provider側の実ログイン成功ではない。

全DNS17件はAPI原本と不変。Cloudflareの証明書画面はapexとwildcardを含むUniversal active（Google Trust Services、2026-12-28期限）とBackup issued（Let's Encrypt、2027-01-06期限）。Backupは配信中の証明書とは扱わない。SSLはFull、Always Use HTTPSはoff、TLS 1.3はon、minimum TLSは1.0。Page RulesとSingle Redirectはともに0件。設定は変更していない。証明書packと設定のAPI取得は403で、ID付き証明書の原本と変更後の所有判定は残る。[限定証拠](evidence/provider-domain-console-readiness-2026-10-19.json)。

### HTTPからHTTPSへの誘導を公開条件に含める

現行apexのHTTP HEADはHTTPSへの301を返したが、この応答が新しいWorkerでも維持されるとは確認できていない。Workerのfetch入口にも汎用のHTTPS誘導はない。切替前にapex・www・adminについて、HTTPのGET/HEADが同じpath/queryのHTTPSへ安全に誘導され、HTTPから認証・業務処理が実行されないことを確認する。

推奨は対象3hostに限定したCloudflareのSingle Redirectを切替票へ用意すること。全hostへ作用するAlways Use HTTPSより、旧auth等への影響範囲を限定できる。これは未適用の案であり、設定保存前には正確な式・転送status・query保持と逆操作をレビューする。[公式のHTTPS設定説明](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/always-use-https/)でも、一部hostだけに適用する場合はSingle Redirectが案内されている。新しいredirectの実IDを保存し、中止時は当該runで追加したその1件だけを解除する。既存TLS設定・NS/mail設定を併せて変更しない。
