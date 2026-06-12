# fanmark.id 全体リファクタリング計画書

> **このドキュメントの目的**: 長年蓄積したコードベースの無駄を、フェーズに分けて安全に解消するための実装指示書。
> Codex / Cursor / Claude Code などのAIコーディングエージェントが、このドキュメントの各フェーズを独立したタスクとして実装できるレベルの詳細を記載する。
>
> **作成日**: 2026-06-12(コードベース実測調査に基づく)

---

## 0. 現状分析サマリー(2026-06-12 実測)

### コードベース規模

| 領域 | 規模 |
|---|---|
| `src/pages` | 27ファイル / 7,924行 |
| `src/components` | 122ファイル / 24,420行(うち `ui/` 49ファイル) |
| `src/hooks` | 33ファイル / 4,461行 |
| `src/data/emojiCatalog.ts` | **84,492行**(静的import される巨大データ) |
| `supabase/functions` | 33関数 / 約11,000行 |
| `supabase/migrations` | 19ファイル / 約15,000行 |

### ベースライン健全性(リファクタリング前の確定状態)

| チェック | 結果 |
|---|---|
| `bun run build` | ✅ 成功。ただし**単一バンドル 3,400KB(gzip 967KB)**、コード分割なし |
| `bunx tsc --noEmit` | ✅ 通過。ただし `strict: false`, `strictNullChecks: false`, `noImplicitAny: false` の緩い設定 |
| `bun run lint` | ❌ **131エラー / 43警告**(大半が `@typescript-eslint/no-explicit-any`) |
| テスト | **0件**(テストランナー自体が未導入) |
| CI | `supabase-deploy.yml` のみ(ビルド/リント/型チェックのCIなし) |

### 検出された主な無駄(定量)

| カテゴリ | 規模 | 詳細 |
|---|---|---|
| 未使用コンポーネント | 8ファイル / 1,301行 | §Phase 1 参照 |
| 未使用 shadcn/ui | 20ファイル / 約500行 | 未使用npm依存も道連れ |
| ローディング演出の重複 | 5ファイル / 556行 | 85〜95%同一コード |
| Edge Functions のボイラープレート重複 | `corsHeaders` 19箇所、`createClient` 23箇所、Stripe初期化 8箇所、JWT検証 12箇所 | §Phase 5 参照 |
| 巨大ファイル | フロント上位5件で約5,800行、Edge Functions上位3件で約2,400行 | §Phase 6 参照 |
| トースト実装の三重化 | `hooks/use-toast.ts` + `hooks/useToast.ts`(エイリアス) + sonner 直接利用3箇所 | §Phase 2 参照 |
| Edge Functions の依存バージョン分裂 | `@supabase/supabase-js` が 2.49.4 / 2.57.2 / 2.57.4 の3系統 | §Phase 5 参照 |

---

## 実装エージェント向け 共通ルール(全フェーズ適用)

実装を行うAIエージェントは、各フェーズの作業前に必ずこのセクションを読むこと。

1. **1フェーズ = 1ブランチ = 1 PR**。フェーズをまたいだ変更を混ぜない。ブランチ名は `refactor/phase-{N}-{slug}`(例: `refactor/phase-1-dead-code`)。
2. **挙動変更ゼロが原則**。リファクタリングフェーズでは機能追加・仕様変更・UI変更を行わない。Before/Afterでユーザー視点の挙動が同一であること。
3. **削除前に必ず再検証**。本ドキュメントの「未使用」判定は調査時点のもの。削除直前に以下を実行し、参照ゼロを自分の目で確認すること:
   ```bash
   # 例: ThemeToggle が本当に未使用か確認(定義ファイル自身以外のヒットが0件であること)
   grep -rn "ThemeToggle" src/ --include="*.tsx" --include="*.ts" | grep -v "src/components/ThemeToggle.tsx"
   ```
4. **各フェーズの完了条件(共通)**:
   ```bash
   bun install          # 依存変更時のみ
   bunx tsc --noEmit    # エラー0(Phase 7以降は厳格化後の基準)
   bun run lint         # 既存エラー数(131)から増加していないこと。Phase 7で0にする
   bun run build        # 成功すること。バンドルサイズを毎回記録すること
   ```
5. **ドキュメント同期**(CLAUDE.md ガイドライン3): ファイルの削除・移動・新設をしたら、同じPR内で `docs/ARCHITECTURE.md` / `docs/TECH.md` の該当記述を更新する。
6. **Git Safety**(CLAUDE.md ガイドライン4): 自分が加えた変更以外の差分を発見したら、revertせず作業を止めて報告する。
7. **コミット粒度**: 「未使用コンポーネント8件削除」「Loading 5種を共通化」のように、レビュー可能な論理単位でコミットする。コミットメッセージは日本語可(既存履歴に倣う)。
8. **Supabase migrations は原則触らない**。適用済みマイグレーションのリネーム・squash・削除はマイグレーション履歴を破壊する。例外は §Phase 5.4 に明記した範囲のみ。
9. **Edge Functions の変更はデプロイ影響がある**。`supabase/functions` を変更するフェーズでは、PR説明に「デプロイ対象関数の一覧」を必ず記載する(CIの `supabase-deploy.yml` が自動デプロイするため)。
10. **進捗管理**: 各フェーズ末尾のチェックリストを、完了したらこのファイル上で `[x]` に更新してコミットに含める。

