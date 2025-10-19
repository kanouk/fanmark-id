# 通知システム実装ガイド

## 実装フェーズ

### Phase 0: 準備作業 ✅

- [x] 既存ビルドエラー修正
- [x] `user_settings.invited_by_code` カラム追加
- [x] 型定義の修正
- [x] ドキュメント整備

### Phase 1: データベーススキーマ構築（Week 1）

#### 1.1 コアテーブル作成

**実装内容**:
- `notification_events` テーブル
- `notification_rules` テーブル
- `notifications` テーブル

**確認事項**:
- [ ] すべてのカラムが正しく定義されている
- [ ] 制約（UNIQUE, FOREIGN KEY）が設定されている
- [ ] インデックスが適切に作成されている
- [ ] デフォルト値が設定されている

#### 1.2 補助テーブル作成

**実装内容**:
- `notification_templates` テーブル
- `notification_preferences` テーブル（将来拡張用）
- `notifications_history` テーブル（アーカイブ用）

#### 1.3 RLSポリシー設定

**実装内容**:
- 各テーブルのRLS有効化
- セキュリティポリシーの実装

**確認事項**:
- [ ] `notification_events`: 管理者のみ閲覧可能
- [ ] `notifications`: ユーザーは自分の通知のみ閲覧・更新可能
- [ ] `notification_rules`: 管理者のみ管理可能
- [ ] `notification_templates`: 管理者のみ管理可能

### Phase 2: イベント処理エンジン（Week 2-3）

#### 2.1 Edge Function作成

**ファイル**: `supabase/functions/process-notification-events/index.ts`

**実装内容**:
1. pendingイベントの取得（FOR UPDATE SKIP LOCKED）
2. Payload検証（JSON Schema）
3. notification_rulesの評価
4. notifications生成
5. イベント状態更新

**確認事項**:
- [ ] ロック機構が正しく動作する
- [ ] エラーハンドリングが適切
- [ ] ログ出力が十分
- [ ] パフォーマンスが要件を満たす

#### 2.2 Database Function作成

**実装内容**:
- `fetch_and_lock_pending_events` 関数

**確認事項**:
- [ ] SECURITY DEFINER設定済み
- [ ] search_path設定済み
- [ ] FOR UPDATE SKIP LOCKEDが動作する

#### 2.3 Cron設定

**実装内容**:
- `supabase/config.toml` にCron設定追加

**確認事項**:
- [ ] スケジュールが正しい（*/1 * * * *）
- [ ] verify_jwt設定が適切

### Phase 3: フロントエンド実装（Week 3-4）

#### 3.1 Hook作成

**ファイル**: `src/hooks/useUnreadNotifications.tsx`

**実装内容**:
- 未読通知カウント取得
- 30秒ごとの自動更新

**確認事項**:
- [ ] React Queryの設定が適切
- [ ] リフェッチ間隔が適切
- [ ] エラーハンドリングが実装されている

#### 3.2 Navigation更新

**ファイル**: `src/components/Navigation.tsx`

**実装内容**:
- ベルアイコン追加
- 未読バッジ表示

**確認事項**:
- [ ] アイコンが適切に表示される
- [ ] バッジが未読数を正しく表示する
- [ ] 99+の表示が正しく動作する

#### 3.3 通知リストページ作成

**ファイル**: `src/pages/Notifications.tsx`

**実装内容**:
- タブUI（すべて/未読/重要）
- 通知リスト表示
- 既読マーク機能

**確認事項**:
- [ ] タブ切り替えが動作する
- [ ] 未読通知が視覚的に区別される
- [ ] 既読マークが正しく動作する
- [ ] 日時表示が適切（date-fns使用）

#### 3.4 ルーティング追加

**ファイル**: `src/App.tsx`

**実装内容**:
- `/notifications` ルート追加

**確認事項**:
- [ ] ルーティングが正しく動作する
- [ ] 認証が必要なページとして保護されている

### Phase 4: 既存システム統合（Week 4-5）

#### 4.1 check-expired-licenses更新

**ファイル**: `supabase/functions/check-expired-licenses/index.ts`

**実装内容**:
- `license_grace_warning` イベント発火
- `license_expired` イベント発火

**確認事項**:
- [ ] グレース期間開始時にイベントが発火する
- [ ] 完全失効時にイベントが発火する
- [ ] `dedupe_key`が適切に設定される
- [ ] ペイロードが仕様に準拠している

#### 4.2 お気に入り失効通知

**ファイル**: `supabase/functions/notify-favorite-expired/index.ts`

**実装内容**:
- お気に入り登録ユーザーの取得
- `favorite_fanmark_expired` イベント生成

**確認事項**:
- [ ] お気に入り登録ユーザーが正しく取得される
- [ ] イベントが適切に生成される

### Phase 5: テンプレート・ルール設定（Week 5）

#### 5.1 初期データ投入

**実装内容**:
- 通知テンプレート登録
- 通知ルール登録

