# Cloudflare 移行: Better Auth 認証 feasibility

確認日: 2026-09-21 (JST)

この調査は、Supabase Auth の本番データを移行したり、Cloudflare のリモート
D1/Worker を変更したりするものではない。`experiments/cloudflare-auth/` に、
架空のユーザー、架空の UUID、架空の bcrypt hash だけを入れたローカル
Workers + D1 proof を置いた。OAuth の provider 登録、OAuth callback、MFA factor
移行、実データの export/import は実施していない。

## 結論

メール/パスワード認証の互換性については、条件付きでローカル feasibility を
確認できた。Better Auth `1.7.5` の D1 adapter を workerd 上で動かし、
`bcryptjs 3.0.3` をカスタム password verifier として渡すと、既存形式を想定
した `$2b$` bcrypt hash を検証できる。正しいパスワードでは synthetic user の
UUID が response と session の `userId` にそのまま残り、誤ったパスワードでは
`401` になり session は増えなかった。4 件の並列 sign-in でも各 session の
UUID 関係は保たれた。

これは「Better Auth へ実ユーザーを移行できる」証明ではない。実際の Supabase
hash の prefix/cost、実ユーザー ID の対応付け、MFA factor、provider の token と
profile の挙動、Cloudflare の CPU plan はまだ未確認であり、下記の gate を通す
必要がある。

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

`npm ci && npm test` の直近の実行では 3 tests passed となった。4 並列 sign-in の
ローカル wall time は `311 ms`、最初の cold sign-in は `4.475 s` だった。この時間は
workerd のテスト wall time であり、Cloudflare が請求する CPU time の測定値では
ない。テストの主張範囲は synthetic data とローカル runtime に限る。

## 検証した範囲

### bcrypt と UUID/session

- Better Auth の新規 password hash の既定は scrypt なので、今回の検証では
  `emailAndPassword.password.verify` と `password.hash` を明示的に差し替えた。
- `bcryptjs` の純 JavaScript 実装で synthetic `$2b$10$...` hash を workerd 内で
  検証できた。既存 hash を `account.password` に置き、`providerId =
  credential`、`accountId` と `userId` を同じ synthetic user UUID にした。
- UUID `11111111-1111-4111-8111-111111111111` は response、D1 `session.userId`、
  `get-session` response で一致した。4 並列の成功でも session 数は 4 増えた。
- 誤った password は `401` で、失敗リクエストによる session は作成されなかった。

この証明から、Supabase の hash が同じ bcrypt 互換形式だとは判断できない。
移行前に本番から hash を持ち出さずに prefix (`$2a$`, `$2b$`, `$2y$`)、cost、
encoding、account/user の対応をサンプリングして判定し、成功時に Better Auth の
新しい hash へ更新する方針と rollback を決める必要がある。今回の proof は新規
hash も bcrypt にしているため、scrypt/別方式へ再 hash する本番方針は未決定で
ある。

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
| Apple | Service ID/client ID、Team ID、Key ID、private key から ES256 client secret を生成。JWT は最長 6 か月。Apple は `email` claim を最初の認可時だけ返す。 | Apple Developer 側の Service ID/return URL、実 callback、初回 email claim 欠落時の account linking、既存 Supabase identity の対応。 |
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

この proof では plugin を有効にしておらず、Supabase の MFA factor/secret を
Better Auth の `twoFactor` schema に変換していない。したがって MFA を「移行
できる」とは判定しない。次の gate は、既存 factor の種類・状態・recovery code
を本番から安全に分類し、secret を移行可能か（または再登録を要求するか）決め、
credential と各 OAuth provider の challenge policy を staging で実行すること
である。TOTP secret を無理に export できない場合は、ユーザー再登録と旧 MFA
無効化の手順・期間を別途設計する。

## 未確認事項と次の gate

| surface | 今回の evidence | 未確認/次の gate |
| --- | --- | --- |
| D1 adapter | 公式 D1 support と local workerd/D1 の core auth/session | production schema parity、D1 batch の実負荷、migration rollback、remote resource policy |
| bcrypt import | synthetic `$2b$` の正しい/誤った password、session/UUID 関係 | 実 Supabase hash 形式/cost、CPU、成功時 rehash、失敗時の lock/rate limit |
| UUID | synthetic user/account/session で UUID を完全一致 | `auth.users.id` と identity/account の実対応表、既存 session の扱い、export/import rehearsal |
| Apple/Google/GitHub/Discord | 公式 docs と provider 設定項目の確認 | staging secret、実 callback、profile/email/null、link/unlink、origin/return URL |
| MFA | 公式 2FA plugin の schema/policy を確認 | Supabase factor の分類・移送可否、再登録、OAuth を含む challenge policy |
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
- [Better Auth 2FA plugin](https://better-auth.com/docs/plugins/2fa) — TOTP/OTP、backup code、schema、OAuth の既定 policy。
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/) — CPU、memory、startup の上限。
- [Cloudflare Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/) — workerd/Miniflare の local binding test。