---

## フェーズ全体像と依存関係

| Phase | 内容 | リスク | 規模感 | 依存 |
|---|---|---|---|---|
| **0** | 安全網の構築(CI・スモークテスト) | 低 | 小 | なし |
| **1** | デッドコード削除 | 低 | 小〜中 | 0 |
| **2** | フロント重複の統合(Loading / Toast) | 低〜中 | 中 | 1 |
| **3** | バンドル最適化(コード分割・絵文字カタログ) | 中 | 中 | 1 |
| **4** | データ取得層の統一(React Query 一本化) | 中 | 中〜大 | 2 |
| **5** | Edge Functions の共通化・整理 | 中 | 大 | 0(並行可) |
| **6** | 巨大ファイルの分割 | 中〜高 | 大 | 2, 4, 5 |
| **7** | TypeScript 厳格化 & Lint ゼロ化 | 中 | 大 | 1〜6 |
| **8** | 最終整理・ドキュメント完全同期 | 低 | 小 | 全部 |

Phase 1〜4(フロント)と Phase 5(バックエンド)は独立しており、並行作業が可能。

---

## Phase 0: 安全網の構築

**目的**: テストもCIもない状態でリファクタリングを始めるのは危険。最低限の回帰検知ラインを先に敷く。

### 0.1 ビルド・型・Lint の CI 追加

- `.github/workflows/ci.yml` を新規作成する:
  ```yaml
  name: CI
  on:
    pull_request:
    push:
      branches: [main]
  jobs:
    check:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: oven-sh/setup-bun@v2
        - run: bun install --frozen-lockfile
        - run: bunx tsc --noEmit
        - run: bun run lint || true   # Phase 7 完了後に `|| true` を外す
        - run: bun run build
        - run: bun test               # 0.2 完了後に有効化
  ```
  ※ lint は現状131エラーあるため、Phase 7 完了まで非ブロッキング(`|| true`)とする。型チェックとビルドは初日からブロッキング。

### 0.2 テストランナー導入と最小スモークテスト

- Vitest を導入する(Vite プロジェクトのため設定コスト最小):
  ```bash
  bun add -d vitest @testing-library/react @testing-library/jest-dom jsdom
  ```
- `vite.config.ts` に `test: { environment: 'jsdom', setupFiles: './src/test/setup.ts' }` を追加。
- `package.json` に `"test": "vitest run"` を追加。
- **最初に書くテスト(ピンポイントで資産価値が高いもの)**:
  1. `src/lib/` の純粋関数(emoji 正規化、URL/電話番号生成、バリデーション)のユニットテスト。Phase 6 でロジックを動かす際の回帰検知になる。
  2. `App.tsx` がクラッシュせずレンダリングされるスモークテスト(supabase クライアントはモック)。
  3. `src/translations/*.json` の4言語(ja/en/ko/id)でキー集合が一致することを検証するテスト(翻訳漏れ検知)。
- E2Eは本計画のスコープ外とするが、導入する場合は Playwright で「トップ表示→検索→詳細表示」のハッピーパス1本のみ。

### 0.3 バンドルサイズの計測基準を記録

- `bun run build` の出力(現状: `index-*.js` 3,400.85KB / gzip 966.58KB)をこのファイルの末尾「計測ログ」に記録する。以降、各フェーズ完了時に追記して効果を可視化する。

### ✅ Phase 0 完了チェックリスト

- [ ] `.github/workflows/ci.yml` が PR で tsc + build を実行している
- [ ] `bun test` で 3 種のスモークテストが通る
- [ ] 計測ログにベースラインを記録した

---

## Phase 1: デッドコード削除

**目的**: 参照されていないコードを消し、以降のフェーズの作業対象を減らす。**挙動変更リスクが最も低く、効果が確実なフェーズ。**

### 1.1 未使用コンポーネントの削除(8ファイル / 1,301行)

以下を削除する。**各ファイルにつき、削除前に共通ルール3のgrep検証を必ず行うこと**(調査時点で参照ゼロを確認済みだが、再確認必須):

| ファイル | 行数 | 備考 |
|---|---|---|
| `src/components/AdminPatternRules.tsx` | 210 | どこからもimportされていない |
| `src/components/FanmarkQuickRegistration.tsx` | 304 | 登録フォームの旧バリアント |
| `src/components/FanmarkRegistrationForm.tsx` | 472 | `FanmarkAcquisition.tsx` に置き換えられた旧フォーム。**注意**: `docs/ARCHITECTURE.md` に主要コンポーネントとして記載があるため、ドキュメント側も更新する |
| `src/components/GraceStatusCountdown.tsx` | 50 | 同上(ARCHITECTURE.md 更新要) |
| `src/components/PWAInstallPrompt.tsx` | 84 | 未参照 |
| `src/components/SubscriptionStatus.tsx` | 91 | `useSubscription` フックに役割が移行済み |
| `src/components/ThemeToggle.tsx` | 33 | 未参照 |
| `src/components/Footer.tsx` | 57 | **重複**: 実際に使われているのは `src/components/layout/SiteFooter.tsx`(25箇所以上) |

