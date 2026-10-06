# ユーザーデータ・ドメイン移行前の完了判定

2026-10-06 JST。親Issue #28と#30–#37の現行本文、現在の実装・受け入れ記録を
照合した残件表。作業時間やテスト件数を進捗率に換算しない。
stagingの機能別受け入れは進んでいるが、以下の全条件はまだ成立していない。

## 保存ファイルから実D1・R2へ一式復旧を受け入れ（2026-10-06 JST）

候補dcb0127のCI37410960675は両job成功。同じ保存bundle v2から別incarnationの
2組の新規3 D1・2 R2・専用Workerへ、全Master25表/12,254行/98定義、合成Auth9表/
16行/30定義、業務40表/15行、PNG2件を復旧した。全定義/列hash/FK0、正確な保存
manifest/40 stream、credential commit後の中断再開、R2 import/replay/bytes/MIME/keyが一致。
実routerで3944絵文字と参照Master4/4/5/16、元session/期限内assurance/logout、
password/TOTP/backup消費・再利用拒否/停止拒否、本人profile/3所有一覧/画像GET・HEADを確認。
所要145407ms/105809msは復元・アプリ確認のone-off値で、本番RTOではない。

2組の所有資源をexact receiptで削除。独立04:06:55.383Zの照合で元D1/R2/Worker一覧、
main全表hash/count/FK0、Auth3 user/7 account/2 sessionとWorker8cを保持した。
D1/Workerはread-only監視credential、R2一覧は固定accountを確認したOAuthでGETのみ。
既存DB書込・main配備/secret変更・追加メール・実ユーザー移送・DNS変更は0。[実D1/R2の一式復旧証拠](evidence/full-combined-file-remote-recovery-2026-10-06.json)。

これは合成Auth/業務の復旧受け入れ。運用鍵/交換・off-host/retention・本番失効方針、
source converterの4 blocking groups/deployable=false、残るUI/provider/実端末・六項目の
完了条件は保持する。Mac解除の既存質問は返答待ち。

## 全Master・合成Auth・業務・画像の保存ファイルを一式local復旧（2026-10-06 JST）

e381075の専用Workerのnative5件が通り、通常CIへ追加した。同じAES-GCM保存bundleの
全Master25表/12,254行/98定義・合成Auth9表/16行/30定義、業務40表/15行・PNG2件を
2つの別incarnationのnative D1/R2へ復旧。Master/Authの全定義/列hash/FK0、業務source
stream/credential変換とcommit後中断再開、R2 replay/bytes/MIME/key、単一wake1/0が一致。
実routerから全3944 catalogと業務emoji対応、保存Authのpassword/TOTP/backup再利用拒否/
停止拒否、業務ownerのsignin/profile/3所有一覧/画像GET/HEAD/logoutを確認した。
元の3合成user/4 account/14 Auth行を保持し、業務ownerの合成user/account2行を追加した
fixtureであり、実ユーザーidentity移送を受け入れたとは扱わない。保存manifestと40 streamは
正確なbytesから復元し再exportしない。所要108759ms/105409msは本番RTOではない。

独立read-only照合で元archiveとmain全表hash・Auth3/7/2・FK0・Worker8cを保持。
remote write/資源作成/実ユーザー移送/DNS変更は0。
[限定native証拠](evidence/full-combined-file-native-recovery-2026-10-06.json)。
CI37410033281は両job成功。実D1/R2一式復旧は上記の後続工程で受け入れた。
運用採用/失効方針と残る全UI/provider/実端末・六項目は未完了。

## 合成Authの保存ファイルから実D1と専用Workerへ復旧（2026-10-06 JST）

159f5c1のCI37407917794は両job成功。元runtime終了後のAES-GCM保存ファイルを
新規の隔離D1へ復旧し、全9非空表/14行/30 schema object・全列/hash・FK0が一致。
既存targetはSQL前に拒否した。専用Workerの正確なD1 UUID、origin/incarnation、
binding/secret名、100% versionを確認後、元のsessionと期限内の同factor assurance、
logout/旧cookie失効、元password/TOTPでの再login、backup code消費/再利用拒否、
誤password/未確認email/停止user拒否を実router/SDKで確認した。signup/MFA登録/
退会/汎用SQL経路は閉じた。復旧＋target全件照合1144msは本番RTOではない。

保存ファイルを保持し、一時D1とWorkerをexact receiptで削除。別read-only processの
03:24:35.917Z照合で元3 DB/Worker inventory、全Business/Auth/Master表hash、FK0、
元Auth3/7/2と稼働Worker8cを保持した。既存DBへの書込・main配備/secret変更・
追加メール・実ユーザー移送・DNS変更は0。
[限定証拠](evidence/synthetic-auth-file-remote-recovery-2026-10-06.json)。

全Masterと全合成Authの個別remote復旧は受け入れ済み。実運用の鍵保管/交換・
off-host保存/retention・session/verification失効方針、最終一式復旧は別の残件。
六項目全体は未完了で、実Authユーザー移送を前倒ししない。Mac解除は返答待ち。

