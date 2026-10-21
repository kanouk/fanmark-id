# fanmark.id リファクタリング計画（Cloudflare移行後）

> **目的**: 2026-10-20のCloudflare全面移行で役目を終えた「移行期の二重構造」を安全に解消し、
> Cloudflare Workers / Better Auth / split D1 / R2 を前提とした単一構造へ整える実装指示書。
> 各Phaseは独立したPRとしてAIコーディングエージェントが実装できる粒度で書く。
>
> **作成日**: 2026-10-21（main `2e4a43d` の実測に基づく）
> **前計画**: [2026-06-12版](history/REFACTORING_PLAN-2026-06-12.md)はSupabase Edge Functions前提で、
> Phase 5/6.2（Edge Functions共通化・分割）は無効。フロント側の指摘（デッドコード・分割・strict化）は
> Phase 5/6として本計画に引き継ぐ。

---

## 0. 現状分析サマリー（2026-10-21 実測）

### 規模

| 領域 | 規模 |
| --- | --- |
| `src/components` | 124ファイル / 25,578行（`ui/` 49ファイル含む） |
| `src/pages` + `src/hooks` | 27 + 36ファイル / 13,853行 |
| `src/lib` | 112ファイル / 17,212行（テスト除く。`*.test.ts` 48本は別） |
| `src/data/emojiCatalog.ts` | 84,492行 / 2.0MB（本番では未使用。後述） |
| `workers/api/src` | 127ファイル / 36,360行（flat構成、`.mjs` 15本 + 手書き`.d.mts` 8本） |
| `workers/api/test` | 99ファイル、vitest設定45本、wrangler test設定41本 |
| `scripts/migration` | 322ファイル / 4.0MB |
| `docs/migration` | 151文書 + `evidence/` 318ファイル / 5.8MB |
| `supabase/` | 3.4MB（Edge Functions 33本、migrations 29本、archive 187本） |
| `experiments/` | 3パッケージ / 872KB |
| `package.json` scripts | 131本 |

### ベースライン健全性

| チェック | 結果 |
| --- | --- |
| `npm run typecheck` | ✅ 通過。ただし`strict: false` / `noImplicitAny: false` / `strictNullChecks: false` |
| `npm --prefix workers/api run typecheck` | ✅（Worker側は`strict: true`） |
| `npm run lint` | ❌ **93エラー / 21警告**。うち**48件は`supabase/functions`**（旧Edge Functions）。残り45件の主因は`no-explicit-any`（36件） |
| `vite build --mode cloudflare-production` | ✅ `index-*.js` **2,368KB（gzip 674KB）** 単一チャンク + `emojiCatalog-*.js` 1,430KB（gzip 441KB） |
| PWA precache（`sw.js`） | 上記**両方**を precache する。本番は`VITE_EMOJI_CATALOG_BACKEND=worker`でカタログをWorkerから取得するため、**1.4MBのemojiCatalogチャンクは一度も実行されないのに全PWAクライアントがダウンロード・保存している** |
| 翻訳キー整合（ja/en/ko/id） | ✅ 欠落なし（en/idに`planDowngrade.selectionComplete`が1件余分なだけ） |
| CI | `cloudflare-migration-validation.yml`（2 job、PostgreSQL / supabase storage-api のDockerを起動して**一回限りの移送helper**を検証）+ `supabase-deploy.yml`（名前と裏腹に検証のみ） |

### 主要な負債（定量）

**A. フロントの二重バックエンド（移行期のstrangler残骸）** ★最大

| 指標 | 値 |
| --- | --- |
| `VITE_*_BACKEND` セレクタ | **45種**。`build:cloudflare-staging`スクリプトに全列挙し、`build-cloudflare-production.mjs`がそれをパースして固定する |
| `"supabase"`分岐を持つ`src/lib/*-api.ts` | **37モジュール**（`"supabase"`リテラル115箇所）。各モジュールに`getXxxBackend()`と両系統の実装・テストがある |
| `@/integrations/supabase/client`をimportする非テストファイル | **66**（components 27 / hooks 23 / pages 12 / lib 4） |
| `supabase.functions.invoke` | 37箇所 / 18ファイル（例: `FanmarkDashboard.tsx`の`return-fanmark`, `create-extension-checkout`） |
| `supabase.rpc` / `supabase.from` / `supabase.storage` | 31 / 10 / 6箇所 |
| `supabase.auth.*` | 44箇所 / 15ファイル（`MFAChallenge.tsx` / `MFAEnrollment.tsx`はSupabase MFA専用。`AdminAuth.tsx`がBetter Auth MFAと並行して保持） |
| 本番bundle | `@supabase/supabase-js`が同梱され、`supabase-disabled.invalid`へのダミークライアントを生成している |
| `npm run dev` | 旧既定値（停止済みSupabase）を向く。**ローカル開発の正規経路が存在しない**（TECH.mdも「通常本番の再現には使わない」と明記） |

**B. Worker側の選択子と旧経路**

| 指標 | 値 |
| --- | --- |
| `Env`型のキー | **121**（`repository.ts`） |
| `*_BACKEND`参照 | 40種以上。うち`AUTH_BACKEND`の参照が**約60箇所**（`index.ts`内で`!== "better-auth"`を30回以上繰り返す） |
| 旧Supabase経路 | `legacy-supabase-auth.ts`、`profile-supabase-repository.ts`、`availability-repository.ts`（Supabase RPC）、`createSupabaseRecentFanmarksRepository`、`configuredSupabase{Url,Key,Timeout}`、`index.ts`の`PROFILE_BACKEND === "supabase"`分岐2箇所 |
| `index.ts` | **1,987行**、import 74、`handle*Request` 47種を1関数`handleRequest`で順次ディスパッチ |
| 重複ヘルパ名（ファイル横断） | `json`×40、`database`×23、`fail`×21、`originHeaders`×17、`isRecord`×17、`readBody`×11、`cors`×10、`corsHeaders`×7 |
| JS/TS混在 | `.mjs` 15本（`license-grace-finalization-source.mjs` 1,635行、`verified-access.mjs` 1,193行 等）に手書き`.d.mts` 8本。`utc-timestamp`は`.mjs`と`.ts`の**両方**が存在 |
| テスト設定 | 機能ごとに`vitest.<feature>.config.mjs` + `wrangler.<feature>-test.jsonc`の対（45 + 41）。`npm test`は`&&`で40以上を直列連結 |
| 命名 | `staging-backup*.ts`を本番でも使用（ARCHITECTURE.mdが注記で補っている） |