### 1.2 未使用 shadcn/ui コンポーネントの削除(20ファイル)

`src/components/ui/` 配下のうち、アプリケーションコードから一切importされていない以下の20ファイルを削除する:

```
aspect-ratio.tsx  avatar.tsx  breadcrumb.tsx  calendar.tsx  carousel.tsx
chart.tsx  command.tsx  context-menu.tsx  drawer.tsx  form.tsx
hover-card.tsx  menubar.tsx  navigation-menu.tsx  progress.tsx
radio-group.tsx  resizable.tsx  scroll-area.tsx  sidebar.tsx
slider.tsx  toggle-group.tsx
```

**検証方法**: `ui/` 内ファイル同士の相互参照があるため(例: `sidebar.tsx` → `sheet.tsx`)、削除は1ファイルずつではなく20件まとめて行い、その後 `bunx tsc --noEmit` と `bun run build` で参照切れがないことを確認する。`chart.tsx` は `recharts` を使うが、`Analytics.tsx` も `recharts` を直接使っているため **`recharts` パッケージ自体は残す**。

### 1.3 未使用 npm 依存の削除

1.2 完了後、各UIコンポーネントだけが使っていたパッケージを削除できる。削除前に `grep -rn "<パッケージ名>" src/` で参照ゼロを確認:

| パッケージ | 唯一の利用元(削除済みになるファイル) |
|---|---|
| `embla-carousel-react` | `ui/carousel.tsx` |
| `react-resizable-panels` | `ui/resizable.tsx` |
| `vaul` | `ui/drawer.tsx` |
| `react-day-picker` | `ui/calendar.tsx` |
| 対応する `@radix-ui/react-*` | `aspect-ratio`, `avatar`, `context-menu`, `hover-card`, `menubar`, `navigation-menu`, `progress`, `radio-group`, `scroll-area`, `slider`, `toggle-group` など。**1つずつgrepで確認してから** `package.json` から外す |

```bash
bun remove embla-carousel-react react-resizable-panels vaul react-day-picker ...
bun install && bunx tsc --noEmit && bun run build
```

### 1.4 トースト残骸の削除(統一は Phase 2)

- `src/hooks/useToast.ts`(30行): `use-toast.ts` の再エクスポートエイリアス。importしている箇所を `@/hooks/use-toast` に書き換えた上で削除。
- `src/components/ui/use-toast.ts`(5行): 未使用の再エクスポート。grep確認の上削除。

### 1.5 ドキュメント更新

- `docs/ARCHITECTURE.md` の「主要コンポーネント」リストから削除したものを除去(`FanmarkRegistrationForm`, `GraceStatusCountdown`, `AdminPatternRules` など)。

### ✅ Phase 1 完了チェックリスト

- [ ] 8つの未使用コンポーネントを削除(各削除前にgrep検証済み)
- [ ] 未使用 shadcn/ui 20件を削除
- [ ] 未使用 npm 依存を削除し、`bun.lock` 更新
- [ ] トーストエイリアス2ファイルを削除
- [ ] ARCHITECTURE.md を同期
- [ ] tsc / build / test がグリーン、バンドルサイズを計測ログに記録

---

## Phase 2: フロントエンド重複の統合

**目的**: ほぼ同一のコードを共通コンポーネント/単一実装に集約する。

### 2.1 ローディングオーバーレイ5種の統合(556行 → 約150行)

**対象**(85〜95%同一構造: z-50オーバーレイ + 3重回転リング + 中央絵文字バウンス + 4つの装飾アイコン + ステップ進行ドット + テキストサイクル):

- `src/components/FanmarkReturnLoading.tsx`(94行)
- `src/components/FanmarkAcquisitionLoading.tsx`(101行)
- `src/components/LotteryActionLoading.tsx`(77行)
- `src/components/MessageboardLoading.tsx`(135行)
- `src/components/RedirectLoading.tsx`(149行)

**実装手順**:

1. `src/components/common/ProcessingOverlay.tsx` を新設。Props 設計:
   ```ts
   interface ProcessingOverlayProps {
     emoji?: string;                    // 中央表示の絵文字
     icon?: LucideIcon;                 // 絵文字の代わりのアイコン
     decorIcons?: LucideIcon[];         // 周囲の装飾アイコン(最大4)
     title: string;                     // メインメッセージ(翻訳済み文字列を受け取る)
     steps?: string[];                  // サイクル表示するステップ文言
     stepIntervalMs?: number;           // デフォルト 800
   }
   ```
