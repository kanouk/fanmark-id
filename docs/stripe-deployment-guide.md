# Stripe課金システム デプロイメントガイド

**作成日**: 2025年10月27日  
**バージョン**: 1.0  
**対象**: 開発者・運用担当者

---

## 1. 概要

このドキュメントは、fanmark.idのStripe課金システムを**開発モード（テストモード）**から**本番環境**へ移行するための完全なガイドです。

### 1.1 前提条件

- Stripeアカウントが作成済み
- Supabaseプロジェクトが稼働中
- 基本的なEdge Functions、データベースマイグレーションが完了

---

## 2. 開発モード（テストモード）での開発

### 2.1 Stripeテストモードの設定

#### 2.1.1 Stripe Dashboardでの設定

1. **Stripe Dashboard**にログイン: https://dashboard.stripe.com/
2. 左上のスイッチを「**テストモード**」に切り替え
3. **APIキー**を取得:
   - 開発者 → APIキー
   - **公開可能キー（Publishable key）**: `pk_test_...`
   - **シークレットキー（Secret key）**: `sk_test_...`（表示ボタンをクリック）

#### 2.1.2 Webhook Endpointの作成（テストモード）

1. **開発者 → Webhook** に移動
2. 「**エンドポイントを追加**」をクリック
3. 以下を設定:
   ```
   エンドポイントURL: https://ppqgtbjykitqtiaisyji.supabase.co/functions/v1/handle-stripe-webhook
   説明: fanmark.id Webhook (Test Mode)
   
   リッスンするイベント:
   ✓ checkout.session.completed
   ✓ customer.subscription.created
   ✓ customer.subscription.updated
   ✓ customer.subscription.deleted
   ✓ invoice.payment_succeeded
   ✓ invoice.payment_failed
   ```
4. 「**エンドポイントを追加**」をクリック
5. 作成されたEndpointの詳細画面で「**署名シークレット**」を表示・コピー: `whsec_...`

#### 2.1.3 Subscription Products & Pricesの作成（テストモード）

1. **商品 → 商品カタログ** に移動
2. **Creator Plan**を作成:
   ```
   商品名: Creator Plan
   説明: fanmark.id Creator Plan - 月額サブスクリプション
   料金モデル: 継続
   価格: ¥1,000
   請求期間: 月単位
   ```
   - 作成後、Price IDをコピー: `price_test_creator_...`

3. **Business Plan**を作成:
   ```
   商品名: Business Plan
   説明: fanmark.id Business Plan - 月額サブスクリプション
   料金モデル: 継続
   価格: ¥2,000
   請求期間: 月単位
   ```
   - 作成後、Price IDをコピー: `price_test_business_...`


#### 2.1.4 Customer Portal設定（テストモード）

Stripe Billing Portalを利用する前に、テストモード用のポータル設定を必ず作成してください。設定が存在しない状態で
`stripe.billingPortal.sessions.create` を呼び出すと、以下のように`No configuration provided...`エラーになります。

1. Stripe Dashboard → **設定 (Settings)** → **Customer portal** に移動
2. 「**Portal設定を作成**」「Get started」などをクリックして、最低限のプラン／ブランド設定を保存
3. これにより`Default configuration`（テストモード用）が作成され、Billing Portal API を呼び出せるようになります
4. 「Products and prices」または「Subscription products」セクションで、顧客に切り替えを許可したいプラン（例: Creator / Business）のPriceを追加し、`Allow customers to switch plans` をONにする

本番モードに切り替える際も、同じ手順で本番用のCustomer Portal設定を作成してください（テストと本番は別設定です）。

> **制限事項:** 1つのサブスクリプションに複数商品（複数のPrice）や従量課金が含まれている場合、Stripe Customer Portalではプラン変更ができず「キャンセルのみ」になります。fanmark.idではプラン課金は「1契約1Price」の構成を維持し、ライセンス延長などの都度課金は別Checkoutで処理してください。

---

### 2.2 Supabase Secretsの設定（テストモード）

Lovableのセキュリティ機能を使用してSecretsを設定します。

#### 2.2.1 必要なSecrets

