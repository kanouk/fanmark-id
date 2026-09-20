# Cloudflare 移行: Better Auth 認証 feasibility

確認日: 2026-09-21 (JST)

この調査は、Supabase Auth の本番データを移行したり、Cloudflare のリモート
D1/Worker を変更したりするものではない。`experiments/cloudflare-auth/` に、
架空のユーザー、架空の UUID、架空の bcrypt hash だけを入れたローカル
Workers + D1 proof を置いた。OAuth の provider 登録、OAuth callback、Supabase
MFA factor の移行、実データの export/import は実施していない。

別途、Supabase SQL Editor で `BEGIN READ ONLY` の aggregate を実行した live
observation では、既存 `encrypted_password` の観測形式が bcrypt `$2a$10$`、検証済み
MFA factor type が TOTP だった。集計件数はこの proof に記録せず、hash 内容・user
対応・factor secret は取得/exportしていない。

## 結論

メール/パスワード認証の互換性については、条件付きでローカル feasibility を
確認できた。Better Auth `1.7.5` の D1 adapter を workerd 上で動かし、
`bcryptjs 3.0.3` をカスタム password verifier として渡すと、synthetic `$2b$` と
live aggregate で観測した `$2a$10$` を想定した bcrypt hash を検証できる。正しい
パスワードでは synthetic user の UUID が response と session の `userId` に
そのまま残り、誤ったパスワードでは
`401` になり session は増えなかった。4 件の並列 sign-in でも各 session の
UUID 関係は保たれた。さらに、二人目の synthetic user について Better Auth
`twoFactor()` の TOTP enrollment、credential sign-in の pending challenge、
誤った/正しい TOTP の拒否・完了をローカル HTTP endpoint で確認した。
さらに synthetic administrator について、credential sign-in と OAuth 相当の
session の両方をサーバー側の `/admin/protected` gate で検査し、同じ session と
現在の verified factor に結び付いた TOTP assurance の後だけ通すことを確認した。

これは「Better Auth へ実ユーザーを移行できる」証明ではない。Supabase の live
aggregate は bcrypt `$2a$10$` 形式を示すが、hash 内容、実ユーザー ID の対応付け、
MFA secret の移送、provider の token と profile の挙動、Cloudflare の CPU plan は
まだ未確認であり、下記の gate を通す必要がある。

## 再現方法と固定バージョン

```sh
cd experiments/cloudflare-auth
npm ci
npm test
```

proof の依存関係は `package.json` と lockfile に exact version で固定している。

| 役割 | version |
| --- | --- |
| Better Auth | `1.7.5` |
| bcrypt verifier | `bcryptjs 3.0.3` |
| Workers test pool | `@cloudflare/vitest-plugin 1.1.13` |
| Vitest | `4.1.11` |
| Wrangler | `4.135.0` |

`wrangler.jsonc` は `nodejs_compat` とローカル D1 binding だけを宣言している。
`database_id` は架空値で、remote D1 の作成・接続・deploy は行っていない。
実際の認証用 secret、OAuth secret、provider の client credential は入れていない。
`BETTER_AUTH_SECRET` には local proof の署名用 synthetic fixture 値だけを置いている。
この lockfile での `npm ci` 後に `npm audit --omit=dev` は 0 vulnerabilities だった。

synthetic OAuth 相当 session を発行する endpoint は `src/test-fixture.mjs` と
`wrangler.fixture.jsonc` に分離し、Vitest の auxiliary Worker としてだけ bundle
している。通常の `src/index.mjs` と `wrangler.jsonc` はこの plugin/endpoint を
import せず、通常 Worker への同じ request は `404` になる。fixture の secret と
user はテスト専用の架空値で、OAuth provider の callback や credential を構成した
ものではない。

`npm ci && npm test` の直近の実行では 6 tests passed となった。4 並列 sign-in の
ローカル wall time は `296 ms` だった。この時間は workerd のテスト wall time であり、
Cloudflare が請求する CPU time の測定値ではない。テストの主張範囲は synthetic data
とローカル runtime に限る。

## 検証した範囲

### bcrypt と UUID/session

- Better Auth の新規 password hash の既定は scrypt なので、今回の検証では
  `emailAndPassword.password.verify` と `password.hash` を明示的に差し替えた。
- `bcryptjs` の純 JavaScript 実装で synthetic `$2b$10$...` と `$2a$10$...` hash を
  workerd 内で検証できた。既存 hash を `account.password` に置き、`providerId =
  credential`、`accountId` と `userId` を同じ synthetic user UUID にした。
- UUID `11111111-1111-4111-8111-111111111111` は response、D1 `session.userId`、
  `get-session` response で一致した。4 並列の成功でも session 数は 4 増えた。
- 誤った password は `401` で、失敗リクエストによる session は作成されなかった。