2. 既存5コンポーネントを「`ProcessingOverlay` に固有Propsを渡すだけの薄いラッパー」に書き換える(呼び出し側の変更を最小化するため、ファイル名とexport名は維持してよい。中身が5〜15行になればよい)。
3. 視覚確認: `bun run dev` で取得フロー・返却フロー・抽選フローを目視確認(アニメーションの差異は許容、構造崩れは不可)。
4. ラッパーすら不要と判断できる呼び出し元(1箇所からしか使われていないもの)は、直接 `ProcessingOverlay` 呼び出しに置換してラッパーを削除する。

### 2.2 トースト実装の一本化

**現状**: 主実装は `src/hooks/use-toast.ts`(33箇所で利用)。一方 `sonner` を直接importしている箇所が3箇所あり、`docs/TECH.md` には「トーストは sonner」と記載されていて実態と矛盾。

**方針**: 利用実態(33 vs 3)に合わせ **`@/hooks/use-toast` に統一**する。

1. `grep -rn "from 'sonner'\|from \"sonner\"" src/` で3箇所を特定し、`useToast` ベースに書き換える。
2. `src/components/ui/sonner.tsx` と `App.tsx` 内の sonner製 `<Toaster />`(もしあれば)を削除。
3. `bun remove sonner next-themes`(`next-themes` は `ui/sonner.tsx` のテーマ連携専用なら削除可。**他で使っていないか必ずgrep**。ThemeToggle 削除済みなら未使用の可能性が高い)。
4. `docs/TECH.md` の「トーストは sonner」記述を「`@/hooks/use-toast`(Radix Toast)」に修正。

### 2.3 Admin系CRUD画面の共通化(任意・効果中)

`AdminBroadcastEmail`(1,064行)/ `AdminUserManagement`(1,026行)/ `AdminTierExtensionPrices`(707行)/ `AdminEmojiMaster`(659行)/ `AdminExtensionCoupons`(513行)/ `AdminInvitationManager`(402行)は全て「useQueryでフェッチ → テーブル表示 → Dialog/Sheetで編集 → AlertDialogで削除確認 → invalidateQueries」という同一パターン。

1. `src/components/admin/shared/` を新設し、以下を抽出する:
   - `AdminDataTable.tsx`: カラム定義・行アクション・ページネーション・空状態を受け取る汎用テーブル
   - `ConfirmDeleteDialog.tsx`: 削除確認 AlertDialog の共通化
   - `useAdminMutation.ts`: 「mutation + 成功/失敗トースト + invalidateQueries」の定型をまとめたフック
2. まず**最小の `AdminInvitationManager`(402行)を移行してパターンを確立**し、レビュー後に残り5つへ展開する。一気に6画面を書き換えない。
3. 期待効果: 各画面200〜300行削減(合計 約1,200〜1,800行)。

### ✅ Phase 2 完了チェックリスト

- [ ] `ProcessingOverlay` 新設、5つのローディングを統合(目視確認済み)
- [ ] トーストを `use-toast` に統一、`sonner`(と可能なら `next-themes`)を依存から削除
- [ ] TECH.md のトースト記述を修正
- [ ] (任意)Admin共通化: `AdminInvitationManager` で確立 → 全画面展開
- [ ] tsc / build / test グリーン、計測ログ更新

---

## Phase 3: バンドル最適化(3.4MB → 目標 1MB 未満/初期ロード)

**目的**: 単一3.4MBバンドルを分割し、初期ロードを軽くする。**ユーザー体感に直結する最も費用対効果の高いフェーズ。**

### 3.1 絵文字カタログ(84,492行)の遅延ロード化 ★最重要

`src/data/emojiCatalog.ts` は84,492行の静的データで、現在は通常のimportにより**全ページの初期バンドルに含まれている**。利用者は絵文字ピッカー(`EmojiInput.tsx` 等)を開いたユーザーのみ。

**実装手順**:

1. `emojiCatalog.ts` のデータ本体を `src/data/emojiCatalog.json`(または `.ts` のままでもよい)として分離し、型定義のみ `src/data/emojiCatalogTypes.ts` に残す。
2. 利用箇所(`grep -rn "emojiCatalog" src/` で特定。`EmojiInput.tsx` など)を dynamic import に変更:
   ```ts
   const loadCatalog = () => import('@/data/emojiCatalog').then(m => m.emojiCatalog);
   ```
   読み込み中はピッカー内にスケルトン表示。React Query の `useQuery({ queryKey: ['emojiCatalog'], queryFn: loadCatalog, staleTime: Infinity })` でキャッシュすると実装が簡潔。
3. `docs/TECH.md` の「絵文字マスタ更新」手順(`scripts/generate-emoji-catalog.ts` の出力先)を新構成に合わせて更新する。**生成スクリプト側の出力フォーマットも忘れずに追従させること。**

### 3.2 ルート単位のコード分割

`App.tsx` は27ルートを全て静的importしている。以下を実施:

1. 全ページコンポーネントを `React.lazy()` 化し、`<Suspense fallback={...}>` でラップする。fallback は既存のシンプルなスピナー(Phase 2 の `ProcessingOverlay` ではなく軽量なもの)。
   ```tsx
   const Dashboard = lazy(() => import('@/pages/Dashboard'));
   ```