| Secret名 | 説明 | 例 |
|---------|------|-----|
| `STRIPE_SECRET_KEY` | Stripeシークレットキー（テスト） | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | Webhook署名シークレット（テスト） | `whsec_...` |
| `STRIPE_PRICE_ID_CREATOR` | Creator PlanのPrice ID | `price_test_creator_...` |
| `STRIPE_PRICE_ID_BUSINESS` | Business PlanのPrice ID | `price_test_business_...` |
| `FRONTEND_URL` | フロントエンドURL | `https://your-app.lovable.app` |

#### 2.2.2 Secretsの登録方法

1. Lovable UIでSecretsツールを使用
2. 各Secretを順番に追加
3. Edge Functionsが自動的にこれらの環境変数にアクセス可能になる

---

### 2.3 データベース設定の確認

#### 2.3.1 system_settingsテーブルの確認

プラン価格は`system_settings`テーブルから動的に取得します。テストモードでも本番と同じ価格設定を使用します。

```sql
-- 現在の価格設定を確認
SELECT setting_key, setting_value 
FROM system_settings 
WHERE setting_key IN ('creator_pricing', 'business_pricing');

-- 期待される結果:
-- creator_pricing  | 1000
-- business_pricing | 2000
```

価格が未設定の場合は管理画面で設定するか、直接SQLで挿入:

```sql
INSERT INTO system_settings (setting_key, setting_value, is_public, description)
VALUES 
  ('creator_pricing', '1000', true, 'Creator plan monthly price in JPY'),
  ('business_pricing', '2000', true, 'Business plan monthly price in JPY')
ON CONFLICT (setting_key) DO UPDATE 
  SET setting_value = EXCLUDED.setting_value;
```

#### 2.3.2 Stripe Price ID設定（プラン連携）

`handle-stripe-webhook` Edge Functionは、Stripeサブスクリプションイベントに含まれる**Price ID**と`system_settings`テーブルの設定を照合して`user_settings.plan_type`を更新します。以下のキーに、Stripe Dashboardで発行したPrice ID（`price_...`形式）を必ず格納してください。

| setting_key | 役割 |
|-------------|------|
| `creator_stripe_price_id` | Creatorプランに紐づくPrice ID |
| `business_stripe_price_id` | Businessプランに紐づくPrice ID |

どちらか片方でも未設定／誤設定のままWebhookが動作すると、決済後もプランが`free`に戻ってしまい課金状態と齟齬が生じます。環境切り替え（テスト⇔本番）時は、Price IDの更新と同時にこれらの設定値も更新してください。

補足: `user_subscriptions`テーブルには`price_id`カラムがあり、Webhookが受信したPrice IDをキャッシュします。調査の際はこの値と`system_settings`の内容を照合すると原因切り分けが容易です。

---

### 2.4 テストカードでの動作確認

#### 2.4.1 Stripeテストカード一覧

| カード番号 | 用途 | 結果 |
|----------|------|------|
| `4242 4242 4242 4242` | 成功 | 決済成功 |
| `4000 0000 0000 9995` | 残高不足 | 決済失敗 |
| `4000 0000 0000 0002` | カード拒否 | 決済失敗 |
| `4000 0025 0000 3155` | 3Dセキュア認証 | 認証フロー発生 |

**共通の入力値**:
- 有効期限: 任意の未来の日付（例: 12/34）
- CVC: 任意の3桁（例: 123）
- 郵便番号: 任意（例: 123-4567）

#### 2.4.2 テストフロー

**プランアップグレードのテスト**:
1. フロントエンドでログイン（Free planユーザー）
2. プラン選択画面でCreator Planを選択
3. Stripe Checkoutページにリダイレクト
4. テストカード `4242 4242 4242 4242` で決済
5. 決済完了後、自動的に `/plans?checkout=success` に戻り、
   [Checkout & Subscription Sync Flow](./subscription-sync-flow.md) に記載のステップでモーダルが閉じることを確認
6. ダッシュボードでプランが「Creator」に変更されていることを確認
7. Supabaseの`stripe_payment_intents`テーブルを確認:
   ```sql
   SELECT * FROM stripe_payment_intents 
   WHERE user_id = 'your-user-id' 
   ORDER BY created_at DESC LIMIT 1;
   ```
8. `user_settings.plan_type`が`'creator'`に更新されていることを確認

**サブスクリプション確認**:
1. Stripe Dashboard → 顧客 で該当ユーザーを検索
2. サブスクリプションが作成されていることを確認
3. ステータスが「有効」であることを確認

