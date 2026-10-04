# ユーザーデータ・ドメイン移行前の完了判定

2026-10-04 JST。親Issue #28と#30–#37の現行本文、現在の実装・受け入れ記録を
照合した残件表。作業時間やテスト件数を進捗率に換算しない。
stagingの機能別受け入れは進んでいるが、以下の全条件はまだ成立していない。

## 今回の到達点

Workersのアプリ/API、分離D1、R2、認証、定常ジョブ、非ユーザー系マスター、
合成データによる移送・統合・復旧を検証し、実ユーザーデータ移送と公開ドメイン
切替に進める状態を作る。実ユーザーのexport/import、既存認証情報・Storageの
実移送、DNS変更、Supabase本番writerの停止・旧基盤終了は今回実行しない。
実ユーザーでしか証明できない行同一性・既存provider主体との対応は、最後の
データ工程の条件として明示する。合成検証の合格から推定して完了にしない。

## 完了までに閉じる六つの作業

| 作業 | 現在の証拠と不足 | 今回の完了条件 | 対応Issue |
| --- | --- | --- | --- |
| 1. 移行元・移行先・呼び出し元の照合 | 40表、58関数、37登録trigger、77policyのcatalogと211箇所のfrontend対応表があり、77policy全件のidentity/hash→40表の現行経路・実装・検証への対応表を作成済み。分類reportは全体照合未完了のまま。sequence keyの3候補indexは現行writer/importの契約を照合し、空/NULL配列等の残る差を最後のデータ工程の条件へ明記した。任意外部consumerとfull converterのgateは保持する。 | 各object/actionについて、source定義hash、権限、実行経路、targetまたは不使用の根拠、契約差、対応する検証を結び付ける。未実装の現行経路・未説明の差を残さない。実データでしか判断できない事項はデータ工程へ明示的に移す。 | #30, #33, #34 |
| 2. アプリと認証・業務処理の仕上げ | 多くのsession/権限/競合/失敗時rollbackは受け入れ済み。退会388044b/Worker4a8d85ddはnative66・remote6を受け入れ済み。検索・お気に入りの4既知event/count不整合もbce8993、CI37094750732両job、Workerc09ece05のlocal17・remote4/cleanup/独立readbackで解消済み。取得の通常CI漏れを修正し、既存21と現行25 Business/4 Auth/8 Master・実signin/TOTP/停止・登録の5件（local26/26）を確認した。ただし全画面・実provider・最終統合は未完了。 | 現行画面の必須操作、管理者MFA、登録/password setup/reset、ライセンス取得・返却・移管・抽選・上限・クーポンを統合構成で確認する。現在修正中の既知不具合を解消し、必要な新経路をstagingで確認する。 | #31, #33, #34 |
| 3. 実サービスとのテスト接続 | GitHubは0fb4976/CI37180854336両job・Worker07bf9d61で実callback/provisioning/初回password保存/logout/session失効/同一identity再loginを受け入れた。Googleのcallback保存・既存資格情報のstaging保存とGoogle/GitHub capabilitiesはWorker8bb6b4d9で確認済み。Googleも実callback/provisioning/本人の初回password保存/logout/session失効/同一identity再loginを受け入れた。DiscordもWorkerfa4ef348で実callbackによる既存Google userへの連携・session失効・同一identity再loginを受け入れた。新規Discord user作成/初回設定は未確認。Appleは更新Program License Agreementへの本人同意待ちで設定管理画面に入れず、実接続未受け入れ。Stripe/Resendも未受け入れ。stagingのsecretは3 provider pairを含む9名称で、Discord/GitHub/Googleを公開する。 | Stripe sandboxのCheckout/Portal/変更/延長/署名Webhook・重複/逆順/再試行、テスト宛先の認証メール、4 providerの開始/callback/初回設定を確認する。Apple relayも含む。必要なprovider資格情報・テスト設定・テスト送信の許可が必要。本番課金・本番宛先送信は行わない。 | #31, #32, #34, #37 |
| 4. ジョブ・運用・復旧 | 通知DOの起動/排出/停止・復旧、期限処理の合成一回実行、archive smoke、Time Travel/R2 replayの個別証拠はある。隔離実Cronでarchive2件/残す2件・履歴payload/FK・cleanupを受け入れ、独立inventoryも一致した。mainの日次expiry/archive・Paid/CPU30,000msは有効化・配備/readback済みで、自然発火は2026-10-05 09:00 JSTの確認待ち。監視専用tokenを二つのRead権限・対象account限定・期限11/4で発行し、Macキーチェーン保管と専用CLIの実readを受け入れた。実書込み拒否は未証明で、定期監視/秘密運用全体/retention/担当/RPO-RTOと最終運用は未受け入れ。 | 起動条件/周期/再開/監視、保存期間、担当と権限、秘密の保管・交換、停止時間/復旧時間目標を確定し、合成障害から復旧を実測する。測定で有料planが必要なら設定前に明示する。 | #30, #34, #37 |
| 5. 移送器の合成データ受け入れ | 現行25 Business/4 Auth、8 Master＋保持する旧Auth core、分離したavatar/cover R2で、同じbundleの合成40表/15行・マスター・2画像を別incarnationへ復旧した。source hash/型/閲覧password/画像参照・bytes/MIMEと通知wakeの単発性を照合。local復旧10182ms。プロフィールを後から取り込むとpassword世代照合が失敗する不具合をcodec v5の順序制御で修正し、専用試験コマンドを追加。通常CIに実行stepがないことを今回確認し、Business/Auth・combined復旧の明示stepを追加。復旧先画像の冗長bucket prefixによる実Storage API404を再現・修正し、primary/別incarnationのGET/HEAD・bytes/MIME/size一致を確認。fresh local復旧10812ms。隔離D1 REST経路はnative9件に加え、1d3085f/CI37108741104両job成功後の実APIで値・rollback・応答破棄後の非自動再送を確認し、所有した一時D1削除/既存3件inventory一致を受け入れた。共通fixture生成と一式remote conductorを準備し、HTTP R2経路のnative6件（import/replay・競合・実Storage GET/HEAD・所有key cleanup）と共通化後combined1件が成功。2cbf4e0/CI37115000097両job成功後、一式remoteの2 targetで40表/15行（非空9表）・Master・2画像・source hash/count・FK/wake・中断再開が成功。新規targetの合成復旧90726msで本番RTOではない。所有した全資源を削除し、独立10:18:30.138Z inventory一致を受け入れた。Authはseedした合成依存userでcredential backup証拠ではない。画像参照のDTO対応と変更なし保存・既存key削除は6a1870a/CI37118191381両job成功後、実stagingのWorker51db2c90でAPI・実Chromeの編集/公開画像decode・cleanup・独立readbackを受け入れた。RTO/運用・最終統合は残る。source schema converterのdeployableはfalse。実ユーザーデータは読み出して移送しない。 | 最終schemaと運用構成で合成snapshotの中断・再開・照合・復旧を通し、未説明差分0と所要時間を記録する。個別の旧schema検証から最終構成の成立を推定しない。 | #35, #37 |
| 6. 最終統合と引き渡し | desktop・390px viewportのeditor/favorites、API/static/PWA/noindexなどの個別証拠がある。実スマホ・対応言語・旧PWAからの更新を含む最終通し確認は未完了。PR #41はdraft。 | 同じ最終candidateで主要利用フロー、provider、ジョブ、PC/スマホ、言語、旧client更新、障害/復旧を一巡する。実行結果と残すデータ/DNS工程の手順を更新し、PRの最終差分・CIをレビュー可能にする。 | #33, #37 |

