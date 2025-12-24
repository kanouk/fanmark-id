# fanmark.id PRODUCT.md

## プロダクトの意図
絵文字1〜5個をID（ファンマ）として取得・保持し、プロフィール／リンク／メッセージを届けるサービス。検索→取得→設定→公開→返却・移管までを一貫して提供し、多言語での利用を前提にしている。

## コア体験
- 検索・取得: 絵文字入力を正規化して空き状況とティア・初回日数を提示。上限未満なら `register-fanmark` Edge Function 経由で取得し設定画面へ遷移。
- ダッシュボード管理: 所有ファンマ一覧表示、返却（`return-fanmark`）、設定遷移、コピー、移管・抽選ステータス表示。
- 設定: アクセスタイプ（redirect/profile/text/inactive）を編集。リダイレクトは URL/Phone を選択、プロフィール型は初期プロフィール自動生成。ドラフトを sessionStorage に保存し、保存完了または閉じるで破棄。
- 公開アクセス: `/a/:shortId` / `/:emojiPath` でアクセスし、RPC `get_fanmark_by_emoji` などから最小データを取得して UI 分岐。パスワード保護時は 4 桁認証。
- プロフィール管理: ユーザー自身のプロフィール・アバター・公開設定を編集。画像はローカルステートを単一ソースとして同期。

## 料金プランとティア
- プラン (ユーザー枠): Free=3件, Creator=10件, Business=50件, Admin=無制限。延長は有料（Adminのみ無料延長）。上限超過時は取得不可。
- プラン変更: アップグレードは即時適用。ダウングレード時は `FanmarkSelectionModal` で上限数だけ選択し、未選択分は一括返却（`bulk-return-fanmarks`）。選択は一度きりでキャンセル不可。
- ファンマティア (絵文字数に応じたライセンス初期日数): S=1個/7日, A=2個または2〜5個連続/14日, B=3個/30日, C=4〜5個以上非連続/無期限 (`license_end=null`)。`fanmark_tiers.display_name` に S/A/B/C を保持。
- AuthCode（移管コード）発行権限: アクティブライセンス保持者は発行可。発行には残期間48h以上が必要で、コード有効期限は発行から48hまたは `license_end` の短い方（Tierに関わらず一定）。承認後の再発行は不可。移管完了後は Transfer Lock 30日間（返却・再移管・再発行不可）。

## ライセンスライフサイクルと猶予
- 取得時は初回日数を次の UTC 0:00 に丸めて `license_end` として保存（Tier C は無期限）。
- 返却または期限到達: status=`grace` にし、`grace_expires_at = roundUpToNextUtcMidnight(now + grace_period_days)`（デフォルト24h以上保証）。グレース中は再取得不可。
- `grace_expires_at` 超過で `expired` へ遷移し設定削除。通知・抽選・お気に入り連携はこの状態遷移をトリガーにする。

## 譲渡（移管）システム
- フロー: 現所有者が移管コード（AuthCode）発行→受取側が申請→現所有者が承認→新ライセンス発行／旧ライセンス失効。申請中は延長・返却をブロック。
- コード発行条件: 残期間48h以上、1ライセンス1コード、申請中は再発行不可、再発行で既存コードを自動 cancel。Tier C は有効期限上限30日。
- 新ライセンス期間: Tier S 7日 / A 14日 / B 30日 / C 無期限。設定データは基本・redirect・messageboard・プロフィールをコピーし、パスワード設定は除外。

## 抽選システム
- 対象: Grace 中のファンマ。ユーザーは1ファンマにつき1件申込、現オーナーも可。延長と抽選は排他（延長が優先し pending をキャンセル）。
- 実行: `check-expired-licenses` バッチが `grace_expires_at` 超過時に申込数を判定。0件→通常失効、1件→自動当選、複数→加重ランダム抽選。結果を通知し、新ライセンス発行・旧ライセンス失効。
- 管理: 抽選確率の編集、申込キャンセル、履歴保存、通知テンプレートは `lottery_*` イベントで管理。

## お気に入り・通知
- お気に入り: `fanmark_discoveries` / `fanmark_favorites` で未取得ファンマも管理。トグルは RPC `add/remove_fanmark_favorite`。返却完了時にお気に入り登録者へ `favorite_fanmark_available` 通知イベントを生成。
- 通知基盤: `notification_events` → `notification_rules` → `notifications`。イベント例: grace開始/失効、抽選当落、移管関連、手動告知。`process-notification-events` Scheduled Function が展開・配信し、in-app/メール等に対応。