**ライセンス延長のテスト**:
1. ダッシュボードで所有ファンマークの延長ボタンをクリック
2. 3ヶ月延長プランを選択
3. Stripe Checkoutで決済（テストカード使用）
4. `fanmark_licenses.license_end`が3ヶ月後に更新されていることを確認

#### 2.4.3 Webhook動作確認

**Stripe CLIを使用したローカルテスト**:

```bash
# Stripe CLIのインストール（Mac）
brew install stripe/stripe-cli/stripe

# Stripe CLIのログイン
stripe login

# Webhookをローカルにフォワード（開発中）
stripe listen --forward-to https://ppqgtbjykitqtiaisyji.supabase.co/functions/v1/handle-stripe-webhook

# 別ターミナルでテストイベント送信
stripe trigger checkout.session.completed
stripe trigger customer.subscription.created
stripe trigger invoice.payment_succeeded
```

**Edge Function Logsの確認**:
```bash
# Supabase CLI
supabase functions logs handle-stripe-webhook

# または、Supabase Dashboard → Edge Functions → handle-stripe-webhook → Logs
```

---

## 3. 本番環境への移行

### 3.1 移行前チェックリスト

開発モードでの動作確認が完了したら、以下のチェックリストを確認してから本番移行を開始します。

- [ ] **機能テスト**: すべての決済フロー（プラン変更、ライセンス延長）がテストモードで正常動作
- [ ] **Webhook処理**: Webhookイベントが正常に処理され、データベースが更新されることを確認
- [ ] **通知システム**: 決済完了後に通知が正しく送信されることを確認
- [ ] **エラーハンドリング**: 決済失敗、キャンセル時の挙動を確認
- [ ] **RLSポリシー**: `stripe_payment_intents`、`stripe_webhook_events`のRLSが正しく設定されている
- [ ] **監査ログ**: 決済関連のアクションが`audit_logs`に記録されることを確認
- [ ] **コード レビュー**: Edge Functionsのコードが本番レディであることを確認
- [ ] **セキュリティ レビュー**: Webhook署名検証が実装されていることを確認
- [ ] **ドキュメント**: 本番環境の設定手順、トラブルシューティングガイドが整備されている

---

### 3.2 本番環境 Stripe設定

#### 3.2.1 本番モードへの切り替え

1. **Stripe Dashboard**で左上のスイッチを「**本番モード**」に切り替え
2. ⚠️ **重要**: 本番モードでは実際のお金が動くため、慎重に操作

#### 3.2.2 本番APIキーの取得

1. **開発者 → APIキー**に移動
2. **本番モードのシークレットキー**を取得: `sk_live_...`
   - ⚠️ このキーは**絶対に**コードにハードコードしない
   - ⚠️ GitHubなどの公開リポジトリにコミットしない

#### 3.2.3 本番Webhook Endpointの作成

1. **開発者 → Webhook**に移動
2. 「**エンドポイントを追加**」をクリック
3. 以下を設定:
   ```
   エンドポイントURL: https://ppqgtbjykitqtiaisyji.supabase.co/functions/v1/handle-stripe-webhook
   説明: fanmark.id Webhook (Production)
   
   リッスンするイベント:
   ✓ checkout.session.completed
   ✓ customer.subscription.created
   ✓ customer.subscription.updated
   ✓ customer.subscription.deleted
   ✓ invoice.payment_succeeded
   ✓ invoice.payment_failed
   ```
4. 「**エンドポイントを追加**」をクリック
5. 作成されたEndpointの詳細画面で「**署名シークレット**」を表示・コピー: `whsec_...`（本番用）

#### 3.2.4 本番Subscription Productsの作成

**重要**: 本番モードではテストモードのProductsは使用できないため、再作成が必要です。

1. **商品 → 商品カタログ**に移動
2. **Creator Plan（本番）**を作成:
   ```
   商品名: Creator Plan
   説明: fanmark.id Creator Plan - 月額サブスクリプション
   料金モデル: 継続
   価格: ¥1,000
   請求期間: 月単位
   税金: 適用される場合は設定
   ```
   - 作成後、Price IDをコピー: `price_live_creator_...`

