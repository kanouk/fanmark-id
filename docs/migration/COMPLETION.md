# ユーザーデータ・ドメイン移行前の完了判定

2026-10-05 JST。親Issue #28と#30–#37の現行本文、現在の実装・受け入れ記録を
照合した残件表。作業時間やテスト件数を進捗率に換算しない。
stagingの機能別受け入れは進んでいるが、以下の全条件はまだ成立していない。

## 最新チェックポイント（2026-10-05 JST）

現行runtime `0ed4213` / CI37298341592両job成功 / 100% Worker
`b3a770b3-8735-4b31-abdd-f4fca99e05cd`。指定先で実登録・確認受信・
emailVerified・本人の再設定・変更後のメール/パスワードログインまで確認した。
Safariの実ダッシュボード・表示アカウントと、正確な検証userに属する再設定後の
有効session1件が一致する。[メール認証経路](evidence/staging-email-password-login-2026-10-05.json)。
旧2 user/6 account/session1を保持し、メール検証accountを含む現在は3/7/2。
確認済み認証経路を「Resend未設定」「再設定待ち」に戻して扱わない。
検証account/session cleanupは未受け入れで、無断削除しない。

今回の読み取り専用preflightでは通知/Stripe滞留・失敗・lease超過・FK違反は0、
wake17/17、期限/graceの期限超過とarchive対象は0。Master履歴と元account保持も
独立確認した。[現在の限定観測](evidence/staging-current-operations-readback-2026-10-05.json)。
これは空のキューでの健全性であり、全アプリ/実端末/自然archiveの証拠ではない。