## 全Masterの暗号化ファイルから実D1へ復旧（2026-10-06 JST）

補正コード801dc78のCI37405218853は両job成功。保存済みAES-GCMファイルを新規の
隔離D1へ復旧し、25表/12,254行の全件hashと98 schema object（旧MFA trigger6個の
body BEGIN大文字化だけを明示許容）、FK0が一致。実アプリreaderで絵文字3944と
4種の参照Masterを取得した。復旧・target照合27161ms。一時D1を削除し、別の
read-only processで元の3 DB inventory・全Business/Auth/Master表hash・Worker8cを
保持した。[実D1復旧の限定証拠](evidence/full-staging-master-remote-recovery-2026-10-06.json)。

全Masterのremote復旧を未実行扱いに戻さない。atomic本番snapshot、定期/off-host保存、
運用鍵/担当/retention/RPO-RTO、Authの運用失効方針・最終一式統合は残る。
この単位の成功を六項目全体の完了と扱わない。Macのロック解除依頼は返答待ち。

## 合成Auth資格情報の暗号化・ローカル復旧（2026-10-06 JST）

全4 Auth migrationの9表を、合成3 user/4 account、SDKで登録したTOTP/暗号化backup code、
bcrypt password、session/同じfactor assurance・停止/確認状態・verification markerを
含めてAES-GCMのJSON往復後に別local D1へ復旧した。全9表は非空で、全schema/全列と
FK0が一致。実Workerで復旧sessionのMFA→logout/失効、元のpasswordで再ログイン→既存TOTP、
backup code login/再利用拒否、誤password/未確認email/停止user拒否を確認した。
鍵/schema/暗号文の不一致と既存targetはSQL前に拒否し、元のsourceを保持した。
native1/1・typecheck/lint/CI isolation成功。通常WorkerのAuth試験へ追加した。
[合成Auth復旧](synthetic-auth-recovery.md)・[限定証拠](evidence/synthetic-auth-local-recovery-2026-10-06.json)。

現SDKのTOTP/backup codeは一致する`BETTER_AUTH_SECRET`も必要。合成SDK鍵とmemory中の
暗号化鍵の試験は実鍵の保管/交換/復旧を受け入れる証拠ではない。memory中のJSON往復を
durable file/remote backupと呼ばず、保持した旧sessionを本番で再有効化する方針へ
拡張しない。実Authユーザー移送は未実行。runtime/Worker/secret/domain変更は0。
六項目全体・最終一式復旧は未完了のまま。

## 全ステージングMasterの暗号化・ローカル復旧（2026-10-06 JST）

これまでの一式復旧は絵文字3件のMaster fixtureだった。今回はread-only監視credentialで
全Master24アプリ表＋移行台帳の12,254行を取得し、暗号化したファイルから隔離SQLiteと
Miniflare/workerd D1へ復旧した。98 schema object、全表count/hash、FK0が一致し、
改変ciphertextは復旧前に拒否した。実アプリrepositoryでactive絵文字3944と4種の参照
Master（Tier4/language4/pattern5/price16）を取得した。別processのsource照合も一致、
remote writeは0。旧Master Auth表は空を確認し、別Auth D1の資格情報を読み出していない。
[全Master復旧](full-master-recovery.md)・[限定証拠](evidence/full-staging-master-local-recovery-2026-10-06.json)。

これは全Masterの限定ローカル復旧証拠で、atomic本番snapshot・定期保存・
鍵保管/担当・retention/RPO/RTOの採用、実Auth資格情報復旧、最終一式統合は未完了。
複数回readの一致をatomic snapshotと呼ばない。六項目全体は未完了のまま。

## カタログ障害時の更新確認を修正（2026-10-06 JST）

`src/main.tsx`はカタログ取得後にService Workerを登録していたため、取得が失敗・停滞
すると登録・更新確認に到達しなかった。root確認後、取得前に更新確認を開始するよう
修正した。React本体は選択カタログの成功後にのみ描画し、失敗時のエラー/再試行と
別backendへ戻らない契約を保持する。実TSX entrypointを実行する回帰テストは修正前
2成功/3失敗、修正後5成功。通常CIに追加し、typecheck/対象lint/staging build/生成PWA
cache境界/現在のcaller map2件も成功した。

コードb26055eを100% Worker`8cbe1e5f-5e55-4a82-a853-65ec96051db2`へ通常設定で配備した。
配信HTML・main JS・sw.js・旧cache退役scriptのbytes/hashが同じbuildと一致し、全canonical
varsと告知send selector/固定宛先の不在を確認した。`/index.html`は正常な307 `/`への転送
だったため、読取対象をcanonical `/`へ直して照合を完了した。配備は繰り返していない。
別read-only照合で全Auth/Business/Master表の全行hashと元Auth3/7/2・FK0を保持した。
[回帰と配信readback](evidence/startup-update-registration-2026-10-06.json)。