**C. 移行完了後に役目を終えた資産**

| 対象 | 状態 |
| --- | --- |
| `supabase/`（functions / migrations / archive / `remote_schema*.sql` / `config.toml`） | 停止原本。lintエラー48件の発生源。`package.json`の`db:*` / `supabase` / `build:legacy`も同様 |
| `src/integrations/supabase/`（`types.ts` 2,394行） | 生成型。参照は3ファイルのみ |
| `.env`（追跡済み） | 旧Supabase公開設定。`.gitignore`で除外指定済みだが追跡されたまま |
| `lovable-tagger` / `.lovable/` / package名`vite_react_shadcn_ts` | Lovable時代の残骸。`.lovable/`のscanner規則はCLAUDE.mdへ転記済み |
| `scripts/migration`（322本） | `test-*` 110、`staging-*` 37、`production-*` 30、`source-*` 16。大半が一回限りの移送・freeze・鍵custody helper。ただし**Worker側vitest設定12本・test 21本が`scripts/migration/business-migration-ledger.mjs`等を直接import**している |
| `experiments/`（3パッケージ） | `stripe-receipts`はCIが毎回`npm ci`してテスト実行 |
| `.github/workflows` | 2本ともPostgreSQL/Storage Dockerや移送検証を含み、通常開発の変更に対して過大 |
| `docs/migration/` | 現行API契約（`*-api.md` 等）と当時の作業票（`RESUME-*`, `HANDOFF.md`, `evidence/`）が混在 |

**D. フロント構造（前計画から継続、再検証済み）**

| 対象 | 値 |
| --- | --- |
| 未参照コンポーネント | `AdminPatternRules`(260) `FanmarkQuickRegistration`(307) `FanmarkRegistrationForm`(475) `GraceStatusCountdown`(50) `PWAInstallPrompt`(84) `ThemeToggle`(33) = 1,209行 |
| 未参照 shadcn/ui | `aspect-ratio` `breadcrumb` `context-menu` `drawer` `hover-card` `menubar` `navigation-menu` `radio-group` `resizable` `scroll-area` `sidebar`(637) `toggle-group` = 12ファイル / 1,511行 |
| 未参照 hook / lib | `useFanmarkSession.tsx`(62)、`emoji-master-utils.ts`(304、`scripts/test-emoji-conversion.ts`のみが参照) |
| 1,000行超 | `FanmarkDashboard` 1,864 / `FanmarkSettings` 1,202 / `AdminBroadcastEmail` 1,139 / `Profile` 1,107 / `AdminUserManagement` 1,009（続いて`PlanSelection` 918, `FanmarkAcquisition` 839, `Auth` 838, `EmojiInput` 815, `Analytics` 801） |
| ルート分割 | なし。`App.tsx`が27ルートを静的import |
| データ取得 | `useEffect` 140箇所 vs React Query利用8ファイル |
| トースト / ローディング演出 | `sonner`直接利用7ファイル vs `use-toast` 41ファイル（+ エイリアス2本） / 同型ローディング5本 |
| TypeScript / ESLint | `strict: false`、`no-unused-vars: off` |

---

## 実装エージェント向け 共通ルール（全Phase適用）

[AGENTS.md](../AGENTS.md)と[CLAUDE.md](../CLAUDE.md)に加え、以下を守る。

1. **1 Phase = 1ブランチ = 1 PR**（大きいPhaseはサブ番号ごと）。ブランチ名は`refactor/phase-{N}-{slug}`。
2. **本番挙動の変更ゼロ**。本番buildの出力が同じリクエストに同じレスポンスを返すこと。
   例外は明示する: Phase 1は`npm run dev`の接続先を（停止済みSupabaseから）ローカルWorkerへ変える。
3. **旧Supabaseへ再接続しない・一回限りhelperを再実行しない**。削除・移動の対象であっても、実行して確かめる作業は禁止。
   移送helperの「HEAD/phase保護」を更新して通る状態にしない。
4. **削除前に参照ゼロを再確認**（本書の判定は2026-10-21時点）:
   ```sh
   grep -rn "<名前>" src workers scripts docs --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.md" | grep -v "<定義ファイル>"
   ```
5. **各Phaseの完了条件（共通）**:
   ```sh
   npm run typecheck && npm --prefix workers/api run typecheck
   npm run lint                       # 既存エラー数から増やさない。Phase 6で0にする
   npm run build                      # Node 22.6.0。chunkサイズを計測ログへ記録
   npm run check:production-live-config
   npm --prefix workers/api run build:dry-run
   ```
   ＋ 当該Phaseで触ったモジュールの`src/lib/*.test.ts`とWorker契約テスト。
6. **秘密・実データ・本番配備に触れない**。CIは検証のみ。本番への反映は[更新手順](operations/deployment.md)に従い別operationで行う。
   Workerの実行コードを変えたPhaseは、PR説明に「配備が必要」と明記する。
7. **ドキュメント同期**: ファイルの削除・移動・新設と同じPRで`docs/ARCHITECTURE.md` / `docs/TECH.md`の該当箇所を更新する。
   履歴文書（`docs/history/`, `docs/migration/`の作業票）は**書き換えない**。移動のみ。
8. **進捗**: 各Phase末尾のチェックリストを完了時に`[x]`へ更新し、計測ログに追記する。

---

## Phase全体像と依存関係

