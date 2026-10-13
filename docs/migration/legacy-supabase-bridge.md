## 旧認証プロフィールの実Cloudflare受け入れ（2026-10-13）

849c4ee/CI38354171074は両job成功。所有2Worker/1D1で、実frontend client→実Worker→
TLSの合成source Auth/PostgREST fixtureを通す7項目が成功した。
本人GET/PATCH/username RPC、foreign保持、偽造/role/未認証・権限変更・ban後JWTの拒否、FK0を確認。
同一accountの検証Worker間だけglobal_fetch_strictly_publicを選択し、通常configは変更しない。
実GoTrueの署名/ban/service role検証は別のlocal実Auth試験で受け入れ済み。
このremote sourceは合成fixtureで、実Supabase productionの版/全schema/既存identityの証明にはしない。

最初の404は具体原因未確定。次の503はsame-account検証通信が未受け入れで、公開fetch flag後に成功した。
正確なplatform errorは取得していないため1042と断定しない。両失敗とcleanupのreceiptは保持する。
成功後も全2Worker/1D1を削除、12D1/12R2/4Worker/8DOとmain34a665d2を照合した。
別readonly processでbinding114・3D1全表件数/schema/FK・配信9file/catalog・backup/monitor版/Cronの保持も確認。
[remote限定証拠](evidence/legacy-profile-native-tls-2026-10-13.json) /
[独立保持確認](evidence/legacy-profile-native-main-preserved-2026-10-13.json)。

残件は旧認証経路の実画面、新frontendの通常V4配備/受け入れと当初条件レビュー。
source user/Auth/Storage・domain/DNS移行0。通常stagingの配備sourceは9794a49のまま。
以下は各時点の履歴。

## フロント接続・実Auth local確認の追加

`useProfile`と旧Authの`useAuth`は、現在のsessionの本人IDとtokenを確認してからWorkerを呼ぶ。
`profile-api.ts`は明示Bearer時にcookieを省き、返却IDが期待した本人でなければ拒否する。
取得・保存・username確認を同じtransportで扱い、失敗時のSupabase direct fallbackを行わない。
Better Auth modeはcookieを保ち、Supabase sessionを読むcallbackを呼ばない。
旧AuthのWorker profile取得中/失敗は保護画面を閉じる。

`GET /api/me/username-availability`のSupabase adapterは、固定RPC
`check_username_availability_secure`へcandidateと検証済みowner IDだけを渡し、booleanだけを返す。
callerのowner指定・余分/重複queryを拒否する。PATCHはowner+profile主キーで1行へ限定し、
旧PostgRESTのorder条件に依存しないようlimitを更新へ持ち越さない。

実GoTrue v2.196.0・PostgREST v14.17・PostgreSQL17.6をloopbackの所有containerへ作り、
actual frontend client→actual workerd API→実Auth署名検証・実service role更新/RPC、
foreign保持・偽造/privilege拒否・ban後のJWT拒否を確認した。7項目成功、全owned cleanup/元一覧一致。
[限定証拠](evidence/legacy-profile-frontend-real-local-auth-2026-10-13.json)。
Docker起動中のsocket切替、Auth schema/search_path不足、テストproxyのHTTP framingを修正した。
これらの失敗receiptはprivateに保持し、成功へ書き換えない。

再現は、Docker daemonが利用可能で、依存treeがinstall済みのrepo rootで:

```sh
node --experimental-strip-types scripts/migration/test-legacy-profile-supabase-local.mjs /absolute/private/result.json
```

外部URL・既存resource・実credentialを入力できない。毎回新しい所有scope/fixture secretを作る。
HTTPS aliasをMiniflare outboundServiceでHTTP loopbackへ写すtest限定のtransportで、遠隔TLSの証明にしない。
reduced profile schema/RPCのため全source policy/trigger互換にも拡張しない。
このreal local試験とclient認証transport9件は通常application CIへ追加した。
source-bridge modeのbuildは成功。通常staging/production selector・配備・secretは変更0。
画面・Cloudflare remote・exact-head CIと当初条件レビューが残る。

以下は最初の候補の契約・local fixture証拠。

# 旧Supabase JWTを保持するAPI bridge

当初#28/#33が要求した旧JWT検証とservice roleの独自認可を保持する。
プロフィールの最初の単位を実装した。全bridge完了・採用・本番切替とは扱わない。

## プロフィールの契約

