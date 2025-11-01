# 抽選システム完全仕様書

**作成日**: 2025年10月27日  
**バージョン**: 1.0  
**ステータス**: 設計完了・実装前

---

## 1. 概要

### 1.1 目的
Grace期間中（返却処理中）のファンマークに対して、複数のユーザーが抽選申込を行い、Grace期間終了時に自動抽選で新しい所有者を決定するシステム。

### 1.2 主要機能
- **抽選申込**: Grace期間中のファンマークに対してユーザーが申込可能
- **抽選実行**: Grace期間終了時に加重ランダム抽選を自動実行
- **ライセンス延長による優先**: 元所有者がライセンス延長した場合は抽選をキャンセル
- **確率管理**: 管理者が各ユーザーの当選確率を編集可能（デフォルトは均等）
- **通知**: 申込完了・当選・落選・延長によるキャンセルを通知

---

## 2. システム要件

### 2.1 機能要件

#### 2.1.1 抽選申込
- **条件**:
  - ファンマークがGrace期間中（`status='grace'` かつ `grace_expires_at > now()`）
  - ✅ **現オーナーも申込可能**（オプションA採用）
  - 同一ファンマークへの重複申込は不可
- **処理**:
  - `fanmark_lottery_entries` テーブルに新規レコード作成
  - 初期抽選確率は `1.0`（均等）
  - 申込完了通知を送信
- **注意事項**:
  - 現オーナーが申込した場合、延長オプションは放棄される
  - 抽選申込後は延長不可（排他制御）

#### 2.1.2 抽選実行
- **トリガー**: `grace_expires_at` が現在時刻を過ぎた時点（バッチ処理）
- **分岐処理**:
  - **申込0件**: 通常のExpired処理（設定削除）
  - **申込1件**: 自動当選、新規ライセンス発行
  - **申込複数**: 加重ランダム抽選実行
- **抽選アルゴリズム**:
  ```
  各エントリーの lottery_probability を合計
  0〜合計値の範囲でランダム数値を生成
  累積確率で当選者を決定
  ```
- **処理後**:
  - 当選者が現オーナーの場合:
    - 元のGraceライセンスを終了（`status='expired'`, `excluded_at=now()`）
    - 新規有料ライセンス発行（tier初期日数分）
  - 当選者が他ユーザーの場合:
    - 元オーナーのライセンスを終了
    - 新規ライセンス発行（tier初期日数分）
  - 当選エントリーを `'won'` に更新
  - 落選エントリーを `'lost'` に更新
  - 抽選履歴を記録（`fanmark_lottery_history`）
  - 各ユーザーに結果通知

#### 2.1.3 ライセンス延長と抽選の排他制御
- **トリガー**: 
  - 抽選申込時: 延長オプションを放棄
  - 延長実行時: 全pending抽選エントリーをキャンセル
- **延長実行時の処理**:
  1. 該当ファンマークの全pending抽選エントリーを取得
  2. エントリーを `'cancelled_by_extension'` に更新
  3. 各申込者に延長によるキャンセル通知を送信
  4. ライセンスを `'active'` に戻す
- **抽選申込中の延長ブロック**:
  - 現オーナーがpending抽選申込を持っている場合、延長を拒否
  - エラーメッセージ: "Cannot extend license while lottery application is pending. Please cancel your lottery application first."
- **優先順位**: **延長が常に最優先**（抽選は実行されない）

#### 2.1.4 申込キャンセル
- **条件**: `entry_status = 'pending'` のエントリーのみ
- **キャンセル可能期間**: `grace_expires_at` 直前まで
- **処理**:
  - エントリーを `'cancelled'` に更新
  - `cancellation_reason = 'user_request'` を記録

#### 2.1.5 確率管理（管理者機能）
- **編集可能期間**: 抽選実行前までいつでも
- **編集対象**: 各ユーザーの `lottery_probability` 値
- **操作**:
  - 個別編集: 数値入力フィールドで直接編集
  - 一括均等化: 全員を `1.0` にリセット
  - 保存: 編集内容を一括更新
- **将来拡張**: ユーザープランに基づく自動按分

---

### 2.2 非機能要件

#### 2.2.1 パフォーマンス
- 抽選実行時間: 1000件のエントリーで3秒以内
- バッチ処理: 複数ファンマークの同時処理に対応

#### 2.2.2 セキュリティ
- RLS（Row Level Security）による厳格なアクセス制御
- 抽選アルゴリズムの透明性（シード値記録）
- 監査ログによる全操作の記録

#### 2.2.3 可用性
- トランザクション保証（抽選・ライセンス発行・通知が原子的）
- ロールバック機構（エラー時の自動復旧）

#### 2.2.4 エラーハンドリングとUI状態同期

**目的**: Edge Functionからエラーが返された場合でも、UI状態を確実に最新化し、ユーザーの混乱を防ぐ。

**実装戦略**:
- `try...catch...finally` 構造を使用
- `finally` ブロックで UI 状態更新を保証（成功・失敗に関わらず実行）
- データベース状態とUI状態の同期を常に保証

**適用箇所**:
1. **抽選申し込みボタン**: 
   - `FanmarkDetailsPage.tsx`: `refetch()` を `finally` ブロックで実行
   - `FanmarkAcquisition.tsx`: `handleQueryChange(query)` を `finally` ブロックで実行

2. **抽選キャンセルボタン**: 
   - 同様に `finally` ブロックで状態更新を保証

**エラーシナリオと対応**:

| エラー種類 | 原因 | ユーザーへの表示 | UI状態更新 |
|-----------|------|----------------|-----------|
| 重複申込 | 既に申込済み | エラートースト: "既にこのファンマの抽選に申し込んでいます" | ✅ `finally` で最新状態取得 → 「申込済」バッジ表示 |
| Grace期間終了 | 期間終了後に申込 | エラートースト: "抽選の申し込みに失敗しました" | ✅ `finally` で最新状態取得 → ボタン/バッジ非表示 |
| 既にキャンセル済み | 他タブでキャンセル済み | エラートースト: "抽選のキャンセルに失敗しました" | ✅ `finally` で最新状態取得 → 「申し込む」ボタン表示 |

**技術的詳細**:
```typescript
// パターン1: FanmarkDetailsPage.tsx
onClick={async () => {
  try {
    await applyToLottery(details.fanmark_id);
  } catch (error) {
    console.error('Failed to apply to lottery:', error);
  } finally {
    // エラーの有無に関わらず、常にデータを再取得してUI状態を最新化
    await refetch();
  }
}}

// パターン2: FanmarkAcquisition.tsx
onClick={async () => {
  if (searchResult?.id) {
    try {
      await applyToLottery(searchResult.id);
    } catch (error) {
      console.error('Failed to apply to lottery:', error);
    } finally {
      // エラーの有無に関わらず、常に検索を再実行してUI状態を最新化
      if (query) {
        handleQueryChange(query);
      }
    }
  }
}}
```

**ユーザーへの影響**:
- **改善前**: エラー時にボタンが残り、何度もクリックしてしまう → 混乱
- **改善後**: エラー時でも正しい状態が表示され、混乱がない → 明確

**関連ドキュメント**: `docs/lottery-ui-error-handling.md` に詳細な技術仕様を記載

---

## 3. データベース設計

### 3.1 新規テーブル

#### 3.1.1 `fanmark_lottery_entries` (抽選申込テーブル)

| カラム名 | 型 | NULL | デフォルト | 説明 |
|---------|-----|------|-----------|------|
| `id` | UUID | NO | `gen_random_uuid()` | 主キー |
| `fanmark_id` | UUID | NO | - | 対象ファンマーク（FK: `fanmarks.id`） |
| `user_id` | UUID | NO | - | 申込ユーザー（FK: `auth.users.id`） |
| `license_id` | UUID | NO | - | 対象ライセンス（FK: `fanmark_licenses.id`） |
| `lottery_probability` | NUMERIC | NO | `1.0` | 抽選確率（デフォルト均等） |
| `entry_status` | TEXT | NO | `'pending'` | ステータス（後述） |
| `applied_at` | TIMESTAMPTZ | NO | `now()` | 申込日時 |
| `lottery_executed_at` | TIMESTAMPTZ | YES | NULL | 抽選実行日時 |
| `won_at` | TIMESTAMPTZ | YES | NULL | 当選確定日時 |
| `cancelled_at` | TIMESTAMPTZ | YES | NULL | キャンセル日時 |
| `cancellation_reason` | TEXT | YES | NULL | キャンセル理由 |
| `created_at` | TIMESTAMPTZ | NO | `now()` | 作成日時 |
| `updated_at` | TIMESTAMPTZ | NO | `now()` | 更新日時 |

**制約**:
- UNIQUE: `(fanmark_id, user_id, license_id)` - 重複申込防止
- INDEX: `(fanmark_id, entry_status)` - ファンマーク別検索
- INDEX: `(user_id, entry_status)` - ユーザー別検索
- INDEX: `(license_id, entry_status)` - ライセンス別検索

**`entry_status` の値**:
- `'pending'`: 抽選待ち
- `'won'`: 当選
- `'lost'`: 落選
- `'cancelled'`: ユーザーによるキャンセル
- `'cancelled_by_extension'`: ライセンス延長によるキャンセル

**`cancellation_reason` の値**:
- `'user_request'`: ユーザーが手動キャンセル
- `'license_extended'`: 元所有者の延長により自動キャンセル
- `'system'`: システムによる自動キャンセル

#### 3.1.2 `fanmark_lottery_history` (抽選履歴テーブル)

| カラム名 | 型 | NULL | デフォルト | 説明 |
|---------|-----|------|-----------|------|
| `id` | UUID | NO | `gen_random_uuid()` | 主キー |
| `fanmark_id` | UUID | NO | - | 対象ファンマーク |
| `license_id` | UUID | NO | - | 対象ライセンス |
| `total_entries` | INTEGER | NO | - | 総申込数 |
| `winner_user_id` | UUID | YES | NULL | 当選者ID |
| `winner_entry_id` | UUID | YES | NULL | 当選エントリーID（FK） |
| `probability_distribution` | JSONB | NO | - | 確率分布（配列） |
| `random_seed` | TEXT | YES | NULL | 乱数シード値 |
| `executed_at` | TIMESTAMPTZ | NO | `now()` | 実行日時 |
| `execution_method` | TEXT | NO | `'automatic'` | 実行方法 |
| `created_at` | TIMESTAMPTZ | NO | `now()` | 作成日時 |

**`execution_method` の値**:
- `'automatic'`: バッチ処理による自動実行
- `'manual'`: 管理者による手動実行

**`probability_distribution` の構造**:
```json
[
  { "user_id": "uuid-1", "lottery_probability": 1.0 },
  { "user_id": "uuid-2", "lottery_probability": 1.5 },
  { "user_id": "uuid-3", "lottery_probability": 2.0 }
]
```

---

### 3.2 RLSポリシー

#### 3.2.1 `fanmark_lottery_entries` のポリシー