## 招待・認証
- 招待制: `system_settings.invitation_mode` が ON の場合、サインアップ前に `validate_invitation_code` 成功が必須。`use_invitation_code` で消費し、残数と期限を検証。待機リストは `waitlist` テーブルで管理し、管理UIから招待コード配布。
- 認証: Supabase Auth。`social_login_enabled=false` または招待モード中は OAuth を抑止し、OAuth でも初回パスワード設定を強制。パスワード要件表示、メール確認・再送、リセット対応。
- 多言語: 日本語/英語の翻訳バンドルを用意し、ヘッダーで切替可能。

## アクセスタイプ仕様
- `redirect`: 外部 URL または `tel:` を保存し即時遷移。
- `profile`: `emoji_profiles` を表示（公開設定・ソーシャルリンク・テーマ）。
- `text` (messageboard): メッセージ表示とコピー。
- `inactive`: 何もしない。ドラフト復元やパスワード保護の有無も翻訳キーで制御。

## データモデル概要
- 主要テーブル: `fanmarks`, `fanmark_licenses` (status/日付/Tier), `fanmark_tiers`, `emoji_profiles`, `fanmark_basic/redirect/messageboard/password_configs`, `fanmark_discoveries`, `fanmark_favorites`, `fanmark_lottery_entries/history`, `fanmark_transfer_codes/requests`, `invitation_codes`, `waitlist`, `system_settings`, `notification_events/rules/notifications`, `audit_logs`.
- RPC/Functions (抜粋): `check_fanmark_availability`, `get_fanmark_by_emoji`, `register-fanmark`, `return-fanmark`, `bulk-return-fanmarks`, `extend-fanmark-license`, `check-expired-licenses`, `generate/apply/approve/reject/cancel-transfer-code`, `apply/cancel-lottery-entry`, `process-notification-events`.

## UXポイント
- ダッシュボード: 統計カードにお気に入り数、抽選/移管バッジ、プラン選択導線。
- ランディング: ヒーロー、検索、最近取得、事例、CTA。
- エラーハンドリング: 主要操作はトースト通知。抽選・検索は `finally` で再フェッチし UI と状態を常に同期。

---

## 課金システム詳細仕様

### 1. プラン課金（サブスクリプション）

#### 1.1 プラン定義

| プラン | 月額 | ファンマ上限 | 延長料金 | Stripe Price ID 設定キー |
|--------|------|-------------|----------|--------------------------|
| Free | ¥0 | 3件 | 有料 | なし |
| Creator | 有料 | 10件 | 有料 | `creator_stripe_price_id` |
| Max | 有料 | 500件 | 有料 | `max_stripe_price_id` |
| Business | 有料 | 50件 | 有料 | `business_stripe_price_id` |
| Admin | - | 無制限 | 無料 | なし（管理者付与のみ） |

#### 1.2 プラン変更マトリクス

**アップグレード（上位プランへ）:**

| From → To | 処理 | Stripe 操作 | ファンマ選択 |
|-----------|------|-------------|-------------|
| Free → Creator/Max/Business | `create-checkout` | 新 Checkout Session 作成 | 不要 |
| Creator → Max/Business | `change-subscription` | 現サブスク `cancel_at_period_end=true` → 新 Checkout | 不要 |
| Max → Business | `change-subscription` | 現サブスク `cancel_at_period_end=true` → 新 Checkout | 不要 |

**ダウングレード（下位プランへ）:**

| From → To | 処理 | ファンマ選択 | Stripe 操作 |
|-----------|------|-------------|-------------|
| Business → Max/Creator | `change-subscription` | 上限超過時のみ必須 | 現サブスク即時キャンセル → 新 Checkout |
| Max → Creator | `change-subscription` | 上限超過時のみ必須 | 現サブスク即時キャンセル → 新 Checkout |
| Creator/Max/Business → Free | `change-subscription` | 上限超過時のみ必須 | `stripe.subscriptions.cancel()` 即時キャンセル |

---

### 2. 新規契約フロー（Free → 有料プラン）

#### 2.1 ユーザー視点

