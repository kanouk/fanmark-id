# グレースピリオド仕様書

## 概要
本ドキュメントでは、ファンマークライセンスのグレースピリオド管理システムについて説明します。このシステムは、有効期限イベント後に最低24時間のグレースピリオドを保証しつつ、実際の有効期限切り替えを次の日次バッチウィンドウ（UTC深夜0時）に合わせるように実装されています。

## 目的
- ファンマークが再取得可能になる前に、最低24時間の猶予期間を強制する
- 手動返却後の即座の再取得を防止する
- ファンマークがいつ再び利用可能になるかを明確に表示する
- 将来の延長機能や課金機能に向けてシステムを準備する

## データベーススキーマ

### 新規カラム: `grace_expires_at`
```sql
ALTER TABLE fanmark_licenses
ADD COLUMN grace_expires_at TIMESTAMP WITH TIME ZONE;
```

**目的**: グレースピリオドがいつ終了し、ファンマークが再取得可能になるかを明示的に追跡します。

## ライセンスステータスのライフサイクル

### 1. アクティブステータス
- **license_end**: ライセンスの予定終了日（延長可能）
- **grace_expires_at**: `NULL`
- **excluded_at**: `NULL`
- **説明**: ユーザーはファンマークへのフルアクセスを持ち、設定を変更できます

## ライセンス終了日の正規化
- 新規発行時は、取得タイムスタンプにティア日数を加算した後、次のUTC深夜0時へ切り上げた値を`license_end`として保存します（すでに0時ちょうどの場合はそのまま）
- ライセンスを延長する際も同じ丸め込みルールを適用し、保存前に次のUTC 0時へ切り上げます
- 即時返却を行っても`license_end`は変更されず、「本来の失効予定日」として保持されます（返却直後はステータスがgraceに切り替わるだけ）
- これにより、有効期限イベントは常に日付境界で始まりつつ、取得/返却タイミングはグレース関連のカラムで追跡できます

### 2. グレースステータス
- **license_end**: 元の予定終了日（延長復元のために保持）
- **grace_expires_at**: グレースピリオドが終了し、ファンマークが再取得可能になる日時
  - 自然な有効期限切れ: `roundUpToNextUtcMidnight(license_end + grace_period_days)`
  - 手動返却: `roundUpToNextUtcMidnight(now + grace_period_days)`
- **excluded_at**: `NULL`
- **説明**: ファンマークはグレースピリオド中で、設定にはアクセスできますが変更はできません。誰もファンマークを再取得できません。

### 3. 期限切れステータス
- **license_end**: 元の予定終了日（履歴記録）
- **grace_expires_at**: グレース期限切れ日時（履歴記録）
- **excluded_at**: ライセンスが完全に期限切れになったタイムスタンプ（グレース→期限切れの遷移）
- **説明**: ファンマークは完全に期限切れで、設定は削除され、再取得可能です

## グレースピリオドの計算

### デフォルトのグレースピリオド
- **基本期間**: `system_settings.grace_period_days`で設定可能（デフォルトは1日 = 24時間）
- **調整ルール**: 基本期間が経過した後、実際の`grace_expires_at`は次のUTC深夜0時に切り上げられ、バッチ処理と一致させます

### 計算方法

#### 自然な有効期限切れ（license_endに到達）
- `license_end`は予定終了日のUTC 00:00:00に保存されます（ライセンス作成時に設定）
- グレース計算:
  ```typescript
  const base = addDays(license_end, grace_period_days);
  const grace_expires_at = roundUpToNextUtcMidnight(base);
  ```

#### 手動返却
- `now`は返却タイムスタンプ（UTC）
- グレース計算:
  ```typescript
  const base = addDays(now, grace_period_days);
  const grace_expires_at = roundUpToNextUtcMidnight(base);
  ```

> `roundUpToNextUtcMidnight`は、入力がすでに正確に深夜0時でない限り、次のUTC日の開始時刻を返します。すでに深夜0時の場合は、同じタイムスタンプを返します。

## 再取得ルール

### 利用可能性チェック
ファンマークは以下の場合に再取得可能です:
1. アクティブなライセンスが存在しない（`status = 'active'`）
2. グレースピリオドが有効でない:
   - `grace`ライセンスが存在しない
   - または`grace`ライセンスが存在するが`grace_expires_at <= now`

### 実装
```typescript
// register-fanmark Edge Functionにて
const { data: existingLicense } = await supabase
  .from('fanmark_licenses')
  .select('id, status, grace_expires_at')
  .eq('fanmark_id', fanmarkId)
  .in('status', ['active', 'grace'])
  .maybeSingle();

if (existingLicense) {
  if (existingLicense.status === 'active') {
    return error('Already taken');
  }

  if (existingLicense.status === 'grace' &&
      new Date(existingLicense.grace_expires_at) > new Date()) {
    return error('In grace period', { available_at: grace_expires_at });
  }
}
```

## Edge Functionの動作

### return-fanmark
**変更前**: ステータスを即座に`expired`に設定し、設定を削除
**変更後**: ステータスを`grace`に設定し、`grace_expires_at`を計算し、設定を保持

```typescript
// グレースピリオドウィンドウを計算
const gracePeriodDays = settings.grace_period_days; // 通常1日（24時間）
const base = addDays(new Date(), gracePeriodDays);
const graceExpiresAt = roundUpToNextUtcMidnight(base);

// グレースステータスに更新
update({
  status: 'grace',
  grace_expires_at: graceExpiresAt.toISOString(),
  excluded_at: null
});
```