```sql
-- ユーザーは自分のエントリーのみ閲覧可
CREATE POLICY "Users can view their own entries"
  ON fanmark_lottery_entries FOR SELECT
  USING (auth.uid() = user_id);

-- ユーザーはGrace期間中のライセンスに申込可能（現オーナーも申込可）
CREATE POLICY "Users can create entries for grace licenses"
  ON fanmark_lottery_entries FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM fanmark_licenses fl
      WHERE fl.id = license_id
        AND fl.status = 'grace'
        AND fl.grace_expires_at > now()
    )
  );

-- ユーザーは自分のpendingエントリーのみキャンセル可
CREATE POLICY "Users can cancel their pending entries"
  ON fanmark_lottery_entries FOR UPDATE
  USING (auth.uid() = user_id AND entry_status = 'pending')
  WITH CHECK (entry_status = 'cancelled');

-- 管理者はすべてのエントリーを管理可能
CREATE POLICY "Admins can manage all lottery entries"
  ON fanmark_lottery_entries FOR ALL
  USING (is_admin());
```

#### 3.2.2 `fanmark_lottery_history` のポリシー

```sql
-- 管理者のみ抽選履歴を閲覧可能
CREATE POLICY "Admins can view lottery history"
  ON fanmark_lottery_history FOR SELECT
  USING (is_admin());
```

---

## 4. API設計

### 4.1 Edge Functions

#### 4.1.1 `apply-fanmark-lottery` (抽選申込)

**エンドポイント**: `POST /apply-fanmark-lottery`

**リクエストボディ**:
```json
{
  "fanmark_id": "uuid"
}
```

**レスポンス（成功）**:
```json
{
  "success": true,
  "entry_id": "uuid",
  "fanmark_id": "uuid",
  "lottery_probability": 1.0,
  "total_entries_count": 3,
  "grace_expires_at": "2025-11-01T00:00:00Z"
}
```

**エラー**:
- `401`: 未認証
- `400`: Grace期間外 / 自分のファンマーク / 重複申込
- `404`: ファンマークが存在しない
- `500`: サーバーエラー

**処理フロー**:
1. ユーザー認証確認
2. ファンマークのGrace状態検証
3. 重複申込チェック
4. エントリー作成
5. 通知イベント作成（`lottery_application_submitted`）
6. 監査ログ記録

---

#### 4.1.2 `cancel-lottery-entry` (申込キャンセル)

**エンドポイント**: `POST /cancel-lottery-entry`

**リクエストボディ**:
```json
{
  "entry_id": "uuid"
}
```

**レスポンス（成功）**:
```json
{
  "success": true,
  "entry_id": "uuid",
  "cancelled_at": "2025-10-28T10:30:00Z"
}
```

**エラー**:
- `401`: 未認証
- `403`: 自分のエントリーでない / すでにキャンセル済み
- `404`: エントリーが存在しない
- `500`: サーバーエラー

**処理フロー**:
1. ユーザー認証確認
2. エントリーの所有権確認
3. ステータスを `'cancelled'` に更新
4. `cancellation_reason = 'user_request'` を設定
5. 監査ログ記録

---

#### 4.1.3 `extend-fanmark-license` の拡張 (既存関数の修正)

**新規処理**（延長成功後に追加）:
```typescript
// 1. pending エントリーを検索
const { data: pendingEntries } = await supabase
  .from('fanmark_lottery_entries')
  .select('id, user_id')
  .eq('license_id', licenseId)
  .eq('entry_status', 'pending');

if (pendingEntries && pendingEntries.length > 0) {
  // 2. エントリーをキャンセル
  await supabase
    .from('fanmark_lottery_entries')
    .update({
      entry_status: 'cancelled_by_extension',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: 'license_extended'
    })
    .eq('license_id', licenseId)
    .eq('entry_status', 'pending');
  
  // 3. 各申込者に通知
  for (const entry of pendingEntries) {
    await supabase.rpc('create_notification_event', {
      event_type_param: 'lottery_cancelled_by_extension',
      payload_param: {
        fanmark_id: fanmarkId,
        fanmark_name: fanmarkName,
        user_id: entry.user_id
      }
    });
  }
  
  // 4. 監査ログ
  await supabase.from('audit_logs').insert({
    user_id: ownerId,
    action: 'LICENSE_EXTENDED_LOTTERY_CANCELLED',
    resource_type: 'fanmark_license',
    resource_id: licenseId,
    metadata: {
      cancelled_entries_count: pendingEntries.length
    }
  });
}
```

---

#### 4.1.4 `check-expired-licenses` の拡張 (バッチ処理)

**新規処理**（Grace期間終了時）:
```typescript
// grace_expires_at を過ぎたライセンスを取得
const { data: expiredLicenses } = await supabase
  .from('fanmark_licenses')
  .select('id, fanmark_id')
  .eq('status', 'grace')
  .lt('grace_expires_at', new Date().toISOString());

for (const license of expiredLicenses) {
  // pending エントリーを取得
  const { data: entries } = await supabase
    .from('fanmark_lottery_entries')
    .select('id, user_id, lottery_probability')
    .eq('license_id', license.id)
    .eq('entry_status', 'pending');
  
  if (!entries || entries.length === 0) {
    // 申込なし → 通常のExpired処理
    await transitionToExpired(license.id);
  } else if (entries.length === 1) {
    // 1名のみ → 自動当選
    await awardLicense(entries[0].user_id, license.fanmark_id);
  } else {
    // 複数名 → 抽選実行
    const winnerId = weightedRandomSelection(entries);
    await executeLottery(license, entries, winnerId);
  }
}

// 加重ランダム抽選アルゴリズム
function weightedRandomSelection(entries) {
  const totalWeight = entries.reduce((sum, e) => sum + e.lottery_probability, 0);
  const random = Math.random() * totalWeight;
  
  let累積 = 0;
  for (const entry of entries) {
    累積 += entry.lottery_probability;
    if (random <= 累積) return entry.user_id;
  }
  return entries[entries.length - 1].user_id; // フォールバック
}

// 抽選実行処理
async function executeLottery(license, entries, winnerId) {
  // トランザクション開始
  const { data: newLicense } = await supabase
    .from('fanmark_licenses')
    .insert({
      fanmark_id: license.fanmark_id,
      user_id: winnerId,
      license_start: new Date(),
      license_end: calculateLicenseEnd(tierLevel), // tier初期日数
      status: 'active',
      is_initial_license: false
    })
    .select()
    .single();
  
  // 当選エントリーを更新
  await supabase
    .from('fanmark_lottery_entries')
    .update({ entry_status: 'won', won_at: new Date() })
    .eq('license_id', license.id)
    .eq('user_id', winnerId);
  
  // 落選エントリーを更新
  await supabase
    .from('fanmark_lottery_entries')
    .update({ entry_status: 'lost', lottery_executed_at: new Date() })
    .eq('license_id', license.id)
    .neq('user_id', winnerId);
  
  // 抽選履歴記録
  await supabase.from('fanmark_lottery_history').insert({
    fanmark_id: license.fanmark_id,
    license_id: license.id,
    total_entries: entries.length,
    winner_user_id: winnerId,
    probability_distribution: entries,
    random_seed: crypto.randomUUID(),
    execution_method: 'automatic'
  });
  
  // 通知送信
  for (const entry of entries) {
    await supabase.rpc('create_notification_event', {
      event_type_param: entry.user_id === winnerId ? 'lottery_won' : 'lottery_lost',
      payload_param: {
        fanmark_id: license.fanmark_id,
        user_id: entry.user_id
      }
    });
  }
  
  // 元のライセンスをExpiredに
  await transitionToExpired(license.id);
}
```