| ステップ | ユーザー操作 | UI表示 |
|----------|-------------|--------|
| 1 | `/plans` 画面でプランカードをクリック | ボタンに「{プラン名} を選ぶ」と表示 |
| 2 | ボタンをクリック | ローディングスピナー表示、ボタン非活性化 |
| 3 | Stripe Checkout へ自動遷移 | 新規タブで Stripe 決済画面が開く |
| 4a | 決済成功 | `/plans?checkout=success` へ戻る |
| 4b | 決済キャンセル | `/plans?checkout=canceled` へ戻る |
| 5 | 成功時: ポーリング開始 | 「サブスクリプションの確認中...」トースト表示 |
| 6 | プラン反映完了 | カードに「現在のプラン」バッジ表示、成功トースト |

**トースト通知:**
- 決済画面遷移時: 「Stripe決済ページに移動します」
- 成功後ポーリング中: 「サブスクリプションの確認中...」
- 完了: 「{プラン名} プランへの変更が完了しました」
- キャンセル時: 「決済をキャンセルしました」
- タイムアウト時: 「プラン情報が更新されない場合は、ページを再読み込みしてください」

**ポーリング仕様:**
- 開始条件: URL に `?checkout=success` パラメータ検出
- 間隔: 初回 1秒後、以降 2秒間隔
- 最大試行: 15回（約30秒）
- 完了条件: `profile.plan_type` が期待値に変化
- タイムアウト時: 警告トースト表示、手動リロード案内

#### 2.2 内部処理

```
1. UI: `/plans` で有料プラン選択
2. フロントエンド: `supabase.functions.invoke('create-checkout', { body: { plan_type } })`
3. Edge Function `create-checkout`:
   a. JWT から user を取得
   b. `system_settings` から `{plan_type}_stripe_price_id` を取得
   c. `user_settings.stripe_customer_id` を参照（なければ Stripe で email 検索 → 作成）
   d. `stripe_customer_id` を `user_settings` に保存
   e. Stripe: `checkout.sessions.create({ mode: 'subscription', customer, ... })`
   f. レスポンス: `{ url: session.url }`
4. フロントエンド: `window.open(url, '_blank')` で Stripe Checkout へ
5. ユーザー: Stripe で決済完了
6. Stripe: `customer.subscription.created` Webhook 送信
7. Edge Function `handle-stripe-webhook`:
   a. イベント検証（署名確認）
   b. `priceId` から `planType` を判定（creator/max/business）
   c. `user_subscriptions` テーブルに upsert
   d. `user_settings.plan_type` を更新
8. フロントエンド: ポーリングで `profile.plan_type` 変化を検知
9. UI 更新完了
```

**DB 更新内容:**
- `user_subscriptions`: stripe_subscription_id, stripe_customer_id, product_id, price_id, status, current_period_start/end, amount, currency, interval 等
- `user_settings.plan_type`: 'free' → 'creator'/'max'/'business'

---

### 3. アップグレードフロー（有料 → 上位有料プラン）

#### 3.1 ユーザー視点

| ステップ | ユーザー操作 | UI表示 |
|----------|-------------|--------|
| 1 | `/plans` で上位プランカードをクリック | ボタンに「{プラン名} を選ぶ」表示 |
| 2 | ボタンをクリック | ローディングスピナー |
| 3 | Stripe Checkout へ遷移 | 新規タブで決済画面 |
| 4 | 決済成功 | `/plans?checkout=success` へ戻る |
| 5 | ポーリング → 完了 | 「{プラン名} プランへのアップグレードが完了しました」 |

**表示される情報:**
- 現在のプランには「現在のプラン」バッジ
- 上位プランは通常のボタン表示

#### 3.2 内部処理

```
1. UI: 上位プラン選択
2. フロントエンド: `supabase.functions.invoke('change-subscription', { body: { new_plan_type } })`
3. Edge Function `change-subscription`:
   a. JWT から user を取得
   b. 現在のサブスクリプションを Stripe から取得
   c. プラン順序を比較 → アップグレード判定
   d. Stripe: 現サブスクに `cancel_at_period_end: true` を設定
   e. `system_settings` から新プランの `stripe_price_id` を取得
   f. Stripe: `checkout.sessions.create({ mode: 'subscription', ... })`
   g. レスポンス: `{ success: true, checkoutUrl: session.url }`
4. フロントエンド: `window.open(checkoutUrl, '_blank')`
5. ユーザー: Stripe で決済
6. Stripe: `customer.subscription.created` Webhook（新サブスク）
7. `handle-stripe-webhook`: DB 更新
```

