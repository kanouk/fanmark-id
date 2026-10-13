## 旧認証プロフィールのフロント接続と実Auth local試験（2026-10-13）

プロフィール取得/保存/ユーザー名確認を、現在のSupabase sessionから得たBearerでWorkerへ接続した。
Better Auth modeはcookieのみでSupabase sessionを読まない。返却プロフィールの本人IDを照合し、
旧Authのプロフィール確認中/失敗もAuthReadinessGateを閉じる。Sourceのユーザー名確認は固定RPCへ
検証済み本人IDだけを渡す。主キー+本人IDに限定したPATCHからlimitを除き、旧PostgRESTも扱う。

local workerd45件、client9件、認証/MFA/readiness14件、既存D1 profile12件、両型検査が成功。
隔離した実GoTrue v2.196.0 / PostgREST v14.17 / PostgreSQL17.6でも、実frontend client→実Worker→
署名検証/本人GET・保存・username RPC、他人の保持、偽造/権限変更拒否、ban後の旧JWT拒否の7項目が成功。
3 container/専用network/一時credentialsを除去し、既存container一覧の保持を照合した。
実際のAuth実装を用いたlocal確認であり、本番source版/全schema/遠隔TLS/実画面/Cloudflare配備の証明ではない。
起動・schema/search_path不足とloopback proxyのHTTP framing失敗も履歴に残す。通常V4配備や実データ変更0。
前候補a687c5dのCI38350082552は両job成功。追加分のexact-head CI、source bridgeの画面/remote受け入れと
当初条件レビューは残る。[限定証拠](evidence/legacy-profile-frontend-real-local-auth-2026-10-13.json)。

## 旧Supabase認証のプロフィール候補

`PROFILE_BACKEND=supabase` / `AUTH_BACKEND=supabase`を選ぶ同一URLのadapterを追加した。
[旧認証bridge](legacy-supabase-bridge.md)を参照。通常V4はD1/Better Authのまま。

## 2026-10-13: 実配備後の保存・再読込・cleanupを確認

修正ソースe511762/CI38315685393両job成功をmain cc82c298へ配備した。
同じChrome actorで画像未設定の表示名保存、D1のnull avatar/表示名反映、reload保持、logoutを確認した。
本人専用のAuth/profile行とoperatorを除去し、schema/共通Master/MFA世代を保持、writer0を確認した。
新avatar uploadと実スマホ全profile操作の受け入れには広げない。
[実画面の限定証拠](evidence/staging-v4-profile-empty-avatar-accepted-2026-10-13.json)。以下は修正前後の履歴。

## 2026-10-13: アバター未設定の実画面保存を修正（配備前）

V4の専用合成ownerでログイン後、画像未設定の表示名保存がHTTP400となり、D1に未保存だった。
フォームの未設定avatarは空文字で、clientがそのままPATCHしWorkerの所有者URL検証に拒否されていた。
実frontend client→Better Auth session→native Worker/D1の回帰を追加し、修正前の400を再現した。
client境界で空文字だけをnullに揃え、Workerのraw空URL拒否と別owner保持を維持する。
修正後のnative12件、client7件、app/Worker型と対象ESLintが成功した。実配備・同じ画面の再確認は後続。

# Own-profile Worker API

The staging profile client uses Better Auth and business D1 for the signed-in
user's profile. `GET/PATCH /api/me/profile` reads the session owner's row and
only permits display name, avatar URL, and preferred language updates. The
DTO includes the current plan and a read-only `requires_password_setup` flag,
but omits Stripe customer IDs and invitation codes.

`GET /api/me/username-availability?username=...` preserves the profile
availability check on the same Worker backend. The Worker derives the excluded
user ID from the Better Auth session, compares the lower-cased candidate with
other `user_settings.username` values in business D1, and returns only
`{schemaVersion: 1, available: boolean}`. The caller cannot supply an owner ID;
unknown/duplicate query parameters, oversized candidates, unsupported methods,
disallowed origins, and unauthenticated requests are rejected. Responses are
`no-store`. The endpoint is read-only and does not reserve or write usernames.

The frontend selects this route only when `VITE_PROFILE_BACKEND=worker` is
explicitly set. It sends the Better Auth cookie with same-origin validation,
bounded response parsing, and no-store caching. It does not retry against
Supabase when the Worker fails. The default/production selector remains
Supabase. User profile rows and existing Auth credentials remain outside this
staging change and the final user-data migration phase.

Successful Worker profile updates publish the validated profile to other
profile hooks in the same tab, including updates initiated by language
preferences. Worker-backed hooks quietly reload when the browser tab/window
becomes visible or focused, replacing the old Supabase Realtime refresh without
periodic D1 polling. Cross-tab changes are picked up when the tab returns to the
foreground.

Synthetic split-D1 coverage is in `workers/api/test/profile-d1.test.ts` and
client contract coverage is in `src/lib/profile-api.test.ts`. Run them with:

```sh
npm run --prefix workers/api test:profile-d1
npm run test:profile-api
```

## Source privilege guards and complete-schema CI (2026-10-03)

The current source INSERT/UPDATE/SELECT settings policies bind auth.uid() to
user_id. Its two plan-escalation triggers allow the service role/administrator
and reject unauthorized admin-plan inserts or plan changes. Target own-profile
PATCH accepts only display_name/avatar_url/preferred_language and uses the
Better Auth owner. Server signup selects free; privileged plan writes are named
MFA administrator or verified billing operations. Exact source definition
hashes and the full37-binding index are in
[source-trigger-counterparts.md](source-trigger-counterparts.md).

The existing10 native cases now use all25 canonical Business migrations and
Auth0003/0007/0008/0009, with staging suspension/OAuth-provisioning selection.
The invitation is seeded to satisfy its real FK, profile IDs are UUIDs, and
both stores' FK checks run after each case. The reduced fixture and its custom
privilege trigger are removed. Own/foreign row preservation, rejected identity/
privilege/billing fields, R2 upload/update/delete/readback and first-password
setup/retry pass10/10; Worker typecheck and focused lint pass. The existing
test:profile-d1 command now runs through test:api-contracts-d1 and normal
Worker CI. This changes verification, not runtime/profile/provider/data/DNS.
7a603bd CI37096588121 passed both jobs; the accepted runtime is stillbce8993/c09.
Exact source username-check behavior, owner exclusion and administrator
authority differences are in [source access helpers](source-access-helpers-review.md).