**確認事項**:
- [ ] テンプレートが正しく登録される
- [ ] ルールが有効化される
- [ ] 言語設定が適切

### Phase 6: 管理UI（Week 6、オプション）

#### 6.1 管理画面作成

**ファイル**: `src/components/AdminNotificationManager.tsx`

**実装内容**:
- 手動通知送信UI
- 通知ログ閲覧

**確認事項**:
- [ ] 管理者のみアクセス可能
- [ ] 手動送信が動作する
- [ ] ログが適切に表示される

### Phase 7: 外部連携準備（Future）

#### 7.1 イベントバス統合準備

**実装内容**:
- ミラーリングフックポイント追加（コメント）

## テスト戦略

### ユニットテスト

```typescript
// 例: Payload検証テスト
describe('validatePayload', () => {
  it('should validate license_grace_v1 schema', () => {
    const payload = {
      user_id: 'uuid',
      fanmark_emoji: '🎮',
      license_end: '2025-01-01T00:00:00Z',
      grace_expires_at: '2025-01-02T00:00:00Z'
    };
    expect(validatePayload(payload, 'license_grace_v1')).toBe(true);
  });
});
```

### E2Eテスト

```typescript
// 例: 通知フローE2Eテスト
describe('Notification Flow E2E', () => {
  it('should create notification from event', async () => {
    // 1. イベント作成
    const event = await createNotificationEvent({
      event_type: 'license_grace_warning',
      payload: { ... }
    });

    // 2. 処理関数実行
    await processNotificationEvents();

    // 3. 通知が生成されたことを確認
    const notifications = await getNotifications(userId);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].status).toBe('pending');
  });
});
```

### JSON Schema Contract Test

```typescript
// 例: スキーマ検証テスト
describe('Payload Schema Validation', () => {
  it('license_grace_warning schema is valid', () => {
    const payload = {
      user_id: '...',
      fanmark_emoji: '🎮',
      license_end: '2025-01-01T00:00:00Z',
      grace_expires_at: '2025-01-02T00:00:00Z'
    };

    const isValid = validateSchema(payload, 'license_grace_v1');
    expect(isValid).toBe(true);
  });
});
```

## デバッグ

### Edge Function ログ確認

```bash
# ローカルでのログ確認
supabase functions logs process-notification-events

# 本番環境でのログ確認
# Supabase ダッシュボード → Functions → process-notification-events → Logs
```

### データベースクエリ例

```sql
-- 処理待ちイベントの確認
SELECT * FROM notification_events 
WHERE status = 'pending' 
ORDER BY trigger_at ASC;

-- 未読通知の確認
SELECT * FROM notifications 
WHERE user_id = 'your-user-id' 
AND read_at IS NULL 
ORDER BY created_at DESC;

-- エラーイベントの確認
SELECT * FROM notification_events 
WHERE status = 'error' 
ORDER BY updated_at DESC;
```

## トラブルシューティング

### 通知が生成されない

**チェック項目**:
1. イベントが正しく作成されているか
2. notification_rulesが有効化されているか
3. セグメント条件がユーザーにマッチしているか
4. クールダウン期間に引っかかっていないか

### 未読バッジが表示されない

**チェック項目**:
1. RLSポリシーが正しく設定されているか
2. user_idが正しく設定されているか
3. channelが'in_app'になっているか

### Edge Functionがタイムアウトする

**対策**:
1. バッチサイズを小さくする（100 → 50）
2. 処理ロジックを最適化する
3. インデックスを追加する

## パフォーマンス最適化

### インデックスチューニング

```sql
-- 遅いクエリの確認
EXPLAIN ANALYZE 
SELECT * FROM notifications 
WHERE user_id = 'uuid' AND read_at IS NULL;

-- 必要に応じてインデックス追加
CREATE INDEX IF NOT EXISTS idx_custom 
ON notifications(user_id, created_at) 
WHERE read_at IS NULL;
```

### クエリ最適化

- N+1問題の回避（LEFT JOINを活用）
- 不要なカラムのSELECT回避
- LIMITの適切な使用

## セキュリティチェックリスト

- [ ] RLSが全テーブルで有効化されている
- [ ] 管理者権限チェックが実装されている
- [ ] ペイロードのサニタイゼーションが実装されている
- [ ] レート制限が設定されている
- [ ] 監査ログが記録されている
- [ ] 機密情報が適切に保護されている

## デプロイ手順

1. **ローカルテスト**
   ```bash
   # Edge Functionのローカル実行
   supabase functions serve process-notification-events
   ```

2. **ステージングデプロイ**
   - Lovableのプレビュー環境で動作確認

3. **本番デプロイ**
   - Lovableの公開ボタンでデプロイ
   - Edge Functionは自動デプロイ

## 参照

- 仕様書: `docs/notifications-specification.md`
- アーキテクチャ: `docs/notifications-architecture.md`
