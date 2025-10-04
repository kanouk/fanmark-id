# 画面・モジュール・URL マッピング

このドキュメントは、AIエージェントが自然言語から該当するモジュールを素早く特定できるように、fanmark.idプロジェクトの画面名、モジュール名、URLパスをマッピングしたものです。

## 目次
- [メインアプリケーション](#メインアプリケーション)
- [管理画面](#管理画面)
- [主要コンポーネント](#主要コンポーネント)

---

## メインアプリケーション

### トップページ / ランディングページ
- **画面名**: トップページ、ランディングページ、ホーム画面
- **URLパス**: `/`
- **ページコンポーネント**: `src/pages/Index.tsx`
- **翻訳キー**: `hero.*`, `sections.*`
- **説明**: サービスの紹介、ファンマ検索、最近取得されたファンマの表示

### 認証画面
- **画面名**: ログイン画面、新規登録画面、認証画面、サインイン・サインアップ
- **URLパス**: `/auth`
- **ページコンポーネント**: `src/pages/Auth.tsx`
- **翻訳キー**: `auth.*`
- **説明**: ログイン・新規登録の両方を扱う認証画面

### パスワードリセット関連

#### パスワード忘れ画面
- **画面名**: パスワード忘れ画面、パスワードリセット申請画面
- **URLパス**: `/forgot-password`
- **ページコンポーネント**: `src/pages/ForgotPassword.tsx`
- **翻訳キー**: `auth.forgotPasswordTitle`, `auth.forgotPasswordDescription`
- **説明**: パスワードリセット用のメール送信画面

#### パスワードリセット画面
- **画面名**: パスワードリセット画面、新規パスワード設定画面
- **URLパス**: `/reset-password`
- **ページコンポーネント**: `src/pages/ResetPassword.tsx`
- **翻訳キー**: `auth.passwordResetTitle`, `auth.passwordResetDescription`
- **説明**: メールから遷移してパスワードを再設定する画面

### ユーザー設定画面
- **画面名**: ユーザー設定画面、プロフィール設定、アカウント設定
- **URLパス**: `/profile`
- **ページコンポーネント**: `src/pages/Profile.tsx`
- **関連コンポーネント**: `src/components/UserProfileForm.tsx`
- **翻訳キー**: `userSettings.*`, `profile.*`
- **説明**: ユーザーの表示名、アバター、プラン情報などの設定

### ダッシュボード画面
- **画面名**: ダッシュボード、マイページ、ファンマ管理画面
- **URLパス**: `/dashboard`
- **ページコンポーネント**: `src/pages/Dashboard.tsx`
- **関連コンポーネント**: `src/components/FanmarkDashboard.tsx`
- **翻訳キー**: `dashboard.*`
- **説明**: 取得済みファンマの一覧表示、新規ファンマの検索・取得

### プラン選択画面
- **画面名**: プラン選択画面、プラン変更画面、料金プラン画面
- **URLパス**: `/plans`
- **ページコンポーネント**: `src/pages/PlanSelection.tsx`
- **翻訳キー**: `planSelection.*`
- **説明**: フリー、クリエーター、ビジネス、エンタープライズなどのプラン選択

### ダウングレード時のファンマ選択モーダル
- **画面名**: ダウングレード画面、プラン変更時のファンマ選択
- **コンポーネント**: `src/components/FanmarkSelectionModal.tsx`
- **翻訳キー**: `planDowngrade.*`
- **説明**: プラン変更時に保持するファンマを選択するモーダル

### ファンマ設定画面
- **画面名**: ファンマ設定画面、ファンマ編集画面
- **URLパス**: `/fanmarks/:fanmarkId/settings`
- **ページコンポーネント**: `src/pages/FanmarkSettingsPage.tsx`
- **関連コンポーネント**: `src/components/FanmarkSettings.tsx`
- **翻訳キー**: `fanmarkSettings.*`
- **説明**: 個別ファンマのアクセスタイプ、転送先URL、伝言板、パスワード保護などの設定

### ファンマプロフィール編集画面
- **画面名**: プロフィール編集画面、ファンマプロフィール編集
- **URLパス**: `/fanmarks/:fanmarkId/profile/edit`
- **ページコンポーネント**: `src/pages/EmojiProfileEdit.tsx`
- **関連コンポーネント**: `src/components/EmojiProfileForm.tsx`
- **翻訳キー**: `emojiProfile.*`
- **説明**: ファンマのプロフィールページ（カバー画像、自己紹介、ソーシャルリンクなど）を編集

### ファンマプロフィールプレビュー画面
- **画面名**: プロフィールプレビュー、ファンマプロフィール確認
- **URLパス**: `/fanmarks/:fanmarkId/profile/preview`
- **ページコンポーネント**: `src/pages/FanmarkProfilePreview.tsx`
- **関連コンポーネント**: `src/components/FanmarkProfile.tsx`
- **翻訳キー**: `emojiProfile.profilePreview*`
- **説明**: ファンマのプロフィールページのプレビュー表示

### 伝言板プレビュー画面
- **画面名**: 伝言板プレビュー、メッセージボードプレビュー
- **URLパス**: `/fanmarks/:fanmarkId/messageboard/preview`
- **ページコンポーネント**: `src/pages/FanmarkMessageboardPreview.tsx`
- **関連コンポーネント**: `src/components/FanmarkMessage.tsx`
- **翻訳キー**: `messageBoard.*`
- **説明**: 伝言板の表示プレビュー（パスワード保護対応）

### ファンマ詳細画面
- **画面名**: ファンマ詳細画面、ファンマ情報画面、whois画面
- **URLパス**: `/f/:shortId`
- **ページコンポーネント**: `src/pages/FanmarkDetailsPage.tsx`
- **翻訳キー**: `fanmarkDetails.*`
- **説明**: ファンマの取得履歴、現在の所有者、ステータスなどの詳細情報

### ファンマアクセス（短縮URL）
- **画面名**: ファンマアクセス、短縮URLアクセス
- **URLパス**: `/a/:shortId`
- **コンポーネント**: `src/components/FanmarkAccessByShortId.tsx`
- **説明**: 短縮ID（shortId）でファンマにアクセス

### ファンマアクセス（絵文字パス）
- **画面名**: ファンマアクセス、絵文字URLアクセス
- **URLパス**: `/:emojiPath`
- **コンポーネント**: `src/components/FanmarkAccess.tsx`
- **関連コンポーネント**: `src/components/FanmarkAcquisition.tsx`
- **翻訳キー**: `acquisition.*`
- **説明**: 絵文字の組み合わせでファンマにアクセス（キャッチオールルート）

### 404 Not Found
- **画面名**: 404画面、ページが見つかりません
- **URLパス**: `*` (その他すべて)
- **ページコンポーネント**: `src/pages/NotFound.tsx`
- **説明**: 存在しないページへのアクセス時に表示

---

## 管理画面

### 管理画面ダッシュボード
- **画面名**: 管理画面、管理者ダッシュボード、Admin画面
- **URLパス**: `/` (admin サブドメイン経由)
- **ページコンポーネント**: `src/pages/AdminDashboard.tsx`
- **アプリルート**: `src/components/AdminApp.tsx`
- **説明**: 管理者専用のダッシュボード（招待システム、パターンルール、データリセットなど）

### 管理画面ログイン
- **画面名**: 管理画面ログイン
- **ページコンポーネント**: `src/pages/AdminAuth.tsx`
- **説明**: 管理者認証画面（kanouk@gmail.com のみアクセス可能）

---

## 主要コンポーネント

### ナビゲーション
- **コンポーネント**: `src/components/Navigation.tsx`
- **翻訳キー**: `navigation.*`
- **説明**: ヘッダーナビゲーション、ユーザーメニュー

### 言語切り替え
- **コンポーネント**: `src/components/LanguageToggle.tsx`
- **説明**: 日本語・英語の切り替え

### ファンマ検索
- **コンポーネント**: `src/components/FanmarkSearch.tsx`
- **翻訳キー**: `search.*`
- **説明**: トップページやダッシュボードでのファンマ検索機能

### ファンマ登録フォーム
- **コンポーネント**: `src/components/FanmarkRegistrationForm.tsx`
- **翻訳キー**: `registration.*`
- **説明**: 詳細設定を含むファンマ登録フォーム

### ファンマクイック登録
- **コンポーネント**: `src/components/FanmarkQuickRegistration.tsx`
- **翻訳キー**: `registration.quick*`
- **説明**: 簡易的にファンマを取得する機能

### 絵文字入力
- **コンポーネント**: `src/components/EmojiInput.tsx`
- **説明**: 絵文字ピッカーとクリップボード貼り付けに対応した入力フィールド

### パスワード保護
- **コンポーネント**: `src/components/PasswordProtection.tsx`
- **翻訳キー**: `passwordProtection.*`
- **説明**: 4桁数字によるパスワード認証UI

### ファンマステータスバッジ
- **コンポーネント**: `src/components/FanmarkStatusBadge.tsx`
- **翻訳キー**: `dashboard.status*`, `fanmarkStatus.*`
- **説明**: ファンマのステータス（有効、失効、返却処理中など）を表示

### 猶予期間カウントダウン
- **コンポーネント**: `src/components/GraceStatusCountdown.tsx`
- **翻訳キー**: `dashboard.graceTimeRemaining`
- **説明**: 失効処理中のファンマの残り時間を表示

### 招待システム（管理画面）
- **コンポーネント**: `src/components/InvitationSystem.tsx`
- **翻訳キー**: `invitation.*`
- **説明**: 招待コードの作成・管理

### 待機リスト管理（管理画面）
- **コンポーネント**: `src/components/SecureWaitlistAdmin.tsx`
- **説明**: 待機リストの表示・エクスポート

### パターンルール管理（管理画面）
- **コンポーネント**: `src/components/AdminPatternRules.tsx`
- **説明**: プレミアム絵文字、有料絵文字、特別絵文字のルール管理

### データリセット（管理画面）
- **コンポーネント**: `src/components/AdminDataReset.tsx`
- **説明**: 開発用のデータリセット機能

### 管理画面設定
- **コンポーネント**: `src/components/AdminSettings.tsx`
- **説明**: 管理者専用の設定

---

## URLパターン一覧

| URLパス | 画面名 | ページコンポーネント |
|---------|--------|---------------------|
| `/` | トップページ | `src/pages/Index.tsx` |
| `/auth` | 認証画面 | `src/pages/Auth.tsx` |
| `/forgot-password` | パスワード忘れ | `src/pages/ForgotPassword.tsx` |
| `/reset-password` | パスワードリセット | `src/pages/ResetPassword.tsx` |
| `/profile` | ユーザー設定 | `src/pages/Profile.tsx` |
| `/dashboard` | ダッシュボード | `src/pages/Dashboard.tsx` |
| `/plans` | プラン選択 | `src/pages/PlanSelection.tsx` |
| `/fanmarks/:fanmarkId/settings` | ファンマ設定 | `src/pages/FanmarkSettingsPage.tsx` |
| `/fanmarks/:fanmarkId/profile/edit` | プロフィール編集 | `src/pages/EmojiProfileEdit.tsx` |
| `/fanmarks/:fanmarkId/profile/preview` | プロフィールプレビュー | `src/pages/FanmarkProfilePreview.tsx` |
| `/fanmarks/:fanmarkId/messageboard/preview` | 伝言板プレビュー | `src/pages/FanmarkMessageboardPreview.tsx` |
| `/a/:shortId` | ファンマアクセス（短縮） | `src/components/FanmarkAccessByShortId.tsx` |
| `/f/:shortId` | ファンマ詳細 | `src/pages/FanmarkDetailsPage.tsx` |
| `/:emojiPath` | ファンマアクセス（絵文字） | `src/components/FanmarkAccess.tsx` |
| `*` | 404 Not Found | `src/pages/NotFound.tsx` |

---

## 翻訳キー対応表（主要なもの）

| 画面・機能 | 翻訳キー（プレフィックス） |
|-----------|-------------------------|
| トップページ | `hero.*`, `sections.*` |
| 認証 | `auth.*` |
| パスワード要件 | `password.*` |
| 検索 | `search.*` |
| 招待 | `invitation.*` |
| ナビゲーション | `navigation.*` |
| ダッシュボード | `dashboard.*` |
| ユーザー設定 | `userSettings.*`, `profile.*` |
| プラン選択 | `planSelection.*` |
| プランダウングレード | `planDowngrade.*` |
| ファンマ設定 | `fanmarkSettings.*` |
| プロフィール編集 | `emojiProfile.*` |
| 伝言板 | `messageBoard.*`, `passwordProtection.*` |
| ファンマ詳細 | `fanmarkDetails.*` |
| ファンマ取得 | `acquisition.*`, `registration.*` |
| 共通 | `common.*` |

---

## 主要な状態・ステータス

### ファンマのステータス
- **active**: 有効
- **inactive**: 停止中
- **expired**: 失効済み
- **grace**: 失効処理中（猶予期間）
- **return_processing**: 返却処理中

### アクセスタイプ
- **inactive**: なにもしない
- **profile**: プロフィール表示
- **redirect**: アドレス転送
- **text** / **messageboard**: 伝言板表示

### プランタイプ
- **free**: フリー
- **creator**: クリエーター
- **business**: ビジネス
- **enterprise**: エンタープライズ
- **admin**: 管理者

---

## 使用例

AIエージェントへの指示例：
- 「ダッシュボード画面を修正して」→ `src/pages/Dashboard.tsx` または `src/components/FanmarkDashboard.tsx`
- 「プラン変更画面のデザインを変えて」→ `src/pages/PlanSelection.tsx`
- 「ダウングレード画面を直して」→ `src/components/FanmarkSelectionModal.tsx`
- 「ファンマ設定画面の翻訳を追加」→ `src/translations/ja.json` の `fanmarkSettings.*`
- 「whois画面を修正」→ `src/pages/FanmarkDetailsPage.tsx`
- 「伝言板のプレビュー画面」→ `src/pages/FanmarkMessageboardPreview.tsx`

---

このドキュメントは、プロジェクトの構造変更に合わせて随時更新してください。