**日割り計算:**
- Stripe 側で自動計算
- 現期間の残り分がクレジットとして新サブスクに適用

---

### 4. ダウングレードフロー

#### 4.1 ファンマ選択が不要な場合（上限内）

##### ユーザー視点

| ステップ | ユーザー操作 | UI表示 |
|----------|-------------|--------|
| 1 | `/plans` で下位プランをクリック | - |
| 2 | 警告ダイアログ表示 | `DowngradeWarningDialog` が開く |
| 3 | 警告内容を確認 | 残期間喪失、新上限、注意事項を表示 |
| 4 | 「ダウングレードする」をクリック | ローディング表示 |
| 5a | Free へ: API 処理完了 | 成功トースト、UI 更新 |
| 5b | 有料プランへ: Stripe Checkout | 決済画面へ遷移 |

**警告ダイアログ内容:**
- 「{現プラン} から {新プラン} へダウングレードします」
- 「現在の有料期間の残り分は返金されません」
- 「ファンマ上限が {旧上限} 件から {新上限} 件に減少します」
- チェックボックス: 「上記内容を理解しました」（チェック必須）

##### 内部処理（Free へのダウングレード）

```
1. UI: Free プラン選択 → DowngradeWarningDialog 表示
2. ユーザー: 確認してダウングレード実行
3. フロントエンド: `supabase.functions.invoke('change-subscription', { body: { new_plan_type: 'free' } })`
4. Edge Function `change-subscription`:
   a. ダウングレード判定
   b. Stripe: `stripe.subscriptions.cancel(subscriptionId)` 即時キャンセル
   c. レスポンス: `{ success: true, pending: true, message: "Subscription cancellation initiated..." }`
   
   ※ DB 更新はここでは行わない（Webhook に委譲）
   
5. Stripe: `customer.subscription.deleted` Webhook 送信
6. Edge Function `handle-stripe-webhook`:
   a. `user_subscriptions` から該当レコードを削除
   b. `user_settings.plan_type = 'free'` に更新
7. フロントエンド: ポーリングで plan_type 変化を検知
```

##### 内部処理（有料プラン間のダウングレード）

```
1. UI: 下位有料プラン選択 → DowngradeWarningDialog
2. フロントエンド: `change-subscription` 呼び出し
3. Edge Function:
   a. Stripe: 現サブスク即時キャンセル
   b. Stripe: 新プランの Checkout Session 作成
   c. レスポンス: `{ success: true, checkoutUrl }`
4. フロントエンド: Stripe Checkout へ遷移
5. 以降は新規契約と同じフロー
```

#### 4.2 ファンマ選択が必要な場合（上限超過）

##### ユーザー視点

| ステップ | ユーザー操作 | UI表示 |
|----------|-------------|--------|
| 1 | `/plans` で下位プランをクリック | - |
| 2 | 選択モーダル表示 | `FanmarkSelectionModal` が開く |
| 3 | ファンマをグリッド表示 | 所有ファンマ一覧、選択カウンター |
| 4 | 残すファンマを選択 | チェック状態変化、「あと{N}個選択してください」 |
| 5 | 上限数を選択完了 | 「この選択で進める」ボタン活性化 |
| 6 | 確定ボタンクリック | 最終確認ダイアログ |
| 7 | 「確定する」クリック | ローディング、一括返却処理 |
| 8 | 返却完了 | ダウングレード処理へ移行 |
| 9 | 処理完了 | 成功トースト、ダッシュボードへ |

**選択モーダルの表示内容:**
- タイトル: 「残すファンマを選択してください」
- サブタイトル: 「{新プラン} プランでは最大 {上限} 個のファンマを保持できます」
- グリッド: 絵文字 + 名前 + チェックボックス
- カウンター: 「{選択数} / {上限} 個を選択中」
- 警告: 「選択されなかったファンマは返却され、他のユーザーが取得可能になります」

**確定前の最終確認:**
- 「以下のファンマを返却します:」+ 未選択ファンマ一覧
- 「この操作は取り消せません」
- 「返却する」「キャンセル」ボタン

##### 内部処理