### check-expired-licenses
**変更前**: `license_end + grace_period_ms`を使用してグレース期限を計算
**変更後**: 直接比較のために`grace_expires_at`を使用

```typescript
// アクティブ → グレース（自然な有効期限切れ）
const base = addDays(new Date(license_end), gracePeriodDays);
const graceExpiresAt = roundUpToNextUtcMidnight(base);

update({
  status: 'grace',
  grace_expires_at: graceExpiresAt.toISOString()
});

// グレース → 期限切れ
// クエリ: WHERE status = 'grace' AND grace_expires_at <= now
update({
  status: 'expired',
  excluded_at: now
});
// すべての設定を削除
```

### register-fanmark
**変更前**: `status = 'active'`のライセンスのみをチェック
**変更後**: `active`と、将来の`grace_expires_at`を持つ`grace`の両方をチェック

```typescript
const licenseEndRaw = addDays(new Date(), tierConfig.initial_license_days);
const licenseEnd = roundUpToNextUtcMidnight(licenseEndRaw);

insert({
  fanmark_id,
  user_id,
  license_end: licenseEnd.toISOString(),
  status: 'active',
  grace_expires_at: null  // 新規ライセンスでは明示的にnull
});
```

## フロントエンドの表示

### ダッシュボード
- 返却日・残り日数は常に`license_end`を基準に表示し、残り時間が0以下の場合は `grace_expires_at` のカウントダウンへ切り替える
- `status = 'grace'`の場合、グレースカウントダウンを表示
- カウントダウンタイマーに`grace_expires_at`を使用
- グレースピリオド中は「延長不可」と表示

### 詳細ページ
- 履歴テーブルはグレースライセンスの`grace_expires_at`を表示
- 期限切れライセンスの`excluded_at`を表示
- アクティブおよび返却済みライセンスの予定失効日は`license_end`を表示（返却直後でも値は変化しない）

### 更新されたコンポーネント
- `GraceStatusCountdown.tsx`: プロップを`licenseEnd`から`graceExpiresAt`に変更
- `FanmarkDashboard.tsx`: ライセンスクエリに`grace_expires_at`を追加
- `FanmarkDetailsPage.tsx`: グレースピリオド日付の表示ロジックを更新

## 将来の拡張

### ライセンス延長
有料延長を実装する際:
```typescript
// グレースからアクティブに復元
update({
  status: 'active',
  license_end: roundUpToNextUtcMidnight(new_end_date).toISOString(),
  grace_expires_at: null,
  excluded_at: null
});
```

### 課金統合
- `grace_expires_at`をチェックして延長が可能かどうかを判断
- グレースピリオド終了後の延長試行を防止
- 延長計算の基準日として`license_end`を使用

## マイグレーション注意事項

### バックフィル戦略
1. 既存の`grace`ライセンス: `grace_expires_at = license_end + grace_period_days`
2. 既存の`expired`ライセンス: `grace_expires_at = license_end + grace_period_days`（履歴）
3. 新規ライセンス: `grace_expires_at = NULL`

### デプロイ順序
1. データベースマイグレーションを実行（カラム追加 + バックフィル）
2. Edge Functionをデプロイ
3. フロントエンドの変更をデプロイ

### ロールバック考慮事項
- 機能がロールバックされてもカラムは残せます
- Edge Functionのロジックを元に戻すことで機能を削除
- カラムは既存の機能を壊しません

## パフォーマンス最適化

### インデックス
```sql
-- グレース期限クエリ
CREATE INDEX idx_fanmark_licenses_grace_expires
ON fanmark_licenses(grace_expires_at)
WHERE status = 'grace';

-- 再取得チェック
CREATE INDEX idx_fanmark_licenses_fanmark_grace
ON fanmark_licenses(fanmark_id, status, grace_expires_at)
WHERE status IN ('active', 'grace');
```

## テストシナリオ

1. **手動返却**: グレースピリオドが最低24時間続き、そのウィンドウ後の次のUTC深夜0時に終了することを確認
2. **自然な有効期限切れ**: グレースピリオドがUTC 00:00に始まり、設定されたウィンドウ後の次のUTC深夜0時に終了することを確認
3. **グレース中の再取得**: available_atタイムスタンプでブロックされるべき
4. **グレース後の再取得**: 成功するべき
5. **グレースから期限切れへの遷移**: 設定が削除され、excluded_atが設定されることを確認
6. **カウントダウン表示**: 正確な残り時間表示を確認
7. **Cronジョブ**: バッチ処理がライセンスを正しく遷移させることを確認

## セキュリティ考慮事項

- グレースピリオドの強制はEdge Function側で行われます
- フロントエンドの表示は情報提供のみです
- 再取得チェックはデータベースレベルのクエリを使用します
- クライアント側のバイパスは不可能です

## モニタリング

### 監査ログ
- `return_fanmark`: メタデータに`grace_expires_at`を含む
- `license_grace_started`: 自然な有効期限切れからグレースへ
- `license_expired`: グレースから期限切れへの遷移

### 主要メトリクス
- 平均グレースピリオド期間
- グレース中の再取得試行回数
- グレースから期限切れへの遷移成功率