---

### 4.2 RPC Functions

#### 4.2.1 `check_fanmark_availability` の拡張

**既存の返却値に追加**:
```json
{
  "available": false,
  "reason": "grace_period",
  "available_at": "2025-11-01T00:00:00Z",
  "blocking_status": "grace",
  "lottery_entry_count": 3,        // ← 新規追加
  "user_has_applied": false         // ← 新規追加
}
```

**実装**:
```sql
-- pending エントリー数を追加
lottery_entry_count := (
  SELECT COUNT(*)
  FROM fanmark_lottery_entries
  WHERE fanmark_id = fanmark_record.id
    AND entry_status = 'pending'
);

-- 現在のユーザーが申込済みか確認
user_has_applied := EXISTS (
  SELECT 1
  FROM fanmark_lottery_entries
  WHERE fanmark_id = fanmark_record.id
    AND user_id = auth.uid()
    AND entry_status = 'pending'
);
```

---

#### 4.2.2 `get_user_lottery_entries` (新規)

**概要**: ユーザーの抽選申込一覧を取得

**引数**:
- `user_id_param` (UUID, デフォルト: `auth.uid()`)

**返却値**:
```sql
RETURNS TABLE (
  entry_id UUID,
  fanmark_id UUID,
  fanmark_emoji TEXT,
  license_id UUID,
  entry_status TEXT,
  lottery_probability NUMERIC,
  applied_at TIMESTAMPTZ,
  grace_expires_at TIMESTAMPTZ,
  total_entries_count INTEGER
)
```

**実装**:
```sql
CREATE FUNCTION get_user_lottery_entries(user_id_param UUID DEFAULT NULL)
RETURNS TABLE (...) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    fle.id AS entry_id,
    fle.fanmark_id,
    f.user_input_fanmark AS fanmark_emoji,
    fle.license_id,
    fle.entry_status,
    fle.lottery_probability,
    fle.applied_at,
    fl.grace_expires_at,
    (SELECT COUNT(*) FROM fanmark_lottery_entries 
     WHERE license_id = fle.license_id AND entry_status = 'pending')::INTEGER AS total_entries_count
  FROM fanmark_lottery_entries fle
  JOIN fanmarks f ON f.id = fle.fanmark_id
  JOIN fanmark_licenses fl ON fl.id = fle.license_id
  WHERE fle.user_id = COALESCE(user_id_param, auth.uid())
  ORDER BY fle.applied_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

#### 4.2.3 `get_lottery_entries_by_fanmark` (管理者用・新規)

**概要**: 特定ファンマークの抽選申込者一覧を取得（管理画面用）

**引数**:
- `fanmark_id_param` (UUID)

**返却値**:
```sql
RETURNS TABLE (
  entry_id UUID,
  user_id UUID,
  username TEXT,
  display_name TEXT,
  lottery_probability NUMERIC,
  entry_status TEXT,
  applied_at TIMESTAMPTZ
)
```

**実装**:
```sql
CREATE FUNCTION get_lottery_entries_by_fanmark(fanmark_id_param UUID)
RETURNS TABLE (...) AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT 
    fle.id AS entry_id,
    fle.user_id,
    us.username,
    us.display_name,
    fle.lottery_probability,
    fle.entry_status,
    fle.applied_at
  FROM fanmark_lottery_entries fle
  JOIN user_settings us ON us.user_id = fle.user_id
  WHERE fle.fanmark_id = fanmark_id_param
  ORDER BY fle.applied_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## 5. フロントエンド設計

### 5.1 検索UI拡張 (`FanmarkAcquisition.tsx`)

#### 5.1.1 Grace期間中の表示

**条件**: `blocking_status === 'grace'`

**表示内容**:
```tsx
<div className="lottery-info rounded-2xl border border-amber-200 bg-amber-50 p-4">
  <div className="flex items-center gap-2 text-amber-700 font-semibold">
    <Sparkles className="h-5 w-5" />
    抽選申込受付中
  </div>
  
  <p className="mt-2 text-sm text-amber-600">
    抽選予定日時: {formattedGraceDate}
  </p>
  
  <p className="text-sm text-amber-600">
    現在 {lotteryEntryCount} 名が申込中
  </p>
  
  {!userHasApplied ? (
    <Button onClick={handleApplyLottery} className="mt-3 w-full rounded-full">
      抽選に申し込む
    </Button>
  ) : (
    <div className="mt-3 space-y-2">
      <Badge className="bg-primary/10 text-primary">
        申込済み
      </Badge>
      <Button variant="outline" onClick={handleCancelEntry} className="w-full rounded-full">
        申込をキャンセル
      </Button>
    </div>
  )}
  
  <p className="mt-2 text-xs text-muted-foreground">
    ※ 元所有者がライセンスを延長した場合、抽選は自動的にキャンセルされます
  </p>
</div>
```

