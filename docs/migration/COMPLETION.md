# ユーザーデータ・ドメイン移行前の完了判定

2026-10-03 JST。親Issue #28と#30–#37の現行本文、現在の実装・受け入れ記録を
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
| 1. 移行元・移行先・呼び出し元の照合 | 40表、58関数、37登録trigger、77policyのcatalogと211箇所のfrontend対応表があり、77policy全件のidentity/hash→40表の現行経路・実装・検証への対応表を作成済み。分類reportは全体照合未完了のまま。sequence keyの3候補indexなどに未解決の意味差がある。 | 各object/actionについて、source定義hash、権限、実行経路、targetまたは不使用の根拠、契約差、対応する検証を結び付ける。未実装の現行経路・未説明の差を残さない。実データでしか判断できない事項はデータ工程へ明示的に移す。 | #30, #33, #34 |
| 2. アプリと認証・業務処理の仕上げ | 多くのsession/権限/競合/失敗時rollbackは受け入れ済み。退会388044b/Worker4a8d85ddはnative66・remote6を受け入れ済み。検索・お気に入りの4既知event/count不整合もbce8993、CI37094750732両job、Workerc09ece05のlocal17・remote4/cleanup/独立readbackで解消済み。ただし全画面・実provider・最終統合は未完了。 | 現行画面の必須操作、管理者MFA、登録/password setup/reset、ライセンス取得・返却・移管・抽選・上限・クーポンを統合構成で確認する。現在修正中の既知不具合を解消し、必要な新経路をstagingで確認する。 | #31, #33, #34 |
| 3. 実サービスとのテスト接続 | Stripe、Resend、4 OAuth providerの実接続は未受け入れ。stagingのsecretは3名称のみで、signup/email/providerは閉じている。閉じていることの確認は接続成功の証拠ではない。 | Stripe sandboxのCheckout/Portal/変更/延長/署名Webhook・重複/逆順/再試行、テスト宛先の認証メール、4 providerの開始/callback/初回設定を確認する。Apple relayも含む。必要なprovider資格情報・テスト設定・テスト送信の許可が必要。本番課金・本番宛先送信は行わない。 | #31, #32, #34, #37 |
| 4. ジョブ・運用・復旧 | 通知DOの起動/排出/停止・復旧、期限処理の合成一回実行、archive smoke、Time Travel/R2 replayの個別証拠はある。定常運用、archive/retention、CPU/plan適合、秘密管理/最小権限を含む運用全体は未受け入れ。 | 起動条件/周期/再開/監視、保存期間、担当と権限、秘密の保管・交換、停止時間/復旧時間目標を確定し、合成障害から復旧を実測する。測定で有料planが必要なら設定前に明示する。 | #30, #34, #37 |
| 5. 移送器の合成データ受け入れ | 現行25 Business/4 Auth、8 Master＋保持する旧Auth core、分離したavatar/cover R2で、同じbundleの合成40表/15行・マスター・2画像を別incarnationへ復旧した。source hash/型/閲覧password/画像参照・bytes/MIMEと通知wakeの単発性を照合。local復旧10182ms。プロフィールを後から取り込むとpassword世代照合が失敗する不具合をcodec v5の順序制御で修正し、専用試験コマンドを追加。通常CIに実行stepがないことを今回確認し、Business/Auth・combined復旧の明示stepを追加。復旧先画像の冗長bucket prefixによる実Storage API404を再現・修正し、primary/別incarnationのGET/HEAD・bytes/MIME/size一致を確認。fresh local復旧10812ms。隔離D1 REST経路はnative9件に加え、1d3085f/CI37108741104両job成功後の実APIで値・rollback・応答破棄後の非自動再送を確認し、所有した一時D1削除/既存3件inventory一致を受け入れた。共通fixture生成と一式remote conductorを準備し、HTTP R2経路のnative6件（import/replay・競合・実Storage GET/HEAD・所有key cleanup）と共通化後combined1件が成功。ただしconductorの一式remote実行・RTO/運用・source URL変換/ブラウザ・最終統合は残る。source schema converterのdeployableはfalse。実ユーザーデータは読み出して移送しない。 | 最終schemaと運用構成で合成snapshotの中断・再開・照合・復旧を通し、未説明差分0と所要時間を記録する。個別の旧schema検証から最終構成の成立を推定しない。 | #35, #37 |
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