3. **Business Plan（本番）**を作成:
   ```
   商品名: Business Plan
   説明: fanmark.id Business Plan - 月額サブスクリプション
   料金モデル: 継続
   価格: ¥2,000
   請求期間: 月単位
   税金: 適用される場合は設定
   ```
   - 作成後、Price IDをコピー: `price_live_business_...`

---

### 3.3 Supabase Secrets更新（本番環境）

#### 3.3.1 本番Secretsの登録

Lovableのセキュリティ機能で以下のSecretsを**更新**します（テストモードから本番モードへ）:

| Secret名 | 本番環境の値 |
|---------|------------|
| `STRIPE_SECRET_KEY` | `sk_live_...`（本番シークレットキー） |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...`（本番Webhook署名シークレット） |
| `STRIPE_PRICE_ID_CREATOR` | `price_live_creator_...` |
| `STRIPE_PRICE_ID_BUSINESS` | `price_live_business_...` |
| `FRONTEND_URL` | `https://fanmark.id`（本番URL） |

#### 3.3.2 更新手順

1. Lovable UIでSecretsツールを使用
2. 既存のテストモードSecretsを本番モードの値に**上書き**
3. Edge Functionsが自動的に新しい値を使用開始

⚠️ **注意**: Secretsを更新すると、すぐに本番モードに切り替わります。準備が整ってから実行してください。

---

### 3.4 本番移行の実行

#### 3.4.1 デプロイ手順

1. **Edge Functionsのデプロイ**:
   ```bash
   # 既にデプロイ済みのため、Secretsの更新のみで動作する
   # 変更がある場合のみ再デプロイ
   supabase functions deploy create-checkout-session
   supabase functions deploy handle-stripe-webhook
   ```

2. **Secretsの確認**:
   ```bash
   # Supabase Dashboard → Settings → Edge Functions → Secrets
   # すべての本番Secretsが正しく設定されていることを確認
   ```

3. **フロントエンドのデプロイ**:
   - Lovableで自動デプロイ（変更がある場合）
   - または既にデプロイ済みのフロントエンドがそのまま使用可能

#### 3.4.2 本番環境初回テスト

**⚠️ 重要**: 本番環境では実際のお金が動くため、**少額テスト**を推奨します。

**テストユーザーでの初回決済**:
1. テスト用のメールアドレスでユーザー登録
2. プラン選択画面でCreator Planを選択（¥1,000）
3. Stripe Checkoutで**実際のクレジットカード**を使用して決済
4. 決済成功後、以下を確認:
   - [ ] プランが「Creator」に変更されている
   - [ ] Stripe Dashboardで決済が記録されている
   - [ ] サブスクリプションが作成されている
   - [ ] `stripe_payment_intents`にレコードが作成されている
   - [ ] Webhookイベントが`stripe_webhook_events`に記録されている
   - [ ] 通知が送信されている
5. Stripe Dashboardでサブスクリプションを**キャンセル**（テストのため）

#### 3.4.3 Webhook動作確認（本番）

**Stripe Dashboardでのテスト送信**:
1. **開発者 → Webhook** に移動
2. 本番Webhook Endpointを選択
3. 「**テストWebhookを送信**」をクリック
4. イベントタイプ: `checkout.session.completed`
5. 「**送信**」をクリック
6. Edge Function Logsで受信・処理を確認

**実際の決済でのWebhook確認**:
- 初回テストで決済を実行
- Stripe Dashboard → Webhook → 本番Endpoint → 「最近の配信」を確認
- すべてのイベントが「成功」ステータスであることを確認

---

## 4. 本番運用

### 4.1 監視とアラート

#### 4.1.1 Stripe Dashboardでの監視

**日次チェック項目**:
- [ ] 決済成功率（95%以上を維持）
- [ ] Webhook配信成功率（99%以上を維持）
- [ ] 異常な返金・チャージバックの有無
- [ ] サブスクリプションキャンセル率

**週次チェック項目**:
- [ ] アクティブサブスクリプション数の推移
- [ ] 月次売上予測（MRR）
- [ ] 決済失敗の原因分析

#### 4.1.2 Supabaseでの監視