実画面はMacのロック解除待ち。callback/UI実操作、既存端末の旧PWA更新・cache退役は
今回のNode回帰/HTTP照合から受け入れない。前のversionを現在の稼働versionとして使わない。
六項目全体は引き続き未完了。

## 管理者MFAと宛先限定の告知配信（2026-10-06 JST）

専用の合成管理者にAPIで登録したTOTPを使い、実Safariの管理画面で既存factorの
challengeを確認した。パスワードだけではsession/assuranceは0件、誤コードは画面で
拒否され、正コードで管理画面が開いた。同じuser/session/factorのassurance1件をD1で
照合し、実UI logout後はsession/assuranceとも0件。今回の証拠は新規TOTP登録UIの
受け入れには使わない。

本人の宛先・件名・本文を特定した1通の送信許可後、同じ管理画面で正確な日本語の
告知下書きを作成した。固定宛先のtest-sendだけを一時的に有効化し、別の正規MFA
sessionから配備済みAPIへ1回送信した。ResendのDeliveredと正確な宛先・件名・本文、
D1の最小監査1件/message IDが一致した。bulk selector/署名secretと送信UIは無効のまま。
送信UI・一括配送・署名Webhook・retry/retention全体を受け入れたとは扱わない。

rollbackで旧versionへ戻しても管理APIのtest-send設定が残ったため、通常設定を
再配備した。現在の100% Workerは`0d9803af-84c8-4e2f-bd9b-dbb418b2555d`、runtime sourceは
`0ed4213`のまま。独立readbackでbulk/test-send selector・固定宛先・署名secretの不在と
28 templateの内容一致を確認した。合成Auth/Business/draft/audit行と一時資格情報を
削除後、別read-only processで元Auth3/7/2、全Masterと他のAuth/Business表の全行hash、
FK0を保持した。MFA generation240→242は正当な変更として保持し、巻き戻していない。
[画面・1通の配信・独立cleanup](evidence/staging-admin-mfa-broadcast-delivery-2026-10-06.json)。
a26ce6eのCI37398046903は両job成功。過去のversion/「告知未送信」/MFA未確認の記述は
その時点の記録として読む。今回の全体六項目は未完了。

## 以前のチェックポイント（2026-10-05 JST）

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
main日次Cronの自然実行は10月6日09:00:57 JSTに受け入れた。handler outcome ok/例外0、
expiry/grace/archiveの完了・競合0・archive残り0と終了時の100% Worker一致を確認。
独立read-only D1でも同じ時刻のexpiry/grace完了台帳と日次scheduleを確認した。
今回は対象0件の自然発火であり、データを含むarchive payload/retentionの証明へ拡張しない。
[日次自然実行と独立照合](evidence/staging-natural-daily-2026-10-06.json)。
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
このreadbackは1通検証前の記録。宛先限定test-sendの実配信は上記で受け入れた。
署名配送・retry/retention全体は残る。移行元通知processorも即時in-app以外はpendingに
するため、別consumerの不在を断定せず、移行を理由に未確認の新規配信機能を追加しない。

2026-10-06 JSTに本番Edge35件を個別downloadし、前後のversion/name/status/JWT metadata一致と
61 file occurrenceを照合した。31 entrypointはcheckoutと同一、課金準備3件と手動失効1件は
差分を分類した。登録version316のルール消費分析は本番bodyへ結び付いた。告知の
旧admin helperはroleのみで、targetのMFA/admin planは明示した認可変更として扱う。
[本番Edge bodyと差分](source-edge-bodies-review.md)。SQL/RLS/trigger全体や外部callerの
受け入れは推定せず、六項目は引き続きopen。

2026-10-06 JST、実Safariで保護された伝言板の誤入力拒否・入力欄リセット・正しい番号での
本文表示を確認した。絵文字URLも短いIDへ転送後に同じ認証画面で開いた。D1は失敗1、成功2、
short-selector proof2で一致する。別emoji-selectorのUI認証やprotected profile/redirectは
今回の証拠に含めない。Cookieなしのshort/emoji APIは引き続き本文を隠す。
所有fixture cleanup後の独立read-only照合で、元Auth3/7/2・全24 Master表・匿名履歴5/8・
既存アクセス監査/予約/制限bucket・profile/MFA/template/wakeを保持し、FK0。
[保護伝言板の実画面とcleanup](evidence/staging-protected-text-native-ui-2026-10-06.json)。
7988123のCI37391902928は両job成功。六項目の全体判定はopenのまま。