#### 5.1.2 ハンドラ実装

```tsx
const handleApplyLottery = async () => {
  try {
    const { data } = await supabase.functions.invoke('apply-fanmark-lottery', {
      body: { fanmark_id: fanmarkId }
    });
    
    toast.success('抽選に申し込みました');
    refetch(); // 状態を再取得
  } catch (error) {
    toast.error('申込に失敗しました');
  }
};

const handleCancelEntry = async () => {
  try {
    await supabase.functions.invoke('cancel-lottery-entry', {
      body: { entry_id: userEntryId }
    });
    
    toast.success('申込をキャンセルしました');
    refetch();
  } catch (error) {
    toast.error('キャンセルに失敗しました');
  }
};
```

#### 5.1.3 アクションアイコン配置（最新仕様）

- ファンマ検索結果のアクションは **ファンマアクセス**（外部リンク）→ **詳細ページを開く**（Sparkles）→ **抽選申し込みトグル**（Ticket/TicketX）の順で並べる。なお、ファンマアクセスはライセンスが誰かに取得されている場合（`status === 'taken'`）のみ表示する。
- 抽選申込人数はカード下部に表示せず、抽選アイコン右上に常時表示する吹き出し（`lottery.entryCount`）で示す。吹き出しはガラス質感の配色とソフトシャドウを用い、全体のトーンに合わせる。
- ツールチップは `dashboard.tooltip.*` 翻訳キーを継続利用し、ステータスに応じて「申し込む」「キャンセルする」を切り替えつつ、人数情報は吹き出し側に集約する。

---

### 5.2 お気に入り画面拡張 (`Favorites.tsx`)

#### 5.2.1 ステータスバッジ追加

```tsx
// Grace期間中のファンマークに対して
{currentLicenseStatus === 'grace' && (
  <Badge className="bg-amber-100 text-amber-700">
    {userHasApplied ? '抽選申込済み' : '抽選申込可能'}
  </Badge>
)}
```

#### 5.2.2 抽選申込ボタン

```tsx
{currentLicenseStatus === 'grace' && !userHasApplied && (
  <Button 
    size="sm" 
    variant="outline" 
    onClick={() => handleApplyLottery(fanmarkId)}
    className="rounded-full"
  >
    抽選に申し込む
  </Button>
)}
```

---

### 5.3 新規: 抽選申込管理画面 (`src/pages/LotteryEntries.tsx`)

**概要**: ユーザー向けの申込一覧画面

**レイアウト**:
```tsx
<div className="container mx-auto p-6">
  <h1 className="text-3xl font-bold mb-6">抽選申込一覧</h1>
  
  {/* ステータスフィルター */}
  <Tabs value={statusFilter} onValueChange={setStatusFilter}>
    <TabsList>
      <TabsTrigger value="all">すべて</TabsTrigger>
      <TabsTrigger value="pending">申込中</TabsTrigger>
      <TabsTrigger value="won">当選</TabsTrigger>
      <TabsTrigger value="lost">落選</TabsTrigger>
      <TabsTrigger value="cancelled">キャンセル</TabsTrigger>
    </TabsList>
  </Tabs>
  
  {/* エントリー一覧 */}
  <div className="mt-6 space-y-4">
    {entries.map(entry => (
      <Card key={entry.entry_id}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-semibold">{entry.fanmark_emoji}</p>
              <p className="text-sm text-muted-foreground">
                申込日時: {formatDate(entry.applied_at)}
              </p>
              <p className="text-sm text-muted-foreground">
                抽選予定: {formatDate(entry.grace_expires_at)}
              </p>
              <p className="text-sm text-muted-foreground">
                総申込数: {entry.total_entries_count}名
              </p>
            </div>
            
            <div className="flex items-center gap-2">
              <Badge variant={getStatusVariant(entry.entry_status)}>
                {getStatusLabel(entry.entry_status)}
              </Badge>
              
              {entry.entry_status === 'pending' && (
                <Button 
                  size="sm" 
                  variant="destructive" 
                  onClick={() => handleCancel(entry.entry_id)}
                >
                  キャンセル
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    ))}
  </div>
</div>
```

**データ取得**:
```tsx
const { data: entries, refetch } = useQuery({
  queryKey: ['lottery-entries'],
  queryFn: async () => {
    const { data } = await supabase
      .rpc('get_user_lottery_entries');
    return data;
  }
});
```

---

### 5.4 新規: 抽選管理画面 (`src/components/AdminLotteryManager.tsx`)

**概要**: 管理者向けの確率編集・抽選管理画面

