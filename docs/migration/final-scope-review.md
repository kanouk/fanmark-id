# 最終レビューの範囲（2026-10-13）

レビュー担当は現在の会話で指定されたGPT6.1 Sol High。初期issueのAstra指定を、Astraが実際にレビューした証拠として扱わない。sourceからの実ユーザー/Auth/画像移送と本番domain/DNSは#38へ保持する。

| issue | アプリ・インフラ準備の証拠 | 最終移送/未確認の境界 |
| --- | --- | --- |
| #30 棚卸し | `source-final-correspondence-review-2026-10-13.json`の40表/58関数/37trigger/77policy/211 caller対応、24チェック・346文書参照。今回の読み取り専用容量集計とPaid現行プラン。運用担当/鍵/日次30日/目標はOPERATIONS冒頭 | count/hashの対応は全任意SQL互換の証拠ではない。Storage容量はmetadata。個別内容・本体hash・外部callerは#38 |
| #31 Auth/競合 | 固定Better Auth/bcrypt、合成UUID/credential移送、native owner/MFA/取得残枠/移管/クーポン。4実OAuthとApple新Authの初回password・通常login | 既存の実provider subject/UUID/role対応とMFA再登録は#38。Apple relay実受信は本人管理の検証宛先なしで未確認 |
| #32 Stripe | 受信/適用/dispatch台帳、local/native重複・逆順・失敗・retry、provider sandboxおよび同一V4のCheckout/Portal/Free、署名7件・完了7件 | 旧Supabase用DB変更は準備済み未本番適用。実契約/旧receiver・dispatcher停止/台帳引継ぎは#38 |
| #33 API | 契約/権限/機微no-store、frontend selector、source匿名recent/availability bridge、旧PWA更新local証拠、現行V4四言語/本人スマホ・ホーム画面 | 初期issueの旧JWT/service-role認証bridgeはプロフィール候補の40件local試験まで。全bridgeは実装済みとはしない。匿名bridgeはservice-roleを拒否し、認証APIはBetter Authのみ。旧利用者は旧Supabaseのまま、最終import後に再login。旧JWT継続受入や任意RPC互換は採用しない |
| #34 アプリ | 現行caller全211件と手動対応、owner/foreign/admin/失敗処理のnative証拠。現行V4の4言語とsandbox課金・通知、専用行cleanup/FK0 | 通常production selectorはSupabase。旧ユーザーについて同一履歴/課金を保持する検証は#38 |
| #35 移送器 | 最新40表非空46→45行（1件の明示credential deferral）、2remote target、型/件数/hash/FK/中断再開、専用Auth/R2・全Master合成復旧 | generic converter deployable=falseを維持。source-shaped全表synthetic試験と実アプリnative D1 importerを同じものと呼ばない。履歴seq_key/実identityは#38 |
| #36 配備 | staging専用CI・Supabase自動配備の分離、Workers/D1/R2、全25表Master、master stage/promote/rollback、公表3,944件 | PR #41 draft・main未merge。公開domain切替なし |
| #37 統合/復旧 | 既存isolated pre-write fallback/post-write repair-forward、暗号化保存/復旧。現行V4の日次通常Cron/自然backup・別monitor、運用鍵/off-host/retention、現行四言語/課金と本人mobile | sourceの実停止/drain・確定copyの同時手順/実契約の受信継続は#38。目標RPO24h/RTO4hを本番保証にしない。KO一過性500/503原因不明を保持 |

代表容量のnative一式復旧はsource9794a49/CI38338723332で受け入れた。Mac保存fileのbyte一致・全5store hash・SDK復帰・画像配信・全資源cleanupと元構成保持を確認。通常main34a665d2へ配備し、設定/保存先/件数/schema/assets/catalog/監視・本人Authを保持した。[容量レビュー](source-capacity-review.md)を参照。過去5caseの失敗と業務D1の原因未確定を保持する。

Apple relayの実受信は本人管理の宛先がなく未確認。旧JWT/service-role認証bridgeは実装済みとして承認しない。実ユーザー同一性・実契約・source writer停止/最終copy・本番domain/DNSは#38。完成済みの証拠を全機能再試験で置き換えず、最終文書/PRと原条件の監査を続ける。

## 旧JWT条件の実装開始

当初条件を削除せず、本人プロフィールのSupabase adapterを最初の単位として追加した。
[legacy bridge](legacy-supabase-bridge.md)に採用条件・local限定証拠・未配備/残りAPIを記録する。
全旧API・frontend・実Supabase接続をこの1APIから受け入れない。

旧認証profile/usernameはfrontend接続45件・実GoTrue/PostgREST local7項目まで進んだ。
[source bridge](legacy-supabase-bridge.md)のlocal/遠隔/全schemaの境界を維持し、
新candidate CI・実画面/Cloudflare remoteを待たずに#33を完了しない。