```
1. UI: 下位プラン選択
2. フロントエンド: `evaluatePlanDowngrade(userId, currentPlan, newPlan)` 呼び出し
   a. `fetchActiveFanmarks(userId)` で現在の所有数を取得
   b. `getPlanLimit(newPlan)` で新上限を取得
   c. 所有数 > 新上限 → `{ requiresSelection: true, fanmarks, newPlanLimit }`
3. UI: FanmarkSelectionModal 表示
4. ユーザー: 上限数だけ選択して確定
5. フロントエンド: `handleFanmarkSelectionConfirm(selectedIds)`
   a. 未選択の fanmark_id リストを算出
   b. `supabase.functions.invoke('bulk-return-fanmarks', { body: { fanmark_ids } })`
6. Edge Function `bulk-return-fanmarks`:
   a. 各ファンマの license を取得
   b. status を 'grace' に更新
   c. grace_expires_at を設定
   d. 設定データをクリア
   e. audit_log に記録
7. 返却完了後、`change-subscription` を呼び出し
8. 以降は通常のダウングレード処理
```

---

### 5. ライセンス延長課金

#### 5.1 延長対象条件

| 条件 | 延長可否 | 理由 |
|------|---------|------|
| status = `active` | ✅ 可 | 通常の延長 |
| status = `grace` | ✅ 可 | 復帰可能 |
| status = `expired` | ❌ 不可 | ライセンス失効済み |
| Tier C（無期限） | ❌ 不可 | license_end = null |
| 移管申請中 | ❌ 不可 | has_active_transfer = true |
| Admin プラン | ✅ 可（無料） | Stripe 経由なし |

#### 5.2 延長価格テーブル

`fanmark_tier_extension_prices` テーブル構造:

| カラム | 説明 |
|--------|------|
| tier_level | 1=S, 2=A, 3=B, 4=C |
| months | 延長月数（1, 3, 6, 12 等） |
| price_yen | 日本円価格 |
| stripe_price_id | Stripe Price ID |
| is_active | 有効フラグ |

#### 5.3 ユーザー視点

| ステップ | ユーザー操作 | UI表示 |
|----------|-------------|--------|
| 1 | ダッシュボードでファンマカードの「...」メニュー | ドロップダウン表示 |
| 2 | 「期間を延長する」をクリック | `ExtendLicenseDialog` が開く |
| 3 | 延長月数を選択 | 月数カード（1ヶ月, 3ヶ月等）、価格表示 |
| 4 | 延長後の日付をプレビュー | 「延長後: 20XX年XX月XX日まで」 |
| 5 | 「¥{price} で延長する」をクリック | ローディング、「Stripe決済ページに移動します」トースト |
| 6 | Stripe Checkout で決済 | 決済画面 |
| 7a | 成功 | `/dashboard?extension=success&fanmarkId=xxx` |
| 7b | キャンセル | `/dashboard?extension=canceled` |
| 8 | 完了 | 「ライセンスを延長しました」トースト、日付更新 |

**ダイアログ表示内容:**
- タイトル: 「{絵文字} の期間を延長」
- 現在の有効期限: 「現在: 20XX年XX月XX日まで」
- 月数選択: 価格付きのカード形式
- 延長後プレビュー: 選択に応じて動的更新
- ボタン: 「¥{price} で延長する」

**無期限ライセンス（Tier C）の場合:**
- ダイアログに「このファンマは無期限のため延長は不要です」と表示
- 延長ボタンは非表示

**移管申請中の場合:**
- 「移管手続き中のため延長できません」と表示
- 延長ボタンは非活性

#### 5.4 内部処理

