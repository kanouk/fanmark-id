# 招待制ローンチ仕様メモ

このドキュメントは、招待制の狙い・仕様・実装方針を俯瞰できるようにまとめたものです。会話内で決めた内容を別スレッドでも再現可能な形で整理しています。

## 目的と方針
- **目的**: 初期ローンチ期間にトラフィックを制御し、限定感や FOMO を演出しつつ、サービスの信頼性を確保する。
- **活用フェーズ**:
  1. **Closed Beta** – 招待コード必須。多回使用コードと待機リスト配布の単発コードで運用。
  2. **Ramp-up** – 待機リスト利用者を順次招待してユーザー数を増やす。
  3. **General Release** – `invitation_mode=false` として通常サインアップに移行。必要に応じて再び招待制へ戻せるよう実装を残す。
- **非目標**: サービス永続の厳格なアクセス制御。あくまでローンチ期の暫定対応。

## 現状の実装概要（2025-10-19 時点）
- `system_settings.invitation_mode` を参照してサインアップタブに `InvitationSystem` を表示し、コード検証が成功するまでサインアップフォームを非表示にするガードを実装済み（`src/pages/Auth.tsx`）。
- `InvitationSystem` は `onValidCode` / `onReset` で親コンポーネントに状態を通知し、入力を変更した際には検証結果をリセットする（`src/components/InvitationSystem.tsx`）。
- サインアップ時は `useAuthForm.signUp()` が `validate_invitation_code` を再実行して妥当性と残数を確認し、成功後に `use_invitation_code` を呼び出す。コード消費に失敗した場合はトーストで警告する。
- プロフィールには可能な範囲で `invited_by_code` を `update` している（メール認証待ちなどでセッションが得られない場合はログ出力のみ）。
- Supabase 側のテーブル・RPC は既存のものを利用（`invitation_codes`, `waitlist`, `validate_invitation_code`, `use_invitation_code`）。`special_perks` は未使用のまま。
- 管理画面には「招待管理」タブ（`AdminInvitationManager`）を追加し、以下の機能を提供：
  - `invitation_mode` トグルのオン・オフおよび再読み込み。
  - 招待コードの一覧表示・新規発行・編集・有効/無効切替・削除。
  - `SecureWaitlistAdmin` を内包し、ウェイティングリストの閲覧・メール開示（super admin のみ）を行える。
- `useInvitationAdmin` フックで `invitation_codes` の CRUD を集約し、`useSystemSettings` に `updateSetting` を追加。

## 仕様決定事項
### 招待コードの位置づけ
- **検証項目**: コードの存在・有効/無効・期限超過の確認・残り使用回数の確認のみ。誰が発行したコードかの照合は行わない。
- **使用回数更新**: サインアップ処理が成功した時点で `used_count` を +1 する。先に検証し、成功後に消費するフローにする。
- **特典 (special_perks)**: 現状のローンチでは利用しない。既存の `special_perks` カラムは触らず、将来的に削除または無効化する方針。

### フロントエンドの挙動
- `system_settings.invitation_mode` を参照し、true の場合のみ招待制 UI を有効化する。  
  (`useSystemSettings` は既に `invitation_mode` を取得している。)
- サインアップタブ (`src/pages/Auth.tsx`) の構造は維持しつつ、以下の条件分岐を追加する：
  1. `InvitationSystem` コンポーネントをタブ内にマウント。
  2. 招待コードが未検証の間はサインアップフォーム (`SignUpForm`) を非表示または無効化。
  3. 検証成功時 (`onValidCode`) にコード・検証結果を `Auth` コンポーネントで保持し、フォームを表示。
- `SignUpForm` / `useAuthForm.signUp()` に招待コードを渡す。  
  - 招待コード未検証の状態で Submit させない。
  - `invitation_mode=false` の場合は従来通り制限なしでサインアップ可能。

### サインアップ処理のフロー
1. フロントエンドで `InvitationSystem` により `validate_invitation_code` RPC を呼び、`remaining_uses > 0` のコードだけを通過させる。
2. `useAuthForm.signUp()` 内で、`invitation_mode` が ON の場合はサインアップ直前に同じ RPC を再確認し（競合対策）、妥当でなければエラーを返す。
3. `supabase.auth.signUp({ email, password })` でアカウントを作成。
4. サインアップ成功後に `use_invitation_code` RPC を呼び、`used_count` を 1 増やす。エラー（例: 同時使用で残数枯渇）が起きた場合は、ユーザー作成済みだがコード消費できなかった状態をトーストなどで知らせ、手動対処する。
5. `profiles.invited_by_code` にコードを保存する処理は、`signUp()` 後に `profiles` 更新 API を呼ぶ形で検討。特典を使わないため `invitation_perks` は空オブジェクトのままでもよい。