2. 特に分割効果が大きいもの: Admin系一式(`AdminApp` / `AdminDashboard` 配下、一般ユーザーは絶対に読まない)、`Analytics.tsx`(recharts を道連れにできる)、`Profile.tsx`。
3. **注意**: `MaintenanceGate` / `ProtectedRoute` / `AuthProvider` などルート横断のラッパーは lazy 化しない。
4. PWA(`vite-plugin-pwa`)の precache 対象が増えることを確認(`globPatterns` がチャンクを拾うか確認し、必要なら調整)。

### 3.3 manualChunks の設定

`vite.config.ts` に:

```ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'vendor-react': ['react', 'react-dom', 'react-router-dom'],
        'vendor-supabase': ['@supabase/supabase-js'],
        'vendor-ui': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', /* 利用中のradixのみ */],
      },
    },
  },
},
```

3.1 / 3.2 を先に行い、その時点の `bun run build` 出力を見てから必要最小限のチャンク指定にとどめる(過剰な手動分割は逆効果)。

### ✅ Phase 3 完了チェックリスト

- [ ] 絵文字カタログが初期バンドルから消えた(build出力で確認)
- [ ] 全27ルートが lazy 化され、Suspense フォールバックが機能
- [ ] 初期ロードJS(エントリチャンク)が gzip 300KB 以下
- [ ] PWA precache が新チャンク構成で正常
- [ ] TECH.md の絵文字カタログ手順を更新、計測ログ更新

---

## Phase 4: データ取得層の統一(React Query 一本化)

**目的**: 現在「Admin系 = React Query / 一般画面 = `useEffect` + `useState` + 直接 supabase 呼び出し(useEffect 112箇所)」と分裂しているデータ取得を React Query に統一し、キャッシュ・ローディング・エラー処理を一元化する。

### 4.1 共通クエリフックの整備

1. `src/hooks/queries/` を新設し、画面横断で使うデータごとにフックを定義する:
   - `useUserSettings()` — `user_settings`(現在 Profile などが個別フェッチ)
   - `useUserLicenses()` — ダッシュボードのライセンス一覧
   - `useSystemSettings()` — `system_settings`(MaintenanceGate ほか)
2. queryKey は `['userSettings', userId]` のような配列規約で統一し、`src/hooks/queries/keys.ts` に定数化する。
3. invalidate は mutation 側で `queryClient.invalidateQueries({ queryKey: keys.userLicenses(userId) })` に統一。

### 4.2 移行手順(画面単位で段階移行)

1. 移行順序(小→大): `Favorites.tsx` → `FanmarkSearch` 系 → `Profile.tsx` → `FanmarkSettings.tsx` → `FanmarkDashboard.tsx`(最大・最後)。
2. 各画面で「`useEffect`+`useState` での supabase 呼び出し」を `useQuery`/`useMutation` に置換。ローディング表示・エラートーストの挙動は既存と同一に保つ。
3. `localStorage` 直接読み書き(ダッシュボードのタブ状態、言語設定)はデータ取得とは別問題なので**このフェーズでは触らない**。
4. 1画面移行ごとにコミットし、`bun run dev` で当該画面を目視確認。

### 4.3 Edge Function 呼び出しの型付きラッパー

現在16以上のコンポーネントが `supabase.functions.invoke("文字列名", ...)` を個別に書いており、関数名のタイポや型不整合を検出できない。

1. `src/lib/edgeFunctions.ts` を新設:
   ```ts
   // 関数名と入出力型を1箇所で対応付ける
   interface EdgeFunctionMap {
     'register-fanmark': { req: RegisterFanmarkRequest; res: RegisterFanmarkResponse };
     'return-fanmark':   { req: ReturnFanmarkRequest;   res: ReturnFanmarkResponse };
     // ... フロントから呼ぶ全関数を列挙(grep -rn "functions.invoke" src/ で洗い出す)
   }

   export async function invokeEdgeFunction<K extends keyof EdgeFunctionMap>(
     name: K,
     body: EdgeFunctionMap[K]['req'],
   ): Promise<EdgeFunctionMap[K]['res']> {
     const { data, error } = await supabase.functions.invoke(name, { body });
     if (error) throw new EdgeFunctionError(name, error);
     return data;
   }
   ```
2. 呼び出し箇所を順次このラッパーに置換する。リクエスト/レスポンス型は既存コンポーネント内のinterface定義を `src/types/edgeFunctions.ts` に移設して再利用。

### ✅ Phase 4 完了チェックリスト

- [ ] `src/hooks/queries/` に共通フックと queryKey 定数を整備
- [ ] 主要5画面の `useEffect` フェッチを React Query へ移行
- [ ] `invokeEdgeFunction` ラッパー導入、`functions.invoke` 直書きゼロ
- [ ] tsc / build / test グリーン

---

## Phase 5: Edge Functions の共通化・整理(バックエンド)

