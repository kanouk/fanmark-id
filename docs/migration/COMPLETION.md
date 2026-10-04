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
| 1. 移行元・移行先・呼び出し元の照合 | 40表、58関数、37登録trigger、77policyのcatalogと211箇所のfrontend対応表があり、77policy全件のidentity/hash→40表の現行経路・実装・検証への対応表を作成済み。分類reportは全体照合未完了のまま。sequence keyの3候補indexは現行writer/importの契約を照合し、空/NULL配列等の残る差を最後のデータ工程の条件へ明記した。任意外部consumerとfull converterのgateは保持する。 | 各object/actionについて、source定義hash、権限、実行経路、targetまたは不使用の根拠、契約差、対応する検証を結び付ける。未実装の現行経路・未説明の差を残さない。実データでしか判断できない事項はデータ工程へ明示的に移す。 | #30, #33, #34 |
| 2. アプリと認証・業務処理の仕上げ | 多くのsession/権限/競合/失敗時rollbackは受け入れ済み。退会388044b/Worker4a8d85ddはnative66・remote6を受け入れ済み。検索・お気に入りの4既知event/count不整合もbce8993、CI37094750732両job、Workerc09ece05のlocal17・remote4/cleanup/独立readbackで解消済み。取得の通常CI漏れを修正し、既存21と現行25 Business/4 Auth/8 Master・実signin/TOTP/停止・登録の5件（local26/26）を確認した。ただし全画面・実provider・最終統合は未完了。 | 現行画面の必須操作、管理者MFA、登録/password setup/reset、ライセンス取得・返却・移管・抽選・上限・クーポンを統合構成で確認する。現在修正中の既知不具合を解消し、必要な新経路をstagingで確認する。 | #31, #33, #34 |
| 3. 実サービスとのテスト接続 | Stripe、Resend、4 OAuth providerの実接続は未受け入れ。stagingのsecretは3名称のみで、signup/email/providerは閉じている。閉じていることの確認は接続成功の証拠ではない。 | Stripe sandboxのCheckout/Portal/変更/延長/署名Webhook・重複/逆順/再試行、テスト宛先の認証メール、4 providerの開始/callback/初回設定を確認する。Apple relayも含む。必要なprovider資格情報・テスト設定・テスト送信の許可が必要。本番課金・本番宛先送信は行わない。 | #31, #32, #34, #37 |
| 4. ジョブ・運用・復旧 | 通知DOの起動/排出/停止・復旧、期限処理の合成一回実行、archive smoke、Time Travel/R2 replayの個別証拠はある。隔離実Cronでarchive2件/残す2件・履歴payload/FK・cleanupを受け入れ、独立inventoryも一致した。mainの日次有効化と定常運用、archive/retention、CPU/plan適合、秘密管理/最小権限を含む運用全体は未受け入れ。 | 起動条件/周期/再開/監視、保存期間、担当と権限、秘密の保管・交換、停止時間/復旧時間目標を確定し、合成障害から復旧を実測する。測定で有料planが必要なら設定前に明示する。 | #30, #34, #37 |
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

2026-10-04、Tier Cの公開/保護参照をcode0e86688/CI37130360266両job成功、
Workerbddc0dadで受け入れた。合成2 accountの無期限short/emoji一致、本人settingsでの
password設定、locked投影の秘匿、誤password拒否、正しいemoji proof/内容取得、
別selector拒否、grace失効・有限期限拒否が成功。合成行を削除し、独立00:01:53.330Z
readbackで業務/Auth非マスター行0、Master/料金/履歴保持・reference世代10/new activation0・
wake17/17・MFA世代保持を確認。[証拠](evidence/tier-c-public-access-2026-10-04.json)。
local public15/registration26/protected13成功。0e CIはregistration26/protected13を実行。
専用public15が通常CIから漏れていたので、test:api-contracts-d1へ追加した。
このCI補強はruntime変更ではなく、受入済みruntimeの同じremote試験を再実行しない。
項目2全体とprovider/定常運用/最終統合は未完了。

画像参照の差を閉じた。`6a1870a`/CI37118191381両job成功後、実stagingの
Worker51db2c90へ反映し、合成画像の編集・公開表示、変更なし保存、既存key削除を
実API/Chromeで受け入れた。合成2 account/2画像は削除済み。独立11:15:19.120Z
readbackで業務/Authの非マスター行0、Master/履歴/料金値保持、wake17/17・MFA240を
確認した。[画像URL対応と証拠](storage-image-url-mapping.md)。実スマホは未確認。

取得APIの通常CI漏れを修正した。既存21回帰を保持し、現行25 Business/4 Auth/8 Master、
実signin、管理者TOTP/停止、canonical ID/順序/お気に入り連携とS/A/C取得の5件を追加。
local26/26・Worker typecheck/変更箇所lint成功。`a2d09dd`/CI37120631839両job成功、Worker logで26件の実行を確認した。
[取得API](fanmark-registration-api.md)と[sequence契約](source-sequence-key-review.md)。
現行writer/importの3index対応を照合し、空/NULL・array shape・衝突等は最後の
ユーザーデータ工程の事前確認へ明記した。generic converterはdeployable=falseを維持する。

通知read3関数・waitlist2関数のsource hash/現行経路/既存受入を照合し、対応表の古い
未実装に見える記載を更新した。legacy toggleの非使用と外部consumer境界も明記した。
イベント生成のsource/target対応を照合した。隔離実Cron→archiveは2件の履歴移送/残す2件/FK/cleanup/独立inventoryを受け入れ済みで、同じ検証を再実行しない。mainの日次有効化と運用条件は残る。
provider設定は項目3で一括して扱う。catalog classifierの54 pendingは、
既存の手動レビューと受入を自動取込みしていない数であり、54件が未実装という意味ではない。
対応表だけでfull-source gateを解除しない。

現行実行・過去の失敗/修正の経緯は[HANDOFF](HANDOFF.md)と[EXECUTION](EXECUTION.md)。
照合は[source runtime](source-runtime-review.md)、[source authorization](source-authorization-review.md)、
[object map](object-map.md)、[frontend callsites](frontend-callsite-map.md)、
[trigger counterparts](source-trigger-counterparts.md)、[policy counterparts](source-policy-counterparts.md)を参照する。

直前のdocs head `e3d5615`/CI37121269163はWorker成功・application失敗。
actual local Workerのeditor試験でCDP protocol拒否が起きた。手元は成功したが
原因は未再現で、method/code/固定kindのみの診断を追加した次HEADで調べる。
取得APIの`a2d09dd`/CI37120631839両job成功とstaging runtime受入は保持する。
診断追加自体を既知不具合の解消や全体CI成功とは扱わない。

診断追加`dae2a70`/CI37123979783はcompleted/success、application/Worker両job成功。
前回のCDP拒否は今回再現せず、エラーを無視する変更はしていない。
実Cronのarchive受け入れは
[evidence](evidence/isolated-notification-archive-cron-2026-10-03.json)に固定した。
providerの設定場所/テスト宛先への送信許可と、Workers Paidの判断は入力待ち。
これらの待ちを合成fixtureや同じ検証の反復で埋めない。

`e68e6e8`/CI37124843575はWorker成功・application失敗。CDP診断から
continueRequestの無効interception IDを確認した。同じ通信のChrome取消しreceiptを
確認するhelperと、実Chromeのpause/abort再現を追加しlocal成功。Linux CIは次HEAD待ち。
元の失敗時の取消しreceiptは未保存で、断定しない。未知のprotocol拒否は失敗を保持する。