**Edge Function Logsの監視**:
```sql
-- Webhook処理失敗を検索
SELECT * FROM stripe_webhook_events
WHERE processed = false OR processing_error IS NOT NULL
ORDER BY created_at DESC;

-- 決済ステータスの集計
SELECT payment_status, COUNT(*) as count
FROM stripe_payment_intents
WHERE created_at > now() - interval '7 days'
GROUP BY payment_status;
```

#### 4.1.3 アラート設定

**推奨アラート**:
- Webhook処理失敗が5件以上（1時間以内）
- 決済失敗率が10%を超える
- サブスクリプション作成失敗が発生

---

### 4.2 トラブルシューティング

#### 4.2.1 よくある問題

**問題1: Webhookが受信されない**

**原因**:
- Webhook Endpointが誤っている
- Edge Functionがデプロイされていない
- 署名検証に失敗している

**対処法**:
```bash
# Edge Function Logsを確認
supabase functions logs handle-stripe-webhook --tail

# Webhook Endpointを確認
# Stripe Dashboard → 開発者 → Webhook → エンドポイントURLを確認

# 署名シークレットを再確認
# STRIPE_WEBHOOK_SECRETが正しいか確認
```

**問題2: 決済完了後にプランが変更されない**

**原因**:
- Webhook処理でエラーが発生
- `payment_type`が正しく渡されていない
- データベース更新に失敗

**対処法**:
```sql
-- Webhookイベントを確認
SELECT * FROM stripe_webhook_events
WHERE event_type = 'checkout.session.completed'
ORDER BY created_at DESC LIMIT 10;

-- 決済履歴を確認
SELECT * FROM stripe_payment_intents
WHERE stripe_checkout_session_id = 'cs_xxx';

-- ユーザーのプランを確認
SELECT plan_type FROM user_settings WHERE user_id = 'xxx';
```

**手動修正**:
```sql
-- プランを手動で更新（緊急時のみ）
UPDATE user_settings
SET plan_type = 'creator'
WHERE user_id = 'xxx';

-- Webhookイベントを再処理済みにマーク
UPDATE stripe_webhook_events
SET processed = true
WHERE stripe_event_id = 'evt_xxx';
```

**問題3: サブスクリプションが作成されない**

**原因**:
- Stripe Price IDが間違っている
- Checkout Sessionの`mode`が`'subscription'`になっていない

**対処法**:
```typescript
// create-checkout-session Edge Functionを確認
// mode: 'subscription' が設定されているか

const session = await stripe.checkout.sessions.create({
  mode: 'subscription', // ← ここが重要
  line_items: [{
    price: priceId, // 正しいPrice IDか確認
    quantity: 1
  }],
  // ...
});
```

---

### 4.3 ロールバック手順

万が一、本番環境で問題が発生した場合のロールバック手順です。

#### 4.3.1 緊急時のテストモードへの戻し方

**ステップ1: Secretsをテストモードに戻す**

Lovable UIでSecretsを元のテストモード値に更新:
```
STRIPE_SECRET_KEY → sk_test_...
STRIPE_WEBHOOK_SECRET → whsec_... (テスト用)
STRIPE_PRICE_ID_CREATOR → price_test_creator_...
STRIPE_PRICE_ID_BUSINESS → price_test_business_...
```

**ステップ2: ユーザーへの通知**

本番決済が一時的に停止していることを通知。

**ステップ3: 問題の調査**

Edge Function Logs、Webhook Events、Stripe Dashboardを確認し、原因を特定。

**ステップ4: 修正とテスト**

テストモードで修正を実施し、動作確認後に再度本番移行。

---

## 5. サブスクリプション管理

### 5.1 サブスクリプションのライフサイクル

#### 5.1.1 サブスクリプション作成フロー

```
[ユーザーがCreator Planを選択]
  ↓
[create-checkout-session: mode='subscription']
  ↓
[Stripe Checkout: カード情報入力]
  ↓
[決済成功]
  ↓
[Webhook: customer.subscription.created]
  ↓
[Webhook: checkout.session.completed]
  ↓
[user_settings.plan_type = 'creator' に更新]
  ↓
[サブスクリプション開始（月次課金開始）]
```

#### 5.1.2 月次課金のWebhook処理

**毎月の課金時に発生するイベント**:
- `invoice.payment_succeeded`: 課金成功
- `invoice.payment_failed`: 課金失敗