live aggregate では観測された Supabase hash の prefix/cost が `$2a$10$` だったが、
hash 本体や user 対応は取得していない。移行前に本番から hash を持ち出さずに
encoding、account/user の対応、実装が `$2a$` を同じ意味で検証することを確認し、成功時に Better Auth の
新しい hash へ更新する方針と rollback を決める必要がある。今回の proof は新規
hash の compatibility を確認しただけで、scrypt/別方式へ再 hash する本番方針は
未決定である。

### Better Auth + D1/Workers

Better Auth の公式 1.5 release note は Cloudflare D1 を first-class database と
して扱い、Worker から `betterAuth({ database: env.DB })` と binding を直接渡す
例を示している。D1 は interactive transaction を持たないため、Better Auth
adapter は batch/atomic 操作を使う。この proof は `env.AUTH_DB` を直接渡し、
ローカル workerd + D1 で core schema と session 作成まで動かした。

Workers の Hono/integration guide に従い `nodejs_compat` を有効にした。Better
Auth のセッション、account、verification の core schema は `migrations/` に
固定し、`validateSchema: false` を使って各 request で D1 introspection を繰り返さ
ないようにした。これは proof を安定させるための設定であり、production schema
検証を不要にする判断ではない。production では migration 適用後の schema と
Better Auth version の整合性を別途確認する。`0001_better_auth_core.sql` は
Better Auth `1.7.5` の Kysely/SQLite schema generator output を基に fixture insert
を加えた canonical な単一 SQL で、generator の一時出力は同梱していない。

### 並列性と CPU

ローカルで 4 件の password sign-in を同時に実行し、すべて成功して各 session
の `userId` が同じ UUID になることを確認した。これは小さな一回の runtime
test であり、rate limit、D1 の本番負荷、再試行、複数 Worker instance 間の
競合を保証しない。

Cloudflare Workers の公式 limits は Free が HTTP request あたり CPU 10 ms、
Paid の既定が 30 s で、設定上限は 300,000 ms である。bcryptjs は純 JavaScript
の CPU work なので、今回の wall time から Free/Paid の可否を決めてはいけない。
実データを扱わない staging Worker に synthetic load をかけ、Worker の CPU
metrics/tail を読み、bcrypt cost と同時実行数を plan と照合することが次の gate
になる。D1 の I/O 待ち時間が CPU にそのまま加算されないとしても、hash 計算と
JSON/request processing の CPU は別に測る必要がある。

## OAuth 4 provider の扱い

Better Auth の公式 provider guide と basic usage は Apple、Google、GitHub、
Discord をサポート provider として扱っている。したがって、provider ID と
基本設定を持つ設計は可能だが、今回の proof はどの provider にも secret を
設定しておらず、外部 OAuth を一度も実行していない。

| provider | 公式ドキュメント上の入力/注意 | 未検証の移行 gate |
| --- | --- | --- |
| Apple | Better Auth の現行 guide は Service ID/client ID、Team ID、Key ID、private key から ES256 client secret を生成し、JWT は最長 6 か月としている。同 guide は `email` claim を最初の認可時だけと説明する一方、Apple の公式 web guide は subsequent authorization でも identity token に email を含めると説明し、user object/name は初回だけとしている。 | 公式資料の記述差を前提に、Apple の stable user identifier を主キーにする。Service ID/return URL、実 callback、identity token の email、初回 name/email の保存、既存 Supabase identity の対応を staging で確認する。 |
| Google | client ID/secret と Better Auth の callback。base URL を正しく設定しないと `redirect_uri_mismatch`。 | 実 client の redirect、token/profile、既存 email との linking、production origin。 |
| GitHub | client ID/secret と `user:email` scope が必要。 | 実 OAuth app の scope、非公開 email、既存 identity との linking。 |
| Discord | client ID/secret と callback。電話番号だけのアカウントでは email が null の場合がある。 | 実 callback、email null の扱い、既存 identity との linking。 |

各 provider の次の gate は、secret を保管した staging 環境で一 provider ずつ
実際の browser callback を通し、redirect、profile/email、account linking、
session 発行を観測することになる。localhost/non-HTTPS callback が使えない
provider があるため、ローカル proof だけで代替しない。

## MFA の扱い

Better Auth の公式 `twoFactor()` plugin は TOTP、OTP、backup code、trusted
device を提供し、user の `twoFactorEnabled` と `twoFactor` table（secret、
backupCodes、verified、失敗回数、lock 時刻など）を追加する。credential sign-in
では 2FA challenge/redirect が発生するが、OAuth/social/passwordless sign-in は
既定では 2FA の対象にならず、全方式に要求するなら hook 等の明示的な policy が
必要である。