**レイアウト**:
```tsx
<Card>
  <CardHeader>
    <CardTitle>抽選管理</CardTitle>
  </CardHeader>
  <CardContent>
    {/* ファンマーク選択 */}
    <Select value={selectedFanmarkId} onValueChange={setSelectedFanmarkId}>
      <SelectTrigger>
        <SelectValue placeholder="ファンマークを選択" />
      </SelectTrigger>
      <SelectContent>
        {graceFanmarks.map(fm => (
          <SelectItem key={fm.id} value={fm.id}>
            {fm.emoji} - {fm.total_entries}名申込中
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
    
    {/* 申込者一覧 */}
    {selectedFanmarkId && (
      <Table className="mt-4">
        <TableHeader>
          <TableRow>
            <TableHead>ユーザー名</TableHead>
            <TableHead>抽選確率</TableHead>
            <TableHead>申込日時</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map(entry => (
            <TableRow key={entry.entry_id}>
              <TableCell>
                {entry.display_name} (@{entry.username})
              </TableCell>
              <TableCell>
                <Input 
                  type="number" 
                  step="0.1" 
                  min="0"
                  value={entry.lottery_probability} 
                  onChange={(e) => updateProbability(entry.entry_id, e.target.value)}
                  className="w-24"
                />
              </TableCell>
              <TableCell>
                {formatDate(entry.applied_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )}
    
    {/* 操作ボタン */}
    <div className="mt-4 flex gap-2">
      <Button onClick={equalizeAll} variant="outline">
        確率を均等化（全員1.0）
      </Button>
      <Button onClick={saveProbabilities} variant="primary">
        保存
      </Button>
      <Button onClick={runManualLottery} variant="destructive">
        手動で抽選実行（テスト用）
      </Button>
    </div>
    
    {/* 抽選履歴 */}
    <div className="mt-6">
      <h3 className="text-lg font-semibold mb-2">抽選履歴</h3>
      {history.map(h => (
        <Card key={h.id} className="mb-2">
          <CardContent className="p-3">
            <p className="text-sm">
              {h.fanmark_emoji} - 当選者: {h.winner_username}
            </p>
            <p className="text-xs text-muted-foreground">
              実行日時: {formatDate(h.executed_at)} | 総申込: {h.total_entries}名
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  </CardContent>
</Card>
```

**確率編集処理**:
```tsx
const [probabilities, setProbabilities] = useState<Record<string, number>>({});

const updateProbability = (entryId: string, value: string) => {
  setProbabilities(prev => ({
    ...prev,
    [entryId]: parseFloat(value) || 0
  }));
};

const equalizeAll = () => {
  const equalProbs = entries.reduce((acc, entry) => ({
    ...acc,
    [entry.entry_id]: 1.0
  }), {});
  setProbabilities(equalProbs);
};

const saveProbabilities = async () => {
  try {
    for (const [entryId, prob] of Object.entries(probabilities)) {
      await supabase
        .from('fanmark_lottery_entries')
        .update({ lottery_probability: prob })
        .eq('id', entryId);
    }
    
    toast.success('確率を更新しました');
    refetch();
  } catch (error) {
    toast.error('更新に失敗しました');
  }
};
```

---

## 6. 通知システム

### 6.1 通知イベント一覧

| イベントタイプ | 説明 | トリガー | 通知対象 |
|-------------|------|---------|---------|
| `lottery_application_submitted` | 抽選申込完了 | 申込API実行時 | 申込者本人 |
| `lottery_won` | 抽選当選 | 抽選実行時 | 当選者 |
| `lottery_lost` | 抽選落選 | 抽選実行時 | 落選者 |
| `lottery_cancelled_by_extension` | ライセンス延長によるキャンセル | 延長API実行時 | 全申込者 |
| `lottery_cancelled_by_user` | ユーザーによるキャンセル | キャンセルAPI実行時 | 申込者本人 |

---

### 6.2 通知テンプレート

#### 6.2.1 抽選申込完了 (`lottery_application_submitted`)

**日本語**:
```json
{
  "title": "抽選に申し込みました",
  "body": "{{fanmark_name}} の抽選申込が完了しました。抽選は {{grace_expires_at}} に実行されます。",
  "summary": "抽選申込完了 - {{fanmark_name}}"
}
```

**英語**:
```json
{
  "title": "Lottery Application Submitted",
  "body": "Your lottery application for {{fanmark_name}} has been submitted. The draw will take place on {{grace_expires_at}}.",
  "summary": "Lottery Application - {{fanmark_name}}"
}
```

---

#### 6.2.2 抽選当選 (`lottery_won`)

**日本語**:
```json
{
  "title": "🎉 抽選に当選しました！",
  "body": "おめでとうございます！{{fanmark_name}} の抽選に当選しました。ライセンスが発行されましたので、設定を行ってください。",
  "summary": "抽選当選 - {{fanmark_name}}"
}
```

**英語**:
```json
{
  "title": "🎉 You Won the Lottery!",
  "body": "Congratulations! You've won the lottery for {{fanmark_name}}. Your license has been issued. Please configure your settings.",
  "summary": "Lottery Won - {{fanmark_name}}"
}
```

---

#### 6.2.3 抽選落選 (`lottery_lost`)

**日本語**:
```json
{
  "title": "抽選結果のお知らせ",
  "body": "{{fanmark_name}} の抽選は残念ながら落選となりました。引き続き他のファンマークをお探しください。",
  "summary": "抽選落選 - {{fanmark_name}}"
}
```

**英語**:
```json
{
  "title": "Lottery Result",
  "body": "Unfortunately, you did not win the lottery for {{fanmark_name}}. Please continue exploring other fanmarks.",
  "summary": "Lottery Lost - {{fanmark_name}}"
}
```

---

#### 6.2.4 ライセンス延長によるキャンセル (`lottery_cancelled_by_extension`)

**日本語**:
```json
{
  "title": "抽選がキャンセルされました",
  "body": "{{fanmark_name}} の抽選申込がキャンセルされました。元所有者がライセンスを延長したため、このファンマークは引き続き利用中となります。",
  "summary": "抽選キャンセル - {{fanmark_name}}"
}
```

**英語**:
```json
{
  "title": "Lottery Cancelled",
  "body": "Your lottery application for {{fanmark_name}} has been cancelled. The original owner has extended their license, and this fanmark remains in use.",
  "summary": "Lottery Cancelled - {{fanmark_name}}"
}
```

---

#### 6.2.5 ユーザーによるキャンセル (`lottery_cancelled_by_user`)