**目的**: 33関数に散らばるボイラープレートを `_shared/` に集約し、依存バージョンを統一する。**フロント(Phase 1〜4)と並行作業可能。**

> ⚠️ このフェーズの変更は `supabase-deploy.yml` により本番へデプロイされる。サブフェーズごとにPRを分け、変更した関数の一覧をPR説明に明記すること。Webhook系(`handle-stripe-webhook`, `send-auth-email`)とCron系(`check-expired-licenses`, `process-notification-events`)は特に慎重に。

### 5.1 `_shared/` 基盤モジュールの整備

現状: `_shared/` は4ファイル(admin-auth.ts, validation.ts, return-helpers.ts, plan-limits.ts)あるが採用率が低く、`corsHeaders` は19関数がインライン定義(しかも4バリアント存在)、`createClient` は23関数がインライン。

新設・整理するモジュール:

1. **`_shared/cors.ts`**: 正準の `corsHeaders` を1定義に。Stripe webhook 用の `stripe-signature` ヘッダ許可は引数で拡張可能にする:
   ```ts
   export function corsHeaders(extraAllowedHeaders: string[] = []) {
     return {
       'Access-Control-Allow-Origin': '*',
       'Access-Control-Allow-Headers':
         ['authorization', 'x-client-info', 'apikey', 'content-type', ...extraAllowedHeaders].join(', '),
       'Access-Control-Allow-Methods': 'POST, OPTIONS',
     };
   }
   export function handleOptions(req: Request): Response | null { /* preflight共通処理 */ }
   ```
2. **`_shared/supabase.ts`**: `createServiceClient()` / `createAnonClient()`。既存の `return-helpers.ts` 内 `createSupabaseClient` をここへ移設し、return-helpers からは re-export して後方互換を保つ。
3. **`_shared/auth.ts`**: 一般ユーザー向け JWT 検証(現在12関数がインライン実装):
   ```ts
   export async function requireUser(req: Request, supabase: SupabaseClient): Promise<User> {
     // Bearer 抽出 → auth.getUser → 失敗時は UnauthorizedError を throw
   }
   ```
   管理者向けは既存 `admin-auth.ts` の `requireAdminContext` を維持。
4. **`_shared/stripe.ts`**: `createStripeClient()`(apiVersion `2025-08-27.basil` を1箇所に)。利用8関数: `check-subscription`, `create-checkout`, `create-extension-checkout`, `customer-portal`, `change-subscription`, `delete-user-account`, `handle-stripe-webhook` ほか。
5. **`_shared/http.ts`**: `jsonResponse(data, status, cors)` / `errorResponse(message, status, cors)`。既存 `validation.ts` のレスポンスヘルパーと統合する。
6. **`_shared/notifications.ts`**: `createNotificationEvent(supabase, { eventType, payload, dedupeKey })` — 10関数以上で重複している `rpc('create_notification_event', ...)` 呼び出しの定型を吸収。
7. **`_shared/deps.ts`**: 依存バージョンの単一ソース:
   ```ts
   export { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
   export { default as Stripe } from 'https://esm.sh/stripe@<現行使用バージョン>';
   export { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
   ```
   現在 `@supabase/supabase-js` が **2.49.4 / 2.57.2 / 2.57.4 の3系統**に分裂しているのを 2.57.4 に統一する(`send-auth-email` の 2.49.4 は特に古いので、更新後に動作確認必須)。

### 5.2 各関数への適用(機械的な置換)

33関数に対し、以下の置換を行う。**1PRあたり5〜8関数を目安に分割**し、変更ごとに `supabase functions serve <name>` でローカル起動確認(可能なら)、最低限 TypeScript としての整合を `deno check` で確認:

1. インライン `corsHeaders` → `_shared/cors.ts`(19関数)
2. インライン `createClient` → `_shared/supabase.ts`(23関数)
3. インライン JWT 検証 → `_shared/auth.ts` の `requireUser`(12関数: transfer系5、checkout/subscription系5、その他2)
4. インライン `new Stripe(...)` → `_shared/stripe.ts`(8関数)
5. インラインのエラーレスポンス構築 → `_shared/http.ts`(15関数)
6. `create_notification_event` 定型 → `_shared/notifications.ts`(10関数以上)
7. import を `_shared/deps.ts` 経由に統一(33関数)

**置換時の注意**: CORSバリアント間の差異(`Allow-Methods` の有無、`stripe-signature`)は §5.1 の引数で吸収する。挙動が変わらないことをレスポンスヘッダレベルで確認すること。

### 5.3 ドメインロジック重複の集約

1. **ライセンス状態遷移**: grace期間取得が3箇所以上、active→grace遷移が2系統(`return-helpers.ts` の `transitionLicenseToGrace` と `check-expired-licenses` 内の独自実装)に重複。`_shared/license-lifecycle.ts` を新設し、`fetchGracePeriodDays` / `transitionLicenseToGrace` / `transitionGraceToExpired` を単一実装に集約。`docs/LICENSE_LIFECYCLE.md` を正として実装が一致するか突き合わせる。
2. **譲渡コード検証**: `generate/apply/cancel-transfer-code`, `approve/reject-transfer-request` の5関数+`check-expired-licenses` に散らばる「コードの状態・有効期限・発行者/申請者・所有権チェック」を `_shared/transfer-validation.ts` に集約。

