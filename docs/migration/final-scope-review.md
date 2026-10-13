# 元の完了条件との照合（2026-10-13 15:52 JST）

現行通常stagingは **958b5ea2-525d-4a7e-adc6-f6b15bfdcf91** / source **5c1504e**。
実ユーザー/Auth/Storageの移送と本番domain/DNSはユーザー指示により#38へ残す。
現在の担当モデルでコードと証拠を確認している。今回Astraが独立レビューしたとは記録しない。

| 元条件 | 確認できた準備・受け入れ | 未達または最終移送の条件 |
| --- | --- | --- |
| #30 全対応表・容量・担当者 | 40表/58関数/37trigger/77policyの実metadataとmanual counterpart。現行215 callerのAST/semantic位置対応。容量・運用担当・鍵・RPO/RTO目標を文書化 | metadata一致は全SQLの意味論の承認ではない。外部caller・実Storage本文照合は#38 |
| #31 認証・競合 | 固定Better Auth/bcrypt、合成UUID/credential、4実OAuth、MFA/残枠/移管/クーポンの既存local/native証拠。Apple初回passwordと通常login | 実provider subject/UUID/role・既存MFAは#38。Apple relay実受信は未確認 |
| #32 Stripe | 受信/適用/dispatch台帳の重複/逆順/失敗/retry、sandbox Checkout/Portal/Freeと署名7件 | 実契約の対応、旧receiver/dispatcher停止と台帳引継ぎは#38 |
| #33 API・旧認証・配信 | typed API/権限/no-store、45 selector、匿名source bridge、旧PWA更新。旧JWT/service-role profile GET/PATCH/usernameは実Auth local8、native TLS7、実画面部品で確認 | profileだけで全旧認証API bridgeを受け入れない。元の機能別契約と残りのsource APIの照合を続ける |
| #34 D1/Auth/R2/Resend/jobs | 既存caller対応、owner/foreign/admin/失敗・並行操作証拠、4言語core/sandbox課金。現行版Appのメールlogin/profile保存/logout/reloginと独立cleanup | 4言語/課金の通しは前cc82c298の証拠。最新変更はprofile/authに限定し確認。実履歴/契約の同一性は#38 |
| #35 移送・復旧 | 非空40表46→45行と明示credential deferral、2target中断再開、専用Auth/R2と全Master合成復旧。代表容量5storeのhash/SDK復帰/画像配信とcleanup | generic converterはdeployable=false。全source schemaと実アプリnative importerを同じものと扱わない。実snapshotの差分0は#38 |
| #36 マスター更新 | 25表Master、3,944 UUID、stage/promote/rollback/draft復元。Unicode更新は別release | 公開domainは変更なし。PR41はdraft |
| #37 統合・停止・復旧 | 既存pre-write fallback/post-write repair-forward、自然日次/backup/monitor/retention、運用鍵、代表復旧実測、旧PWA、4言語、本人phone/home-screen | 新mainで自然dailyを再観測したとは扱わない。実source停止/drain/確定copy/実契約受信は#38。RPO/RTOは目標 |
| 文書・PRレビュー | PRODUCT/ARCHITECTURE/TECH/API/環境/運用手順と差分・限定証拠を保存。CI38356766234両job成功 | 元条件の意味論とPR最終レビューは未完了。新文書は次のcommitで保存 |

今回の実App確認は合成アカウントだけ。保存・再読込後の保持、通常サインアウトと再ログイン、
390px表示、Supabase通信0、全表件数の復元と本人Auth metadata保持を別processで照合した。
[通常版の証拠](evidence/staging-profile-auth-regression-2026-10-13.json) /
[配備と旧認証画面部品](evidence/legacy-profile-rendered-normal-deploy-2026-10-13.json)。

残る準備工程は、#33の機能別契約/旧認証bridge範囲、元条件に対するsource機能とPRレビュー、Apple relay実受信。
宛先なしを成功に置き換えず、全工程完了・本番切替可能とは判定しない。
当初のcheckboxを今回の限定結果だけでは変更しない。
[照合記録](evidence/original-criteria-status-2026-10-13.json)には確認した証拠の版とhashを残す。