この proof では plugin の email/password TOTP endpoint は実行したが、Supabase の
MFA factor/secret を Better Auth の `twoFactor` schema に変換していない。したがって
MFA を「移行できる」とは判定しない。次の gate は、既存 factor の種類・状態・recovery code
を本番から安全に分類し、secret を移行可能か（または再登録を要求するか）決め、
credential と各 OAuth provider の challenge policy を staging で実行すること
である。TOTP secret を無理に export できない場合は、ユーザー再登録と旧 MFA
無効化の手順・期間を別途設計する。

ローカル proof では、二人目の synthetic user（UUID
`33333333-3333-4333-8333-333333333333`）だけに `twoFactor()` を有効化した。
password sign-in 後に `POST /api/auth/two-factor/enable`（`method: "totp"`）を
呼び、URI の secret をログへ出さずテストメモリ内で RFC 6238 の enrollment code
を WebCrypto HMAC-SHA1 から生成して `verify-totp` を通した。sign-out 後の再 sign-in
は `twoFactorRedirect: true` と `twoFactorMethods: ["totp"]` を返し、challenge
を含む全 `Set-Cookie` name/value pair を forwarding した `get-session` は `null` に
なった。Better Auth の current ±1 period 範囲から外した6桁 code は `401`、正しい
current code は `200` で、同じ UUID の authenticated session が作られた。

この endpoint proof は email/password 経路だけを対象とする。OAuth の4 provider
で Better Auth の challenge が自動的に強制されること、Supabase の旧 MFA
factor/secret/recovery code の移行は未確認である。

### Administrator route の MFA assurance proof

Better Auth の `twoFactor()` は OAuth/social sign-in を既定では 2FA の対象に
しない。そのため、admin 操作は sign-in の種類に依存せず、サーバー側で認証済み
session と MFA assurance を再検査する gate が必要になる。proof では synthetic
admin に `adminRole` を付け、`/admin/protected` が次の全てを D1 と Better Auth
session から確認するようにした。

- `auth.api.getSession` による現在の session があり、role が `admin` である。
- user の `twoFactorEnabled` と current `twoFactor.verified` が有効である。
- `mfaAssurance` の `sessionId` が現在の session ID と一致し、期限内である。
- `mfaAssurance.factorId` が current verified factor の ID と一致する。

`mfaAssurance.sessionId` は `session(id)` への unique foreign key（cascade）で、
`factorId` は `twoFactor(id)` への foreign key（cascade）である。verify hook は
成功 response の user ID と Better Auth の supported context (`newSession` または
current `session`) の user ID を比較し、既存 session の場合は token から internal
adapter で再読込した同一 session を確認してから、current verified factor ID と
共に assurance を保存する。admin gate は cookie や client header の MFA claimを
信用せず、毎回この関係を D1 で照合する。session sign-out の cascade と
two-factor enable/disable hook の assurance 削除も検証した。

テストでは未認証、non-admin、MFA 未検証、pending sign-in の全 cookie、OAuth 相当
session を順に拒否し、OAuth 相当 session も同じ session の TOTP verify 後だけ
許可した。別 session の assurance は拒否し、disable 後は route と assurance row
の両方が無効になった。OAuth 相当 session は実 provider callback ではなく、通常の
Worker から分離した Vitest auxiliary Worker の test-only endpoint が
`internalAdapter.createSession` と `setSessionCookie` で発行する synthetic session
である。したがって、この結果は Apple/Google/GitHub/Discord の実 callback や
OAuth hook の完全な移行を証明しない。

factor ID を assurance に保存し、current factor と照合することで、通常の
disable/再 enrollment で factor row が置き換わったとき旧 factor の proof を再利用
できない形にした。さらに、`mfaGeneration(id = 1, generation)` という D1 の singleton
行を追加した。factor の insert/delete、secret または `userId` の変更、verified の
`1 -> 0`、user の `twoFactorEnabled` の `1 -> 0` は SQLite trigger で generation を
増やし、その factor/user に属する assurance を削除する。失敗回数の更新と
enrollment の `false -> true` では増やさない。

Worker は `verify-totp` の handler に入る前に generation だけを一度読み取る。cookie
を解析したり、入力 cookie から user/session を先に引いたりはしない。Better Auth の
supported context で TOTP 成功と user/session の一致を確認した後、guard 付きの一つの
`INSERT ... SELECT` が、同じ generation、現在の session/user、verified factor、
enabled user、未期限切れ session を同時に確認して assurance を保存する。D1 の SQLite
adapter がこの proof の session expiry を ISO text として保存することは実際の row の
`typeof(expiresAt)` と parse をテストで確認し、guard は同じ ISO 表現で比較している。