2026-10-06 JST、合成ownerの保護プロフィールで、別の合成ユーザーのSafariから認証画面と
正しい番号でのexact名前/本文表示を確認した。同一licenseを保護URL転送に切り替えると
access世代が進み、再読込時は認証画面へ戻り、正しい番号で設定先へ実転送された。
Cookieなしのshort/emoji APIは内容を隠し、保護public-profileは404。native proofはshort2件で、
別profile-selectorのUIは未確認。所有cleanupと独立readbackで全Master24表・元profile/MFA/
template/wake・匿名履歴5/8・既存アクセス状態・FK0を保持。Auth4/8/3は元human3/7/2と、
次の上限検証用合成account1/1/1を含む。
[保護プロフィール・転送の実画面](evidence/staging-protected-profile-redirect-native-ui-2026-10-06.json)。
da15074のCI37392979553は両job成功。全体の六項目はopenのまま。

2026-10-06 JST、本人承認後に合成accountの単一Creator sandbox申込（JPY1,000/月）を確定。
自然署名反映と再読込後のCreator表示を確認し、実APIで5件取得してFreeへ変更した。
実Safariの5候補/3件選択上限/最終確認/3件保持・2件返却と、Freeの3/3表示を確認。
独立D1照合で同じ選択のactive3/grace2・Free・canceled test subscription・submitted commandと
一致した。自然署名receipt4件がterminalとなり、請求の初期retryは自然attempt2で完了。
FreeのWebhookはactive3件/追加返却0でUI返却を重複していない。logout/所有cleanup後の
独立read-only照合で元Auth3/7/2・全Master24表・profile/MFA/template・全scoped未所有行hash・
匿名履歴5/8・FK0を保持し、wake21→23/23を戻していない。Stripe側の解約済みtest customerと
過去請求は保持。paid退会・Checkout復帰の無中断自動pollingは未受け入れ。
[上限超過選択とFreeへの変更](evidence/staging-populated-plan-limit-native-ui-2026-10-06.json)。
全体の六項目はopenのまま。旧上限選択未確認の記述は過去のcheckpoint。

2026-10-06 JST、合成3 accountの実登録→返却→2人の抽選申込APIからfixtureを作成し、
所有licenseの締切だけを前倒しした。現行配備sourceと一致するloopback Wranglerの
scheduled handlerをremote staging D1に対して1回実行し、候補1/競合0・旧license失効・
当選1/落選1・2人の履歴/seedと新active license1を確認した。main自然Cronの有データ
受け入れとは分ける。実配備Auth POSTから通知DOが起動し、outbox6件処理/通知4件配信。
実Safariの当選側1/3と🧷有効、落選側0/3、期限付き当選通知/応募総数2の落選通知、
当選通知の既読保存と両者logoutを確認した。所有fixture/3 Auth account/一回実行台帳の
cleanup後に別read-only processで元Auth3/7/2・全Master24表・profile/MFA/template・
匿名履歴5/8・元lifecycle/access状態・未所有scoped行hash/FK0を保持した。
wake23→29/29を維持。Worker/config/main Cronは変更せず、local devと検証tabは終了。
[抽選結果の実画面とcleanup](evidence/staging-lottery-result-native-ui-2026-10-06.json)。
a36b94aのCI37395116307は両job成功。抽選結果UIのこの限定経路は受け入れ済み。
六項目全体・有料退会・管理者MFA登録UIを含む最終統合は未完了のまま。

2026-10-06 JST、frontendの現行ASTは211呼出だが、認証/profile/resetの16参照行が
古い対応表から移動していた。資料同士だけのCI照合を、現行ASTの位置・操作・対象・
動的式の照合へ拡張し、古い資料での失敗を確認してから全211の対応表を更新した。
操作・対象・動的式の差は0、意味対応は全件各1、focused mapping2/2・抽出fixture suite成功。
[現行callerへの接続](evidence/current-frontend-callsite-refresh-2026-10-06.json)。
これは静的に抽出したcallerの証拠接続で、未知の間接alias/外部caller/全source意味論を
完了とはしない。runtime/DB/deployは変更せず、六項目は引き続きopen。

2026-10-06 JST、最後の実データ工程向けに`identity-readiness.sql`を準備した。
3つのunique index対象に加え、同じ厳格な配列importerを持つevent表もshape検査する。
空/NULL/NULL要素/多次元/配列位置の問題とcanonical重複・追加display一意性を件数のみで
返す。favoriteの別ownerとeventの反復は拒否せず、履歴の順序/反復/6個以上の長さを保つ。
同じSQLをPostgreSQLの合成VALUESだけで実行し、正常8行と問題16行の集計・停止を確認。
実importerでも全4表の保持/拒否を確認しfocused13件・lint成功。実テーブル版は未実行で、
userdata移送を開始していない。[準備と範囲](evidence/deferred-identity-preflight-preparation-2026-10-06.json)。
5ba5f5fのCI37396865202は両job成功。52790bfのCI37396416191は後続更新によりcancelled。
4つのgeneric converter groupと全source意味論・運用・最終統合は未完了のまま。

## 完了までに閉じる六つの作業

バックアップ運用について、受け入れ済みのsource暗号化/R2 canary/現行schemaの一式復旧と、
未採用の担当・鍵・off-host定期保存・retention・RPO/RTO・Auth失効方針を
[運用監査](backup-operations.md)に分けた。合成復旧の再試験を運用採用の代わりにしない。

