# 通知アーキテクチャ設計メモ

## 目的
複数トリガー（例: ライセンス失効予告・失効完了・お気に入りファンマの失効・運営からの告知など）を一元的に扱える通知基盤を構築し、中長期的な拡張と運用を容易にする。

## 全体像
```
┌───────────────┐
│  ドメインイベント│  ← 既存バッチ / Edge Functions / 管理UI
└─────┬─────────┘
      │ INSERT
      ▼
┌─────────────────────┐
│ notification_events │  (イベントキュー)
│ - event_type         │
│ - payload (JSON)     │
│ - trigger_at         │
│ - dedupe_key         │
│ - status             │
└─────┬──────────────┘
      │ スケジュール処理
      ▼
┌─────────────────────┐
│ notifications       │  (配信キュー)
│ - user_id            │
│ - channel            │
│ - template_id        │
│ - payload            │
│ - status             │
│ - delivered_at       │
└─────┬──────────────┘
      │ チャネル毎ワーカー
      ▼
  各種チャネル (アプリ内 / メール / WebPush 等)
```

## コアテーブル
### `notification_events`
- **役割**: ドメインイベントを受け取る入口。
- **主なカラム**
  - `id`: 主キー。後続テーブルとの紐付け用に必須。
  - `event_type`: `license_grace_warning`, `license_expired`, `favorite_fanmark_expired`, `manual_announcement` など。
  - `event_version`: イベントスキーマの互換性維持用。後方互換にならない変更は version を increment。
  - `source`: 発火元（`batch`, `edge_function`, `admin_ui` など）を記録し、監査とトラブルシュートに使用。
  - `payload`: 対象ユーザーやファンマ情報、テンプレート変数を格納。
  - `payload_schema`: JSON Schema のバージョンまたは参照名。イベント処理前にバリデーションを行う。
  - `trigger_at`: 通知生成タイミング（例: 失効3日前）。
  - `dedupe_key`: 同一イベントの二重登録防止キー。
  - `status`: `pending` / `processed` / `error` / `skipped`。
  - `processed_at`, `error_reason`, `retry_count`: フローの可視化・再処理の制御に利用。
  - `created_at`, `updated_at`: 再取り込みやレポートのために保持。
- **生成タイミング**
  - `check-expired-licenses` バッチでステータス遷移時に挿入。
  - `return-fanmark`（返却処理）や `register-fanmark`（取得完了）時。
  - 管理画面からの手動通知入力。

### `notification_rules`
- **役割**: イベント→通知テンプレートのマッピング。
- **主なカラム**
  - `id`: 主キー。実際に発行した通知と結び付ける。
  - `event_type`, `channel`, `template_id`, `template_version`, `delay_seconds`, `priority`。
  - `segment_filter`: Supabase Row Level Security を踏まえた SQL 断片 or 保存済みセグメント ID。
  - `cooldown_window_seconds`, `max_per_user`: ユーザー単位のスパム防止制御。
  - `cancel_condition`: イベント再評価時に true なら未配信通知をキャンセルする条件式。
  - `enabled`, `valid_from`, `valid_until`: 運用での段階的ロールアウトを想定。
- **運用例**
  - `license_grace_warning` を「メール＋アプリ内通知」で 3 日前と 1 日前に送信。
  - `manual_announcement` は管理UIで対象セグメントを指定。

### `notifications`
- **役割**: 実際に配信する通知キュー。
- **主なカラム**
  - `id`, `event_id`, `rule_id`: どのイベント・ルールから生まれた通知かを追跡。
  - `user_id`
  - `channel`: `in_app`, `email`, `webpush` など。
  - `template_id`, `template_version`
  - `payload`: テンプレート変数。
  - `status`: `pending` / `sending` / `sent` / `failed` / `cancelled`.
  - `priority`, `triggered_at`, `expires_at`: 配信順序や不要になった通知の廃棄を制御。
  - `delivered_at`, `error_reason`, `retry_count`
  - `read_at`, `read_via`（アプリ内通知の場合の既読経路）

## フロー詳細
1. **イベント発火**
   - ライセンス遷移バッチから `notification_events` に挿入。
   - お気に入りファンマ失効は `fanmark_favorites` と `fanmark_licenses` を結合して対象ユーザーを payload に含める。
   - ファンマ返却 (`return-fanmark` / `bulk-return-fanmarks`) 実行時に、お気に入り登録していたユーザーへ `favorite_fanmark_available` イベントを即時発行。
   - 管理UIは `manual_announcement` イベントを登録。

2. **イベント処理**
   - Supabase の Scheduled Function などで `notification_events` をポーリング（`FOR UPDATE SKIP LOCKED` を利用し多重並列に対応）。
   - `trigger_at <= now()` のレコードに対し payload のバリデーション→対応する `notification_rules` を適用→ユーザー対象の再評価（セグメント・ユーザー設定・最新状態）を行い `notifications` に展開。
   - `favorite_fanmark_available` のクールダウン判定はユーザー単位ではなくファンマ単位で行い、異なるファンマの返却は即時通知できるようにする。
   - `max_per_user` の判定も payload の `fanmark_id` を考慮し、同じファンマの通知は 1 回まで、異なるファンマは都度配信できるようにする。
   - 配信直前にイベント条件が解消されていないかチェックし、不要な通知は `status = skipped` として終了。
   - 重複チェック: `event_type` / `dedupe_key` に加え、`notification_rules` の cooldown 条件も満たす場合のみ通知生成。
   - どのルールも該当しない場合は `status = skipped` と `processed_at` を記録して監視対象とする。