### 5.4 マイグレーションの整理(ドキュメントのみ・低リスク)

- `supabase/migrations/` には5日間で4本のフルスキーマスナップショット(計13,410行)が存在するが、**適用済みマイグレーションは削除・squashしない**(履歴破壊のため)。
- 対応は次の2点のみ:
  1. `supabase/migrations/README.md` を新設し、「`*_remote_schema.sql` 4本はCLIによるリモート同期スナップショットであり、手で編集しないこと。ベースラインは `migrations_archive/remote_baseline_20251231_154807` を参照」と経緯を明文化する。
  2. 今後のスナップショット乱発を防ぐ運用ルール(`supabase migration new` を使い、`db pull` の安易な実行を避ける)を `docs/TECH.md` に追記。

### ✅ Phase 5 完了チェックリスト

- [ ] `_shared/` に cors / supabase / auth / stripe / http / notifications / deps を整備
- [ ] 33関数のボイラープレートを置換(PR分割、デプロイ対象明記)
- [ ] `@supabase/supabase-js` を 2.57.4 に統一(特に `send-auth-email` の動作確認)
- [ ] ライセンス状態遷移と譲渡コード検証を共有モジュール化
- [ ] migrations/README.md 新設、TECH.md に運用ルール追記
- [ ] Stripe webhook / 認証メール / cron 2種の本番動作確認

---

## Phase 6: 巨大ファイルの分割

**目的**: 1,000行超のファイルを責務単位に分割し、変更容易性とレビュー可能性を回復する。**挙動変更リスクが最も高いフェーズなので、Phase 0 のテストと Phase 2/4/5 の共通化が済んでから着手する。**

### 6.1 フロントエンド(優先順)

分割の共通ルール: **「JSXの抽出」より先に「ロジックのフック化」**を行う。状態とロジックをカスタムフックに出せば、JSX分割は安全になる。

1. **`FanmarkDashboard.tsx`(1,732行 / useState 19個 / フック17個)** → `src/components/dashboard/` に分割:
   - `useDashboardLicenses.ts`(ライセンス取得・Phase 4 のクエリフックを利用)
   - `useTransferDialogs.ts`(譲渡関連のダイアログ状態+操作)
   - `useReturnFlow.ts`(返却・一括返却)
   - `LicenseCard.tsx` / `TransferDialogs.tsx` / `ReturnDialogs.tsx` / `ExtensionSection.tsx`
   - 本体は一覧レイアウトと各セクションの合成のみ(目標300行以下)
2. **`FanmarkSettings.tsx`(1,172行 / useEffect 7個)** → アクセスタイプ別サブフォーム(4種)を `settings/AccessTypeForm*.tsx` に分割、パスワード保護・SNSリンク・ファイルアップロードを独立コンポーネント化。カスケードしている7つの useEffect は派生状態(`useMemo`)かフォームライブラリの `watch` に置換できないか個別に検討。
3. **`Profile.tsx`(1,052行)** → `profile/AvatarSection.tsx` / `BillingSection.tsx` / `MFASection.tsx` / `DangerZone.tsx`(アカウント削除)に分割。
4. **`Auth.tsx`(773行)** → `LoginForm.tsx` / `SignupForm.tsx` / `PasswordResetForm.tsx` に分割(バリデーションスキーマは `src/lib/authSchemas.ts` へ)。
5. **`FanmarkAcquisition.tsx`(836行)** / **`EmojiInput.tsx`(796行)**: 上記4件が完了し問題がなければ着手(同じ手法)。

各分割は「1ファイル = 1PR」。分割前後で画面の目視確認を必ず行う。

### 6.2 Edge Functions(優先順)

1. **`check-expired-licenses`(922行)**: 「active→grace遷移」「grace→expired遷移」「抽選再割当」「通知」「監査ログ」が単一関数に混在。関数ディレクトリ内でモジュール分割する:
   ```
   check-expired-licenses/
     index.ts          # オーケストレーションのみ(~100行)
     transitions.ts    # 状態遷移(Phase 5.3 の license-lifecycle を利用)
     lottery.ts        # 抽選再割当
     notifications.ts  # 通知イベント生成
   ```
   ※ Edge Function は関数ディレクトリ内の相対importが可能。cron実行のためエンドポイントURLは不変。
2. **`register-fanmark`(880行)**: バリデーション / Tier判定 / ライセンス作成 / プロフィール作成 / 通知 を同様にモジュール分割。
3. **`handle-stripe-webhook`(625行)**: イベントタイプごとのハンドラ(`handleCheckoutCompleted` 等)をファイル分離し、index.ts はディスパッチのみに。

Edge Functions の分割は挙動同一性の確認が難しいため、**分割のみ行いロジックの1行も変えない**こと(変数名変更も最小限)。