最新候補8c17c7eのCI37112092427は両job成功。一式remote復旧を初回実行したが、
一時画像Workerの配備で失敗し、schema・データ取り込み前に終了した。作成した
D1 3件/R2 2件は削除し、09:26:21.141Zの独立API inventoryで既存資源一覧の一致と
一時Workerの不在を確認した。復旧そのものは未受け入れ。追加のread-only確認で、
/tmpの一時Wrangler設定では専用fanmark profileではなく別アカウントの認証を
参照する不具合が判明。元の配備エラーはwrapperが破棄しており、直接のprovider
エラーは未保存。次の実行前に一時設定の認証固定と資源作成前のidentity確認、
値を含まない失敗情報の保存を修正する。既存アプリの再配備や全機能の再検証は
このツール修正だけでは必要としない。以下の直近作業記載は過去の経緯を残す。

修正1d3085fのCI37108741104は両job成功。一式local復旧試験のCI配置と、
隔離D1の実REST primitive確認は完了した。合成snapshot全体のremote復旧、
R2とsource URL/ブラウザ、運用RTO、六工程の全体完了はまだ受け入れていない。

前候補8bc3baaのCI37108118976はアプリ成功、Workerのcombined復旧step失敗で終了。
Master生成が参照するアプリ依存をWorker-only jobがinstallしていないことが原因で、
復旧のassertion開始前に止まった。両依存をinstall済みのアプリjobへcombined試験を
移し、Business/Auth試験はWorker jobに保持する。remote復旧資源は未作成。

検索・お気に入りの4既知不具合は、修正・CI・staging配備・rollback/retry・cleanup・
独立readbackまで完了。sourceの4関数とtargetの経路/差異/証拠をobject mapと
source-runtime-reviewへ対応付けた。これで六項目のうち一項目全体を閉じたとは扱わない。

次は上記1の残る関数/indexと明示した契約差、上記4の運用条件を閉じる。必要な外部設定は3で
   一括して扱い、コード確認の途中で同じ依頼を繰り返さない。

2026-10-03 04:12Zの最新source catalogは58定義/37binding/77policyと両fingerprintが
不変。37bindingの対応先を[source trigger counterparts](source-trigger-counterparts.md)
へ列挙し、plan権限の2triggerとNOTICEのみのsecurity triggerの実処理を照合した。
既存の本人profile10ケースは全25 Business/4 Auth・実FK・実session/R2で通過し、
通常CIへ組み込み、7a603bdのCI37096588121は両job成功。
29 timestamp bindingは現行アプリの対応照合を完了した。62 UPDATE候補と
UPSERT/動的SQL、25 Business migration適用後のクーポン・招待消費triggerの
書き込みを確認し、業務更新での日時設定欠落は見つからなかった。移送履歴の日時、
Masterの変更なし操作、内部claimのみの更新では、sourceとの意図した差を記録した。
これは任意の直接D1更新や未知の旧consumerの互換性、最終schema移送・復旧の
受け入れを証明しない。残る関数/権限・indexの照合は未完了で、上記1全体は開いたまま。

追加でusername/role/admin/elevated-adminの4定義を現行callerと既存検証へ
対応付けた。sourceの上位管理者判定は、該当行がないSELECTのNULLにより拒否分岐を
通り抜け得る。実データ・保存関数を使わないPostgreSQLの5ケースで式を確認し、
targetでは既存のwaitlist9ケースが非admin/設定なしを拒否していることを照合した。
target管理者roleはplanとは独立し、実管理者の対応付け・運用権限の保管は未完了。
通知wake/sleep3定義と既存のstaging受け入れの対応、管理データresetの有効化・
API/browser受け入れも古い対応表へ反映した。後続processor変更、provider、運用、
最終統合の条件は残す。この文書の更新だけで六項目のいずれか全体を閉じない。