**実装**:
```typescript
// handle-stripe-webhook Edge Function内
if (event.type === 'invoice.payment_succeeded') {
  const invoice = event.data.object;
  const subscriptionId = invoice.subscription;
  
  // サブスクリプションが継続中であることを確認
  // 通知を送信（オプション）
  await supabase.rpc('create_notification_event', {
    event_type_param: 'subscription_renewed',
    payload_param: {
      user_id: userId,
      amount: invoice.amount_paid / 100
    }
  });
}

if (event.type === 'invoice.payment_failed') {
  const invoice = event.data.object;
  
  // ユーザーに決済失敗を通知
  await supabase.rpc('create_notification_event', {
    event_type_param: 'payment_failed',
    payload_param: {
      user_id: userId,
      reason: 'カード情報をご確認ください'
    }
  });
  
  // 一定期間後にプランをダウングレード（オプション）
}
```

#### 5.1.3 サブスクリプションキャンセル

**ユーザーによるキャンセル**:
1. ダッシュボードに「サブスクリプションをキャンセル」ボタンを追加
2. Edge Function `cancel-subscription`を作成:
   ```typescript
   const subscription = await stripe.subscriptions.update(subscriptionId, {
     cancel_at_period_end: true // 期間末にキャンセル
   });
   ```
3. Webhook `customer.subscription.deleted`でプランをFreeにダウングレード

**Stripeでの自動キャンセル**:
- 決済失敗が連続した場合、Stripeが自動的にキャンセル
- Webhook `customer.subscription.deleted`で検知

---

### 5.2 プラン変更（アップグレード/ダウングレード）

#### 5.2.1 Creator → Business へのアップグレード

**実装方法**:
```typescript
// Edge Function: upgrade-subscription
const subscription = await stripe.subscriptions.retrieve(subscriptionId);

await stripe.subscriptions.update(subscriptionId, {
  items: [{
    id: subscription.items.data[0].id,
    price: process.env.STRIPE_PRICE_ID_BUSINESS, // Business PlanのPrice ID
  }],
  proration_behavior: 'create_prorations', // 日割り計算
});
```

**日割り計算**:
- Stripeが自動的に日割り計算を実施
- 差額が次回請求に反映される

#### 5.2.2 Business → Creator へのダウングレード

**実装方法**:
```typescript
// 期間末にダウングレード（推奨）
await stripe.subscriptions.update(subscriptionId, {
  items: [{
    id: subscription.items.data[0].id,
    price: process.env.STRIPE_PRICE_ID_CREATOR,
  }],
  proration_behavior: 'none', // 日割りなし
  billing_cycle_anchor: 'unchanged' // 次回請求日から適用
});
```

---

## 6. ライセンス延長システムの管理

### 6.1 Stripe Price IDの統一管理

ライセンス延長プランの Price ID は、`fanmark_tier_extension_prices` テーブルで一元管理されます。**テスト/本番の環境変数は不要**で、Admin画面から直接編集できます。

#### 6.1.1 テストモードでの設定

**Stripe Dashboardでの設定**:
1. **テストモード**に切り替え
2. **商品 → 商品カタログ** から延長プラン用のProductを作成:
   ```
   商品名: Fanmark License Extension (Tier 1, 3 Months)
   料金モデル: 一回限り
   価格: ¥3,000
   ```
3. 作成したPrice IDをコピー: `price_xxxxx`

**Admin画面での設定**:
1. **Admin Dashboard → Tier Extension Prices** に移動
2. 対象のTier・期間の行で「Stripe Price ID」欄にテスト用Price IDを入力
3. 「Price ID更新」ボタンをクリックして保存

#### 6.1.2 本番環境への切り替え

**本番Price IDの作成**:
1. Stripe Dashboardで**本番モード**に切り替え
2. テストモードと同じ条件でProductとPriceを作成
3. 本番Price IDをコピー: `price_xxxxx`

**Admin画面での切り替え**:
1. **Admin Dashboard → Tier Extension Prices** に移動
2. 対象の行の「Stripe Price ID」欄を**本番Price IDに上書き**
3. 「Price ID更新」ボタンをクリック
4. ✅ これで即座に本番モードに切り替わります

#### 6.1.3 メリット