| Phase | 内容 | リスク | 規模 | 依存 |
| --- | --- | --- | --- | --- |
| **0** | 計測基準とローカル開発経路の確立 | 低 | 小 | なし |
| **1** | フロントの二重バックエンド解消（Supabase経路の除去） | 中 | 大 | 0 |
| **2** | レガシー資産の削除（Lovable / supabase / Worker旧経路） | 低 | 中 | 1（2.1は0のみ） |
| **3** | 移行ツール・CI・移行文書の整理 | 低〜中 | 中 | 2 |
| **4** | Worker構造の整理（分割・共通化・TS化・テスト設定統合） | 中 | 大 | 3 |
| **5** | フロント構造の整理（デッドコード・分割・React Query・巨大ファイル） | 中 | 大 | 1 |
| **6** | TypeScript厳格化 & Lintゼロ化 | 中 | 中 | 2, 5 |
| **7** | ドキュメント最終同期 | 低 | 小 | 全部 |

Phase 4（Worker）と Phase 5（フロント）は独立しており並行できる。Phase 2.2（supabase/配下の物理削除）は
[旧Supabaseの保持終了条件](migration/production-operations.md#旧supabaseの保持終了を判断する条件)の判断後に行う。
それまでは削除せず、Phase 1で**参照だけを先に断つ**。

---

## Phase 0: 計測基準とローカル開発経路

**目的**: 二重バックエンドを外す前に、「本番相当のローカル環境」を用意する。現状`npm run dev`は停止済みSupabaseを向くため、
Phase 1の変更を目視確認する手段が無い。

### 0.1 計測ログのベースライン記録

本書末尾の計測ログに、§0の数値（bundle / lint / 行数 / テスト数）を記録する。

### 0.2 ローカル開発経路 `npm run dev:local` の確立

`scripts/migration/test-owner-profile-editor-local.mjs`は、loopback HTTPS・合成Auth・ローカル分割D1/R2・ローカルWorkerを
組み立てて画面を検証する既存harnessである（[TECH](TECH.md)参照）。これをテストから切り離し、常駐型の開発サーバーとして再利用する:

1. harnessの「環境組み立て」部分を`scripts/dev/local-stack.mjs`へ抽出する（wrangler `--local`で3つのD1 + 2つのR2、
   `BETTER_AUTH_URL`等を合成値で設定、全`*_BACKEND`を本番と同じ値に固定）。
2. Viteは`VITE_FANMARK_API_BASE_URL`等を同一originのローカルWorkerへ向ける。`npm run dev:local`で両方を起動する。
3. 合成管理者と一般ユーザーのseed（既存harnessにある）を流用する。
4. TECH.mdの「開発サーバー・build・preview」表に`dev:local`を追加し、`npm run dev`の注意書きを「Phase 1完了後に削除」と注記する。

**受け入れ**: `npm run dev:local`でトップ→検索→取得→ダッシュボード→設定が合成データで操作できる。本番・stagingの遠隔bindingを一切使わない。

### 0.3 フロント単体テストの集約コマンド

`src/lib/*.test.ts` 48本は個別の`test:*`スクリプトでしか起動できない。`"test": "node --experimental-strip-types --test src/lib/*.test.ts"`
を追加し、以降のPhaseの完了条件に含める。（個別スクリプトはPhase 3.2で整理する）

### ✅ Phase 0 完了チェックリスト

- [ ] 計測ログにベースライン記録
- [ ] `npm run dev:local`が合成環境で起動し、主要導線を目視確認できる
- [ ] `npm test`で`src/lib`の全テストが通る

---

## Phase 1: フロントの二重バックエンド解消 ★最重要

**目的**: `"supabase"`分岐・`VITE_*_BACKEND`・`@supabase/supabase-js`をフロントから消し、`src/lib/*-api.ts`を唯一のAPI層にする。
**本番buildは既に全セレクタが`worker`固定**なので、本番挙動は変わらない。

### 1.1 `src/lib` のセレクタと旧分岐を除去（37モジュール）

モジュールごとに1コミット。各モジュールで:

1. `getXxxBackend()`と`VITE_XXX_BACKEND`参照を削除し、`worker`実装を唯一の実装にする
   （例: `favorites-backend.ts`は`favorites-api.ts`のworker関数を直接exportする形に畳む）。
2. `normalizeSupabase*`等、Supabase応答の正規化関数とそのテストケースを削除する。
3. `*.test.ts`の「backend未設定→supabase」「`VITE_*=worker`」系のケースを削除し、worker契約のケースのみ残す。
4. **残すもの**: `main-site-url.ts` / `recent-fanmarks.ts`のAPI base URL解決、`ProfileApiError`等のエラー型、タイムアウト・応答サイズ制限。

順序（依存が少ない順）: `favorites` → `notifications` → `system-settings` / `maintenance-settings` → `public-access` / `verified-access` → `fanmark-*`（search, details, profile, settings, return, registration, lottery, transfer, analytics, access-analytics）→ `profile` / `subscription` / `account-deletion` → `stripe-*` → `admin-*` / `invitation` / `waitlist` / `lifecycle` / `extension-coupon`。

### 1.2 認証: `isBetterAuthEnabled()` の定数化と `supabase.auth.*` の除去

1. `src/lib/auth-backend.ts`の`isBetterAuthEnabled()`は`MODE`判定を止め、常にBetter Authとする（関数自体は1.5で削除）。
2. `useAuth.tsx`: `Session`型と`supabase.auth.getSession/onAuthStateChange/signOut`分岐を削除。`applySession`系の旧経路を消し、
   `applyBetterAuthSession`のみ残す。
3. `useAuthForm.tsx` / `usePasswordReset.tsx` / `ForgotPassword.tsx` / `PasswordSetup.tsx` / `AdminAuth.tsx`: Supabase auth呼び出しを
   `better-auth-client.ts`経由に置換（Better Auth側の機能が既に本番稼働しているものだけ。無い機能は分岐ごと削除し、PRで列挙する）。
4. `components/auth/MFAChallenge.tsx` / `MFAEnrollment.tsx`: Supabase MFA専用。唯一の参照元`AdminAuth.tsx`(529行)は
   Better Auth MFA経路と旧経路を両方持つので、Better Auth経路だけ残して2コンポーネントを**削除**する。
   一般ユーザー向けMFAの要否はPRODUCT.mdと突き合わせ、無ければ仕様判断として付録Aに回す。

### 1.3 `supabase.functions.invoke` / `rpc` / `from` / `storage` の置換（67ファイル）

対応表（`grep -rn "functions.invoke\|supabase.rpc\|supabase.from\|supabase.storage" src`で洗い出し、PRに表を載せる）:

| 旧呼び出し | 置換先（既存の`src/lib`） |
| --- | --- |
| `invoke('return-fanmark')` / `bulk-return-fanmarks` | `fanmark-return-api.ts` |
| `invoke('create-extension-checkout')` / `create-checkout` / `change-subscription` / `customer-portal` / `check-subscription` | `stripe-*-api.ts` / `subscription-api.ts` |
| `invoke('apply-fanmark-lottery')` / `cancel-lottery-entry` | `fanmark-lottery-api.ts` |
| `invoke('*-transfer-*')` 5種 | `fanmark-transfer-api.ts` |
| `invoke('admin-*')` 5種 / `reset-fanmark-data` / `send-broadcast-email` / `manual-expire-grace-licenses` | `admin-user-management-api.ts` / `admin-data-reset-api.ts` / `admin-broadcast-email-api.ts` / `lifecycle-run-api.ts` |
| `rpc('is_admin')`（`MaintenanceGate`）、`rpc('get_favorite_fanmarks')` 等 | admin session API / 各`*-api.ts` |
| `supabase.storage.*`（avatar / cover upload） | `storage-api.ts` |
| `supabase.from(...)`（`useSubscription`, `useAuth`の`user_settings`直読み 等） | `subscription-api.ts` / `profile-api.ts` |

置換先が存在しない呼び出しが見つかった場合は**実装を足さず**、その機能が本番で動いているかをWorker側ルートで確認し、
動いていなければ「本番で既に到達不能な機能」としてPRに列挙して削除する（仕様判断はユーザーに委ねる）。

`hooks/components`側の`getXxxBackend() !== 'worker'`ガード3箇所（`useProfile`, `FanmarkDashboard`, `PlanSelection`）も削除する。

### 1.4 `useSubscription` の realtime 分岐

`supabase.channel`による購読は`backend === 'supabase'`分岐内のみで、本番はpollingの`usePlanProjectionPolling`を使う。分岐ごと削除する。

### 1.5 依存と設定の除去

1. `src/integrations/supabase/`を削除。`types.ts`を参照する3ファイルは、必要な型を各`*-api.ts`の既存interfaceへ寄せる。
2. `npm uninstall @supabase/supabase-js`。
3. `.env`を`git rm --cached`し、`.env.example`（キー名のみ、値なし）へ置き換える。TECH.mdの「追跡済み`.env`」注記を削除。
4. `vite.config.ts` / `src/integrations/supabase/client.ts`由来の`MODE === 'cloudflare-production' | 'cloudflare-staging'`分岐（src内5箇所）は、
   Supabase無効化のためだけに存在するものを削除する。PWAの`cacheId`切替は残す。
5. `scripts/build-cloudflare-production.mjs`: `build:cloudflare-staging`スクリプトからセレクタをパースする仕組みを廃止し、
   Node版固定・origin固定・env隔離のみ残す。`scripts/test-cloudflare-production-build.mjs`の`legacySupabaseDisabled`検証を、
   「bundleに`supabase`文字列が含まれない」検証へ置き換える。
6. `package.json`の`build:cloudflare-staging`から`VITE_*_BACKEND=...`列挙を外す。

### 受け入れ基準

- `grep -rn "supabase" src/ --include=*.ts --include=*.tsx` が**0件**（コメント含む）。
- `grep -rn "_BACKEND" src/` が0件。
- 本番bundleに`@supabase/supabase-js`が含まれない（`grep -c supabase dist-cloudflare-production/assets/index-*.js` = 0）。
- `npm run dev:local`で§0.2の導線が動く。`npm test`と該当Worker契約テストが通る。
- 本番buildのAPIリクエスト（パス・メソッド・ヘッダ）が変更前と一致する（Phase 0のharnessでリクエストログを比較）。

### ✅ Phase 1 完了チェックリスト

- [ ] `src/lib` 37モジュールからセレクタと旧分岐を除去、テスト更新
- [ ] `useAuth`ほか認証系からSupabase auth除去、MFA旧コンポーネント削除
- [ ] `functions.invoke` / `rpc` / `from` / `storage` 直書き0
- [ ] `src/integrations/supabase`・`@supabase/supabase-js`・追跡`.env`を削除
- [ ] 本番build scriptとテストを新構成に更新
- [ ] ARCHITECTURE.md「残存するSupabase分岐は…」の注記、TECH.md「`VITE_*_BACKEND`とWorkerのselectorの両方を見る」を更新

---

## Phase 2: レガシー資産の削除

### 2.1 即時に安全なもの（Phase 0完了後、Phase 1と並行可）

| 対象 | 作業 |
| --- | --- |
| `lovable-tagger`、`vite.config.ts`の`componentTagger`、`.lovable/` | 削除。package名を`fanmark-id`へ |
| `package.json` の `supabase` / `db:start` / `db:stop` / `db:reset` / `db:status` / `db:push` / `build:legacy` | 削除 |
| `eslint.config.js` | `ignores`に`supabase/**`, `experiments/**`, `scripts/migration/**`, `dist-*`を追加（物理削除までの暫定。48件が消える） |
| `.github/workflows/supabase-deploy.yml` | 削除。`scripts/check-supabase-workflow.mjs`と`scripts/test-workflow-local-auth-isolation.mjs`は
  両方ともこのファイルを読むので、前者は削除、後者は`cloudflare-migration-validation.yml`のみを検査する形に書き換えて`check:ci`を更新する |
| `workers/api/src/utc-timestamp.mjs` と `.d.mts` | `.ts`版へ統一（importerは25本。機械的置換） |

### 2.2 旧Supabase保持終了の判断後に行うもの

| 対象 | 作業 |
| --- | --- |
| `supabase/`（全体） | 削除。`docs/history/README.md`に「原文はcommit `2e4a43d`以前で取得できる」と1行追記。
  `migrations_archive`等は再適用しないため、Gitの履歴で十分 |
| `src/lib`テスト・`scripts`内のSupabase用fixture | 削除 |
| Worker旧経路: `legacy-supabase-auth.ts`、`profile-supabase-repository.ts`、`availability-repository.ts`、
  `repository.ts`の`createSupabaseRecentFanmarksRepository` / `configuredSupabase*` / `isAllowedSupabaseKey`、`index.ts`の`PROFILE_BACKEND === "supabase"`分岐 | 削除。`Env`から`SUPABASE_*`キーを外す。**`STORAGE_LEGACY_ORIGIN`は保存済み旧Storage URLのR2 URL変換に使うため残す** |
| `experiments/cloudflare-auth`, `experiments/cloudflare-d1-concurrency` | 削除（検証済み。CIから参照なし）。`experiments/stripe-receipts`はPhase 3.3でCIから外した後に削除 |

**配備**: Worker実行コードが変わるため、Phase 2.2のPRは「配備が必要」。

### ✅ Phase 2 完了チェックリスト

- [ ] 2.1: Lovable残骸・旧scripts・旧workflow削除、lint対象を現行コードに限定
- [ ] 2.2: `supabase/`・Worker旧経路・experiments削除（保持終了判断の記録をPRにリンク）
- [ ] `grep -rni supabase workers/api/src` が `STORAGE_LEGACY_ORIGIN`関連のコメント以外0件

---

## Phase 3: 移行ツール・CI・移行文書の整理

**目的**: 一回限りの移送helperを通常開発の経路（CI・`package.json`・Worker test）から切り離す。
**削除ではなく隔離**を基本にし、再実行されない形で保存する（AGENTS.mdの方針）。

### 3.1 `scripts/migration` の分類と移動

322本を次の3区分に分け、PRに一覧表を載せる:

| 区分 | 例 | 移動先 |
| --- | --- | --- |
| **(a) 継続運用で使う** | `production-preparation-audit.mjs --check`、`check-production-live-config.mjs`、`scheduled-job-coverage.mjs`、`business-migration-ledger.mjs`（Worker testが依存）、backup点検系、`test-owner-profile-editor-local.mjs`（Phase 0で`scripts/dev/`へ） | `scripts/ops/` または `workers/api/tools/` |
| **(b) 現行コードの回帰テスト** | `test-frontend-callsite-mapping.mjs`、`test-safe-diagnostics.mjs`、`test-scheduled-job-coverage.mjs`、`test-wrangler-migration-selectors.mjs`、`test-production-runtime-config.mjs` 等、`workers/api/src`をimportする`test-*` | `workers/api/test/` または `scripts/test/` |
| **(c) 一回限りの移送helper** | `source-*`（freeze/pause/drain）、`production-*import*`、`*-r2-import*`、`*credential-lease*`、`auth-identity-preflight`、`staging-*-smoke`（遠隔書込みを含む）、`apply-*`、`run-*` | `scripts/migration-archive/`（READMEに「再実行禁止・HEAD/phase保護を更新しない」を明記）|

Worker側vitest設定12本・test 21本が`../../scripts/migration/*`をimportしている。(a)/(b)の移動と同時にimportパスを更新する。
`workers/api/src`から`scripts/`へ向かう依存が無いことを確認する（現状なし）。

### 3.2 `package.json` scripts の整理（131 → 30本以下）

残す: `dev` `dev:local` `build` `build:cloudflare-staging` `preview` `typecheck` `lint` `test` `test:worker`（= `npm --prefix workers/api test`）
`check:ci` `check:cloudflare-schedules` `check:production-live-config` `test:cloudflare-production-build` `test:app-startup`
`test:staging-asset-retention` `test:emoji-*` `build:cloudflare-production-*:dry-run`。
削除: 個別の`test:<module>-api`（`npm test`に統合）、account IDを埋め込んだ`test:migration:*`、`migration:*`、`verify:*`、`test:staging-*-smoke`（(c)へ）。

### 3.3 CI の再構成

`cloudflare-migration-validation.yml`を`ci.yml`へ改名し、2 jobに絞る:

- **app**: `npm ci` → `typecheck` → `lint` → `test` → `test:app-startup` / `test:staging-asset-retention` / `test:cloudflare-production-build` →
  `build`（Node 22.6.0）→ `build:cloudflare-production-worker:dry-run` → `check:production-live-config` → `test:staging-profile-editor-local`（合成環境のブラウザ結合）
- **worker**: `npm ci` → `typecheck` → `test` → `build:dry-run` → `check:cloudflare-schedules`

外す: PostgreSQL / supabase storage-api Docker、`test:migration-data`（(b)に残した分は`npm test`経由で実行）、`test:source-*`、
`experiments/stripe-receipts`、`test-legacy-profile-supabase-local.mjs`。`check:ci`の検査対象を新workflowへ更新する。
CIは引き続き秘密・配備権限を持たない。

### 3.4 `docs/migration` の再配置

| 内容 | 移動先 |
| --- | --- |
| 機能別API契約（`*-api.md`, `storage-r2-app-api.md`, `storage-image-url-mapping.md`, `verified-access-design.md`, `stripe-ledger-design.md` 等） | `docs/api/` |
| `production-operations.md` | `docs/operations/production-operations.md` |
| `RESUME-*`, `HANDOFF.md`, `*-validation.md`, `evidence/`, staging受入れ記録 | `docs/history/migration/`（内容は変更しない） |

ARCHITECTURE.md / TECH.md / operations / history README のリンクを更新する。`docs/history/README.md`の
「`docs/migration/`には現在のAPI契約と過去の操作票が混在する」の注記を解消する。

### ✅ Phase 3 完了チェックリスト

- [ ] `scripts/migration`を(a)(b)(c)に分類・移動、archive READMEに再実行禁止を明記
- [ ] `package.json` scripts 30本以下
- [ ] CIが2 jobでDocker不要、所要時間を計測ログに記録
- [ ] `docs/api/`・`docs/operations/`・`docs/history/migration/`へ再配置、リンク切れ0（`grep -rn "migration/" docs/*.md`で確認）

---

## Phase 4: Worker構造の整理

**目的**: `index.ts`のモノリスと選択子の網を解き、ドメイン単位の構造にする。Worker側は既に`strict`かつ契約テストが厚いので、
テストを変えずに内部を動かせる。

### 4.1 選択子（`*_BACKEND`）の存続基準

**ルール**: 現行の配備設定（`wrangler.app-production.jsonc` / `wrangler.app-staging.jsonc` / test用jsonc）で**2つ以上の値が実際に使われている**
選択子だけ残す。残す候補: `NOTIFICATION_WAKE_BACKEND`（durable-object）、`EMOJI_PUBLICATION_BACKEND`（production-service）、
`AUTH_EMAIL_BACKEND`（resend）、`BROADCAST_SEND_BACKEND`（stagingで`disabled`）、`D1_TOPOLOGY`、`CUTOVER_WRITE_FREEZE` / `RECOVERY_WRITE_FREEZE`。
それ以外（`FAVORITES_BACKEND=d1`等、`d1`以外の値が存在しないもの）は削除し、`Env`から外す。
「未設定なら503」という防御は、選択子ではなく**binding存在チェック**（`env.FANMARK_DB`が無ければ503）に置き換える。

`AUTH_BACKEND !== "better-auth"`の64箇所は、`/api/`配下のディスパッチ入口で1回だけ`requireAuthConfigured(env)`を呼ぶ形に畳む。
wrangler test設定からも該当varを外す（選択子を削除した後はvarsが無くても同じ挙動になることをテストで確認）。

### 4.2 共通ヘルパの抽出

`workers/api/src/http/`に`response.ts`（`json` / `fail` / `empty` / `cors` / `originHeaders` / `readBody` / `readJson`）、
`validation.ts`（`isRecord` / `text` / `nullableText` / `requiredText` / `uuid` / `requireUuid` / `parseEmojiIds`）、
`d1.ts`（`database` / `databaseFor` / `assertD1`）、`stripe-client.ts`（`stripeClient`）を新設。
各`*-d1-api.ts`のローカル定義を1ファイルずつ置換する。**レスポンスヘッダとエラーコードを1バイトも変えない**（契約テストが検出する）。

### 4.3 `index.ts` の分割

```
workers/api/src/
  index.ts                 # fetch/scheduled のエントリ。freeze判定・owner acceptance・静的資産・API振り分けのみ（目標 200行）
  routes/
    auth.ts                # /api/auth/*, admin session, password setup
    public.ts              # recent / search / availability / public access / OGP / waitlist signup
    fanmark.ts             # owned / details / profile / settings / return / registration / lottery / transfer / analytics
    account.ts             # profile / subscription / favorites / notifications / account deletion / storage
    stripe.ts              # checkout / portal / plan change / webhook ingress
    admin.ts               # admin-* / master / reference / lifecycle / maintenance / system settings
    scheduled.ts           # cron dispatch
  auth/                    # better-auth.*, auth-email, auth-social, oauth-signup-provisioning, configuredAuth/createApplicationAuth
  http/                    # 4.2
```

`handleRequest`の順序依存（freeze → owner acceptance → waitlist → OGP → 静的資産 → API）は保ったまま、
各ルートファイルは`(request, env, ctx) => Promise<Response | null>`を返す関数に統一する。

### 4.4 `.mjs` の TypeScript 化

Phase 3で`scripts/migration`からの参照が archive へ移った後、15本を`.ts`へ変換し`.d.mts` 8本を削除する。
大きい順: `license-grace-finalization-source`(1,635) → `verified-access`(1,193) → `license-expiry`(884) → `license-expiry-source`(838) → `better-auth`(317)。
変換は型注釈の追加のみ。`better-auth.mjs`はimporter 35本・scriptsからの参照3本があるため最後に行う。

### 4.5 テスト設定の統合

`vitest.<feature>.config.mjs` 45本 + `wrangler.<feature>-test.jsonc` 41本を、vitestの`projects`と共通の`wrangler.test.jsonc`に統合する:

- 共通test設定は3つのD1（AUTH/FANMARK/MASTER）+ 2つのR2 + 合成secretを持ち、`vars`は4.1で残った選択子だけ。
- 機能ごとに異なるのは`include`と`provide`（migration SQL）のみなので、`projects`配列で表現する。
- 意図的に「binding無し」「選択子off」を試すテストは、専用projectとして残す（現状の`*-production-closed`等）。
- `npm test`の`&&`連結を`vitest run`＋`node --test test/*.integration.mjs`の2本にする。`fileParallelism: false`は維持。

### 4.6 命名とディレクトリ

- `staging-backup*.ts` → `operational-backup*.ts`（binding名・var名・Cronは変更しない。ファイル名とexport名のみ）。
- `src/`直下130本をドメインで分ける: `fanmark/` `stripe/` `admin/` `notifications/` `lifecycle/` `backup/` `recovery/` `storage/` `auth/` `http/`。
  移動はPhase 4の最後に1PRで行う（diffをrenameとして読めるようにする）。

### ✅ Phase 4 完了チェックリスト

- [ ] 選択子を存続基準で削減、`Env`キー数を計測ログに記録
- [ ] 共通ヘルパ抽出、重複定義（`json`×40等）が各1定義
- [ ] `index.ts` 200行以下、ルートはドメイン別
- [ ] `.mjs`/`.d.mts` 0本
- [ ] vitest設定が`projects`1本、`npm test`が2コマンド
- [ ] ARCHITECTURE.mdのファイルマップを新構成へ更新、配備が必要なPRを明記

---

## Phase 5: フロント構造の整理

Phase 1完了後、`src/lib`が唯一のAPI層になっている前提で進める。

### 5.1 デッドコード削除

- コンポーネント6本（§0-D）。`FanmarkRegistrationForm`はARCHITECTURE旧版にのみ記載。
- `ui/` 12本。`sidebar.tsx`は`sheet.tsx`等を参照するため12本まとめて削除し、`typecheck`で確認する。
- `useFanmarkSession.tsx`、`emoji-master-utils.ts`（参照元`scripts/test-emoji-conversion.ts`も一緒に削除するか、Phase 3(b)へ移した上で判断）。
- `hooks/useToast.ts`（エイリアス）、`components/ui/use-toast.ts`。
- 依存: `vaul`（drawer）、`react-resizable-panels`（resizable）、未参照`ui/`だけが使う`@radix-ui/react-*`（aspect-ratio, context-menu, hover-card,
  menubar, navigation-menu, radio-group, scroll-area, toggle-group）。**`embla-carousel-react` / `react-day-picker` / `cmdk`は現在も参照があるため残す**。
- `Profile.tsx`の「TODO: Re-enable when ... implemented」8箇所のコメントアウト済みUIは削除（履歴で復元できる）。

### 5.2 ローディング演出5本とトーストの統一

前計画 §2.1 / §2.2 をそのまま適用する。`sonner`直接利用7ファイル → `use-toast`。`next-themes`は`ui/sonner.tsx`のみが使うため同時に削除。

### 5.3 バンドル分割 ★ユーザー体感に直結

1. **emojiCatalogチャンクのprecache除外（即効・1行）**: `vite.config.ts`の`workbox.globIgnores`に`**/emojiCatalog-*.js`を追加する。
   本番はWorkerからカタログを取得するため、このチャンクは実行されない。PWA更新時の1.4MBダウンロードが消える。
   `test:staging-asset-retention`の期待値を更新する。
2. **bundled catalogの位置づけ整理**: `main.tsx`の「`VITE_EMOJI_CATALOG_BACKEND`未設定ならbundleから読む」分岐は、Phase 1でセレクタを外すと
   `dev:local`でもWorkerから読む形になる。`src/data/emojiCatalog.ts`を本番bundleから外し、`scripts/generate-emoji-catalog.ts`の出力先を
   Worker publication用に限定する（カタログ更新手順はTECH.mdの「絵文字マスタ更新」を参照し変更しない）。
3. **ルート分割**: `App.tsx`の27ルートを`React.lazy`化。効果が大きい順に Admin一式 → `Analytics`（recharts）→ `Profile` / `PlanSelection` → 残り。
   `MaintenanceGate` / `ProtectedRoute` / `AuthProvider`はlazy化しない。
4. **manualChunks**: 3の結果を見てから`vendor-react`のみ指定。過剰な手動分割はしない。
5. **受け入れ**: `/a/:shortId` 直撃時のJS合計 gzip 300KB以下。エントリチャンク gzip 300KB以下。PWA precacheの合計サイズを計測ログに記録。

### 5.4 データ取得の React Query 統一

前計画 §4.1 / §4.2 を適用する。`src/hooks/queries/`にqueryKey定数と共通フック（`useOwnProfile`, `useOwnedFanmarks`, `useSystemSettings`,
`useUnreadCount`）を置き、`useEffect`+`useState`での取得を画面単位で置換する。順序: `Favorites` → `Notifications` → `Profile` → `FanmarkSettings` → `FanmarkDashboard`。
`src/lib/*-api.ts`は既に「fetch + 検証 + エラー型」まで持つので、`queryFn`にそのまま渡す。

### 5.5 巨大ファイルの分割

「JSXの抽出より先にロジックのフック化」の原則で、1ファイル=1PR:

1. `FanmarkDashboard.tsx`(1,864) → `dashboard/` に `useDashboardLicenses` / `useReturnFlow` / `useExtensionFlow` と `LicenseCard` / `ReturnDialogs` / `ExtensionSection`
2. `FanmarkSettings.tsx`(1,202) → アクセスタイプ別フォーム4種 + パスワード保護 + SNSリンク
3. `AdminBroadcastEmail.tsx`(1,139) / `AdminUserManagement.tsx`(1,009) → 5.6のAdmin共通化と同時に
4. `Profile.tsx`(1,107) → `profile/AvatarSection` / `BillingSection` / `DangerZone`
5. `Auth.tsx`(838) + `useAuthForm.tsx`(540) → `LoginForm` / `SignupForm`、スキーマは`lib/auth-schemas.ts`
6. `PlanSelection.tsx`(918)、`FanmarkAcquisition.tsx`(839)、`EmojiInput.tsx`(815)、`Analytics.tsx`(801)は上記完了後

### 5.6 Admin CRUD 画面の共通化（任意）

前計画 §2.3。`AdminDataTable` / `ConfirmDeleteDialog` / `useAdminMutation`を`components/admin/shared/`に置き、最小の`AdminInvitationManager`で確立してから展開する。

### ✅ Phase 5 完了チェックリスト

- [ ] デッドコードと未使用依存の削除、`package-lock.json`更新
- [ ] ローディング・トーストの統一
- [ ] emojiCatalogのprecache除外、ルート分割、受け入れ基準達成（計測ログ）
- [ ] 主要5画面のReact Query化
- [ ] `src/`に1,000行超のコンポーネントがない
- [ ] ARCHITECTURE.mdの画面対応表を新構成へ更新

---

## Phase 6: TypeScript厳格化 & Lintゼロ化（フロント）

Worker側は既に`strict: true`。対象は`tsconfig.app.json` / `tsconfig.json`。

1. `noFallthroughCasesInSwitch` → `noUnusedLocals` / `noUnusedParameters` → `noImplicitAny` → `strictNullChecks` → `strict: true` の順に1オプションずつ。
   `!`非nullアサーションでの回避は禁止。ディレクトリ単位（`lib` → `hooks` → `components` → `pages`）でコミットを刻む。
2. ESLint: `@typescript-eslint/no-unused-vars`を`error`へ戻す。`no-explicit-any`（Phase 2.1後に残る36件）は実型を当てる。
   `react-hooks/exhaustive-deps` 10件は依存配列を修正する（挙動が変わる場合はPRで個別に説明）。
3. CIの`lint`をブロッキング化。
4. **Node版固定の見直し（判断事項）**: `build-cloudflare-production.mjs`は`22.6.0`完全一致を要求する。`--experimental-strip-types`の
   最低版という理由なら`>=22.6.0 <23`へ緩められる。理由が「本番buildの再現性」なら現状維持し、TECH.mdにその旨を明記する。

### ✅ Phase 6 完了チェックリスト

- [ ] `strict: true`で`npm run typecheck`エラー0
- [ ] `npm run lint`エラー0・警告0、CIでブロッキング
- [ ] Node版固定の方針を決定しTECH.mdに記載

---

## Phase 7: ドキュメント最終同期

1. `docs/ARCHITECTURE.md`の「本番の構造」「画面・操作から実装を探す」を新ディレクトリ構成で全面更新。
   「残存するSupabase分岐」「名前にstagingを含むが本番にも使う」の注記を削除。
2. `docs/TECH.md`のコマンド表・検証例・`VITE_*_BACKEND`記述を更新。`npm run dev`の注意書きを削除。
3. `CLAUDE.md` / `AGENTS.md` / `.cursorrules`: 「Security Scanner False Positive Rules」（Supabase RLS前提）を削除し、
   「旧Supabaseは停止原本」の記述を「削除済み（commit参照）」へ更新。`.cursorrules`の「Server Actions」等Next.js前提の文言を修正。
4. `README.md`の「最初のローカル確認」コマンド列を新scriptsへ更新。
5. 本書を完了レポートへ改題するか`docs/history/`へ移す。

---

## 計測ログ（各Phase完了時に追記）

| 時点 | index chunk (gzip) | PWA precache合計 | `src/`行数 | lintエラー | tsc設定 | `Env`キー | `package.json` scripts | CI所要時間 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ベースライン（2026-10-21） | 2,368KB (674KB) + emojiCatalog 1,430KB (441KB) | 約3.8MB | 約57,000行（+emojiCatalog 84,492行） | 93（うちsupabase/ 48） | strict: false | 121 | 131 | 未計測 |
| Phase 1 完了 | | | | | | | | |
| Phase 2 完了 | | | | | | | | |
| Phase 3 完了 | | | | | | | | |
| Phase 4 完了 | | | | | | | | |
| Phase 5 完了 | | | | | | | | |
| Phase 6 完了 | | | | | | | | |

---

## 付録A: 着手前にユーザーの判断が必要な事項

| # | 事項 | 本書の推奨 |
| --- | --- | --- |
| 1 | ローカル開発の正規経路（Phase 0.2） | 既存harnessを`dev:local`へ昇格し、`npm run dev`は廃止または`dev:local`のエイリアスにする |
| 2 | `supabase/`等の物理削除時期（Phase 2.2） | [保持終了条件](migration/production-operations.md#旧supabaseの保持終了を判断する条件)の判断（10月末見直し予定）後。それまではPhase 1で参照だけ断つ |
| 3 | 移送helperを archive に残すか削除するか（Phase 3.1(c)） | archive（Gitの履歴があるので削除でも復元可だが、AGENTS.mdの「再実行しない」運用を明文化したREADME付きで残す方が安全） |
| 4 | Worker選択子の存続基準（Phase 4.1） | 「配備設定で2値以上が使われている」もののみ残す |
| 5 | Node 22.6.0 完全一致固定（Phase 6.4） | 理由を確認の上、再現性目的なら維持 |
| 6 | 一般ユーザー向けMFA（Phase 1.2） | `MFAChallenge`/`MFAEnrollment`はSupabase MFA専用。Better Auth側に一般ユーザーMFAが無ければ、PRODUCT.mdの該当記述とともに整理する |

## 付録B: スコープ外（本計画では行わない）

- 機能追加・UI刷新・文言変更。`docs/operations/current-state.md`記載のモバイル表示崩れ（390×844で18px横はみ出し）は**不具合として別Issue**にする。
- D1 schema・migration sequenceの変更、R2のキー構造変更。
- i18nライブラリへの移行（自前`useTranslation` 143行、翻訳キーは4言語で整合済み）。
- `docs/history/`・移行作業票・evidenceの内容編集（移動のみ）。
- 本番への配備そのもの（各PRは「配備が必要」を明記するにとどめ、[更新手順](operations/deployment.md)に従って別途行う）。

## 付録C: 削除してはいけない「一見未使用」のもの

- `workers/api/src/staging-backup*.ts` / `recovery-set.ts` / `recovery-writer-drain.ts`: 名前にstagingを含むが本番のbackup/復旧実装。
- `STORAGE_LEGACY_ORIGIN`と`storage-image-url.*`: 保存済み旧Storage URLをR2 URLへ変換する。旧Supabaseへはfetchしない。
- `wrangler.*-production-closed.jsonc`: 開始前の履歴設定。`production-operations.md`が参照する。
- `scripts/migration/business-migration-ledger.mjs`: Worker契約テストがmigration SQLの適用順を得るために使用。Phase 3.1(a)で移動する。
- `clear-legacy-api-cache.js`（PWA）: 旧クライアントのAPI cache消去。`test:staging-asset-retention`が検証する。