日次Cronの秒ずれを許容し、両jobとhandlerを照合する読み取り専用observerを用意した。
自然発火は10月6日09:00 JSTの受信・最終version照合まで未受け入れ。
observer6448be6のCI37323113576は両job成功。画面操作接続が回復し、
独立したSafari通常windowの合成Free ownerで検索・Sティア取得・設定への遷移、
伝言板/名前の保存・一覧1/3と7日の表示・設定再読込・公開本文表示を確認した。
未保存下書きは同じtabのreloadで復元し、公開APIには保存前の本文が残ることと、
復元後の保存で更新されることを匿名で照合した。UI logoutと所有fixture cleanup後、
別processで既存3/7/2・プロフィール・Master履歴/MFA/wake17/17・FK0を確認した。
匿名検索は削除せず3候補/6eventを保持し、削除した合成fanmarkへのpointerだけ解除した。
これは取得/伝言板/設定/下書きの限定UI受け入れで、延長・上限・有料退会等は残る。
[画面と独立照合](evidence/staging-acquisition-settings-ui-2026-10-05.json)。
続く独立合成ownerの延長画面で1か月JPY2,000/10月13日→11月13日を確認し、
実sandbox Checkoutを送信した。Stripe paid/completeと、自然署名dispatchによる
application/effect/audit各1件・11月13日のactive licenseを別processで照合した。
元3/7/2・profile/Master/MFAと元匿名履歴は保持。現在の匿名検索は4候補/7event。
10月6日に復元したSafariで11月13日のactive表示とUI logoutを確認した。
一時journalは失われたためexact合成owner/決済台帳から所有関係を再構成し、
対象Business/Auth行を削除した。独立read-only processで元3/7/2・Master全24表・
profile/MFA/template/wake・匿名履歴4/7保持・FK0を確認した。
中断なしのCheckout復帰時刻とUI単独のexact session失効は未確認のまま。
[復元表示と所有cleanup](evidence/staging-extension-restored-ui-cleanup-2026-10-06.json)。
paid Checkoutは再実行していない。
[延長決済のみの証拠](evidence/staging-extension-ui-payment-only-2026-10-05.json)。
checked-inの有効なパターンルールにも登録拒否/追加課金の効果がないことを
[呼び出し元の制御フロー](source-availability-rule-review.md)で照合した。
無条件の全source/外部caller/不正な履歴JSONの受け入れには換算しない。
10月6日に合成credential/Free accountでプロフィール編集・公開内容、非公開化・再公開、
URL転送の保存/再読込/実browser遷移、inactiveの保存/一覧/準備中表示を確認した。
匿名APIも各状態と一致し、実UI logoutでexact session1→0を確認した。
所有fixture削除後の独立read-only照合で元3/7/2・全24 Master表・profile/MFA/template/wake・
匿名履歴4/7・FK0を保持した。電話実機起動と保護password UIはこの証拠に含めない。
[プロフィール・転送・inactive UI](evidence/staging-profile-redirect-inactive-ui-2026-10-06.json)。
10月6日に本人の免責事項同意後、合成2 accountで実Safariの移管コード発行→受取申請→
所有者承認→受取側再loginを確認した。旧所有者0/3・失効、新所有者1/3・7日・inactiveと、
D1の旧/新license・新basic config・30日lockが一致。通知2件も自然処理でin-app配信済み。
UI logoutで合成session0、所有fixture cleanupと別read-only照合後に元3/7/2・
全24 Master表・profile/MFA/template・匿名履歴4/7・FK0を保持した。
wake17→19/19は正当な通知処理として保持。JA/EN/KO/IDはdashboard表示のみ確認し、
lockのUI拒否・全言語の通し操作・実スマホの受け入れへ拡張しない。
[移管UIと独立cleanup](evidence/staging-transfer-ui-2026-10-06.json)。
f7707b7のCI37388658554は両job成功。
さらに合成クーポンで実UIの1か月延長（10/13→11/13）とD1の処理/usage各1、
同じ所有者の返却/猶予表示、別合成accountの抽選申込→取消/人数1→0とD1の同一entry
pending→cancelledを確認した。抽選実行/当選をこのUI証拠から推定しない。
UI logoutで合成session0、所有fixture cleanup後の別read-only照合で元3/7/2・
全24 Master表・既存クーポン4定義・profile/MFA/template・FK0を保持。
今回の実検索で匿名履歴は5候補/8eventとなり、その全履歴を保持した。wakeは21/21。
[クーポン・返却・抽選申込UI](evidence/staging-coupon-return-lottery-ui-2026-10-06.json)。
六項目は引き続き未完了で、ユーザーデータ/DNS工程を前倒ししない。
下の過去の観測値は上記の最新チェックポイントに読み替える。

## 今回の到達点

Workersのアプリ/API、分離D1、R2、認証、定常ジョブ、非ユーザー系マスター、
合成データによる移送・統合・復旧を検証し、実ユーザーデータ移送と公開ドメイン
切替に進める状態を作る。実ユーザーのexport/import、既存認証情報・Storageの
実移送、DNS変更、Supabase本番writerの停止・旧基盤終了は今回実行しない。
実ユーザーでしか証明できない行同一性・既存provider主体との対応は、最後の
データ工程の条件として明示する。合成検証の合格から推定して完了にしない。

2026-10-06 JSTの読み取り専用照合では、共通Resend key/fromと認証メール設定は有効、
告知bulk/test-send・固定宛先・告知署名secretは未設定。28 template contentは基準一致、
告知関連6集計とpending email/Web Pushは0件だった。
[告知の限定readback](evidence/staging-broadcast-readonly-preflight-2026-10-06.json)。
認証メールの成功から告知provider受け入れを推定しない。宛先限定の告知検証準備と
実送信、署名配送・retry/retentionは残る。移行元通知processorも即時in-app以外はpendingに
するため、別consumerの不在を断定せず、移行を理由に未確認の新規配信機能を追加しない。

2026-10-06 JSTに本番Edge35件を個別downloadし、前後のversion/name/status/JWT metadata一致と
61 file occurrenceを照合した。31 entrypointはcheckoutと同一、課金準備3件と手動失効1件は
差分を分類した。登録version316のルール消費分析は本番bodyへ結び付いた。告知の
旧admin helperはroleのみで、targetのMFA/admin planは明示した認可変更として扱う。
[本番Edge bodyと差分](source-edge-bodies-review.md)。SQL/RLS/trigger全体や外部callerの
受け入れは推定せず、六項目は引き続きopen。

