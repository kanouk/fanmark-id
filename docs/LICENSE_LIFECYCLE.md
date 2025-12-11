# Fanmark License Lifecycle

状態遷移と、各処理がどのデータをどう書き換えるかの網羅的メモ。

## 状態遷移（fanmark_licenses.status）

```
active --(手動返却/一括返却, license_end < now を cron で検知)--> grace
grace  --(extend-fanmark-license / Stripe license_extension)--------> active
grace  --(grace_expires_at <= now を cron で検知)-------------------> expired
active --(approve-transfer-request で旧ライセンス失効)-------------> expired

expired --(抽選当選で新ライセンス発行)-----------------------------> active(新ライセンス)
expired --(移管完了で新ライセンス発行)-----------------------------> active(新ライセンス)
```

## 取得フロー

- **通常取得** (`supabase/functions/register-fanmark`)
  - `fanmarks`: 既存レコード再利用または新規 insert（status=active, normalized_* を保存）。
  - `fanmark_licenses`: 1 件 insert（status=active, is_initial_license=true, license_end=初期日数を UTC 0:00 に丸めた値 or null[Tier C], grace_expires_at=null, user_id/fanmark_id を紐付け）。
  - 設定系: `fanmark_basic_configs` を fanmark_id/upsert、さらに license_id 起点で `fanmark_basic_configs`（fanmark_name, access_type）、`fanmark_redirect_configs` or `fanmark_messageboard_configs` を upsert。`createProfile` 指定時は `fanmark_profiles` を insert。
  - 監査: `audit_logs (register_fanmark)` に tier/emoji 情報を記録。通知はなし。

- **抽選当選での取得** (`supabase/functions/check-expired-licenses` 内 grace→expired 処理)
  - 旧ライセンス: status=expired / excluded_at=now に更新後、設定 (`fanmark_basic_configs`, `fanmark_redirect_configs`, `fanmark_messageboard_configs`, `fanmark_password_configs`) を削除。
  - 新ライセンス: 当選者 1 名を決定し `fanmark_licenses` に insert（status=active, is_initial_license=false, license_start=now, license_end=ティア初期日数を **UTC 0:00 丸めなしで** now+days 付与、grace_expires_at=null）。
  - 抽選テーブル: `fanmark_lottery_entries` を won/lost/limit_exceeded などに更新、`fanmark_lottery_history` を insert。
  - 通知: `license_expired`（旧オーナー）、`lottery_won`/`lottery_lost`/`lottery_limit_exceeded` を応募者へ。監査: `audit_logs (license_expired)`。

- **移管承認での取得** (`supabase/functions/approve-transfer-request`)
  - 旧ライセンス: status=expired, is_returned=true, license_end=now, excluded_at=now に更新し設定を全削除（basic/redirect/messageboard/password/profile）。
  - 新ライセンス: `fanmark_licenses` に insert（status=active, is_initial_license=false, is_transferred=true, license_start=now, license_end=ティア初期日数を UTC 0:00 丸め, grace_expires_at=null）。
  - 設定系: 新ライセンスに対し `fanmark_basic_configs` を insert（fanmark_name=payload 由来, access_type='inactive'）。旧ライセンスに紐付く `fanmark_lottery_entries` は cancelled。
  - 移管テーブル: `fanmark_transfer_codes`=completed, `fanmark_transfer_requests`=approved。監査: `audit_logs (LICENSE_TRANSFERRED)`。通知: `transfer_approved`（受領者）。

## 返却・失効フロー

- **手動返却** (`supabase/functions/return-fanmark`) / **ダウングレード未選択による一括返却** (`bulk-return-fanmarks`)
  - 前提: `has_active_transfer` が false の active ライセンス。
  - `fanmark_licenses`: status=grace, license_end=now, grace_expires_at=roundUpToNextUtcMidnight(now + grace_period_days setting; 最低1日), is_returned=true, excluded_at/excluded_from_plan=null。
  - 監査: `audit_logs (return_fanmark)`。通知: `fanmark_returned_owner`（オーナー）、`favorite_fanmark_available`（お気に入り登録者）。

- **期限切れによる失効 (active→grace)** (`supabase/functions/check-expired-licenses`)
  - 条件: status=active かつ license_end < now。
  - 更新: status=grace, grace_expires_at=roundUpToNextUtcMidnight(license_end + grace_period_days), is_returned=false。
  - 監査: `audit_logs (license_grace_started)`。通知: `license_grace_started`。

- **グレース終了による失効 (grace→expired)** (`supabase/functions/check-expired-licenses`)
  - 条件: status=grace かつ grace_expires_at <= now。
  - 更新: status=expired, excluded_at=now。設定テーブルを削除（basic/redirect/messageboard/password/profile）。`audit_logs (license_expired)` と `license_expired` 通知。
  - その後に抽選分岐（上記「抽選当選での取得」参照）。応募なしの場合は終了。全員上限超過の場合 `fanmark_lottery_history` を winner なしで記録。

- **グレースからの復帰 (grace→active)** (`supabase/functions/extend-fanmark-license`, `supabase/functions/handle-stripe-webhook` の `license_extension`)
  - 更新: status=active, license_end=rounded(now or current_end + months), grace_expires_at=null, is_returned=false, excluded_at/excluded_from_plan=null。
  - 抽選: 該当ライセンス/ファンマの pending `fanmark_lottery_entries` を `cancelled_by_extension`/`cancelled` に更新し `lottery_cancelled_by_extension` 通知。
  - 監査: `audit_logs (extend_fanmark_license)` または `LICENSE_EXTENDED`。

- **移管による返却 (active→expired)** (`supabase/functions/approve-transfer-request`)
  - 旧ライセンスを即 expired/is_returned=true にし、設定削除・抽選キャンセル（上記移管取得に含む）。

## 追加の付随処理

- `check-expired-licenses` は処理後に Transfer Code も整理し、有効期限切れまたはライセンスが active でないコードを `fanmark_transfer_codes.status=expired` にし、紐付く `fanmark_transfer_requests` の pending を `cancelled` にする。
- 返却・失効では設定削除は行わず（grace 中は保持）、expired 遷移時にまとめて削除する。