```
1. UI: ExtendLicenseDialog で月数選択
2. フロントエンド: `supabase.functions.invoke('create-extension-checkout', { body: { fanmark_id, months } })`
3. Edge Function `create-extension-checkout`:
   a. JWT から user を取得
   b. `fanmark_licenses` から該当ライセンスを取得
   c. 検証: user_id 一致、status が active/grace、license_end が null でない
   d. `fanmark_tiers` から tier_level を取得
   e. `fanmark_tier_extension_prices` から price_id を取得（tier_level + months で検索）
   f. Stripe: `checkout.sessions.create({
        mode: 'payment',
        line_items: [{ price: stripe_price_id, quantity: 1 }],
        metadata: {
          type: 'license_extension',
          fanmark_id,
          license_id,
          user_id,
          months,
          tier_level
        }
      })`
   g. レスポンス: `{ url: session.url }`
4. フロントエンド: Stripe Checkout へ遷移
5. ユーザー: 決済完了
6. Stripe: `checkout.session.completed` Webhook 送信
7. Edge Function `handle-stripe-webhook`:
   a. metadata.type === 'license_extension' を確認
   b. metadata から fanmark_id, license_id, user_id, months を取得
   c. 現在の license_end を取得
   d. 新しい license_end を計算:
      - base = max(now(), 現在の license_end)
      - extended = addMonths(base, months)
      - new_license_end = roundUpToNextUtcMidnight(extended)
   e. fanmark_licenses を更新:
      - status = 'active'
      - license_end = new_license_end
      - grace_expires_at = null
      - is_returned = false
   f. 該当ファンマの pending 抽選エントリをキャンセル
   g. audit_logs に記録
8. UI: 次回ダッシュボード表示時に反映
```

**日付計算ロジック:**
```typescript
function roundUpToNextUtcMidnight(date: Date): Date {
  const next = new Date(date);
  next.setUTCHours(24, 0, 0, 0);
  return next;
}

function addMonths(base: Date, months: number): Date {
  const result = new Date(base);
  result.setMonth(result.getMonth() + months);
  // 月末ロールオーバー処理
  return result;
}
```

---

### 6. 返却・移管時の課金への影響

#### 6.1 返却時

| 項目 | 変化 |
|------|------|
| サブスクリプション | 変化なし |
| プラン枠 | 即時解放（所有数 -1） |
| ライセンス status | active → grace |
| 延長可否 | grace 中も延長可能 |
| 返金 | なし（購入済み期間は返金対象外） |

#### 6.2 移管完了時

| 対象 | 項目 | 変化 |
|------|------|------|
| 送り手 | サブスク | 変化なし |
| 送り手 | プラン枠 | 即時解放 |
| 送り手 | ライセンス | status = expired |
| 受け手 | サブスク | 変化なし |
| 受け手 | プラン枠 | 消費（所有数 +1） |
| 受け手 | ライセンス | 新規発行（Tier 初期日数） |

---

### 7. サブスクリプション管理（Customer Portal）

#### 7.1 ユーザー視点

| ステップ | ユーザー操作 | UI表示 |
|----------|-------------|--------|
| 1 | `/plans` で「サブスクリプション管理」リンクをクリック | - |
| 2 | Stripe Customer Portal へリダイレクト | Stripe 管理画面が開く |
| 3 | 支払い方法変更/解約等の操作 | Stripe UI で操作 |
| 4 | 「戻る」をクリック | アプリに戻る |

**Customer Portal で可能な操作:**
- 支払い方法の変更/追加
- 請求履歴の確認
- サブスクリプションのキャンセル
- 領収書のダウンロード

#### 7.2 内部処理

```
1. フロントエンド: `supabase.functions.invoke('customer-portal')`
2. Edge Function `customer-portal`:
   a. JWT から user を取得
   b. Stripe: email で customer を検索
   c. Stripe: `billingPortal.sessions.create({ customer: customerId, return_url })`
   d. レスポンス: `{ url: portalSession.url }`
3. フロントエンド: `window.location.href = url` でリダイレクト
```

---

### 8. グレース期間と延長

#### 8.1 グレース期間設定

- 設定場所: `system_settings.grace_period_days`
- デフォルト値: 1日（24時間以上を保証）
- 計算式: `grace_expires_at = roundUpToNextUtcMidnight(now + grace_period_days)`

#### 8.2 グレース中の状態

| 項目 | 状態 |
|------|------|
| ファンマへのアクセス | 可能（設定は維持） |
| 延長 | 可能 |
| 抽選への応募 | 他ユーザーが可能 |
| 再取得 | 不可（他ユーザーも不可） |

#### 8.3 グレース中の延長完了時

- `status`: grace → active
- `grace_expires_at`: クリア（null）
- `license_end`: 延長後の日付
- pending 抽選エントリ: 自動キャンセル
- 通知: 抽選応募者に「延長により抽選がキャンセルされました」

---

### 9. Webhook イベント処理一覧