3. **チャネル配信**
   - アプリ内通知: `notifications` から `channel = in_app` を React Query 経由で取得し、既読機能付き UI を表示。
     - ナビゲーションバーにベルアイコンを配置し、`where read_at is null` の件数をバッジとして表示。ユーザーがタップすると通知リスト画面に遷移し、`notifications` を新着順で表示する。
     - 通知リストはタブないしフィルタで「すべて」「重要」を切り替えられるよう設計しておく（将来の `priority` フィールド利用を想定）。
      - ナビゲーションのプレビューは Supabase Realtime で `notifications` テーブルを監視し、挿入／更新時に最新データへ再フェッチする。
    - メール / WebPush: 送信ワーカーが `pending` を取得し外部サービスへ連携。
   - 失敗時は `status = failed` と `error_reason` / `retry_count` / `last_error_at` を保存。再送は手動／自動で retry キューへ移動。
   - 配信完了後はテンプレートで利用した値を保持できるよう `notifications_history` などのアーカイブテーブルにスナップショットを保存。

4. **既読管理**
   - アプリ内通知に限り `read_at` を更新する RPC 提供。
   - 未読件数は `WHERE read_at IS NULL` の集計で算出。

5. **運用とモニタリング**
   - Supabase モニタリング or カスタムダッシュボードで `notification_events` / `notifications` の件数推移を監視。
   - エラー時は Slack/Webhook へアラート。
   - 管理UIに通知ログフィードを追加し、ユーザー別履歴を参照可能にする。

## 既存ロジックとの連携
- 失効バッチ (`supabase/functions/check-expired-licenses`) でイベント挿入を追加する。
- お気に入り連携は `docs/favorites-feature.md` に記載の API 群を活用し、payload に favorite ユーザー一覧を求める。
- `docs/GRACE_PERIOD_SPECIFICATION.md` のとおり `available_at` / `blocking_status` が得られるため、通知テンプレートでも再利用できる。
- `supabase/functions/_shared/return-helpers.ts` で返却処理完了時に `favorite_fanmark_available` イベントを生成し、ユーザー操作トリガーの通知を実現している。

## 匿名化・テンプレート管理
- `notification_templates` テーブルでテンプレート本文・件名・サマリーなどを管理する。`template_id` と `template_version` の組み合わせで取得し、将来ローカライズ時に差し替え可能にする。
- テンプレート側にも JSON Schema を紐付け、`payload_schema` と整合性チェックを行う。
- ユーザー固有情報は `payload` に含め、テンプレートでは `{{ }}` プレースホルダで参照。レンダリング時に欠損があれば検知できるよう Validation を実装する。

## 今後の拡張案
- **ユーザー設定**: `notification_preferences` を追加し、チャネル別オン／オフや頻度制御をサポート。
- **多言語テンプレート**: テンプレートを `notification_templates` テーブルで管理し、ユーザーの言語設定に応じて切り替え。
- **イベント分析**: `notification_events` を BigQuery などに連携し、配信成果の分析を行う。

## 拡張性を意識した追加設計ポイント
- **再評価とキャンセル**: ライセンス更新などで条件が解消された場合、`notification_events` を再評価し、未送信の `notifications` を `cancelled` に遷移させるワークフロー（または `notification_cancellations` テーブル）を用意する。
- **ユーザー設定の組み込み**: `notification_rules` 適用時は `notification_preferences` や `email_verified` などの前提条件をフィルタリング。設定変更後は再評価ジョブで未送信通知を調整する。
- **レート制御**: チャネル別／ユーザー別のレートリミットを設定し、短時間に大量通知が生成されないよう `cooldown_window_seconds` と `max_per_user` を活用。
- **バッチ配信**: `manual_announcement` の大規模配信では対象ユーザーの抽出と `notifications` 生成を段階的に行う（ペイジング・Chunking）ことでタイムアウトを防止。処理単位には `batch_id` を付与し、後からロールバック／再送を管理。
- **イベントスキーマの可視化**: `docs/notifications-event-catalog.md`（新規）などで各 `event_type` の payload 必須項目・例を整理し、バックエンドの追加時に参照できるようにする。
- **エラーハンドリング**: `notification_events` の `status = error` は Dead Letter Queue として保管。再処理の際にはバックオフ戦略を導入し、監視対象にする。
- **監査ログ**: 管理 UI からのイベント登録・キャンセルは `admin_audit_logs` に記録し、誰がいつどのセグメントに送ったか追えるようにする。
- **テスト戦略**: イベント→通知の E2E テストを Supabase ローカル／CI で実行し、payload の JSON Schema に対する Contract Test を追加しておく。
- **外部通知基盤への委譲**: `notification_events` をイベントバス（Kafka, Pub/Sub 等）にミラーし、`notification_rules` / `notifications` の生成を外部マイクロサービスに切り出せるようにしておく。Supabase 内ではイベント登録とユーザー向け既読 UI の最小限のみ保持すれば、将来的に全面的な外出しが可能。

## 実装ロードマップ概要
1. スキーマ定義 (`notification_events`, `notification_rules`, `notifications`) と RLS 設定。
2. `notification_templates` / `notifications_history` / `notification_preferences` など付随テーブルも最小構成で作成。
3. 既存 Edge Functions / バッチでイベント生成ロジックを組み込み（イベントスキーマの Contract Test も整備）。
4. イベント→通知展開の Scheduled Function を実装し、並列実行とスキップ／キャンセルフローを組み込む。
5. アプリ内通知 UI と既読 API を追加。
6. メール等の外部チャネルを段階的に拡張（テンプレートレンダリングの共通ライブラリを用意）。

以上により、チャットスレッドが途切れても通知基盤の方向性と実装ステップを追跡できるようにする。