## 完了までに閉じる六つの作業

| 作業 | 現在の証拠と不足 | 今回の完了条件 | 対応Issue |
| --- | --- | --- | --- |
| 1. 移行元・移行先・呼び出し元の照合 | 40表、58関数、37登録trigger、77policyのcatalogと211箇所のfrontend対応表があり、77policy全件のidentity/hash→40表の現行経路・実装・検証への対応表を作成済み。分類reportは全体照合未完了のまま。sequence keyの3候補indexは現行writer/importの契約を照合し、空/NULL配列等の残る差を最後のデータ工程の条件へ明記した。任意外部consumerとfull converterのgateは保持する。 | 各object/actionについて、source定義hash、権限、実行経路、targetまたは不使用の根拠、契約差、対応する検証を結び付ける。未実装の現行経路・未説明の差を残さない。実データでしか判断できない事項はデータ工程へ明示的に移す。 | #30, #33, #34 |
| 2. アプリと認証・業務処理の仕上げ | 多くのsession/権限/競合/失敗時rollbackは受け入れ済み。退会388044b/Worker4a8d85ddはnative66・remote6を受け入れ済み。検索・お気に入りの4既知event/count不整合もbce8993、CI37094750732両job、Workerc09ece05のlocal17・remote4/cleanup/独立readbackで解消済み。取得の通常CI漏れを修正し、既存21と現行25 Business/4 Auth/8 Master・実signin/TOTP/停止・登録の5件（local26/26）を確認した。ただし全画面・実provider・最終統合は未完了。 | 現行画面の必須操作、管理者MFA、登録/password setup/reset、ライセンス取得・返却・移管・抽選・上限・クーポンを統合構成で確認する。現在修正中の既知不具合を解消し、必要な新経路をstagingで確認する。 | #31, #33, #34 |
| 3. 実サービスとのテスト接続 | GitHubは0fb4976/CI37180854336両job・Worker07bf9d61で実callback/provisioning/初回password保存/logout/session失効/同一identity再loginを受け入れた。Googleのcallback保存・既存資格情報のstaging保存とGoogle/GitHub capabilitiesはWorker8bb6b4d9で確認済み。Googleも実callback/provisioning/本人の初回password保存/logout/session失効/同一identity再loginを受け入れた。DiscordもWorkerfa4ef348で実callbackによる既存Google userへの連携・session失効・同一identity再loginを受け入れた。新規Discord user作成/初回設定は未確認。Appleは本人の契約同意・callback追加許可後に本番設定を保持してstaging URLを保存し、Vaultの既存鍵で更新した90日有効なsecretを保存した。初回実callbackのorigin拒否を限定修正し、7e6cf76/CI37192167542両job成功後のWorker495b3ce4でremote form POSTとstate拒否を確認した。実Apple callbackで既存Google userへの連携とsession失効・同一account再ログインを確認した。Apple新規user/初回設定/relayは未受け入れ。Stripeはtest料金19件・専用10 event Webhook（testのみ有効）・test default Portalを作成し、test key/署名secretをstagingへ保存した。Business test Price/modeとMasterのprivate test Price派生版を照合済み。87b61ef/CI37200812928両job成功・Workerca971193でtest Checkout→Creator、Portal支払い確定→Business、Free即時解約→署名反映、重複単一適用・処理済みeventの逆順再送・自然retryと専用合成userのcleanupを確認した。同じWorkerで実登録→Sティア1か月JPY2,000延長、拒否時未延長、3DS成功、実署名自然処理とdelivery2/効果各1・cleanupの独立照合も受け入れた。定期請求の実拒否/past_due、未受信の古い成功eventをdelivery1で初回逆順配送して失敗状態を維持、成功支払いからBusiness/activeと失敗状態クリア、解約/cleanup・独立保持照合も受け入れた。定期請求の実payment_action_required投影、保存済みカードのhosted3DS完了、同じInvoice/PaymentIntentの成功復旧・独立cleanupも受け入れた。12fa13f/Workercc6d9da7で同一合成userの実signin/プラン選択/Checkout→Creator/Portal支払い→Business/警告確認→Free/logoutと独立cleanupを受け入れた。license/延長/上限超過選択/有料退会を含む全UIは未受け入れ。Resendの実登録・メール確認・再設定・変更後のログインは上記の限定証拠で受け入れ済み。検証account cleanupは残る。Apple/Discord/GitHub/Googleを公開する。 | Stripe sandboxのCheckout/Portal/変更/延長/署名Webhook・重複/逆順/再試行、テスト宛先の認証メール、4 providerの開始/callback/初回設定を確認する。Apple relayも含む。必要なprovider資格情報・テスト設定・テスト送信の許可が必要。本番課金・本番宛先送信は行わない。 | #31, #32, #34, #37 |
| 4. ジョブ・運用・復旧 | 通知DOの起動/排出/停止・復旧、期限処理の合成一回実行、archive smoke、Time Travel/R2 replayの個別証拠はある。隔離実Cronでarchive2件/残す2件・履歴payload/FK・cleanupを受け入れ、独立inventoryも一致した。mainの日次expiry/archive・Paid/CPU30,000msは有効化・配備/readback済みで、2026-10-05 09:00:15 JSTの自然expiry/graceは対象0/競合0・完了台帳を確認した。監視の秒完全一致が日次ログを取りこぼし、main archive/handler全体の自然実行結果は未受け入れ。監視専用tokenを二つのRead権限・対象account限定・期限11/4で発行し、Macキーチェーン保管と専用CLIの実readを受け入れた。新規一時D1のSELECT成功・非ゼロINSERT認可拒否・同一SQLの配備権限positive controlを確認し、所有D1の削除と独立inventory一致も受け入れた。定期監視/秘密運用全体/retention/担当/RPO-RTOと最終運用は未受け入れ。 | 起動条件/周期/再開/監視、保存期間、担当と権限、秘密の保管・交換、停止時間/復旧時間目標を確定し、合成障害から復旧を実測する。測定で有料planが必要なら設定前に明示する。 | #30, #34, #37 |
| 5. 移送器の合成データ受け入れ | 現行25 Business/4 Auth、8 Master＋保持する旧Auth core、分離したavatar/cover R2で、同じbundleの合成40表/15行・マスター・2画像を別incarnationへ復旧した。source hash/型/閲覧password/画像参照・bytes/MIMEと通知wakeの単発性を照合。local復旧10182ms。プロフィールを後から取り込むとpassword世代照合が失敗する不具合をcodec v5の順序制御で修正し、専用試験コマンドを追加。通常CIに実行stepがないことを今回確認し、Business/Auth・combined復旧の明示stepを追加。復旧先画像の冗長bucket prefixによる実Storage API404を再現・修正し、primary/別incarnationのGET/HEAD・bytes/MIME/size一致を確認。fresh local復旧10812ms。隔離D1 REST経路はnative9件に加え、1d3085f/CI37108741104両job成功後の実APIで値・rollback・応答破棄後の非自動再送を確認し、所有した一時D1削除/既存3件inventory一致を受け入れた。共通fixture生成と一式remote conductorを準備し、HTTP R2経路のnative6件（import/replay・競合・実Storage GET/HEAD・所有key cleanup）と共通化後combined1件が成功。2cbf4e0/CI37115000097両job成功後、一式remoteの2 targetで40表/15行（非空9表）・Master・2画像・source hash/count・FK/wake・中断再開が成功。新規targetの合成復旧90726msで本番RTOではない。所有した全資源を削除し、独立10:18:30.138Z inventory一致を受け入れた。Authはseedした合成依存userでcredential backup証拠ではない。画像参照のDTO対応と変更なし保存・既存key削除は6a1870a/CI37118191381両job成功後、実stagingのWorker51db2c90でAPI・実Chromeの編集/公開画像decode・cleanup・独立readbackを受け入れた。RTO/運用・最終統合は残る。2026-10-05には保存済みsource catalogと現行v43/25 Business/4 Authで40 checkpoint/13合成行のimport・resume・fresh local restore（69056ms）・単一wakeと改変拒否を確認した。このlocal runにMaster/R2・実Auth credential backupは含まない。4c2a8c5/CI37246478014両job成功後、現行25/4/8と分離R2の一式remote復旧を二つの新規targetで通し、40表/15合成行・Master fixture3 emoji/4 tier・2画像・中断再開・GET/HEAD・FK/wake・96988msとcleanup/独立inventory一致を確認した。既存2/6/1・Master履歴/MFA/wakeと匿名検索2/5も保持。これは全Masterや実Auth資格情報のbackupではない。source schema converterは4 blocking groups/deployable=false。実ユーザーデータは読み出して移送しない。 | 最終schemaと運用構成で合成snapshotの中断・再開・照合・復旧を通し、未説明差分0と所要時間を記録する。個別の旧schema検証から最終構成の成立を推定しない。 | #35, #37 |
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