| イベント | 処理内容 | DB 更新 |
|----------|----------|---------|
| `customer.subscription.created` | 新規サブスク作成 | user_subscriptions upsert, user_settings.plan_type 更新 |
| `customer.subscription.updated` | サブスク更新 | user_subscriptions upsert, user_settings.plan_type 更新（必要時） |
| `customer.subscription.deleted` | サブスクキャンセル完了 | user_subscriptions 削除, 同一customerにactiveが無い場合のみ user_settings.plan_type = 'free' |
| `checkout.session.completed` (type=license_extension) | ライセンス延長決済完了 | fanmark_licenses 更新, 抽選キャンセル, audit_log |

**priceId → planType 判定ロジック:**
```typescript
const priceIdToPlanType = {
  [creatorPriceId]: 'creator',
  [maxPriceId]: 'max',
  [businessPriceId]: 'business'
};
```

**Webhookのユーザー特定:**
- `subscription.customer` / `checkout.session.customer` の `stripe_customer_id` を `user_settings` から逆引き
- 見つからない場合のみ email をフォールバックし、見つかったら `stripe_customer_id` を保存

---

### 10. エラーハンドリング

#### 10.1 API/Stripe エラー時

| エラータイプ | トースト内容 | 復旧方法 |
|-------------|------------|---------|
| 認証エラー | 「ログインセッションが切れました。再度ログインしてください」 | 再ログイン |
| Stripe API エラー | 「決済処理中にエラーが発生しました。時間をおいて再度お試しください」 | リトライ |
| サブスク取得失敗 | 「サブスクリプション情報を取得できませんでした」 | リトライ |
| 延長検証エラー | 「このファンマは延長できません: {理由}」 | 条件確認 |

#### 10.2 Webhook 遅延/未着時

- `check-subscription` Edge Function で手動同期可能
- UI ポーリング: 最大15回、2秒間隔
- タイムアウト時メッセージ: 「プラン情報が更新されない場合は、ページを再読み込みしてください」
- 最終手段: Customer Portal で状態確認

---

### 11. 状態遷移とボタン制御

| 状態 | ボタン表示 | 活性状態 |
|------|----------|---------|
| 未ログイン | 「ログインしてプランを選択」 | 活性（→ログイン画面） |
| 処理中 | スピナー + 「処理中...」 | 非活性 |
| 現在のプラン | 「現在のプラン」バッジ | 非活性（選択不可） |
| 上位プラン | 「{プラン名} を選ぶ」 | 活性 |
| 下位プラン | 「{プラン名} を選ぶ」 | 活性 |
| Free（有料→Free時） | 「Free プランに戻す」 | 活性 |

**延長ボタン制御:**

| 状態 | ボタン | 活性状態 |
|------|--------|---------|
| 通常 | 「期間を延長する」 | 活性 |
| 無期限（Tier C） | 表示なし or 「延長不要」 | 非活性 |
| 移管申請中 | 「移管中のため延長不可」 | 非活性 |
| Admin プラン | 「無料延長」 | 活性 |

---

### 12. 関連テーブル

| テーブル | 用途 | 主要カラム |
|----------|------|-----------|
| `user_settings` | ユーザープラン情報 | plan_type, user_id |
| `user_subscriptions` | Stripe サブスク詳細 | stripe_subscription_id, status, current_period_end |
| `fanmark_licenses` | ライセンス状態 | status, license_end, grace_expires_at |
| `fanmark_tier_extension_prices` | 延長価格マスタ | tier_level, months, price_yen, stripe_price_id |
| `fanmark_tiers` | Tier 定義 | tier_level, initial_license_days |
| `system_settings` | システム設定 | creator/max/business_stripe_price_id, grace_period_days |
| `audit_logs` | 操作履歴 | action, resource_type, metadata |

---

### 13. 関連 Edge Functions

| Function | 用途 | 入力 | 出力 |
|----------|------|------|------|
| `create-checkout` | 新規プラン契約 | plan_type | { url } |
| `create-extension-checkout` | ライセンス延長 | fanmark_id, months | { url } |
| `change-subscription` | プラン変更 | new_plan_type | { success, checkoutUrl?, pending? } |
| `check-subscription` | サブスク状態確認 | - | { subscribed, product_id, subscription_end } |
| `handle-stripe-webhook` | Webhook 処理 | Stripe Event | 200 OK |
| `bulk-return-fanmarks` | 一括返却 | fanmark_ids[] | { success, results[] } |
| `customer-portal` | Portal セッション | - | { url } |