既存`GET/PATCH /api/me/profile`に、明示`PROFILE_BACKEND=supabase`かつ
`AUTH_BACKEND=supabase`で選ぶadapterを追加した。通常V4は`d1`/`better-auth`のまま。
クライアントはAuthorizationのBearerで旧access tokenを送る。Cookieでは認証しない。

1. 固定project/custom Auth rootに対して`GET /auth/v1/user`で検証する。
   事前decodeは拒否フィルターだけで、署名検証として扱わない。anon/service role JWT、
   別issuer/audience、期限切れ、alg=none、非UUID subjectを拒否する。
2. Auth応答の本人ID/roleを確認し、匿名・削除・有効なbanを拒否する。
   user_metadataのrole/IDは権限・所有者判定に使用しない。
3. service roleの固定`user_settings`読取を、その本人の`user_id`で限定する。
   結果0件は404、複数/別所有者/不正DTOは503。Stripe顧客ID等を返さない。
4. PATCHはD1経路と同じ3項目の入力検証を使用する。既存プロフィールのIDも
   固定条件へ追加し、本人のSupabase avatar pathだけを新規参照として認める。
   既存外部avatar参照の保持、nullへの解除は許可する。
   サーバー側のplan/課金/招待/ユーザーID/setup flagを入力できない。
5. Supabaseだけへ保存する。D1への二重書込・移送・fallback・自動再送をしない。
   通信失敗時には、既に更新されたか未確定として扱う。成功したPATCHの返却表現を検証する。

CORSは固定Origin一覧、OPTIONSはGET/PATCHのみ。応答はno-store。
Authリクエストは公開apikeyと本人JWT、データリクエストはWorker専用service roleを使い、
受信Cookie/Origin等を上流へ複製しない。上流redirectを追わず、タイムアウト5秒（設定最大30秒）、
応答64 KiB上限で停止する。上流例外本文・個人情報・credentialをエラーへ載せない。
R2 selectorとの混在、異なる認証方式の混在は拒否する。

## 環境変数

| 変数 | 用途 |
| --- | --- |
| AUTH_BACKEND / PROFILE_BACKEND | 両方`supabase`を明示した場合だけ使用 |
| SUPABASE_URL | データAPIの固定HTTPS root、path/query/userinfoなし |
| SUPABASE_AUTH_URL | 任意の固定Auth HTTPS root。既定はSUPABASE_URL。issuerはこのrootの`/auth/v1` |
| SUPABASE_PUBLISHABLE_KEY / SUPABASE_ANON_KEY | Auth検証用公開key。既存anon-only validatorを使用 |
| SUPABASE_SERVICE_ROLE_KEY | Worker secretのみ。secret keyまたはlegacy service_role JWT。公開keyの代用を拒否 |
| CORS_ALLOWED_ORIGINS | 既存と同じ完全一致のOrigin一覧 |
| SUPABASE_REQUEST_TIMEOUT_MS | 既存5秒default、1–30,000ms |

キーを設定・取得・配備していない。stagingの既存secret/selectorは変更していない。

## 検証と残件

`workers/api/test/legacy-supabase-profile.test.ts`はlocal workerdの実entrypointに対し、
合成HMAC署名を検証するAuth fixtureとPostgREST fixtureを使う。
所有者のGET/PATCH、公開DTO、D1アクセス禁止、署名偽造/期限/issuer/role/状態、
metadata偽装、ID/plan等の更新禁止、別avatar/Origin/redirect/過大応答、
ACK不明のPATCH再送なしを含む40件が成功。既存native D1プロフィール12件、
Worker型検査と対象ESLintも成功した。
[local限定証拠](evidence/legacy-supabase-profile-local-2026-10-13.json)。

```sh
cd workers/api
npx vitest run --config vitest.config.mjs test/legacy-supabase-profile.test.ts
npm run test:profile-d1
npm run typecheck
```

新しいtestは既存vitest.config.mjsのincludeを通じて通常Worker CIに含まれる。
合成upstream fixtureは実Supabase Authでの成功・実service roleの権限を証明しない。
ソースのlogoutが既存access JWTを直ちに失効させるとは保証しない。

残件はfrontendのBearer送出/採用、他の旧APIとの契約対応、隔離した実Supabase
Auth/service roleの統合、stagingでの全bridge受け入れ。当初の条件をこの1APIで閉じない。
実ユーザー/Auth/Storageの移送と本番domain/DNSは最後の#38。

根拠: [Auth getUser](https://supabase.com/docs/reference/javascript/auth-getuser)、
[JWT検証](https://supabase.com/docs/guides/auth/jwts)、
[API keyとservice role](https://supabase.com/docs/guides/getting-started/api-keys)。