| 作業 | 現在の証拠と不足 | 今回の完了条件 | 対応Issue |
| --- | --- | --- | --- |
| 1. 移行元・移行先・呼び出し元の照合 | 40表、58関数、37登録trigger、77policyのcatalogと211箇所のfrontend対応表があり、77policy全件のidentity/hash→40表の現行経路・実装・検証への対応表を作成済み。分類reportは全体照合未完了のまま。sequence keyの3候補indexは現行writer/importの契約を照合し、空/NULL配列等の残る差を最後のデータ工程の条件へ明記した。任意外部consumerとfull converterのgateは保持する。 | 各object/actionについて、source定義hash、権限、実行経路、targetまたは不使用の根拠、契約差、対応する検証を結び付ける。未実装の現行経路・未説明の差を残さない。実データでしか判断できない事項はデータ工程へ明示的に移す。 | #30, #33, #34 |
| 2. アプリと認証・業務処理の仕上げ | 多くのsession/権限/競合/失敗時rollbackは受け入れ済み。退会388044b/Worker4a8d85ddはnative66・remote6を受け入れ済み。検索・お気に入りの4既知event/count不整合もbce8993、CI37094750732両job、Workerc09ece05のlocal17・remote4/cleanup/独立readbackで解消済み。取得の通常CI漏れを修正し、既存21と現行25 Business/4 Auth/8 Master・実signin/TOTP/停止・登録の5件（local26/26）を確認した。新規管理者MFA登録UIも本人のSafari操作後、verified factor・同一session assurance・logout失効・合成cleanupと既存全表hash/FK0保持で受け入れた。[限定証拠](evidence/staging-admin-mfa-enrollment-native-2026-10-06.json)。有料退会も実Safari、Stripe test解約、Tier C返却、Auth cascade、署名解約通知の修正配備/実Cron完了、exact-owned cleanup/独立保持照合を受け入れた。[限定証拠](evidence/staging-native-paid-deletion-accepted-2026-10-06.json)。全画面・実provider・最終統合は未完了。 | 現行画面の必須操作、管理者MFA、登録/password setup/reset、ライセンス取得・返却・移管・抽選・上限・クーポンを統合構成で確認する。現在修正中の既知不具合を解消し、必要な新経路をstagingで確認する。 | #31, #33, #34 |
| 3. 実サービスとのテスト接続 | GitHubは0fb4976/CI37180854336両job・Worker07bf9d61で実callback/provisioning/初回password保存/logout/session失効/同一identity再loginを受け入れた。Googleのcallback保存・既存資格情報のstaging保存とGoogle/GitHub capabilitiesはWorker8bb6b4d9で確認済み。Googleも実callback/provisioning/本人の初回password保存/logout/session失効/同一identity再loginを受け入れた。DiscordもWorkerfa4ef348で実callbackによる既存Google userへの連携・session失効・同一identity再loginを受け入れた。新規Discord user作成/初回設定は未確認。Appleは本人の契約同意・callback追加許可後に本番設定を保持してstaging URLを保存し、Vaultの既存鍵で更新した90日有効なsecretを保存した。初回実callbackのorigin拒否を限定修正し、7e6cf76/CI37192167542両job成功後のWorker495b3ce4でremote form POSTとstate拒否を確認した。実Apple callbackで既存Google userへの連携とsession失効・同一account再ログインを確認した。Apple新規user/初回設定/relayは未受け入れ。Stripeはtest料金19件・専用10 event Webhook（testのみ有効）・test default Portalを作成し、test key/署名secretをstagingへ保存した。Business test Price/modeとMasterのprivate test Price派生版を照合済み。87b61ef/CI37200812928両job成功・Workerca971193でtest Checkout→Creator、Portal支払い確定→Business、Free即時解約→署名反映、重複単一適用・処理済みeventの逆順再送・自然retryと専用合成userのcleanupを確認した。同じWorkerで実登録→Sティア1か月JPY2,000延長、拒否時未延長、3DS成功、実署名自然処理とdelivery2/効果各1・cleanupの独立照合も受け入れた。定期請求の実拒否/past_due、未受信の古い成功eventをdelivery1で初回逆順配送して失敗状態を維持、成功支払いからBusiness/activeと失敗状態クリア、解約/cleanup・独立保持照合も受け入れた。定期請求の実payment_action_required投影、保存済みカードのhosted3DS完了、同じInvoice/PaymentIntentの成功復旧・独立cleanupも受け入れた。12fa13f/Workercc6d9da7で同一合成userの実signin/プラン選択/Checkout→Creator/Portal支払い→Business/警告確認→Free/logoutと独立cleanupを受け入れた。license/延長/上限超過選択/有料退会を含む全UIは未受け入れ。Resendの実登録・メール確認・再設定・変更後のログインは上記の限定証拠で受け入れ済み。検証account cleanupは残る。Apple/Discord/GitHub/Googleを公開する。 | Stripe sandboxのCheckout/Portal/変更/延長/署名Webhook・重複/逆順/再試行、テスト宛先の認証メール、4 providerの開始/callback/初回設定を確認する。Apple relayも含む。必要なprovider資格情報・テスト設定・テスト送信の許可が必要。本番課金・本番宛先送信は行わない。 | #31, #32, #34, #37 |
| 4. ジョブ・運用・復旧 | 通知DOの起動/排出/停止・復旧、期限処理の合成一回実行、archive smoke、Time Travel/R2 replayの個別証拠はある。隔離実Cronでarchive2件/残す2件・履歴payload/FK・cleanupを受け入れ、独立inventoryも一致した。mainの日次expiry/archive・Paid/CPU30,000msは有効化・配備/readback済みで、2026-10-05 09:00:15 JSTの自然expiry/graceは対象0/競合0・完了台帳を確認した。旧監視の秒完全一致による取りこぼしを修正し、10月6日09:00:57 JSTのmain expiry/grace/archive自然実行は完了/例外0/競合0/残り0で受け入れた。対象0件のhandler観測と隔離環境の有データarchive試験は分ける。監視専用tokenを二つのRead権限・対象account限定・期限11/4で発行し、Macキーチェーン保管と専用CLIの実readを受け入れた。新規一時D1のSELECT成功・非ゼロINSERT認可拒否・同一SQLの配備権限positive controlを確認し、所有D1の削除と独立inventory一致も受け入れた。定期監視/秘密運用全体/retention/担当/RPO-RTOと最終運用は未受け入れ。 | 起動条件/周期/再開/監視、保存期間、担当と権限、秘密の保管・交換、停止時間/復旧時間目標を確定し、合成障害から復旧を実測する。測定で有料planが必要なら設定前に明示する。 | #30, #34, #37 |
| 5. 移送器の合成データ受け入れ | 最新27 Business/4 Authで、同じ暗号化保存bundleから全Master25表/12,254行/98定義、合成Auth9表/16行/30定義、業務40表/15行と分離R2画像2件を2組の新規実D1/R2へ復旧。各Business targetの全27 migration/schemaが現行runtime profileに一致し、全hash/FK0、commit後中断再開、R2 replayと実SDK/owner/catalog/画像を確認。全所有資源削除と独立inventory/main全表hash/Auth3/7/2/Worker d437保持を確認。所要132917/310412msは本番RTOではない。[限定証拠](evidence/full-combined-file-remote-recovery-v27-2026-10-06.json)。実ユーザー移送は0。source converterの4 blocking groups/deployable=false、運用鍵/off-host/retention/失効方針と実運用採用は残る。 | source全schemaの残る4分類を判断し、運用鍵/保存先/失効方針を採用した最終構成で未説明差分0と所要時間を記録する。合成復旧から実ユーザーidentityの移送成立を推定しない。 | #35, #37 |
| 6. 最終統合と引き渡し | desktop・390px viewportのeditor/favorites、API/static/PWA/noindexなどの個別証拠がある。旧source→現行frontendのローカル実ブラウザーで、SW更新/自動reload/旧API cache退役・合成設定保持と現行PWA画面を確認した。実スマホ・対応言語・実ユーザーのインストール済みPWAを含む最終通し確認は未完了。PR #41はdraft。 | 同じ最終candidateで主要利用フロー、provider、ジョブ、PC/スマホ、言語、旧client更新、障害/復旧を一巡する。実行結果と残すデータ/DNS工程の手順を更新し、PRの最終差分・CIをレビュー可能にする。 | #33, #37 |

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
classifierの54 pendingはsemantic acceptanceを自動で進めない数で、54件の
未実装を意味しない。任意の手動trace入力は04:15:10.854785Zの最新runtime catalogに対し
全58 signature/hash/属性/接続数を照合し、mappedFunctionCount=58/欠落0を記録した。
[実sourceとの対応表照合](evidence/source-runtime-counterpart-linkage-2026-10-06.json)。一方、fullRuntimeReconciled/converterDeployableはfalseを保持し、
未説明差や実データでしか確認できない事項を完了扱いにしない。
[現行converterと合成取り込み](evidence/schema-current-preparation-2026-10-05.json)では、保存済みsource metadataに対するv43の4 blocking groupsと現行targetのlocal復旧を確認した。最新source readや全converterの受け入れには換算しない。
[source runtime](source-runtime-review.md)、[source authorization](source-authorization-review.md)、
[object map](object-map.md)、[frontend callsites](frontend-callsite-map.md)、
[trigger counterparts](source-trigger-counterparts.md)、[policy counterparts](source-policy-counterparts.md)を参照する。
過去の失敗/修正・個別受け入れは[HANDOFF](HANDOFF.md)と[EXECUTION](EXECUTION.md)へ残す。

