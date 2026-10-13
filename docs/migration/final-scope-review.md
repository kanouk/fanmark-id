# 元の完了条件との照合（2026-10-13）

## 2026-10-13: Apple非公開メール認証と配送記録を確認

本人のApple「メールを非公開」選択後、専用環境のAppleアカウント1件・確認済みrelayメールを確認した。
通常stagingに同一メールのアカウントがないことを照合し、既存signup経路から合成アカウントを1件作成、確認メールを1通送った。
signupは200/attempt completed、ResendはSent・Delivered。実際の転送先受信と所有テストデータの後片付けは未完了。
新Resend鍵・送信再試行・本番ユーザー移送・domain変更は0。現行通常main19aa1e2f/source fdd16ef。
[配送の限定証拠](evidence/apple-private-relay-delivery-2026-10-13.json)。target/PRの最終判定と最後の#38は引き続き別工程。


## 2026-10-13: 移行方針を本人回答で確定

ユーザーは「現在の方針を継続：Cloudflare環境を完成させ、既存ユーザー移送と再ログインは最後」を選択した。
本番の正は最後の切り替えまでSupabase、検証環境はWorkers / Better Auth / D1 / R2とする。
全機能への旧JWT中継は今回の実装条件から外す。既存のprofile/username adapterは任意の検証済みコードとして保持し、通常stagingへ旧認証を設定しない。
元#28/#33の移行途中の旧JWT中継要求は、この本人判断で置き換える。未実装の中継を実装済みと扱わない。
[本人の範囲判断](evidence/owner-migration-scope-decision-2026-10-13.json)。通常main f7a601f0/runtime cb3c1f3を維持。
結果文書efff9e0のCI38385973590も両job成功。Resendは再login済み。
Apple本人認証・非公開メール選択と実受信、およびtarget機能の最終判定は残る。
実ユーザー/Auth/Storage移送と本番domain/DNSは最後の#38。以下の範囲未確定/Resend login待ちは各時点の履歴。

現行通常stagingは **19aa1e2f-b1a0-45cb-a56f-f5de74bbe9cd** / source **fdd16ef**。
検索の現所有/grace選択もlocal D1 17/API4/client6・実Cloudflare8項目と独立cleanup/通常保持確認を受け入れた。
[限定証拠](evidence/search-current-license-native-2026-10-13.json)。
お気に入りの現所有者選択もlocal D1 19/client6・実Cloudflare5項目・独立cleanup/通常保持確認を受け入れた。
[限定証拠](evidence/favorites-current-license-native-2026-10-13.json)。
Adminの移管無制限もlocal46件・実Cloudflare4項目・独立cleanup/通常保持確認を受け入れた。
初回初期化500の原因未確定と同じ所有資源での再開を保持する。[Admin移管の限定証拠](evidence/transfer-admin-unlimited-native-2026-10-13.json)。
取得・抽選の上限判定もlocal85件・実Cloudflare8項目・独立cleanup/通常保持確認を受け入れた。
[取得・抽選の限定証拠](evidence/acquisition-lottery-capacity-native-2026-10-13.json)。
移管plan/limit競合のlocal43件・実Cloudflare6件・独立cleanup/通常保持確認を受け入れた。
[限定証拠](evidence/transfer-plan-snapshot-native-2026-10-13.json)。
下表のprofile/auth App受け入れは958b5ea2/source5c1504e当時の結果として保持する。
実ユーザー/Auth/Storageの移送と本番domain/DNSはユーザー指示により#38へ残す。
元計画の20条件と子イシュー30条件を[条件別監査](evidence/original-requirement-audit-current-2026-10-13.json)で個別に照合した。
現在の担当モデルでコードと証拠を確認している。今回Astraが独立レビューしたとは記録しない。