- **環境変数不要**: `STRIPE_TEST_MODE` などの切り替え用環境変数は不要
- **柔軟な管理**: Admin画面でリアルタイム更新可能
- **シンプル**: データベースの単一カラムで完結
- **監査可能**: Price ID変更履歴をログで追跡可能

---

## 7. セキュリティベストプラクティス

### 6.1 APIキーの管理

- [ ] **絶対にコードにハードコードしない**
- [ ] **環境変数（Supabase Secrets）のみで管理**
- [ ] **GitHubなどの公開リポジトリにコミットしない**
- [ ] **定期的にキーをローテーション**（年1回推奨）

### 6.2 Webhook署名検証

- [ ] **すべてのWebhookリクエストで署名を検証**
- [ ] **署名検証に失敗した場合は即座に403を返す**
- [ ] **署名シークレットも環境変数で管理**

### 6.3 金額の検証

- [ ] **Webhookで受信した金額が期待値と一致するか検証**
- [ ] **不正な金額の場合はエラーログに記録し、手動調査**

---

## 7. パフォーマンス最適化

### 7.1 Webhook処理の高速化

- [ ] **Webhookイベントの重複チェックを最初に実行**
- [ ] **データベースクエリをバッチ処理**
- [ ] **不要なログ出力を削減**

### 7.2 Checkout Sessionの最適化

- [ ] **Price IDをキャッシュ**（環境変数で管理）
- [ ] **success_url、cancel_urlを動的に生成**
- [ ] **metadataに必要最小限の情報のみ含める**

---

## 9. チェックリスト

### 9.1 本番移行前チェックリスト

- [ ] すべてのテストがパス
- [ ] Stripeテストモードでの動作確認完了
- [ ] 本番Stripe設定（Products, Prices, Webhook）完了
- [ ] 本番Secretsの登録完了
- [ ] **Admin UIでライセンス延長Price IDをテストIDに設定**
- [ ] Edge Functionsのデプロイ完了
- [ ] 初回テスト決済の実施
- [ ] 監視・アラート設定完了
- [ ] ドキュメント整備完了
- [ ] チーム内での共有完了

### 9.2 本番移行後チェックリスト

- [ ] 初回決済の成功確認
- [ ] Webhook配信の成功確認
- [ ] サブスクリプション作成の確認
- [ ] **ライセンス延長決済の確認**
- [ ] **Admin UIでライセンス延長Price IDを本番IDに更新**
- [ ] プラン変更の反映確認
- [ ] 通知送信の確認
- [ ] ログの確認
- [ ] ユーザー体験の確認

---

## 10. よくある質問（FAQ）

### Q1: テストモードと本番モードを同時に動かせますか？
**A**: サブスクリプションプランは環境変数で管理されるため、テストか本番のどちらかになります。ライセンス延長はAdmin UIで個別管理できます。

### Q2: 本番移行後にバグが見つかった場合は？
**A**: Secretsをテストモード値に戻すことで、即座にロールバック可能です。ライセンス延長Price IDもAdmin UIで戻してください。既に作成されたサブスクリプションは手動でキャンセルが必要です。

### Q3: Stripeの手数料はいくらですか？
**A**: 日本のクレジットカード決済: 3.6%。詳細はStripe公式サイトを参照してください。

### Q4: サブスクリプションの請求日はいつですか？
**A**: 初回決済日から1ヶ月後が次回請求日になります。例: 1月15日に決済 → 2月15日が次回請求日。

### Q5: プラン変更時の日割り計算はどうなりますか？
**A**: アップグレード時は日割り計算が適用され、差額が次回請求に加算されます。ダウングレード時は次回請求日から新プランが適用されます（日割りなし推奨）。

### Q6: ライセンス延長のPrice IDはどこで管理しますか？
**A**: Admin Dashboard → Tier Extension Prices でリアルタイム管理できます。環境変数は不要です。

---

## 11. 連絡先とサポート

### 11.1 Stripeサポート

- **Stripe Dashboard**: https://dashboard.stripe.com/
- **Stripeドキュメント**: https://stripe.com/docs
- **Stripeサポート**: dashboard内の「サポート」から問い合わせ

### 11.2 Supabaseサポート

- **Supabase Dashboard**: https://app.supabase.com/
- **Supabaseドキュメント**: https://supabase.com/docs
- **Supabase Discord**: https://discord.supabase.com/

---

**以上**
