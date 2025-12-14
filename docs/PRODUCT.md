# fanmark.id PRODUCT.md

## プロダクトの意図
絵文字1〜5個をID（ファンマ）として取得・保持し、プロフィール／リンク／メッセージを届けるサービス。検索→取得→設定→公開→返却・移管までを一貫して提供し、多言語での利用を前提にしている。

## コア体験
- 検索・取得: 絵文字入力を正規化して空き状況とティア・初回日数を提示。上限未満なら `register-fanmark` Edge Function 経由で取得し設定画面へ遷移。
- ダッシュボード管理: 所有ファンマ一覧表示、返却（`return-fanmark`）、設定遷移、コピー、移管・抽選ステータス表示。
- 設定: アクセスタイプ（redirect/profile/text/inactive）を編集。リダイレクトは URL/Phone を選択、プロフィール型は初期プロフィール自動生成。ドラフトを sessionStorage に保存し、保存完了または閉じるで破棄。
- 公開アクセス: `/a/:shortId` / `/:emojiPath` でアクセスし、RPC `get_fanmark_by_emoji` などから最小データを取得して UI 分岐。パスワード保護時は 4 桁認証。
- プロフィール管理: ユーザー自身のプロフィール・アバター・公開設定を編集。画像はローカルステートを単一ソースとして同期。

## 料金プランとティア
- プラン (ユーザー枠): Free=3件, Creator=10件, Business=50件, Admin=無制限。延長は有料（Adminのみ無料延長）。上限超過時は取得不可。
- プラン変更: アップグレードは即時適用。ダウングレード時は `FanmarkSelectionModal` で上限数だけ選択し、未選択分は一括返却（`bulk-return-fanmarks`）。選択は一度きりでキャンセル不可。
- ファンマティア (絵文字数に応じたライセンス初期日数): S=1個/7日, A=2個または2〜5個連続/14日, B=3個/30日, C=4〜5個以上非連続/無期限 (`license_end=null`)。`fanmark_tiers.display_name` に S/A/B/C を保持。
- AuthCode（移管コード）発行権限: アクティブライセンス保持者は発行可。発行には残期間48h以上が必要で、コード有効期限は発行から48hまたは `license_end` の短い方（Tierに関わらず一定）。承認後の再発行は不可。移管完了後は Transfer Lock 30日間（返却・再移管・再発行不可）。

## ライセンスライフサイクルと猶予
- 取得時は初回日数を次の UTC 0:00 に丸めて `license_end` として保存（Tier C は無期限）。
- 返却または期限到達: status=`grace` にし、`grace_expires_at = roundUpToNextUtcMidnight(now + grace_period_days)`（デフォルト24h以上保証）。グレース中は再取得不可。
- `grace_expires_at` 超過で `expired` へ遷移し設定削除。通知・抽選・お気に入り連携はこの状態遷移をトリガーにする。

## 譲渡（移管）システム
- フロー: 現所有者が移管コード（AuthCode）発行→受取側が申請→現所有者が承認→新ライセンス発行／旧ライセンス失効。申請中は延長・返却をブロック。
- コード発行条件: 残期間48h以上、1ライセンス1コード、申請中は再発行不可、再発行で既存コードを自動 cancel。Tier C は有効期限上限30日。
- 新ライセンス期間: Tier S 7日 / A 14日 / B 30日 / C 無期限。設定データは基本・redirect・messageboard・プロフィールをコピーし、パスワード設定は除外。

## 抽選システム
- 対象: Grace 中のファンマ。ユーザーは1ファンマにつき1件申込、現オーナーも可。延長と抽選は排他（延長が優先し pending をキャンセル）。
- 実行: `check-expired-licenses` バッチが `grace_expires_at` 超過時に申込数を判定。0件→通常失効、1件→自動当選、複数→加重ランダム抽選。結果を通知し、新ライセンス発行・旧ライセンス失効。
- 管理: 抽選確率の編集、申込キャンセル、履歴保存、通知テンプレートは `lottery_*` イベントで管理。

## お気に入り・通知
- お気に入り: `fanmark_discoveries` / `fanmark_favorites` で未取得ファンマも管理。トグルは RPC `add/remove_fanmark_favorite`。返却完了時にお気に入り登録者へ `favorite_fanmark_available` 通知イベントを生成。
- 通知基盤: `notification_events` → `notification_rules` → `notifications`。イベント例: grace開始/失効、抽選当落、移管関連、手動告知。`process-notification-events` Scheduled Function が展開・配信し、in-app/メール等に対応。

## 招待・認証
- 招待制: `system_settings.invitation_mode` が ON の場合、サインアップ前に `validate_invitation_code` 成功が必須。`use_invitation_code` で消費し、残数と期限を検証。待機リストは `waitlist` テーブルで管理し、管理UIから招待コード配布。
- 認証: Supabase Auth。`social_login_enabled=false` または招待モード中は OAuth を抑止し、OAuth でも初回パスワード設定を強制。パスワード要件表示、メール確認・再送、リセット対応。
- 多言語: 日本語/英語の翻訳バンドルを用意し、ヘッダーで切替可能。

## アクセスタイプ仕様
- `redirect`: 外部 URL または `tel:` を保存し即時遷移。
- `profile`: `emoji_profiles` を表示（公開設定・ソーシャルリンク・テーマ）。
- `text` (messageboard): メッセージ表示とコピー。
- `inactive`: 何もしない。ドラフト復元やパスワード保護の有無も翻訳キーで制御。

## データモデル概要
- 主要テーブル: `fanmarks`, `fanmark_licenses` (status/日付/Tier), `fanmark_tiers`, `emoji_profiles`, `fanmark_basic/redirect/messageboard/password_configs`, `fanmark_discoveries`, `fanmark_favorites`, `fanmark_lottery_entries/history`, `fanmark_transfer_codes/requests`, `invitation_codes`, `waitlist`, `system_settings`, `notification_events/rules/notifications`, `audit_logs`.
- RPC/Functions (抜粋): `check_fanmark_availability`, `get_fanmark_by_emoji`, `register-fanmark`, `return-fanmark`, `bulk-return-fanmarks`, `extend-fanmark-license`, `check-expired-licenses`, `generate/apply/approve/reject/cancel-transfer-code`, `apply/cancel-lottery-entry`, `process-notification-events`.

## UXポイント
- ダッシュボード: 統計カードにお気に入り数、抽選/移管バッジ、プラン選択導線。
- ランディング: ヒーロー、検索、最近取得、事例、CTA。
- エラーハンドリング: 主要操作はトースト通知。抽選・検索は `finally` で再フェッチし UI と状態を常に同期。