2026-10-06 告知配送の順序不具合: 現行25 Businessで恒久bounce/苦情の後着成功上書き、通常イベントによる別未送信行の停止、完了runの集計未更新を調べ、5件の失敗を再現。追加0025と再集計修正後、全26 Businessを使う13配送テストと現行Business/Auth import 1件、typecheck/eslintを通過。[限定証拠](evidence/broadcast-terminal-outcomes-2026-10-06.json)。候補eeb4f6a/CI37414547662両job成功後、全26 Businessの一時実D1/Workerで署名イベント8シナリオ（恒久bounce/苦情/一時bounce/failed × ACK前後）と不正署名・改変・期限・未対応eventの未書込、重複単一event/audit、FK0を確認。所有D1/Workerを削除し元inventory/元main全表hash/Workerを独立保持照合した。main stagingへ0025とWorker b3ce17ce-cd56-464c-8694-2215dce51b39を適用し、追加ledger1件以外の全表hash、既存秘密設定、他の全schema、公開asset4件、broadcast disabledを確認。現在の保存baselineはprivate broadcast-terminal-remote-2026-10-06/staging-install.jsonのbaselineで、旧25の記録を上書きしない。Resend実署名配送、bulk/送信UI/retentionは未受け入れ。過去の全結合復旧は25 Businessの証拠として保持する。

