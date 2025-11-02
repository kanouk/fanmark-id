# レイアウト共通コンポーネント

共通ヘッダ／フッタに関する実装メモです。各ページは可能な限り本コンポーネントを利用してください。

## AppHeader

- 認証済みユーザー向けダッシュボード系画面で使用するフル機能ヘッダ。
- 通知プレビュー、未読バッジ、ユーザーメニュー、言語切替を内包。
- Props
  - `showLanguageToggle`, `showNotifications`, `showUserMenu`, `showAuthButton`: 機能の ON/OFF 切替。
  - `rightSlot`, `leftSlot`: 追加ボタンを挿入する際に使用。

## SimpleHeader

- 公開ページやシンプルなフォーム画面向けヘッダ。
- ブランドボタンでトップ (`/`) に戻る。
- Props
  - `showLanguageToggle`: デフォルトは `true`。必要に応じて `false` にして `rightSlot` 内で独自 UI を構築。
  - `leftSlot`: ブランドロゴの右側に任意要素（例: 「プレビュー」バッジ）を表示。
  - `rightSlot`: 追加アクションボタンを配置。

## SiteFooter

- サイト全体で利用する共通フッタ。
- デフォルトの文言は翻訳キー `layout.footer.description` で管理。
- Props
  - `descriptionKey`: カスタムメッセージキーを指定可能。`null` で非表示。
  - `description`: ReactNode を直接渡してカスタム表示。
  - `hideBrand`: ブランドロゴを非表示にする場合に使用。
  - `leftSlot` / `rightSlot`: 追加コンテンツを左右に配置。

## 利用指針

- 認証済み UI → `AppHeader` を優先（`Profile`, `Dashboard`, `Notifications` など）。
- 公開フォーム／プレビュー → `SimpleHeader` + `SiteFooter` を組み合わせる。
- 旧 `Navigation` コンポーネントは廃止済み。新規画面では本ガイドに従うこと。