**日本語**:
```json
{
  "title": "抽選申込をキャンセルしました",
  "body": "{{fanmark_name}} の抽選申込をキャンセルしました。",
  "summary": "申込キャンセル - {{fanmark_name}}"
}
```

**英語**:
```json
{
  "title": "Lottery Application Cancelled",
  "body": "You have cancelled your lottery application for {{fanmark_name}}.",
  "summary": "Application Cancelled - {{fanmark_name}}"
}
```

---

## 7. 実装スケジュール

### Phase 1: データベース設計（1-2日）
- [ ] マイグレーションSQL作成
- [ ] テーブル作成（`fanmark_lottery_entries`, `fanmark_lottery_history`）
- [ ] RLSポリシー設定
- [ ] インデックス作成

### Phase 2: Edge Functions実装（3-4日）
- [ ] `apply-fanmark-lottery` 実装
- [ ] `cancel-lottery-entry` 実装
- [ ] `extend-fanmark-license` 拡張
- [ ] `check-expired-licenses` 拡張（抽選実行ロジック）

### Phase 3: RPC関数実装（1日）
- [ ] `check_fanmark_availability` 拡張
- [ ] `get_user_lottery_entries` 実装
- [ ] `get_lottery_entries_by_fanmark` 実装

### Phase 4: フロントエンド実装（3-4日）
- [ ] `FanmarkAcquisition.tsx` 拡張（Grace期間中の抽選UI）
- [ ] `Favorites.tsx` 拡張（ステータスバッジ・申込ボタン）
- [ ] `LotteryEntries.tsx` 新規作成（ユーザー向け申込一覧）
- [ ] `AdminLotteryManager.tsx` 新規作成（管理者向け確率編集）

### Phase 5: 通知システム統合（1-2日）
- [ ] 通知イベントタイプ追加
- [ ] 通知テンプレート作成（日本語・英語）
- [ ] 通知ルール設定

### Phase 6: バッチ処理統合（1日）
- [ ] `check-expired-licenses` への統合
- [ ] トランザクション処理の実装
- [ ] ロールバック機構の実装

### Phase 7: テスト・検証（2-3日）
- [ ] 単体テスト（各Edge Function）
- [ ] 統合テスト（抽選フロー全体）
- [ ] シナリオテスト（延長によるキャンセル等）
- [ ] 負荷テスト（1000件エントリーでの抽選実行）

### Phase 8: ドキュメント・デプロイ（1日）
- [ ] ユーザー向けガイド作成
- [ ] 管理者向けマニュアル作成
- [ ] マイグレーション実行
- [ ] Edge Functions デプロイ
- [ ] フロントエンドデプロイ

**総所要時間**: 13-18日（約2.5-3.5週間）

---

## 8. リスク管理

### 8.1 技術的リスク

| リスク | 影響 | 対策 |
|-------|------|------|
| 延長とバッチ処理の競合 | 抽選実行中に延長された場合のデータ不整合 | トランザクション分離レベル（SERIALIZABLE）で対応 |
| 抽選アルゴリズムの偏り | 特定ユーザーが有利になる | シード値記録による監査可能性の確保 |
| 通知の遅延・失敗 | ユーザーが結果を知らない | 非同期処理 + リトライ機構（最大3回） |
| バッチ処理の失敗 | 抽選が実行されない | エラー時の自動アラート + 手動リトライ機能 |

---

### 8.2 運用リスク

| リスク | 影響 | 対策 |
|-------|------|------|
| 申込者0名 | 抽選が不成立 | 通常のExpired処理にフォールバック |
| Grace期間直前の延長 | 抽選準備中のキャンセル | リアルタイムチェック（延長時にpendingエントリー検索） |
| 確率編集ミス | 不公平な抽選 | 編集履歴を audit_logs に記録 + 変更前の確認ダイアログ |
| 大量申込による負荷 | システムダウン | エントリー上限設定（将来対応） + 負荷分散 |

---

## 9. 将来の拡張性

### 9.1 確率按分の自動化

**ユーザープランに基づく自動確率設定**:
```sql
UPDATE fanmark_lottery_entries
SET lottery_probability = CASE
  WHEN (SELECT plan_type FROM user_settings WHERE user_id = fanmark_lottery_entries.user_id) = 'enterprise' THEN 2.0
  WHEN (SELECT plan_type FROM user_settings WHERE user_id = fanmark_lottery_entries.user_id) = 'business' THEN 1.5
  WHEN (SELECT plan_type FROM user_settings WHERE user_id = fanmark_lottery_entries.user_id) = 'creator' THEN 1.2
  ELSE 1.0
END
WHERE entry_status = 'pending';
```

**実装時の考慮事項**:
- プラン変更時の確率自動更新
- 管理画面での手動上書き優先度
- ユーザーへの透明性（確率表示）

---

### 9.2 複数当選枠の設定

**仕様**:
- 1つのファンマークで複数名に同時発行可能（例: 3名まで）
- `fanmark_lottery_config` テーブルで制御

**テーブル設計**:
```sql
CREATE TABLE fanmark_lottery_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fanmark_id UUID NOT NULL UNIQUE REFERENCES fanmarks(id),
  max_winners INTEGER NOT NULL DEFAULT 1,  -- 最大当選者数
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**抽選ロジックの変更**:
```typescript
// 複数当選者を選出
const winners: string[] = [];
for (let i = 0; i < config.max_winners && entries.length > 0; i++) {
  const winnerId = weightedRandomSelection(entries);
  winners.push(winnerId);
  
  // 当選者を除外して次の抽選
  entries = entries.filter(e => e.user_id !== winnerId);
}