2026-10-06 告知署名通知の発生順: 26 Businessで通常の失敗/成功の順序逆転による4件の誤判定を再現。追加0026とroot created_at検証により、受信日時とは別にUTC offset/小数秒の全桁を保持し、発生日時・同時刻IDで通常結果を選ぶ。恒久bounce/苦情の優先は維持する。全27 Businessの配送22件、Business/Auth import1件、監視5件とtypecheck/eslintを通過。[限定証拠](evidence/broadcast-provider-chronology-2026-10-06.json)。候補a5a2b75/CI37416934627両job成功後、全27 Businessの隔離実D1/専用Workerで従来の8件と発生順8件の署名HTTPシナリオを確認。発生順/逆順・ACK保存前後で最新結果と小数秒全桁が一致し、重複は単一receipt、無効日時は未書込だった。所有D1/Workerを削除し元inventoryとmain全表hash/旧Workerを保持した。mainへ0026とWorker 0605e4ed-38d2-4e09-967e-3c3f3c99910dを適用し、ledger27、追加ledger1件以外の全表hash・既存秘密設定・公開asset4件と変更2定義/他schema保持を独立照合した。現在の保存baselineはprivate broadcast-chronology-remote-2026-10-06/staging-install.jsonのbaselineであり、旧26/25の証拠を上書きしない。追加メール0、実Resend通知・bulk/UI/retentionや全体移行へ受け入れを拡張しない。

2026-10-06 表示言語のHTML属性: in-app DOM接続で新規tabの現行トップを確認し、EN/KO/IDの本文切替後もhtml langがjaのままという3件の不一致を観測。選択言語effectにdocument lang同期を追加し、typecheck・eslint(error0/warning1)・staging buildを通過。ブラウザー表示言語をJAへ戻し、別read-only processで元全表hash/Workerを保持した。候補5e037d0/CI37418737512両job成功後、Worker d4375d19-5024-4bf6-9cd7-1e5d399ce7b5へ通常設定で配備。公開asset4件のbytes/hash、既存秘密設定・canonical vars・ledger27と全表hashを保持し、既存Worker runtime a5a2b75からの変更0を確認。既存IAB検証tabを通常reloadして新entryを確認し、JA/EN/KO/IDすべてで本文とhtml lang一致、最後にJAへ復元した。別read-only processで全表hash/FK0と100% versionを保持照合した。[限定証拠](evidence/staging-language-metadata-2026-10-06.json)。全言語の通し操作・実スマホ・native GUIの残件は保持する。

## 現行27 Businessでの保存bundle一式復旧（2026-10-06 JST）

コード候補5e037d0/CI37418737512両job成功版と、文書だけ異なる022a0d4を照合した。
文書候補022a0d4のCI37420051154も両job成功。
同じ暗号化保存bundle v2から、別incarnationの2組の新規3 D1/2 R2/専用Workerへ
全Master25表/12,254行/98定義、合成Auth9表/16行/30定義、業務40表/15行とPNG2件を復旧。
各Business targetの全27 migrationとschema定義が現行runtime profileへ一致した。
全Master/Auth列hash・定義/FK0、正確な保存40 stream、credential commit後中断再開、
R2 replay/画像bytes、実SDKのsession/password/TOTP/backup/停止拒否、本人profile/3所有一覧、
画像GET・HEAD、catalog3944/参照Master4/4/5/16、単一wake1/0を確認した。
所要132917/310412msはone-off値で、本番RTOではない。2組目は同名Worker再作成後のprivate
identity確認に失敗したため、正確な所有資源/version/bindingを再照合し、同じ一時Workerの
recovery gateだけを同じ権限で更新して再開した。初回HTTP応答/根本原因は未記録のため断定しない。
2組目の所要時間にはD1作成開始から、この再開とアプリ確認までを含む。
初回失敗と再開記録を保持し、スキーマ/データ復旧をやり直していない。