現在の実行・配備の詳細は[HANDOFF](HANDOFF.md)と[EXECUTION](EXECUTION.md)、
関数/RLS/callerの照合は[source runtime](source-runtime-review.md)、
[source authorization](source-authorization-review.md)、
[object map](object-map.md)、[frontend callsites](frontend-callsite-map.md)を参照する。

2026-10-03の[source policy counterparts](source-policy-counterparts.md)で77policyの
対応先・元式hash・所有者/管理者/内部処理条件を40表ごとに明示した。既存画面に
直接callerのない行APIを増やさず、通知preferencesの内部参照、Enterpriseの管理
操作、Auth D1のロール/MFAへの置換を確認した。未対応の旧行APIは不使用と断定せず
外部consumerの扱いを残す。選択済みreference releaseの公開DTOはinactiveな
pattern/priceを含む既存契約で、sourceのactive限定policyとの差を確認した。
当時の公開可否の差と歴史的所有者のanalytics範囲、残る関数/indexにより、項目1
全体を完了にはしない。combined recovery candidate0019568のCI37100329703は
両job成功を確認済み。稼働Workerは引き続きc09/bce8993。

公開inactive行の差は現行candidateで修正した。release全体の整合性確認後に
Tier/pattern/priceのactive行だけを返し、管理・保存データは保持する。言語の全行
公開と公開価格の最小DTO契約は維持する。全行inactiveなら200/空一覧を返すが、
不完全なmanifest/不正なinactive行は拒否する。native API9/client8/release6、
両typecheck/lintが成功。既存activation履歴が2件を超えると正常切替後にも誤って
失敗するhelperの不具合も再現し、既存履歴を保持して1件追加を検証するよう修正。
候補c7b71c6のCI37101502623は両job成功し、Worker70090cdcへ配備した。
公開4マスター4/4/5/16件、JS/CSS一致と保持データの独立readbackが成功。
ただし無効化・復元のstagingテストは管理APIのbaseline503で変更前に停止した。
保持済みMasterのPostgreSQL UTC/旧ISOミリ秒表記を新しいstrict日時readerが
拒否する不具合を修正。snapshot内で精度を保って正規化し、古いreleaseは
書き換えず、不正日付/非UTC/6桁超は拒否する。local API10/10・型・lintは成功。
合成Authと取り残した一時管理者profileは削除し、06:25:49Zの独立readbackで
owned0・Master7888/履歴不変を確認。MFA世代は236から238へ進んだ。
日時修正d234ef8のCI37103506054はWorker成功だが、アプリ側の最初のChrome
起動が2回とも失敗した。画面を開く前の起動だけを1回再試行し、stderr/終了状態を
記録するよう修正。local UI8件と意図した初回起動失敗→実Chrome cold画面の確認が
成功。画面の検証条件は維持する。cbb90c7のCI37105400187は両job成功し、
Worker e0a4b16eへ配備。管理baseline503は解消し、料金の無効化中は公開15件/
管理16件、復元後は公開16件を確認。全Master値/Stripe IDと既存監査履歴を保持し、
reference世代8→10の2件のみ追加。独立07:25:20Z readbackでowned0・emoji7888/
履歴不変・wake17/17・MFA238→240を確認した。これで既知503とremote価格可視性
の受け入れは完了。六項目全体、実providerと運用/最終統合の未完了は残る。
58関数すべてに対応表の行はある。7行の古い設計TODOを既存実装・検証・残る
条件へ更新したが、全体照合完了とは扱わない。Workers Freeを実アカウント
画面で確認済み。有料planの判断とprovider設定は回答待ち。