### ✅ Phase 6 完了チェックリスト

- [ ] FanmarkDashboard / FanmarkSettings / Profile / Auth を分割(各300行以下の合成コンポーネント化)
- [ ] check-expired-licenses / register-fanmark / handle-stripe-webhook をモジュール分割
- [ ] `src/` 直下に1,000行超のコンポーネントがない(emojiCatalog等のデータファイルを除く)
- [ ] 各分割PRで該当画面/関数の動作確認記録
- [ ] ARCHITECTURE.md のファイルマップを新構成に全面更新

---

## Phase 7: TypeScript 厳格化 & Lint ゼロ化

**目的**: `strict: false` と131件のlintエラーを解消し、リファクタリング成果を型レベルで固定する。

### 7.1 段階的 strict 有効化

`tsconfig.app.json`(と `tsconfig.json` のオーバーライド)を一気に `strict: true` にせず、以下の順で1オプションずつ有効化し、その都度エラーを潰す:

1. `noFallthroughCasesInSwitch: true`(影響最小)
2. `noUnusedLocals: true` / `noUnusedParameters: true`(デッドコード検出。Phase 1〜6 後なら少ないはず)
3. `noImplicitAny: true`(最大の山。`src/integrations/supabase/types.ts` の生成型を活用して supabase レスポンスの型を当てる)
4. `strictNullChecks: true`(2番目の山。`?.` / 早期returnで対応。**安易な `!` 非nullアサーションは禁止**)
5. 最後に `strict: true` へ統合

エラーが数百件出る場合は、ディレクトリ単位(`src/lib` → `src/hooks` → `src/components` → `src/pages`)で潰してコミットを刻む。

### 7.2 ESLint エラーゼロ化

1. `bun run lint -- --fix` で自動修正可能な3件を先に処理。
2. 残る `no-explicit-any` 約128件は、7.1-③ と同時に実型を当てて解消(`as any` での隠蔽は禁止。やむを得ない箇所は `unknown` + 型ガード)。
3. 完了後、Phase 0 で入れた CI の `|| true` を外し、lint をブロッキング化する。

### ✅ Phase 7 完了チェックリスト

- [ ] `strict: true` で `bunx tsc --noEmit` がエラー0
- [ ] `bun run lint` がエラー0・警告0
- [ ] CI で lint がブロッキング化

---

## Phase 8: 最終整理

1. **ドキュメント完全同期**: `docs/ARCHITECTURE.md` / `docs/TECH.md` / `docs/PRODUCT.md` を最終構成と突き合わせ、古い記述(削除済みコンポーネント名、旧ディレクトリ構成、sonner等)を一掃する。
2. **計測ログの確定**: 下表を完成させ、Before/After を README または本ドキュメントに残す。
3. **残課題の棚卸し**: 本計画でスコープ外としたもの(E2Eテスト拡充、i18nライブラリへの移行是非、`migrations` スナップショット運用の自動化など)を Issue 化する。
4. 本ドキュメント自体を `docs/REFACTORING_PLAN.md` から完了レポートに改題するか、アーカイブする。

---

## 計測ログ(各フェーズ完了時に追記)

| 時点 | 初期バンドル(gzip) | src行数 | lintエラー | tsc設定 | テスト数 |
|---|---|---|---|---|---|
| ベースライン(2026-06-12) | 966.58 KB(単一3,400KB) | 約41,000行(+emojiCatalog 84,492行) | 131 | strict: false | 0 |
| Phase 1 完了 | | | | | |
| Phase 2 完了 | | | | | |
| Phase 3 完了 | | | | | |
| Phase 4 完了 | | | | | |
| Phase 5 完了 | | | | | |
| Phase 6 完了 | | | | | |
| Phase 7 完了 | | | | | |

---

## 付録A: スコープ外(本計画では行わないこと)

- 機能追加・UI刷新・文言変更
- i18n ライブラリ(i18next等)への移行 — 現行の自前 `useTranslation`(142行)は小さく問題が顕在化していないため現状維持。翻訳キー整合テスト(Phase 0)のみ導入
- 適用済み DB マイグレーションの squash / 書き換え
- RLS ポリシーの変更(docs/ARCHITECTURE.md の公開方針は仕様であり、リファクタリング対象ではない)
- Header 3種(AppHeader / SimpleHeader / PWAHeader)の統合 — 調査の結果、役割分担が明確で重複ではないと判断

## 付録B: フロントから呼ばれない(が削除してはいけない)Edge Functions

以下はフロントの `functions.invoke` 検索でヒットしないが、Webhook/Cron/公開エンドポイントとして使用中。**デッドコードと誤認して削除しないこと**:

- `handle-stripe-webhook`(Stripe Webhook)
- `send-auth-email`(Supabase Auth Hook)
- `process-notification-events`(Cron: 毎分)
- `check-expired-licenses`(Cron: 毎日 UTC 0:00)
- `fanmark-ogp` / `generate-ogp-image`(公開OGPエンドポイント)
