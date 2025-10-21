# 通知イベントカタログ

通知基盤で取り扱うイベント種別と payload 必須項目の一覧です。新しいイベントを追加する際は本ドキュメントを更新し、テンプレート／ルールとの整合を取ってください。

| `event_type` | 主な用途 | 暴露タイミング | 必須 `payload` キー | 備考 |
| --- | --- | --- | --- | --- |
| `license_grace_started` | ライセンス猶予期間の開始通知 | `check-expired-licenses` バッチがアクティブ→グレースに遷移させた直後 | `user_id`, `fanmark_id`, `fanmark_name`, `license_end`, `grace_expires_at` | テンプレート `ライセンス猶予期間開始` を使用。 |
| `license_expired` | ライセンス失効通知 | `check-expired-licenses` バッチがグレース→失効へ遷移させた直後 | `user_id`, `fanmark_id`, `fanmark_name`, `expired_at`, `license_end` | テンプレート `ライセンス失効` を使用。 |
| `favorite_fanmark_available` | お気に入り登録済みファンマが返却され再取得可能になったことを知らせる | 返却系 Edge Function (`return-fanmark` / `bulk-return-fanmarks`) が処理完了後にお気に入りユーザーへイベント登録 | `user_id`, `fanmark_id`, `fanmark_name`, `fanmark_short_id`, `link` | テンプレート `お気に入りファンマークが利用可能` を使用。`link` は `/f/{short_id}` を想定。返却実行者は対象外。 |
| `manual_announcement` | 管理者による任意通知 | 管理 UI から登録 | 任意（テンプレートが参照するキー） | 配信対象セグメントはルールの `segment_filter` で制御。 |

## 実装メモ
- Event 登録は `supabase.rpc('create_notification_event', ...)` を介して行う。`dedupe_key` はイベントタイプ×対象ユーザー×リソースの組み合わせを基本とし、同一処理の二重登録を避ける。
- テンプレートは `notification_templates` で言語・チャネル別に管理する。payload から不足キーがないか Contract Test で担保することを推奨。
- 新規イベント追加時は `notification_rules` にルールを追加し、チャネル・遅延・クールダウン設定を明示する。