現行候補4c2a8c5/CI37246478014両job成功後の隔離一式remote復旧は、
二つの物理target/40表15行/Master fixture/分離R2・中断再開と独立cleanupを受け入れた。
[現行候補の限定証拠](evidence/isolated-combined-recovery-2026-10-05.json)。
既存アカウント・マスター全履歴・MFA/wakeと匿名検索2/5は保持。実スマホ・
provider残件・全UI・main archive自然実行・運用条件は引き続き未完了。

2026-10-05 08:39–08:40 JSTの最新source metadataで、40表/406列/144制約/139index、
58関数/37binding/77policy、locale/regex probeとsource Cron設定の前回一致を確認した。
現行手動対応表の58関数hash・77policyのidentity/command/role/hash・37bindingの
identity/function/hash prefixも一致した。[最新source照合](evidence/source-current-readonly-refresh-2026-10-05.json)。
これはsource行の移送や全意味論の受け入れではなく、converterの4 blocking groupsと
全体false gateは維持する。Chromeのnative操作接続は初期化失敗、in-appは使用可能。
中断したv4 UI fixtureは登録/決済前に削除し、独立readbackで元の2/6/1とMaster/MFA/wakeを保持した。
CI674d0dd/37245109681は両job成功。09:00:15 JSTのexpiry/grace完了台帳と、
毎分の自然実行okを確認した。日次ログの秒完全一致filterによる取りこぼしのため
archive/handler全体は未受け入れ。[日次の限定証拠](evidence/main-natural-lifecycle-ledger-2026-10-05.json)。
元の2/6/1とMaster/MFA/wakeは保持。匿名検索2候補/5イベントの追加は所有者不明のまま保持する。
Resendログイン、画面操作接続の復旧、archive自然実行・運用と最終統合は残る。

