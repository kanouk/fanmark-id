# 通知システム仕様書

## 概要

Fanmarkプロジェクトの通知基盤システムの仕様を定義します。このシステムは、ユーザーへの各種通知（ライセンス期限、お気に入り失効など）を統一的に管理します。

## アーキテクチャ

### データフロー

```
イベント発生源 → notification_events → 処理エンジン → notification_rules 評価 → notifications 生成 → ユーザー配信
```

### 3層アーキテクチャ

1. **イベント層** (`notification_events`)
   - システム内で発生した通知トリガーイベントを記録
   - 冪等性保証（`dedupe_key`）
   - スキーマバージョン管理

2. **ルール層** (`notification_rules`)
   - イベントタイプごとの配信ルールを定義
   - チャネル選択（アプリ内/メール/WebPush）
   - セグメンテーション、優先度、クールダウン管理

3. **通知層** (`notifications`)
   - 実際にユーザーに配信される通知レコード
   - 配信状態管理（pending/sent/failed）
   - 既読状態トラッキング

## データモデル

### notification_events

イベント発生を記録するテーブル。

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| event_type | TEXT | イベントタイプ（例: `license_grace_warning`） |
| event_version | INTEGER | イベントスキーマバージョン |
| source | TEXT | 発生源（`batch`/`edge_function`/`admin_ui`） |
| payload | JSONB | イベントデータ |
| payload_schema | TEXT | ペイロードスキーマ名 |
| trigger_at | TIMESTAMPTZ | 処理予定時刻 |
| dedupe_key | TEXT | 重複排除キー |
| status | TEXT | 処理状態（`pending`/`processed`/`error`/`skipped`） |
| processed_at | TIMESTAMPTZ | 処理完了時刻 |
| error_reason | TEXT | エラー理由 |
| retry_count | INTEGER | リトライ回数 |

**制約**:
- UNIQUE(event_type, dedupe_key)

### notification_rules

通知配信ルールを定義するテーブル。

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| event_type | TEXT | 対象イベントタイプ |
| channel | TEXT | 配信チャネル（`in_app`/`email`/`webpush`） |
| template_id | UUID | テンプレートID |
| template_version | INTEGER | テンプレートバージョン |
| delay_seconds | INTEGER | 遅延秒数 |
| priority | INTEGER | 優先度（1-10） |
| segment_filter | JSONB | ユーザーセグメント条件 |
| cooldown_window_seconds | INTEGER | クールダウン期間 |
| max_per_user | INTEGER | ユーザーあたり最大通知数 |
| cancel_condition | TEXT | キャンセル条件（SQL式） |
| enabled | BOOLEAN | 有効/無効 |
| valid_from | TIMESTAMPTZ | 有効期間開始 |
| valid_until | TIMESTAMPTZ | 有効期間終了 |

### notifications

実際の通知レコード。

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| event_id | UUID | 元イベントID |
| rule_id | UUID | 適用ルールID |
| user_id | UUID | 通知先ユーザー |
| channel | TEXT | 配信チャネル |
| template_id | UUID | テンプレートID |
| template_version | INTEGER | テンプレートバージョン |
| payload | JSONB | レンダリングデータ |
| status | TEXT | 配信状態（`pending`/`sending`/`sent`/`failed`/`cancelled`） |
| priority | INTEGER | 優先度 |
| triggered_at | TIMESTAMPTZ | トリガー時刻 |
| expires_at | TIMESTAMPTZ | 有効期限 |
| delivered_at | TIMESTAMPTZ | 配信完了時刻 |
| error_reason | TEXT | エラー理由 |
| retry_count | INTEGER | リトライ回数 |
| read_at | TIMESTAMPTZ | 既読時刻 |
| read_via | TEXT | 既読経路 |

### notification_templates

通知テンプレート定義。

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| template_id | UUID | テンプレートID |
| version | INTEGER | バージョン番号 |
| channel | TEXT | 対象チャネル |
| language | TEXT | 言語コード |
| title | TEXT | タイトルテンプレート |
| body | TEXT | 本文テンプレート |
| summary | TEXT | サマリーテンプレート |
| payload_schema | JSONB | 必須ペイロードスキーマ |
| is_active | BOOLEAN | 有効/無効 |

**制約**:
- UNIQUE(template_id, version, channel, language)

## イベントタイプ定義

### license_grace_warning

ライセンスがグレース期間に入った際の警告。

**Payload Schema** (`license_grace_v1`):
```json
{
  "user_id": "UUID",
  "fanmark_emoji": "🎮",
  "fanmark_id": "UUID",
  "license_end": "2025-01-01T00:00:00Z",
  "grace_expires_at": "2025-01-02T00:00:00Z"
}
```

### license_expired

ライセンスが完全に失効した際の通知。

**Payload Schema** (`license_expired_v1`):
```json
{
  "user_id": "UUID",
  "fanmark_emoji": "🎮",
  "fanmark_id": "UUID",
  "expired_at": "2025-01-02T00:00:00Z"
}
```

### favorite_fanmark_expired

お気に入り登録したファンマークが失効した際の通知。

**Payload Schema** (`favorite_expired_v1`):
```json
{
  "user_id": "UUID",
  "fanmark_id": "UUID",
  "fanmark_emoji": "🎮",
  "previous_owner_username": "user123"
}
```

## セキュリティ

### RLSポリシー

1. **notification_events**: 管理者のみ閲覧可能
2. **notifications**: ユーザーは自分の通知のみ閲覧・更新可能
3. **notification_rules**: 管理者のみ管理可能
4. **notification_templates**: 管理者のみ管理可能

### データ保護

- ペイロードのサニタイゼーション（XSS対策）
- レート制限（クールダウン機能）
- 監査ログ記録

## パフォーマンス

### インデックス戦略

1. `notification_events`:
   - (status, trigger_at) WHERE status = 'pending'
   - (event_type)

2. `notifications`:
   - (user_id, read_at) WHERE read_at IS NULL AND channel = 'in_app'
   - (status, channel) WHERE status IN ('pending', 'failed')
   - (user_id, created_at DESC)

3. `notification_rules`:
   - (event_type) WHERE enabled = true

### 並列処理

- `FOR UPDATE SKIP LOCKED`による楽観的ロック
- イベント処理の並列化
- チャネル別の独立処理

## 拡張性

### 将来の拡張ポイント

1. **新規チャネル追加**
   - メール配信（Resend.com統合）
   - WebPush通知
   - SMS通知

2. **高度な機能**
   - A/Bテスト
   - 通知設定UI
   - 多言語対応
   - イベントバス委譲（Kafka/Pub/Sub）

3. **分析機能**
   - 配信成功率トラッキング
   - 既読率分析
   - エンゲージメント測定

## 運用

### モニタリング指標

- イベント処理レイテンシ
- 通知配信成功率
- 未読率
- エラー率

### アラート条件

- エラー率が5%を超えた場合
- 処理遅延が1分を超えた場合
- 配信失敗が連続10件を超えた場合

## 参照

- アーキテクチャ設計: `docs/notifications-architecture.md`
- 実装ガイド: `docs/notifications-implementation-guide.md`
- API仕様: `docs/notifications-api.md`