> ⚠️ この方式はフロントエンドによるガードであり、DevTools 経由で `supabase.auth.signUp` を直接叩けば突破可能。ローンチ初期の暫定対応として許容し、必要になった際に Edge Function や RLS での厳格化へ発展させる。

### データモデル / テーブル運用
- `invitation_codes`
  - 主なカラム: `code`, `max_uses`, `used_count`, `expires_at`, `is_active`
  - ルール: `used_count <= max_uses` を守り、`expires_at` を過ぎたら使用不可。  
  - 管理者が直接 SQL / Supabase Dashboard で投入可能。将来的に管理画面を追加する場合は `special_perks` を使わない前提で UI を設計する。
- `waitlist`
  - 招待コードをまだ持たないユーザーのメールを保存。`status` は `waiting` / `invited` / `converted` を利用。
  - 管理用タブに `SecureWaitlistAdmin` を組み込み、メール判明ボタン・エクスポート・ログ閲覧を行えるようにする。
- `profiles`
  - 初期実装では `invited_by_code` のみを更新し、特別ロールは `user_roles` テーブルで管理する方針。
- `user_roles`
  - 既存のロール管理仕組みを活用し、必要に応じて `beta`, `partner` などのロールを追加。管理画面 (`AdminUserManagement`) から変更可能にする。

### 待機リスト戦略
- 待機リスト経由で招待を配布する際は、単発（max_uses = 1）のコードを発行し、有効期限を短く設定して FOMO を演出する。
- 配布手段（メールなど）は別途設計。最低限、配布済みユーザーを `waitlist.status='invited'` に変更し、再配布を避ける。
- 検証後でもコードが失効した場合に備え「期限切れ・残数ゼロ」のメッセージを `InvitationSystem` に追加。

### 管理者向け補足
- 招待管理タブでは RLS（`is_admin()`）により権限ユーザーのみ `invitation_codes` を操作可能。
- ウェイティングリストの閲覧は `is_super_admin()` を満たす場合のみ詳細参照が許可され、権限がない場合は UI 上でガードされる。
- 特典 JSON (`special_perks`) はシステム側では未使用だがフォームから入力可能。利用しない場合は空欄のままで良い。
- 既存 Edge Functions / RPC はサービスロールキーを必要とするため、キー管理とアクセスログの把握が必須。厳格化が必要になった場合はダッシュボード経由の操作を Edge Function に移管する。

## 実装ステップ（推奨）
1. `Auth` ページに `InvitationSystem` を組み込み、検証状態を管理するステートを追加。
2. `SignUpForm` / `useAuthForm` を改修し、`invitation_mode` 時のみ招待コードチェック → サインアップ → コード消費のフローを実装。
3. サインアップ成功時に `profiles.invited_by_code` を更新する処理を追加（今回実装済み。失敗時はログ出力に留まるため、必要に応じてバックエンド連携を検討）。
4. `SecureWaitlistAdmin` を Admin 画面のタブに追加し、待機リスト運用を可能にする。  
5. 招待管理タブの QA：モード切替、コード発行/更新/無効化/削除、ウェイティングリスト閲覧、サインアップフローへの反映を確認。
6. 招待制が不要になったら `invitation_mode=false` に設定し、UI が自動的に通常サインアップへ戻ることを確認。

## リスク / 今後の検討
- フロントエンドのみのガードのため、熟練ユーザーが API を直接叩けば招待制をバイパスできる。プロダクトのライフサイクルや拡散リスクを見ながら、Edge Function や RLS での厳格化を検討する。
- `use_invitation_code` 呼び出し後の不整合（ユーザー作成成功・コード消費失敗）に備え、監視やアラート、手動修復手順を用意しておく。現状はエラー時にトースト＋ログ出力のみ。
- 今後 `special_perks` を削除する場合は、関連マイグレーションと型定義 (`src/integrations/supabase/types.ts`) の更新が必要。
- 招待制終了後も再びクローズド化する可能性がある場合、今回の改修をフラグ制御で保持し、定期的にテストする。

---
このメモをベースに、招待制ローンチを短期間で実装しつつ、ローンチ後に一般公開へ戻す際の切り替えもスムーズに行えるようにしてください。追加要件や仕様変更があれば、本ドキュメントを更新します。