## 進行方法

- この六項目を管理単位にする。個別の新テストを追加しただけでは項目を完了にしない。
- 既に受け入れた機能は、その契約や依存箇所が変わった場合、既知不具合がある場合、
  または最終統合で必要な場合に再確認する。全機能のremote fault検証を各commitで
  一律にやり直すことは完了条件に追加しない。
- 個別の障害検証は、移行要件・実際の不具合・未確認の契約に結び付ける。
  新しい仮説を無制限に追加して終了条件を動かさない。
- provider設定待ちの間は、設定に依存しない上記作業を進める。ただし設定待ちの
  項目を完了にせず、全体完了の見通しをコード作業だけで約束しない。
- 六項目の未完了・待ち理由・証拠を更新する。次のチェックポイントでは完了した
  項目と具体的に残る項目を示す。実ユーザーデータ/DNSの未実行は、今回の範囲内で
  必要なコード/infra/接続/統合の未完了を隠す理由にしない。

## 現在の直近作業

アプリruntimeは`0fb4976`、両CI37180854336成功、100% Worker
`07bf9d61-d9be-43db-875e-492ed6e2e7c5`。GitHubの実認証は
[保存済み証拠](evidence/github-staging-real-auth-2026-10-04.json)で受け入れ済み。
本人管理の試験アカウントは保持する。既存ユーザーの移送ではない。
[HTML navigation](evidence/staging-navigation-2026-10-04.json)もこの版で確認した。

項目4の専用token経路はCI37183202677両job成功。専用tokenを対象accountの
Workers Scripts Read/D1 Readで発行し、Macキーチェーン保管・専用CLIの実readを確認した。
[資格情報受入](evidence/dedicated-staging-monitor-credential-2026-10-04.json)。
実書込み拒否と定期実行/秘密運用全体は未受け入れ。Google secret保存後のWorker版は
`8bb6b4d9-a9e1-42c4-8963-6348e05d05ce`で、コードは同じ`0fb4976`。
[実readの証拠](evidence/staging-monitor-rest-read-2026-10-04.json)と
[運用手順](OPERATIONS.md)を参照する。監視tool/docs変更ではruntimeを再配備しない。

項目3はGoogle callback/初回password保存/session失効/同一identity再loginまで受け入れ済み。Discordは既存Google user連携での実callback/logout/reloginを受け入れ、新規user作成/初回設定は残る。Appleは更新契約への本人同意待ち。Stripe
sandbox・Resendのテスト宛先/実接続も残る。main日次Cronは登録/有効化済みだが、
次回2026-10-05 09:00 JSTの自然発火・処理結果は未確認。
運用担当/権限/秘密保管/保存期間/RPO-RTOと、同じ最終candidateの実スマホ・言語・
旧PWA更新・provider/ジョブ/復旧の統合は残る。

source照合は58関数/37binding/77policy/40表/211 frontend callsiteの対応を結び付けた。
classifierの54 pendingは手動counterpartの受け入れを取り込んでいない数で、54件の
未実装を意味しない。一方、fullRuntimeReconciled/converterDeployableはfalseを保持し、
未説明差や実データでしか確認できない事項を完了扱いにしない。
[source runtime](source-runtime-review.md)、[source authorization](source-authorization-review.md)、
[object map](object-map.md)、[frontend callsites](frontend-callsite-map.md)、
[trigger counterparts](source-trigger-counterparts.md)、[policy counterparts](source-policy-counterparts.md)を参照する。
過去の失敗/修正・個別受け入れは[HANDOFF](HANDOFF.md)と[EXECUTION](EXECUTION.md)へ残す。