全所有資源をexact receiptで削除。独立2026-10-06T06:01:29.711Zの読み取りで
元D1/R2/Worker inventory、main全表hash/count/FK0、Auth3/7/2とWorkerd437を保持した。
main DB書込・配備/secret変更・追加メール・実ユーザー移送・DNS変更は0。
[現行27の限定復旧証拠](evidence/full-combined-file-remote-recovery-v27-2026-10-06.json)。

これは現在のschemaでの合成一式復旧の受け入れであり、source converterの4 blocking groups、
運用鍵/off-host/retention/失効方針の採用、本人操作と実スマホ・provider・最終統合の六項目は残る。
以前の25 Businessの証拠は当時の結果として保持し、書き換えない。

## 旧PWAから現行frontendへのローカル更新確認（2026-10-06 JST）

旧source c077fbfと候補5d616cb（CI37421614544両job成功）を同じ使い捨てlocalhost URLで配信した。
旧Supabase clientのURL/keyだけを合成のローカル入力へ置換し、旧SW設定を保持。
現行335 sourceファイルは変更0、旧231ファイルはこのclientだけ変更1。
Vite/PWA/Workbox/Reactの旧・現行lockと実installed versionは一致する。
現在のcatalog3944だけを読み、Auth/業務APIは合成応答/拒否として実サービスへ転送しない。
旧API cacheはfixture UIで合成値を入れたもので、Supabase network requestの結果ではない。
状態表示probeをReact root外へ挿入し、CUAの実in-app browserで操作/DOM確認した。

旧SWのactive/control/旧main precacheとsupabase-cacheを確認後、同じ登録へのupdateで
自動reloadし、現行mainとprecacheへ更新した。supabase-cacheは削除され、無関係な
合成cacheと保存済み合成設定は保持。未保存DOM入力はreloadで失われた。
現行画面はfixtureのmaintenance API欠落時に停止表示した。合成の正常設定DTOを
追加し、通常reload後に現行/pwa検索画面を確認。製品の安全側の制御は変更しない。
fixture SW登録/cache/owned設定キーを削除し、所有tabと二つのserver processを終了した。
mainは既存version d437のGET readbackのみ。DB/配備/secret/メール/userdata/DNS変更は0。

[限定ブラウザー証拠](evidence/pwa-legacy-update-local-2026-10-06.json)。
これはローカルの旧→現行PWA protocol確認であり、実ユーザーのインストール済みPWA、
実スマホ/standalone、全言語/全フローの最終確認は未受け入れ。六項目全体は未完了。

## 有料退会の実Safari・実解約通知・後片付けを受け入れ（2026-10-06 JST）

専用合成accountの最終削除を本人許可後に一度だけ実行し、Stripe test購読の即時解約/200、
Auth関連行0、業務profile/購読0、無期限Tier Cのgrace返却/所有者NULL、退会監査1件を照合。
設定2行はgrace期間中に保持する仕様で、同じSafariの/dashboardは/authへ戻った。
同じSafariの通常reload/既存Checkout成功URL/Creator表示も受け入れた。
Macロック中のPWA自動更新・実スマホ/standalone更新は未証明。

退会後の署名解約通知が削除済み設定を要求する不具合を修正した候補bdc23daは、
CI37456809494の両job成功後、Worker 471faabe-3aff-4312-ba22-cd326dc821e1へ100%配備。
関連Webhook79/79（購読22）、typecheck/lint成功。秘密/設定/全公開asset6件を保持した。
専用通知のavailable_atだけを一度早め、試行回数・generation・terminal状態は変更せず、
実毎分Cronによる同じ署名通知のignored/completed・errorなし・fence解放を確認した。
退会監査/過去applied同一購読/Stripe現在canceled・有効購読0の厳格一致を要求し、
本人projectionを再作成しない。これは運用者による待ち時間短縮を含む受け入れである。

所有する3監査/4receiptと関連台帳/command/fence/ファンマ/設定だけを後片付けした。
別のread-only credentialによる全表照合で既存全row hash、Auth3/7/2、Master25表、FK0を保持。
再利用防止のlicense incarnation tombstoneは+1で残し、既存MFA/wake世代は巻き戻さない。
private journalはverified_and_cleaned。削除済み合成passwordとui-credentialsを除去。
再seed/再Checkout/再Delete/完了runner再実行は不要。
[受け入れの限定証拠](evidence/staging-native-paid-deletion-accepted-2026-10-06.json)。

有料退会のこの経路は完了。六項目全体はopenで、source/外部caller/4 converter group、
Apple・Discord新規/relay、告知UI/実通知/bulk、運用条件、同じ最終candidateの実スマホ・
対応言語・旧PWA・障害復旧の通し確認が残る。実ユーザー移送とDNS/domainは最後の別工程。
本番Stripe、追加mail、実ユーザー移送、DNS変更は0。全体移行は未完了。
