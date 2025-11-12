# Checkout & Subscription Sync Flow

このドキュメントは fanmark.id のプラン課金で Stripe Checkout から戻ってきた後、
アプリ内でどのように状態を同期させるかをまとめたものです。今後別の課金経路を追加する際も
同じ方針で実装できます。

## 状態遷移

1. **Checkout Success**  
   - Stripeから`/plans?checkout=success`にリダイレクトされる  
   - `PlanSelection`は `pendingCheckout` を有効化し、現在の `plan_type` を記録
2. **Session Recovery**  
   - Supabase `useAuth` が`applySession`でユーザー情報を復元するまで `pollState=waiting-session`  
   - 15秒待ってもセッションが復元しない場合はタイムアウト（ユーザーへ再同期案内）
3. **Polling**  
   - `user` が利用可能になったら `pollState=polling`  
   - Supabaseから `user_settings` / `user_subscriptions` を定期的に再取得（初回1秒→以降2秒間隔、最大15回）  
   - Webhookの反映を待つため、`profile.plan_type` が初期値と変わったら完了
4. **Completion / Timeout**  
   - 反映後はProcessingモーダルを閉じ、成功トーストを表示  
   - 規定回数ポーリングしても変化が無い場合はタイムアウトとして案内を表示

## 実装上のポイント

- `useAuth` の `applySession` が複数回呼ばれることを前提に、`user` が `null→値あり` へ遷移した瞬間にポーリングを開始する
- ポーリングループが `user` 不在時に実行されないようステートを明示的に分離  
  (`idle` / `waiting-session` / `polling`)
- モーダル表示は `checkingSubscription` と同期させ、ステート終了時に必ず解除
- タイムアウト時はトーストで再読込を案内しつつもUIをブロックしない
- Webhook (`handle-stripe-webhook`) は `user_subscriptions` に `amount` / `currency` / `interval` / `interval_count` を保存する。Stripeの `amount` はマイナー単位（JPYなら1円単位、USDなら1セント単位）で渡されるため、フロント側ではゼロ小数の通貨を識別し、必要に応じて100で割る/割らないロジックを実装する。
- 同じく `current_period_start` / `current_period_end` を利用して「現在の請求期間」や「次回請求日」「終了予定日（cancel_at_period_end=true）」を表示する。UIから参照する際は `useSubscription` フックで提供している値を用いる。

この設計により、Webhook伝搬の遅延や一時的なセッション切断があっても、ユーザーの操作を妨げずに安全に状態を同期できます。別の課金フローを追加する場合も、上記の状態遷移とタイムアウト方針を再利用してください。