// 各当選者にライセンス発行
for (const winnerId of winners) {
  await awardLicense(winnerId, fanmarkId);
}
```

---

### 9.3 抽選エントリー上限の設定

**目的**: 過度な申込による負荷を防ぐ

**実装**:
```sql
-- system_settings に追加
INSERT INTO system_settings (setting_key, setting_value, description)
VALUES ('max_lottery_entries_per_fanmark', '100', '1つのファンマークに対する最大申込数');
```

**申込時のチェック**:
```typescript
const currentCount = await supabase
  .from('fanmark_lottery_entries')
  .select('id', { count: 'exact', head: true })
  .eq('fanmark_id', fanmarkId)
  .eq('entry_status', 'pending');

if (currentCount.count >= maxEntries) {
  throw new Error('抽選申込の上限に達しました');
}
```

---

### 9.4 抽選結果の公開

**仕様**:
- ファンマークごとの抽選履歴を公開ページで表示
- 過去の当選者・申込者数・確率分布を閲覧可能
- プライバシー保護のため、ユーザー名は部分マスキング

**実装例**:
```tsx
<Card>
  <CardHeader>
    <CardTitle>{fanmarkEmoji} の抽選履歴</CardTitle>
  </CardHeader>
  <CardContent>
    {history.map(h => (
      <div key={h.id} className="mb-4 p-3 border rounded">
        <p className="font-semibold">
          抽選日時: {formatDate(h.executed_at)}
        </p>
        <p className="text-sm text-muted-foreground">
          総申込数: {h.total_entries}名
        </p>
        <p className="text-sm text-muted-foreground">
          当選者: {maskUsername(h.winner_username)}
        </p>
      </div>
    ))}
  </CardContent>
</Card>

// ユーザー名マスキング
function maskUsername(username: string) {
  if (username.length <= 3) return username[0] + '**';
  return username[0] + '***' + username[username.length - 1];
}
```

---

## 10. FAQ

### Q1: 抽選確率のデフォルト値は？
**A**: 全員 `1.0`（均等）です。管理者が手動で編集可能です。

### Q2: 抽選申込のキャンセルはいつまで可能？
**A**: `grace_expires_at` 直前まで可能です。

### Q3: 管理画面での確率編集はいつまで可能？
**A**: 抽選実行前までいつでも編集可能です。

### Q4: 元所有者が延長した場合、抽選はどうなる？
**A**: **延長が最優先**です。抽選は自動的にキャンセルされ、全申込者に通知が送られます。

### Q5: 抽選結果の通知方法は？
**A**: 現在はアプリ内通知のみです。将来的にメール通知も追加予定です。

### Q6: 申込者が0名の場合はどうなる？
**A**: 通常のExpired処理が実行され、ファンマークの設定が削除されます。

### Q7: 申込者が1名だけの場合は？
**A**: 自動的に当選となり、新規ライセンスが発行されます。

### Q8: 抽選の公平性はどう担保される？
**A**: シード値を記録し、抽選履歴として保存することで、監査可能性を確保しています。

### Q9: 複数のファンマークに同時に申込できる？
**A**: はい、可能です。それぞれ独立した抽選として扱われます。

### Q10: 抽選に落選した場合、再申込できる？
**A**: 同じファンマークが再度Grace期間に入れば、再申込可能です。

---

## 11. 付録

### 11.1 加重ランダム抽選アルゴリズムの詳細

**アルゴリズム**:
```typescript
function weightedRandomSelection(
  entries: Array<{ id: string; user_id: string; lottery_probability: number }>
): string {
  // 1. 総重みを計算
  const totalWeight = entries.reduce((sum, e) => sum + e.lottery_probability, 0);
  
  // 2. 0〜総重みの範囲でランダム数値生成
  const random = Math.random() * totalWeight;
  
  // 3. 累積確率で当選者を決定
  let cumulative = 0;
  for (const entry of entries) {
    cumulative += entry.lottery_probability;
    if (random <= cumulative) {
      return entry.user_id;
    }
  }
  
  // フォールバック（浮動小数点誤差対策）
  return entries[entries.length - 1].user_id;
}
```

**例**:
```
エントリー:
- ユーザーA: 確率 1.0
- ユーザーB: 確率 1.5
- ユーザーC: 確率 2.0

総重み: 4.5

ランダム数値: 2.3 の場合
- 累積0.0 → 1.0 (A): 2.3 > 1.0 → 次へ
- 累積1.0 → 2.5 (B): 2.3 <= 2.5 → ユーザーB当選
```

---

### 11.2 状態遷移図

```
[Active License]
      ↓ license_end 到達
      ↓
[Grace Period] ← 抽選申込受付開始
      ↓
      ├─ 元所有者が延長
      │    ↓
      │  [Active License] ← 抽選エントリー全キャンセル
      │
      └─ grace_expires_at 到達
           ↓
           ├─ 申込0件 → [Expired]（設定削除）
           │
           ├─ 申込1件 → [Active License]（自動当選）
           │
           └─ 申込複数 → [抽選実行]
                          ↓
                        [当選者: Active License]
                        [落選者: 通知のみ]
```

---

### 11.3 データフロー図

```
[ユーザー] → [apply-fanmark-lottery] → [fanmark_lottery_entries]
                                          ↓
                                    [notification_events]

[元所有者] → [extend-fanmark-license] → [fanmark_lottery_entries]
                                           (cancelled_by_extension)
                                          ↓
                                    [notification_events]

[バッチ処理] → [check-expired-licenses] → [抽選実行]
                                           ↓
                                    [fanmark_licenses]（新規発行）
                                    [fanmark_lottery_entries]（won/lost更新）
                                    [fanmark_lottery_history]（履歴記録）
                                    [notification_events]（結果通知）
```

---

## 12. 変更履歴

| バージョン | 日付 | 変更内容 | 担当者 |
|----------|------|---------|-------|
| 1.0 | 2025-10-27 | 初版作成 | AI Assistant |

---

**以上**