2026-10-04の実Chrome Freeログイン後に`/plans`の設定503を発見し、private Stripe価格IDを
公開設定読取から除外する修正を`12fa13f`/CI37208535583両job成功後に配備した。
現在の100% Workerは`cc6d9da7-b81b-45fe-b0be-6c0978570232`。公開設定は200/exact11/価格IDなし、
匿名管理設定401と元の2/6/1・Master全履歴/MFA/wake・他設定の保持を確認した。
2026-10-05のMac解除後、旧JSを通常reloadで更新した実`/plans`の表示を確認した。
別Chromeの合成ownerで実signin/Checkout→Creator/Portal支払い→Business/Free/logoutを確認し、
自然署名反映・所有fixture cleanupと元の2/6/1・Master/MFA/wakeの独立保持照合が成功した。
[同一利用者の実購読画面](evidence/stripe-staging-subscription-ui-2026-10-05.json)。
license/延長/上限超過選択/有料退会を含む全UIは未受け入れ。以下は過去checkpoint。
[設定修正と境界](evidence/plan-settings-public-projection-2026-10-04.json)。


過去のruntime candidateは`87b61ef`、CI37200812928は両job成功、100% Workerは
`ca971193-b17b-4a44-9991-76ab6eb7f20c`。Stripe test-only接続・Portalの空POST修正を
反映した。元の本人管理2 user/6 account/session1、Masterの全履歴・MFA/wakeを
保持し、専用合成fixtureのcleanupと別processのread-only readbackを確認した。
[Stripe実サービス証拠](evidence/stripe-staging-real-provider-2026-10-04.json)。