test-only barrier で Better Auth の TOTP 成功後・guarded insert 前に同じ factor の
secret を更新すると、trigger が assurance を削除し generation を増やし、verify 自体は
`200` のままでも assurance は作られず `/admin/protected` は `403` になった。secret を
戻した後の新しい TOTP verify は `200` で route を通った。通常の disable/delete 後に
新しい factor を enable/verify した場合は factor ID が変わり、新しい session-bound
assurance だけが有効になった。sign-out 後は session の cascade で route が `401` に
戻った。

singleton generation は新しい assurance の optimistic concurrency guard であり、無関係
な user の MFA 変更が同時に起きると、新しい assurance を保守的に作らず retry を要求
することがある。既存 assurance の admin request で global generation を比較しないため、
無関係な user の変更で確立済み session を全体 revoke はしない。local D1 でこの順序を
再現した証拠は得たが、remote D1 の multi-Worker concurrency、Better Auth session 作成
と assurance 保存をまたぐ本番 transaction、実 factor reset API の運用は未検証であり、
staging の race/trigger/load test が残る。

Supabase 側は read-only aggregate で既存 factor type が TOTP だと確認できたが、
factor の secret、recovery code、user 対応、移行可能性は確認していない。件数や
hash/factor の個別値は export していないため、この live observation は proof の
synthetic enrollment を実データ移行の証明に変えない。

## 未確認事項と次の gate

| surface | 今回の evidence | 未確認/次の gate |
| --- | --- | --- |
| D1 adapter | 公式 D1 support と local workerd/D1 の core auth/session | production schema parity、D1 batch の実負荷、migration rollback、remote resource policy |
| bcrypt import | synthetic `$2b$10$` と `$2a$10$` の正しい/誤った password、session/UUID 関係。live aggregate は観測 hash を `$2a$10$` と確認 | 実 hash 内容/user 対応、CPU、成功時 rehash、失敗時の lock/rate limit |
| UUID | synthetic user/account/session で UUID を完全一致 | `auth.users.id` と identity/account の実対応表、既存 session の扱い、export/import rehearsal |
| Apple/Google/GitHub/Discord | 公式 docs と provider 設定項目の確認 | staging secret、実 callback、profile/email/null、link/unlink、origin/return URL |
| MFA | synthetic user の local HTTP TOTP enrollment/challenge/verification、UUID/session 関係。admin route は role、current verified factor、session/factor-bound assurance を再検査し、OAuth 相当 session を verify 前に拒否。MFA mutation generation と guarded assurance insert を実 D1 barrier で検証し、同じ factor secret reset、factor replacement、sign-out 後の stale assurance を拒否。live aggregate は factor type を TOTP と確認 | Supabase factor secret/user 対応・移送可否、再登録、4 provider の実 callback と challenge policy、remote D1 multi-Worker concurrency、staging admin authorization |
| CPU/concurrency | local 4 並列 sign-in が成功 | staged Worker の CPU metrics、plan/limit、D1 concurrency、rate limit、ピーク負荷 |

これらの gate を通る前に本番 migration、旧 Auth の停止、OAuth provider の
redirect 切替、MFA の無効化は行わない。

## 公式一次資料

- [Better Auth installation](https://better-auth.com/docs/installation) — 依存関係と最新 package version の確認。
- [Better Auth database concepts](https://better-auth.com/docs/concepts/database) — core table、account/session、D1 adapter のモデル。
- [Better Auth 1.5: Cloudflare D1](https://better-auth.com/blog/1-5) — D1 binding、batch、interactive transaction の制約。
- [Better Auth Hono integration](https://better-auth.com/docs/integrations/hono) — Workers の `nodejs_compat`。
- [Better Auth security reference](https://better-auth.com/docs/reference/security) — scrypt の既定と password hash/verify の差し替え。
- [Better Auth OAuth concept](https://better-auth.com/docs/concepts/oauth) — social provider の共通モデル。
- [Apple](https://better-auth.com/docs/authentication/apple)、[Google](https://better-auth.com/docs/authentication/google)、[GitHub](https://better-auth.com/docs/authentication/github)、[Discord](https://better-auth.com/docs/authentication/discord) — provider 固有の client、scope、callback 条件。
- [Apple Developer: configuring your webpage for Sign in with Apple](https://developer.apple.com/documentation/signinwithapple/configuring-your-webpage-for-sign-in-with-apple) — user object/name の初回提供と identity token の email claim。
- [Better Auth 2FA plugin](https://better-auth.com/docs/plugins/2fa) — TOTP/OTP、backup code、schema、OAuth の既定 policy。
- [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238) — test-only TOTP counter/HMAC routine の仕様。
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/) — CPU、memory、startup の上限。
- [Cloudflare Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/) — workerd/Miniflare の local binding test。
- [Cloudflare Workers Vitest configuration](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/) — test-only auxiliary Worker と service binding。