| 元条件 | 確認できた準備・受け入れ | 未達または最終移送の条件 |
| --- | --- | --- |
| #30 全対応表・容量・担当者 | 40表/58関数/37trigger/77policyの実metadataとmanual counterpart。現行215 callerのAST/semantic位置対応。容量・運用担当・鍵・RPO/RTO目標を文書化 | metadata一致は全SQLの意味論の承認ではない。外部caller・実Storage本文照合は#38 |
| #31 認証・競合 | 固定Better Auth/bcrypt、合成UUID/credential、4実OAuth、MFA/残枠/移管/クーポンの既存local/native証拠。Apple初回passwordと通常login | 実provider subject/UUID/role・既存MFAは#38。Apple relay実受信は未確認 |
| #32 Stripe | 受信/適用/dispatch台帳の重複/逆順/失敗/retry、sandbox Checkout/Portal/Freeと署名7件 | 実契約の対応、旧receiver/dispatcher停止と台帳引継ぎは#38 |
| #33 API・旧認証・配信 | typed API/権限/no-store、45 selector、匿名source bridge、旧PWA更新。旧JWT/service-role profile GET/PATCH/usernameは実Auth local8、native TLS7、実画面部品で確認 | 全旧JWT中継は本人判断で今回の条件から除外。target機能別契約の最終判定は継続し、旧中継の全機能対応を実装済みとは扱わない |
| #34 D1/Auth/R2/Resend/jobs | 既存caller対応、owner/foreign/admin/失敗・並行操作証拠、4言語core/sandbox課金。958b5ea2版Appのメールlogin/profile保存/logout/reloginと独立cleanup | 4言語/課金の通しは前cc82c298の証拠。最新変更はprofile/authに限定し確認。実履歴/契約の同一性は#38 |
| #35 移送・復旧 | 非空40表46→45行と明示credential deferral、2target中断再開、専用Auth/R2と全Master合成復旧。代表容量5storeのhash/SDK復帰/画像配信とcleanup | generic converterはdeployable=false。全source schemaと実アプリnative importerを同じものと扱わない。実snapshotの差分0は#38 |
| #36 マスター更新 | 25表Master、3,944 UUID、stage/promote/rollback/draft復元。Unicode更新は別release | 公開domainは変更なし。PR41はdraft |
| #37 統合・停止・復旧 | 既存pre-write fallback/post-write repair-forward、自然日次/backup/monitor/retention、運用鍵、代表復旧実測、旧PWA、4言語、本人phone/home-screen | 新mainで自然dailyを再観測したとは扱わない。実source停止/drain/確定copy/実契約受信は#38。RPO/RTOは目標 |
| 文書・PRレビュー | PRODUCT/ARCHITECTURE/TECH/API/環境/運用手順と差分・限定証拠を保存。CI38356766234両job成功 | 元条件の意味論とPR最終判定は未完了。現runtimeのCI38382342905は両job成功 |

今回の実App確認は合成アカウントだけ。保存・再読込後の保持、通常サインアウトと再ログイン、
390px表示、Supabase通信0、全表件数の復元と本人Auth metadata保持を別processで照合した。
[通常版の証拠](evidence/staging-profile-auth-regression-2026-10-13.json) /
[配備と旧認証画面部品](evidence/legacy-profile-rendered-normal-deploy-2026-10-13.json)。

残る準備工程は、target機能別契約とPRの最終判定、Apple relay実受信。旧JWT全機能中継の範囲判断は解決済み。
専用のrelay検証環境は準備済みだが、Resend再loginは完了したが、本人の非公開メール認証と実受信は未完了。これを成功に置き換えず、全工程完了・本番切替可能とは判定しない。
当初のcheckboxを今回の限定結果だけでは変更しない。
58関数の18機能群と現在の境界確認を[レビュー索引](evidence/application-counterpart-review-index-2026-10-13.json)、
[認証・保護・課金・復旧](evidence/application-security-boundaries-2026-10-13.json)、
[管理・日次処理](evidence/application-admin-scheduled-boundaries-2026-10-13.json)に保存した。
索引の網羅と現在の境界確認は、任意の旧RPC利用者・元PostgreSQL権限・全PRの同等性承認を意味しない。
[照合記録](evidence/original-criteria-status-2026-10-13.json)には確認した証拠の版とhashを残す。