GitHub/Googleの実callback/provisioning/初回password保存/session失効/同一identity
再loginを受け入れ済み。Discord/Appleは既存Google userへの実連携とlogout/reloginを
確認した。両providerの新規user/初回設定、Apple relayは残る。Stripeは実Checkout→
Creator、Portal支払い確定→Business、アプリFree即時解約→署名反映、重複単一適用・
処理済みevent逆順再送・自然retryを確認した。同じWorkerで実取得→Sティアの
1か月JPY2,000延長、拒否時未延長、3DS成功、実署名自然処理、再送delivery2/
効果各1と独立cleanup・元状態保持を確認した。
[実延長の証拠](evidence/stripe-staging-extension-provider-2026-10-04.json)。
定期請求の実失敗、古い成功eventの初回逆順配送で現在の失敗を保持、成功復旧・解約/cleanupと独立保持照合を確認した。
[定期請求の証拠](evidence/stripe-staging-invoice-provider-2026-10-04.json)。
定期請求の追加認証待ちとhosted3DS・同じInvoice/PaymentIntentの復旧、独立cleanupも確認した。
[追加認証の証拠](evidence/stripe-staging-invoice-authentication-2026-10-04.json)。
同一利用者の購読画面は2026-10-05に受け入れたが、license/延長/上限超過選択/有料退会を
含む全UIは残る。Resendの承認済み宛先・実接続も残る。

専用monitor tokenのscope/Keychain/readに加え、所有した一時D1で非ゼロINSERTの
拒否・保存0、配備権限の同一INSERT positive control、後片付けの独立照合を確認した。
[実書込み拒否](evidence/staging-monitor-write-denial-2026-10-04.json)。
定期運用・秘密更新の全体は未受け入れ。main日次Cronは登録/有効化済みだが、
次回2026-10-05 09:00 JSTの自然発火・処理結果は未確認。
運用担当/権限/秘密保管/保存期間/RPO-RTOと、同じ最終candidateの実スマホ・言語・
旧PWA更新・provider/ジョブ/復旧の統合は残る。

source照合は58関数/37binding/77policy/40表/211 frontend callsiteの対応を結び付けた。
classifierの54 pendingは手動counterpartの受け入れを取り込んでいない数で、54件の
未実装を意味しない。一方、fullRuntimeReconciled/converterDeployableはfalseを保持し、
未説明差や実データでしか確認できない事項を完了扱いにしない。
[現行converterと合成取り込み](evidence/schema-current-preparation-2026-10-05.json)では、保存済みsource metadataに対するv43の4 blocking groupsと現行targetのlocal復旧を確認した。最新source readや全converterの受け入れには換算しない。
[source runtime](source-runtime-review.md)、[source authorization](source-authorization-review.md)、
[object map](object-map.md)、[frontend callsites](frontend-callsite-map.md)、
[trigger counterparts](source-trigger-counterparts.md)、[policy counterparts](source-policy-counterparts.md)を参照する。
過去の失敗/修正・個別受け入れは[HANDOFF](HANDOFF.md)と[EXECUTION](EXECUTION.md)へ残す。
