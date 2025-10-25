# Realtime Subscription Cleanup (2025-10)

## 1. 背景と目的

- Supabase の Realtime (`realtime.list_changes`) 呼び出しが 5,700,000 回超と高負荷になり、利用料金が跳ね上がっている。
- 現行フロントエンドは初期ロードで API 取得を行った後、同じデータに対してリアルタイム購読を重複的に張っており、即時同期が必須ではない画面でも常時 SSE 接続が走っている。
- 利用料金と複雑性を抑えるため、リアルタイム購読を廃止し、必要なタイミングでのフェッチ／リフレッシュに一本化する。

## 2. 対象範囲

| 区分 | ファイル | 現状の購読 | 備考 |
|------|----------|-------------|------|
| プロフィール | `src/hooks/useProfile.tsx` | `user_settings` テーブルの `UPDATE` を購読 | `useProfile` を参照する複数画面・フックでチャンネルが重複生成される |
| 通知バッジ | `src/components/Navigation.tsx` | `notifications` テーブルの全イベントを購読 | React Query で初期ロード済み、購読は差分更新のみ |
| 通知一覧 | `src/pages/Notifications.tsx` | `notifications` テーブルの全イベントを購読 | 画面表示時に 50 件ロード済み |

（検索、ダッシュボード等は初期ロードのみでリアルタイム購読なし）

## 3. 変更方針

1. **リアルタイム購読を削除**
   - `supabase.channel(...).on('postgres_changes', ...).subscribe()` の呼び出しを廃止。
   - `supabase.removeChannel(channel)` のクリーンアップも不要になる。

2. **データ更新トリガーの代替**
   - `useProfile`: プロフィールを更新する処理（例: `updateProfile` 完了時）で `fetchProfile()` を再呼び出し。必要に応じて画面遷移時に `refetch` を実行する。
   - `Navigation` の通知プレビュー: React Query の `invalidateQueries` による手動リフレッシュを維持。通知アイコンのクリックや通知画面への遷移時に最新化を促す。
   - `Notifications` 画面: 既存の「最新の通知を確認」ボタンをガイダンスとして活用し、初期ロード＋ボタン操作で更新。

3. **利用ガイドの更新**
   - 「リアルタイム通知が必要な場合は明示的に購読を追加する」旨を README / 内部ドキュメントに追記。

## 4. 実装ステップ

1. `useProfile.tsx`
   - リアルタイム購読の `useEffect` を削除。
   - `fetchProfile` を公開 (`return { ..., refetch: fetchProfile }`) しており、必要箇所で再利用する。

2. `Navigation.tsx`
   - `useEffect` 内のチャンネル登録を削除。
   - 未読数は既存の React Query フック `useUnreadNotifications`（30 秒ポーリング）に依存。

3. `Notifications.tsx`
   - リアルタイム購読を削除。
   - 初期ロード処理 (`fetchNotifications()`) を残し、手動更新ボタンで再取得。

4. 共通対応
   - `supabase.removeAllChannels()` をログアウト時に呼ぶか検討（不要なチャンネルが残らないよう確認）。
   - 変更後、`git grep 'channel('` で残存サブスクリプションがないか確認する。

## 5. テスト観点

- **プロフィール**
  - `Profile` ページで表示名を更新後、同ページ／ダッシュボードで `refetch` が走って最新値になること。
- **通知バッジ**
  - `Navigation` の未読バッジが API リフレッシュで更新されるか（通知送信 → ページ再表示、あるいは手動 button → load）。
- **通知一覧**
  - 画面表示直後に最新 50 件が表示されること。
  - 手動リロードボタンで新着が反映されること。

## 6. デプロイ注意点

- フロントエンドのみの変更になる見込み。サーバー側 (Supabase Edge Functions / Database) の更新は不要。
- リアルタイム購読削除に伴い、Supabase ダッシュボード上での `realtime.list_changes` 呼び出しが大幅に減少することを確認する。
- 既存ユーザーへの影響は「リアルタイムでの即時更新がなくなる」点のみ。通知やプロフィールの更新が数十秒遅れる場合は UI ガイダンスを追加すること。

## 7. フォローアップ

- 将来リアルタイム性が必要になった場合、購読が本当に必要な画面に限定して再導入する。
- コスト監視を継続し、必要に応じて Supabase Realtime の上限・アラート設定を調整する。



