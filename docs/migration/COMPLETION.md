# ユーザーデータ・ドメイン移行前の完了判定

## 現在のチェックポイント（2026-10-09 JST）

通常stagingのmainは`1b57012d-e5fe-4821-adaf-6e30ad7d6b0c`。新3D1/2R2とV2 DOへ
分離し、旧全表/旧namespace/未判定ticket34を保持した。CI205b168の両job成功後、
新scope限定で初回暗号化R2保存・同運用鍵での隔離復旧14,591ms・独立全表/R2照合と
所有targetのcleanupを確認した。保存元Auth user/credential/session0・画像R2空。
実Cron0。別monitor/固定本人宛先通知と期限処理完了receiptの候補を追加し、local native22件・schedule guard12件を確認した。native配備/実通知/自然Cron・残るprovider/最終端末統合は未受け入れ。実ユーザー/DNSは最後。
最新の[限定native結果](evidence/staging-resource-scope-v2-operational-2026-10-09.json)と
[backup operations](backup-operations.md)末尾を優先する。以下の詳細には過去の状態も含む。

## 告知の定期配信を検証用1名で受け入れ（2026-10-08 JST）

番号付きの本人所有テスト宛先1名を、free/jaと過去の閉じた登録日範囲で限定した。
既存利用者を含まない対象0件から専用fixtureを追加し、MFA保護APIのestimate=1、
配信要求202、同一request IDの再要求で同じrunだけが残ることを確認した。
実毎分CronがAuth ID snapshotを完了し、Resendへ1回送信した。実署名sent/deliveredを
同じprovider ID・recipientへ反映し、run completed、recipient delivered、集計1/1/0、
作成・要求・初回完了の監査3件を照合した。手動Cron起動・API応答置換は0。

一時配備のCLI末尾が認証エラー10000になったため、再配備・新要求は行わず、
100%の配備版、binding、6 asset、専用行を除く全表hashを読み取り専用で照合して
反映済みと確認した。通常構成へ復元したmainは
`cc6d75c4-53c3-4ccd-939e-5a2c4a706c1c`。署名受信だけを有効に保ち、
bulk/test送信を再び無効化。専用actor/recipient/draft/run/監査/eventを除去後、
独立プロセスでAuth3・7・2、他の全表hash、FK0、同じ6 assetを確認した。
MFA generationは258→260へ進み、戻していない。
[限定証拠](evidence/staging-broadcast-single-recipient-2026-10-08.json)。

これは送信API・実定期処理・実配送を1名でつないだ受け入れ。送信UI、複数名/50件境界、
実bounce/苦情・provider retry、運用backup、Apple/Discord新規identity/relay、
実スマホ/PWA、同じ最終candidateの統合は引き続き残る。運用案と実スマホの質問は回答待ち。
実ユーザー移送と本番domainは最後の別工程。

## CIの保存失敗テストの通信遮断を修正（2026-10-08 JST）

設定commit `62a4d6c` のCI37782119977はWorker job成功。アプリjobは最初にChrome起動待ち、
再実行ではlocal editorの保存失敗試験で失敗した。後者は遮断件数0・未消費の遮断flagと
実PATCH/設定画面への成功遷移を記録し、保存失敗の受け入れにしなかった。

editor試験の失敗1回だけService Worker経路をバイパスし、実PATCHへのCDP遮断と
同じnetworkIdの接続失敗receiptを要求する。reload前に通常の経路へ戻す。
ローカルの実Chrome/Worker・全27 Business/4 Auth/8 Masterで、SWが制御中の状態から
遮断1回・実ネットワーク失敗・DB未更新・下書きreload・再試行保存を確認した。
API応答置換0、provider/remote操作0。PWA経由の障害試験や実スマホ確認へは拡張しない。
[限定証拠](evidence/editor-network-fault-boundary-local-2026-10-08.json)。修正commit `bcb9565` の[CI37785543127](https://github.com/kanouk/fanmark-id/actions/runs/37785543127)はアプリ・Worker両job成功。

通常stagingの実Resend受信・再送・owned cleanupの受け入れは保持する。
mainは`cbb800a3-9f71-4a90-b21c-6fe87d2d7b12`、bulk/test送信は無効。
今回の修正はテストと文書のみ。バックアップ運用案と実スマホ確認の質問は回答待ち。


## Resendの実署名通知と受信専用構成を受け入れ（2026-10-08 JST）

利用者がWebhook追加と署名キーのstaging/キーチェーン保存を個別に許可した。
Workspace全体の宛先・件名・配送状態が届く範囲を説明済み。番号付き検証宛先へ
MFA認証付きWorker APIから1通だけ送信し、実Resendのsent/delivered両イベントを
署名検証して最小6列のD1記録と照合した。宛先・件名はevent表へ保存しない。
deliveredのprovider再送も200/received=true、Attempts 2で確認し、D1は同じ2行のまま。

通常stagingは`cbb800a3-9f71-4a90-b21c-6fe87d2d7b12`を100%配信する。
`BROADCAST_WEBHOOK_BACKEND=d1`と署名secretを保持し、bulk/test送信のselectorと
固定宛先は解除した。元の6 asset・通知/処理件数計測DOと他bindingを保持した。
専用actor/draft/audit/eventのみ除去し、独立Read processで他の全表hash、Auth3・7・2、
FK0を照合した。MFA generationは合成factorの作成/削除により256→258へ進み、戻さない。
[限定証拠](evidence/staging-resend-signed-webhook-2026-10-08.json)。

利用者はstagingのD1・R2に既知のfanmark Worker/このチャット以外の書き込み元は
ないと回答した。将来の追加writerや本番まで確認済みとは扱わない。
実Resendの署名受信とこの再送の残件は解消。一括配送、実bounce/苦情等、retry/retention、
バックアップ運用採用、Apple/Discord新規identityとApple relay、実スマホ/PWAと
同じ最終candidateの統合は残る。実ユーザー移送と本番domainは最後の別工程。


## R2合計20 MiBの復旧・exact resumeを実Cloudflareで受け入れ（2026-10-08 JST）

- `87920b1` / [CI37762268107](https://github.com/kanouk/fanmark-id/actions/runs/37762268107) はアプリ・Worker両job成功。
- 新規専用7 bucket/Workerで、前の不合格と同じ8 MiB・8 MiB・4 MiBの合成3 object、合計20 MiB、補完なしStandard、同じsnapshot hash・v1・暗号文長を使用した。fixture側で以前のinput/resultを破棄したり、検証を小さく分割したりせず、一つの実行でcapture・暗号化往復・初回復元・exact resume/version保持・object上限+1 byte拒否・total上限+1 byte拒否の6項目すべてが通過した。
- 既存上書き拒否、全bytes/metadataと復元後の全native読取/hash検証は維持する。ローカル9 R2/16一式復旧、型/lint/bundleの検査も通過。容量上限のメモリ超過という今回の残件は、この合成materialで解消した。
- 全owned objectと7 bucket/Workerを削除し、元のD1/R2/Worker inventoryに戻した。別Read processでmain `1071896f-7e6c-4218-818d-6b1eceeea9f3`・既存全表hash/Auth3・7・2/FK0・binding/namespaceを保持照合した。通常stagingへの再配備は0。
- 記録: [`evidence/r2-recovery-maximum-capacity-accepted-2026-10-08.json`](evidence/r2-recovery-maximum-capacity-accepted-2026-10-08.json)。1000 object・InfrequentAccess・五つのstoreを同時に最大量にした試験や運用RTO/定期backupの受け入れへは拡張しない。
- Resend実署名通知、外部writer/運用方針、残る実provider/実端末/最終統合と六項目全体は未完了。実ユーザー移送と本番domain変更は最後の別工程。

## R2容量上限で復号・初回復元は通過、exact resumeを修正中（2026-10-08 JST）

- `7a8c6ee` / [CI37760585412](https://github.com/kanouk/fanmark-id/actions/runs/37760585412) は両job成功。新規専用環境の同じ3 object・20 MiB・Standard・v1で、capture・暗号化往復・初回復元と全hashの照合まで実Cloudflareで通過した。
- 結果を保持した同じ呼び出しの `resume-maximum` で native `exceededMemory` が発生した。exact resume/容量上限全体の受け入れはまだ未完了。テストの容量・元データ・保存形式・全件照合は減らさない。
- 同script/versionのnative終了を照合してから、専用7 bucket/Workerを削除した。別Read processで元inventory・通常staging全表hash/Auth3・7・2/FK0/設定・namespaceを保持照合した。
- 次候補は、検証済みbytesを直接比較して巨大なobject JSONの二重生成を避け、exact subset確認後のprivate読取payloadを解放する。復元後の全native capture/hash検証は維持し、返却値はその検証と一致したprivate normalized containerとimmutable payloadを使い、次のresumeまで同じ全bucket payloadを重複保持しない。
- 次候補の実Cloudflare再検証は未完了。通常stagingへの再配備は0。実ユーザー移送と本番domainは最後の別工程。
- 記録: [`evidence/r2-recovery-capacity-resume-memory-2026-10-08.json`](evidence/r2-recovery-capacity-resume-memory-2026-10-08.json)。

## R2容量上限の修正候補を実環境で再検証（2026-10-08 JST）

- `5eb0ced` の [CI37758494467](https://github.com/kanouk/fanmark-id/actions/runs/37758494467) は両job成功。
- 同じ合成3 object・合計20 MiB・Standard・保存形式v1で新規専用環境を作り、単一の実行要求を送った。復号 `open-maximum` で再び native `exceededMemory` を確認した。最初の中間コピー削減だけでは容量上限の条件を満たさない。
- 実行終了を同script/versionの監視結果で確認してから、所有7 bucketとWorkerを削除した。別のRead processで既存全表hash/Auth3・7・2/FK0/設定・namespace・元資源inventoryを保持照合した。journalの最初の非終端cleanup拒否は履歴として残す。
- 次の修正候補は、private archive containerのciphertext参照と復号byte bufferをparse前に解放し、decoded textをvalidate前に解放する。呼び出し元のarchiveは変更せず、保存形式と8 MiB/object・20 MiB/rawの上限を維持する。
- ローカル20 MiBの復号・復元・exact resume・plus-one拒否を確認した。次候補のCIと実Cloudflare容量上限の受け入れはまだ未完了。通常stagingの再配備は0。
- 記録: [`evidence/r2-recovery-capacity-candidate-recheck-2026-10-08.json`](evidence/r2-recovery-capacity-candidate-recheck-2026-10-08.json)。実ユーザー移送と本番ドメイン変更は最後の別工程。

2026-10-06 JST。親Issue #28と#30–#37の現行本文、現在の実装・受け入れ記録を
照合した残件表。作業時間やテスト件数を進捗率に換算しない。
stagingの機能別受け入れは進んでいるが、以下の全条件はまだ成立していない。

## R2の容量上限でメモリ超過を確認・修正候補（2026-10-08 JST）

通常stagingを保持し、新規7 bucket/専用Workerで8 MiB・8 MiB・4 MiBの合成objectを
扱った。補完なしStandardの合計20 MiB captureは通ったが、`open-maximum`で応答が
不明になり、同じscript/version・開始時刻のCloudflare監視データにexceededMemory1件を
確認した。未完了receiptを成功扱いにせず、呼出終了の確認後だけoperator failureを
記録し、同じjournalの読取再開で全owned資源を削除した。POSTの再送は0。
別Read processで元inventory・main全表hash/Auth3・7・2/FK0・設定/namespaceを保持照合。
[不合格の限定証拠と候補](evidence/r2-recovery-maximum-capacity-failure-2026-10-08.json)。

容量8/20 MiBとarchive v1を維持し、base64の巨大なbinary/canonical文字列コピーを
chunk処理に変更。immutableなpayload文字列を共有し、snapshot/metadata等のmutable
containerはコピーする。chunk境界・不正padding/pad bits/空白と呼出後input変更の拒否/
分離を加え、R2 9件・一式復旧16件・型/bundleとlocal実workerd20 MiB検証が通った。
修正候補の両CIと、新しい隔離remoteで同じ容量の受け入れはまだ必要。main再配備は0。
1000 object上限、InfrequentAccess、全ストア同時の最大容量/運用RTOへは拡張しない。
実ユーザー移送とdomainは最後の別工程、六項目と既存の回答待ちは維持する。

## 修正後の確認メールを実配信で確認（2026-10-08 JST）

通常Worker `1071896f-7e6c-4218-818d-6b1eceeea9f3` で、許可済み番号付き宛先test02へ
確認メールを1通だけ送った。ResendのDelivered、実際の日本語本文の「1時間」、
リンクのexp−iat=3600秒、同originのverify-emailと`/auth?verified=1`への戻り先を確認。
リンクは開いておらず、本人のGmail受信・新規signup/loginの受け入れには拡張しない。
[限定証拠](evidence/staging-auth-verification-copy-delivery-2026-10-08.json)。

パスワード・credential account・sessionを作らないemail-only fixtureとprofileだけを
exact条件で削除した。別Read processで全baseline hash、Auth3・7・2、
Business79/Auth10/Master25表、FK0、同じWorkerとbinding/namespaceを照合した。
test02は旧tokenの期限まで再利用せず、次の検証はtest03以降を使う。
今回の追加送信は1通。4言語rendererの既存証拠は保持するが、残る3言語の新しい実配信、
Resend署名Webhook・運用backup・実端末/最終統合と六項目全体は未完了。
実ユーザー移送とドメイン移行は最後の別工程のまま。

## 通常stagingの処理件数計測を有効化（2026-10-08 JST）

候補450ec08/[CI37748771478](https://github.com/kanouk/fanmark-id/actions/runs/37748771478)は
アプリ・Worker両job成功。通常Workerを`1071896f-7e6c-4218-818d-6b1eceeea9f3`へ一度配備し、
内部SQLite DOと計測selectorを追加した。元の通知namespace/全bindingと公開6 assetを保持。
並行catalog GET6件でactive6を観測し、完了後0へ戻った。専用合成actorのsignin/
authenticated session/signoutとexact-owned cleanup後も0。同versionに絞ったLive Tailで
自然の毎分Cronがoutcome=ok/例外0と確認し、tailを終了した。追加メールは0。

一時検査Workerの初回HTTP assertはstatusを保存しておらず再構成しない。
検査Workerだけ再配備した後、同じURLの404→401を観測し、同じmainの検査を再開した。
一時Workerとfixtureは除去済み。別Read processで既存全表hash、Auth3・7・2、
Business79/Auth10/Master25表、FK0、設定/namespaceを照合した。
[限定受け入れ](evidence/staging-writer-tracking-2026-10-08.json)。

停止flagは未設定、owner=null/drained=falseのまま。これは計測有効化と対象処理の
終了確認であり、初回旧writer終了/外部writer lease/owner付き停止/整合capture/定期backup
採用の証拠ではない。source・provider・運用方針・実端末/最終統合の残件と、
実ユーザー移送・ドメインを最後にする範囲は保持する。

## 確認メールの期限表記を1時間へ修正（2026-10-08 JST）

実リンクのJWTはexp−iat=3600秒なのに、移行したsignup本文は24時間と記載していた。
EN/JA/KO/IDの4行の本文を1時間へ合わせ、updated_atを更新した。現在のtoken期限、
他12 template、source snapshot/初回seed、Worker/config/schemaは保持した。
実際のtarget行を既存rendererへ渡し、HTML/textとも4言語で1時間と確認。
実providerへの追加送信は0なので、新しい実メールの受信確認とは区別する。
別Read processでtargetの全baseline hash、Auth3・7・2/FK0と同じWorkerを再確認した。
[限定修正証拠](evidence/staging-auth-verification-copy-2026-10-08.json)。

現在の4 signup行は初回source-copyからの明示的なtarget修正である。
元source/seedの完全一致検証を現在の4行にそのまま当てれば相違になるため、
初回取込証拠とこの補正を分けて比較する。次のbaselineはprivate
`auth-verification-copy-2026-10-08/plan.json`のafterBaseline。
rollbackは同planで現在値を照合した4行だけを戻す。全Auth/mailと六項目全体は未完了。

## 招待必須の実登録・メール確認・ログインを検証（2026-10-08 JST）

通常Worker `f6d162c5-6168-4389-bf22-c0ab2f04c5a4` の専用Safari private windowで、
未登録の番号付き検証用受信先、1回限りの招待コード、一時的な招待必須設定を使った。
無効コードを拒否し、有効コードを適用。本人が新しいパスワードを入力して登録した。
UUID command/user/credential/profile各1件、招待消費1回、Free/JA/招待帰属と
未認証session0を確認した。Resendで指定先への確認メール2件のDeliveredを観測し、
本人のリンク操作後にemailVerified=1/session0、通常ログイン後にdashboard/上限3/session1、
native logout後にsession0、消費済みコードのAPI拒否を確認した。2通の発生源を推定しない。

招待設定は元行へ正確に復元し、所有したsignup fixtureだけを除去した。
別Read processでも全baseline hash、Auth3・7・2、Business79/Auth10/Master25表、FK0、
同じWorkerを確認した。provider履歴を保持し、本人が入力したパスワードは読取・保存していない。
[限定証拠](evidence/staging-invitation-signup-native-2026-10-08.json)。

メール本文の24時間という記載と、実リンクのexp−iat=3600秒が不一致だった。
実際の期限に合わせる4言語signup本文のtarget修正を別途記録する。
この登録検証は全Auth/mail・provider・実スマホ/PWA・最終統合と六項目全体の完了ではない。
実ユーザーデータ移送とドメイン移行は最後の別工程のまま。

## 有料延長の自動更新と移管ロック表示を受け入れ（2026-10-08 JST）

修正`8586601`/[CI37697249567](https://github.com/kanouk/fanmark-id/actions/runs/37697249567)は
アプリ・Worker両job成功。通常stagingのWorker `f6d162c5-6168-4389-bf22-c0ab2f04c5a4`へ100%配備し、
公開6 assetを新buildと照合した。既存設定/namespace・全表hashを保持し、別Read processでも
Business79/Auth10/Master25表、Auth3・7・2/FK0を確認。[配備証拠](evidence/staging-extension-confirmation-runtime-rollout-2026-10-08.json)。

新しい使い捨て利用者と同じSafari private windowで、1か月JPY2000のsandbox Checkoutから自然復帰した。
適用前は確認中と10月15日を表示し、自然署名dispatch/application/effect各1件の後に、
手動reloadなしで11月15日・38日へ更新して確認中表示が消えた。短時間の成功toast自体は直接捕捉していない。
同じ専用licenseだけに移管lock期限を置き、実発行操作が11月7日までの拒否を表示し、コード作成0を確認した。
これはlock表示の合成検証であり、新しい自然移管/期限経過の証拠ではない。

native logout→owned cleanup→別Read processで既存全表hash/Auth3・7・2/全Master25表/FK0を保持した。
[新しい限定受け入れ](evidence/staging-extension-confirmation-native-2026-10-08.json)。以前の表示不整合の不合格記録は保持する。
未登録受信先/Resend署名通知/新Apple・Discord identityとrelay、運用鍵・off-host・担当・周期・保存期間・
RPO-RTO/外部writer、実スマホ/PWA・最終統合と六項目全体は未完了。実ユーザー移送とドメインは最後の別工程。

## 有料延長の復帰で表示不整合を確認・修正準備（2026-10-08 JST）

通常runtime4445297 / Worker55ab5910の専用Safari private windowで、使い捨て利用者1件と
有限Tier4/Sのファンマ1件を用意し、1か月JPY2000のStripe sandbox決済を自然完了した。
復帰直後に成功toastが出たが、期限は10月15日のまま。自然署名dispatchはapplication/effect各1件で
D1を11月15日へ更新したが、画面は手動reloadまで更新されなかった。
[不合格の限定証拠](evidence/staging-extension-return-stale-date-2026-10-08.json)。

利用者とrequest UUIDに限定した状態確認GETと、適用後の所有一覧再取得・最大2分の待機・
未確認時の再確認を追加した。local client7/native D1 checkout7、型/staging build、
211 callsiteの現行位置・対応表2件を確認。追加のlint errorは0（Dashboard既存8件）。
まだ修正candidateのCI・配備・新規の途切れないnative決済復帰は未受け入れ。
今回のnative logoutは専用sessionを失効し、owned cleanup後の別Read processで既存全表hash/
Auth3・7・2/全Master25表/FK0を保持した。ユーザーデータ/DNSと六項目全体の未完了は維持する。

## 既存UI証拠から残件を特定（2026-10-08 JST）

移管の発行/申請/承認は[既存native証拠](evidence/staging-transfer-ui-2026-10-06.json)、
5件からFree上限3件への選択は[既存上限証拠](evidence/staging-populated-plan-limit-native-ui-2026-10-06.json)
で受け入れ済み。移管のcaptured frontend/router8ファイルは0ed4213からruntime4445297まで
同じblobで、これを未実行として繰り返さない。共有依存や最終統合まで同一とは推定しない。

有料延長の[既存復元記録](evidence/staging-extension-restored-ui-cleanup-2026-10-06.json)は
restoredDashboardDateAccepted=trueだが、uninterruptedCheckoutReturnAccepted=false。
専用actorで、Checkout→自然署名反映→dashboardのtoast/日付更新→logout/cleanupを
途切れず確認する工程が残る。本人アカウントとは別の専用actor/browserを使い、
元の利用者・認証状態・設定を保持して、所有したfixtureだけを後片付けする。

## 内部確認機能の通常staging反映と最新source照合（2026-10-08 JST）

`4445297`/[CI37687088667](https://github.com/kanouk/fanmark-id/actions/runs/37687088667)は
アプリ・Worker両job成功。Worker logでnative writerの6件成功も確認した。
同じ候補を通常stagingへ反映し、version `55ab5910-9abf-499e-8c34-af8d77a5e37b` の100%配信を確認した。
公開6 asset、既存binding/secret登録metadata/namespace、全表hash/FK0を保持。
別Read processでもBusiness79/Auth10/Master25表、Auth3・7・2と全表hash/設定の一致を確認。
[限定配備証拠](evidence/staging-writer-inspection-runtime-rollout-2026-10-08.json)。
計測/停止selectorは未有効化。この配備を通常環境の初回停止や定期backup採用とは扱わない。

最新Supabase catalog `2026-10-07T21:14:44.389671Z` は58関数/37binding/外部表binding1/
event binding0で、前回fingerprintと一致。58件の定義/属性/binding件数が手動対応表と一致した。
[限定source照合](evidence/source-runtime-counterpart-refresh-2026-10-08.json)。
Supabaseユーザー行の読取/移送・source関数呼出し/書込みは0。historical/data/任意外部consumer、
54 pending分類/full-runtime/converter=false、運用採用と最終統合の条件は保持する。

## 通知のイベント指定言語を実stagingで確認（2026-10-08 JST）

通常Worker`e688fdf6`（runtime`ad8f754`）で、日本語設定の専用利用者へEN/KO/IDの
payload.languageを与え、指定言語の正確なtitle/bodyと実受信箱・既読更新を確認した。
空文字/nullの2件は日本語へ戻り、利用者の設定は日本語のまま。5件の実DO processorは
retry0で配信した。所有fixtureを削除し、別Read processで既存全表hash（単調増加wakeを除く）/
Auth3・7・2/FK0、wake34→39とack39を照合した。新メール・runtime再配備・source writeは0。
[限定証拠](evidence/staging-notification-payload-language-2026-10-08.json)。

初回の検証手順はCLI INSERT後のGETをwakeと誤認し、30秒で待機失敗。既存eventの再作成は
せず、同じjournalで実PATCHのbridgeへ合わせて継続した。中断前の専用session1件もexact条件で
除去し、二度目のcleanup確認後に独立照合した。driverの途中失敗は証拠へ残す。
API/processorのこの言語分岐を受け入れた範囲であり、新たなUI/実端末・外部配信・全体完了ではない。

## 実Cloudflareの全Master復旧と通常staging反映（2026-10-08 JST）

候補`ad8f754`の[CI37678533990](https://github.com/kanouk/fanmark-id/actions/runs/37678533990)は
アプリ・Worker両job成功。新規6 D1・5 R2・Worker・別source/target SQLite DOで、
保存済み非ユーザーMaster12,254行と合成Auth/Businessを実アプリへ接続した。
通常SDKログイン→両writer fence→共通collector→Macの暗号化file→同じfileから空target復旧を
受け入れた。SQL数はinitialize262/collect251/restore786。明示失効でcredentialを保持し、
旧cookie拒否・新ログイン成功、実catalog3,944件、参照4/4/5/16件、hash一致/FK0を確認。
[remote限定証拠](evidence/application-recovery-transport-full-master-remote-2026-10-08.json)。

全owned資源とone-off鍵fileをcleanupし、D1/R2/Worker/DOの前後identityは3/3/2/1で一致。
4つのdata R2は空なので、画像class/最大容量の証拠にはしない。合計109,844msは作成・検証・
cleanupを含むone-off所要時間で、本番RTOではない。受け入れ済みのdriverは再実行しない。

同じ候補を通常`fanmark-app-staging`へ一度配備し、version
`e688fdf6-a5d7-4868-89b7-8171768ed865`の100%配信を確認した。公開6 assetのbytes/hash、
既存設定・secret登録metadata・namespaceを保持。別Read資格情報の独立processで全表hash/FK0、
Auth users3/accounts7/sessions2、Business79/Auth10/Master25表を再照合した。
[staging反映と独立照合](evidence/staging-native-recovery-runtime-rollout-2026-10-08.json)。

停止/計測selectorとmainのRecovery bindingは未有効化。今回で隔離remoteの実アプリ・
全Master・DO guard・collector接続の残件は閉じたが、通常main初回停止/旧writer終了、
外部writer lease、運用鍵/off-host/周期/retention/担当/RPO-RTO採用と最終統合は残る。
六つの完了条件は維持し、実ユーザーデータ・ドメイン移行は最後の別工程とする。
以下の「remote未実行」「通常main未配備」は過去のcheckpointであり、この観測を優先する。

## 計測したHTTP/Cron/DOの終了確認を追加（2026-10-08 JST）

内部DOによるticket censusとowner fenceを追加。native local5件・既存37件・型/bundleが
成功し、通常CIへ追加した。[限定証拠](evidence/recovery-writer-drain-local-2026-10-08.json)。
最初から計測した処理に限る。旧version/外部writerの終了確認・trusted collector adapter・
通常stagingへの配備と実remote capture/運用backupは未完了。前の停止候補3f7b6e4の
[CI37654697817](https://github.com/kanouk/fanmark-id/actions/runs/37654697817)は両job成功。
六項目と実ユーザー/DNSを最後にする範囲は維持する。

## バックアップ用の新規書き込み停止を追加（2026-10-08 JST）

`RECOVERY_WRITE_FREEZE`でHTTP全入口、fetch後outbox flush、Cron診断を含むjob、
通知DOのBusiness処理を停止する。native local37件・型検査・bundle dry-run成功。
[限定証拠](evidence/recovery-write-freeze-local-2026-10-08.json)。停止中のqueue/generation保持と
解除後の重複なしのalarm再開を確認。通常stagingでは未有効化。新規処理を止める実装であり、
既に実行中の処理のdrain・外部writer停止・collector trusted guard・運用backup採用は残る。
既存cutover設定のAuth/Stripe継続契約と、六項目・実ユーザー/DNSを最後にする範囲は保持する。

## 共通一式collectorを実Cloudflareで受け入れ（2026-10-08 JST）

候補99762afの[CI37649724810](https://github.com/kanouk/fanmark-id/actions/runs/37649724810)
はアプリ/Worker両job成功。通常CI logでも一式native/bundle8件と型/dry-runの成功を確認。
途中候補2e46cc9/CI37648656829はapplication成功・Workerは後続の実装追加によりcancelled。

新規6 D1・5 R2・Worker74b7fa6eで、現行27 Business/4 Auth/8 Master+legacy Authと合成行、
補完なしのStandard画像2件を共通moduleで収集した。Macの0700/0600暗号化fileを読み直し、
同じfileから別の空targetへnative単一batchで戻し、全desired hash/FKを確認した。
明示失効でsession/challengeを戻さずcredential bytesを保持。収集246/復旧623 query。
[限定証拠](evidence/recovery-set-isolated-remote-2026-10-08.json)。

全owned object/6 D1/5 R2/Workerを削除し、前後inventoryは3/3/2で一致。one-off request/
archive key fileも除去した。独立Read tokenではmain Worker17fdbf39/Business27/wake34/34/
FK0/queue滞留0/API・root200が前後同じ。別Wrangler processでも元の3 R2だけを確認した。
既存全行hashの新しい再照合とは扱わない。既存staging store write/新mail/runtime再配備/
Supabase write/実ユーザー移送/DNSは0。

小さい合成fixtureでの実collector/file復旧を受け入れた。全Master12,254行の新collector
capture・本番最大容量/RTO、通常アプリのwriter停止/drain、運用鍵/off-host/周期/retention/
担当/RPO-RTO/定期監視・最終統合と六項目は未完了。旧一式復旧runnerは再実行していない。

## 一式collectorの実Worker形式とremote準備（2026-10-08 JST）

共通recovery setを呼ぶ専用Worker/CLIを追加。独立local schema pin、固定account/HEAD/
CI、6 D1/5 R2/Workerのowned identity/version、別one-shot claimとstatusを要求する。
Macのprivate fileへ保存→同じfileを読み直し→空targetへのnative単一batch復旧を準備した。

通常local/bundle合計8件・型検査が成功。native D1 queryは収集246/復旧623。
無補完のlocal classは拒否し、補完はtest entrypointだけ。別archive、未認証/nonce/
二重claim/処理中cleanup/未知keyを拒否する。
[契約](recovery-set.md)・[限定証拠](evidence/recovery-set-bundled-local-2026-10-08.json)。

今回のremoteはまだ未実行。通常アプリの停止/drain・運用鍵/off-host/retention/
担当/RPO-RTO/定期監視・最終統合と六項目は残る。実ユーザー/DNSは最後の範囲を保持。

## 全ストアの収集・保存・exact再開を共通化（2026-10-08 JST）

Auth/Business/Master/avatars/coversを`fanmark-recovery-set-v1`へまとめるcoordinatorと
repo外0700/0600のfile helperを追加。全partを結び付けるencrypted manifest、独立schema/
source/runtime/key identity、caller-owned source/target guard、全targetのwrite前検証を要求する。

native local D1/R2と実fileで6件・型検査が成功。実Business commit後ACK喪失から、全hashが
一致したD1を再INSERTせずに全体を再開。別part/SDK鍵/既存file/foreign R2を拒否し、
明示失効方式ではsession/challengeを戻さずcredential bytes/FK0を保持した。
[契約](recovery-set.md)・[限定証拠](evidence/recovery-set-local-2026-10-08.json)。

通常CIへ追加。前文書候補fe46898/CI37645782521は両job成功。今回の一式はlocal限定で、
class補完はtestのみ。trusted guard実装の採用・runtime停止/drain・off-host/運用鍵/
周期/retention/担当/RPO-RTOと最終統合は未完了。CUTOVER_WRITE_FREEZEのAuth/Stripe継続を
全ストア停止と扱わず、guard callback自体の存在も運用証拠にしない。新remote write/mail/
runtime配備/source write/実ユーザー移送/DNSは0。

## 共通R2復旧を実Cloudflareで受け入れ（2026-10-08 JST）

候補`fcd4812`の[CI37643375901](https://github.com/kanouk/fanmark-id/actions/runs/37643375901)
は両job成功、R2 native/bundle8件も実CI logで確認した。CIの総合/個別step反映に一時差が
あり、最初のCLIはresource作成前のgateで拒否。step成功の反映後に検証を実行した。

新規の専用7 R2 bucketとWorker `ae69e6bd-27fe-424d-87a9-1023a6098ed2`で、class補完なしに
Standard class、avatar3/cover1の暗号化往復と全bytes/HTTP/custom metadata、Unicode/空object、
実アプリ画像GET・HEAD、commit後ACK喪失の不足2件のみ再開/version不変、異なるmetadata
の無書込拒否とsource不変の8項目を確認した。
[限定証拠](evidence/r2-recovery-shared-remote-2026-10-08.json)。

全owned objectを消去し、7 bucket/Workerのidentity/消失、D1/R2/Worker inventoryの前後一致
（3/3/2）を確認。別Wrangler processでも元の3 bucketだけを確認し、private request keyを
除去した。独立Read tokenのmain観測はWorker `17fdbf39`、Business27、wake34/34、FK0、
queue/処理滞留0、API/root200と前後同じ。全既存行のhashを再照合した証拠とは扱わない。

R2単体の実API境界を受け入れた。一式collector/整合した復旧点/鍵/off-host/retentionと
運用採用・最終統合は残る。既存staging bucketへのwrite、新規mail、runtime再配備、
実ユーザー移送/source write/公開DNS/本番課金は0。

## R2の実Worker metadata差異を修正し、remote試験を準備（2026-10-08 JST）

前candidate `de07b9a`のCI 37642308160は両job成功。新しいbundle試験で既知optional HTTP
metadataのundefinedが拒否される差異を見つけ、その未設定fieldだけを省略する修正を加えた。
通常R2検証8件・型検査・driver syntax checkが成功。無補完のnative Workerは欠落classを
拒否し、test専用entrypointの補完時は8 assertionで両kind復旧/画像GET・HEAD/ACK再開を確認。
[限定証拠](evidence/r2-recovery-bundled-local-2026-10-08.json)。

専用7 bucket/Workerの明示remote runnerを追加。固定account/HEAD/両CI/owned identityを
要求し、1回claimとstatusで不明な応答を扱う。既存stagingのrouteやbucketには未接続。
remote Standard class受け入れはこのcheckpointでは未実行。一式collector/整合点/運用採用と
六項目の完了条件、実ユーザーデータ/DNSを最後にする範囲は維持する。

## R2復旧の共通処理とCI診断（2026-10-08 JST）

avatars/cover-images全bucketのcapture・AES-256-GCM・空target/exact subset復旧を
共通moduleへ追加。local R2のavatar3件/cover1件で全bytes/HTTP/custom metadata、
Unicode/空object/ページング、実画像GET/HEAD、ACK喪失から不足分だけの再開と保存済み
version不変を確認。別bytes/metadata/未知keyはwrite前に拒否し、上書き/削除しない。
6件・Worker型/dry-run成功、通常Worker CIへ追加した。
[契約](r2-recovery.md)・[限定証拠](evidence/r2-recovery-shared-local-2026-10-08.json)。

固定MiniflareがstorageClassを空で返すため、local fixtureだけでStandard fieldを補った。
本実装は補完せず未知classを拒否する。実Cloudflareのstorage class受け入れ、全ストア
collector/整合した復旧点、運用鍵/off-host/retention/担当は未完了のまま。

Business候補aac3bb4のCI37639502798はapplicationの招待browser通信guardで一度失敗。
詳細を出力していなかったため、protocol method/codeを機密値なしで出す診断を8ddd51cに
追加した。判定は緩めていない。local招待flowは再実行成功、CI37640360292のapplicationも
成功したが、原因確定・再現修正とは扱わない。Worker jobは実行中としてexact handleを
監視している。R2の今回remote write/追加mail/runtime配備0。六項目と実ユーザー/DNSの
後工程境界は保持する。実staging招待用の未登録受信先は引き続き回答待ち。

## Business復旧の共通処理と採番保持（2026-10-07 JST）

現行27 migrationの79業務表と採番状態をcapture/暗号化/空D1復旧する共通profileを
追加した。Masterとbounded engineを共有し、既存Master format/APIは保持する。
実local D1でevent1,001行・226 schema objectを83 statementで取得し、249 statementの
単一batch復旧後に全hash/FK0が一致。招待消費1回、wake9/7、削除済みlicense incarnationと
event/ledger最大IDを保持し、次のID9,001/101・実wake triggerも確認した。
FK/constraintの実rollback、commit後ACK喪失の保持/再実行拒否も成功。

Business native5件・Master互換native7件・Worker型検査・dry-run成功。通常Worker CIへ
追加した。[契約](business-recovery.md)・[限定証拠](evidence/business-recovery-shared-local-2026-10-07.json)。
招待browser候補9402f61のCI37637603237はアプリ/Worker両job成功。
source行取得/remote write/追加mail/runtime配備0。全ストアcollector、運用鍵/off-host/
retention/担当/失効方針と同一最終candidateの統合は残る。六項目の全体完了とは扱わない。
実staging招待signup用の未登録受信先は回答待ち、実ユーザー/DNSは最後の別工程を保持。

## 招待必須登録を実ブラウザーとlocal Workerで確認（2026-10-07 JST）

現行アプリbuildとWorker、27 Business/4 Auth/8 Masterの分離local D1で、日本語の
招待検証→登録→確認link→password login→dashboard→logoutを実Chromeで確認した。
上流Resendだけを合成handlerにし、他のWorker/browser外向き通信を拒否。無効codeでは
登録formを開かず、成功時はUUID command/Auth/profileの対応と消費1回を照合した。
未確認login403・確認前後session0・login後1・logout後0、使用済みcodeの再登録拒否、
本人API4経路200と全FK0も確認。応答を差し替えるAPI mockは使っていない。

[再現コマンドと境界](invitation-signup-api.md#actual-local-browser-flow-2026-10-07)・
[限定証拠](evidence/invitation-signup-local-browser-2026-10-07.json)。通常application CIへ
このflowを追加した。esbuildはworkerd条件とnative AsyncLocalStorageを使い、browser用
polyfillを含むbundleは拒否する。検証中の不足設定/誤ったbundleは受け入れず、最終試験
では全画面APIに5xxなし、dashboardを視認した。owned browser/server/runtimeは停止済み。

これはlocal flowの受け入れで、実stagingの招待必須signup/消費と実メール配信は未確認。
読み取り専用の現在capabilityはsignUp/verification/reset=true、invitationRequired=false、
4 provider公開を確認した。staging設定/実ユーザー移送/DNS/追加実mail/runtime配備0。
実staging用の未登録受信先を問い合わせ済み。Master候補8397627のCI37634167828は
アプリ/Worker両job成功。六項目の全体完了、最終candidateの統合とは扱わない。

## Master復旧を共通化し、保存済み全Masterを照合（2026-10-07 JST）

Master限定capture/暗号化/空target復旧を共通moduleへ移し、通常Worker CIへ7件の
native local D1回帰を追加した。実batchのDDL/FK rollback、commit後ACK不明の保持、
再実行拒否、inactive release・監査triggerを確認。別private processで保存済み全Master
25表/12,254行/98 objectを新formatから復旧し、全hash・FK0・公開view件数が一致した。
233 statementで復旧、28でreadback。保存時点のgeneration0を保持し、現stagingの
generationや実Authを変更していない。[共通処理と境界](master-recovery.md)・
[限定証拠](evidence/master-recovery-shared-full-local-2026-10-07.json)。

前候補f0d94b9のCI37631765556はアプリ/Worker両job成功。今回はsource/remote read・write、
mail・runtime配備0。担当/鍵/off-host/retention/全ストアcollector/失効方針と
同一最終candidateの統合は残り、六項目の全体完了とは扱わない。

## メールテンプレート管理のnative保存・再取得を確認（2026-10-07 JST）

現行Worker17fdbf39と専用合成管理者の同じsession/verified factorで、Chromeの
メールテンプレート管理から日本語magiclinkの件名・本文・ボタン文言を一時保存。
改行・絵文字・placeholder・literalドル/ampersandを含む全入力値、更新時刻、監査がD1と一致し、
通常reloadして同じタブを開き直したフォームも一致した。元の3項目はUIから保存し、
exact復元行をpinしたguard付きcleanupでtestのupdated_atも元へ戻した。activeは不変。

UI logout後、合成actor/settings/所有監査2行をexact削除。独立read-only processで
元templateを含む既存全表hash・Auth3/7/2・Master25表・FK0・MFA世代+2とWorker不変を確認。
合成資格情報も除去済み。[限定証拠](evidence/staging-email-template-admin-native-2026-10-07.json)。
追加mail・runtime配備・secret/source/実ユーザー/DNS変更は0。magiclinkは管理catalogの
種類で、現Better Auth callbackの送信対象はsignup/recoveryだけ。この試験はmagiclinkの
実送信/ログインを受け入れるものではない。全体の六項目は未完了。

## 通常ログインMFAと管理メール2通を受け入れ（2026-10-07 JST）

候補dd9317bのCI37617933339はアプリ/Worker両job成功。通常`/auth`のメールログインを
Chrome private windowで実行し、TOTP画面・検証前session0・検証後dashboardと
同じsession/verified factorのMFA assuranceを確認した。誤コード/期限切れ等は
実hook/Provider/SDKのローカル回帰8件とSDK契約15件の証拠で、native全ケースとは扱わない。

専用合成管理者の管理画面から、明示承認済みの同じ検証アドレスへ管理reset1通と
告知test1通を各一度送信。Resendの新しい2行がDeliveredで、resetのexact監査/verificationと
告知のprovider message ID・宛先を含まないD1監査を照合した。reset linkは使用せず、
既存passwordは変更0。告知下書きはdraftのまま、一括配信は無効のまま維持した。

通常設定へ復元した現行Workerは`17fdbf39-99a5-4927-bf12-bc11e19b7c3d`（100%）。
一時test変数を除去し、frontendの告知2操作はdisabled。既存binding/secretと公開asset6件、
復元前後の全D1表hashは一致。配備直後のasset不一致は再配備せずreadbackで解消した。
UI logout後に所有user/settings/告知draftと監査12行・verification1行をexact削除し、
別read-only processで既存全表hash・Auth3/7/2・Master25表・FK0・MFA世代+2保持を確認。
残った専用private sessionは所有userのcascadeで失効し、合成資格情報も除去済み。
[実配備・nativeメール・cleanupの限定証拠](evidence/staging-main-auth-mfa-admin-mail-native-2026-10-07.json)。
再seed/再送/再cleanupは不要。実ユーザー移送・公開domain/DNS・本番課金は未実行。
招待必須signup/消費、Apple/Discord新規identity/relay、告知bulk/実署名通知、運用採用と
同一最終candidate/実端末の統合は残件で、全体の六項目は未完了。

## 招待コードのnative発行・切替・削除を確認（2026-10-07 JST）

現行Worker471faabeで専用合成管理者の既存TOTPを検証し、Safariから未使用コード
1件を発行。使用上限1回・無期限・JSON特典がD1と一致し、有効→無効→有効→無効の
各更新日時が進んだ。再取得した一覧も一致し、全体の招待モードは保持した。
本人が確認画面から完全削除し、成功toast・再取得後の空一覧・exact D1行の不在を確認。

UI logoutでsession/assuranceを失効後、所有settings/Auth user各1件とcascade、空waitlist
監査2行、通常signinに残ったMFA challenge/attempts2行をexact ID/metadataで除去。
独立read-only processで既存全表hash・Auth3/7/2・Master25表・FK0・Worker不変を確認。
正当なMFA世代+2は保持し、合成資格情報と入力ファイルを除去済み。再seed/再削除は不要。
[限定証拠](evidence/staging-invitation-create-toggle-native-2026-10-07.json)。

日本語の削除ボタンに欠けていたcommon.deleteを追加し、staging build成功、未配備。
この管理画面の発行/編集/切替/削除は確認済み。招待必須でのsignup/消費、provider/mail/
運用/最終統合は残件。追加mail・source write・実ユーザー移送・DNS変更は0、全体は未完了。

## Auth保存ファイルのサイズ制限を保存・読込で統一（2026-10-07 JST）

共通Auth復旧処理はopenだけ暗号文32 MiB上限があり、sealは読込できないサイズの
ファイルを作成できた。GCM tag16 bytesを含む同じ上限をseal/openで共用し、sealは
暗号化・JSON byte array展開の前にUTF-8サイズを確認、平文bufferを消去して拒否する。
Node WebCryptoの合成確認ではUnicode超過とtagによる1 byte超過を暗号化呼出0で拒否し、
小さいUnicode snapshotのseal/openが一致。native D1/SDK既存統合1 case・型/lint/diffも成功。
[サイズ制限の限定証拠](evidence/auth-recovery-size-boundary-2026-10-07.json)。

Macの実ロックをComputer Useが検出し、招待管理のnative作成/切替/削除は解除待ち。
新しいfixture/remote row mutation/追加mail/設定変更は0。前候補d986a72の
CI37485153008はアプリ/Worker両job成功。運用採用・全体の六項目は未完了。

## Auth復旧を共通処理へ移し、明示失効方式を合成検証（2026-10-07 JST）

`auth-d1-recovery.ts`へ9表のcapture/AES-256-GCM/空target復旧を切り出し、既存の
native試験から共通処理を使用。明示session policyを要求し、選択した失効方式では
session/MFA assurance/verificationを戻さず、他のcredential/factor/role/停止監査/
generationを保持する。旧cookie/管理MFA拒否と実SDKの新規password/TOTPを確認。
不正列の実transaction rollback、migration ledgerだけのtarget拒否、実commit後に
応答を失ったtargetの保持/盲目的な再実行拒否も確認した。native統合1 case・型/lint/
workflow isolation成功。これは運用policy採用・定期/off-host collector有効化ではない。
[限定証拠](evidence/auth-recovery-shared-local-2026-10-07.json)。

source対応表は現在の登録/Resendと既存Google/GitHub・メール受け入れへ補正。
8旧ordinary RPCのbounded direct caller不在を記録したが、外部利用は未確認のまま。
全58 metadata/linkageと13試験は一致し、54分類pending/full-runtime/converter=falseを保持。
追加mailは新たな2通の許可待ち。今回のremote write/実ユーザーexport/移送・DNSは0。
全体の六項目は未完了。担当/鍵/off-host/retention/失効方針の既存質問は回答待ち。

## 無効な招待コードのnative編集を確認（2026-10-06 JST）

現行Worker471faabeで専用合成管理者の既存TOTP/MFAを確認し、Safariの招待管理から
専用の無効コード1件を編集した。使用可能回数10→1と検証用JSONメモを保存し、
更新toast・D1の正確な値・再読み込み後の一覧・開き直したフォームが一致した。
コード文字列・未使用0件・無期限・無効状態、全体の招待モードは保持した。
発行/有効化/招待signup/メール送信は実行していない。

UI logout後、所有するcode/settings/Auth user各1件とcascadeを除去。招待画面が
同時に空のwaitlistを読むことで生じた管理監査2件も、本人UUIDとaction/resource/
timestamp/metadataをpinしてexact IDだけ除去した。別read-only processで既存全表
hash・Auth3/7/2・Master25表・FK0・Worker不変を確認。正当なMFA世代+2は保持し、
合成資格情報と入力ファイルを除去済み。[限定証拠](evidence/staging-invitation-edit-native-2026-10-06.json)。

招待管理の編集操作を受け入れた。発行/有効化/削除、招待必須でのsignup/消費と
他の管理画面・provider/運用採用/実端末/最終統合は別の条件。全体は未完了。

## 登録・メール設定の古い未設定記述を補正（2026-10-06 JST）

現行Worker471faabeのread-only設定metadataと`GET /api/auth/capabilities`を照合した。
D1 signup、Resend、D1メールtemplateとResend secret bindingがあり、signUp/
emailVerification/passwordReset=true、invitationRequired=false、4 providerを公開する。
招待関連文書の「資格情報/selector未設定で登録閉鎖」は初期checkpointの記録だった。
現在の設定と既存の実メール受け入れへ結び直し、再設定待ちとして扱わない。
[現在の限定証拠](evidence/staging-invitation-capabilities-current-2026-10-06.json)。

今回の登録/コード検証/追加mail・設定変更は0。広告されたcapabilityを新規provider
登録や招待必須での実消費の証拠に拡張せず、その残件と全体未完了は保持する。

## 手動通知作成から受信・既読までを実Safariで受け入れ（2026-10-06 JST）

現行Worker `471faabe-3aff-4312-ba22-cd326dc821e1`を保持し、専用合成管理者の
既存TOTP/MFAで通知管理へ入り、手動送信画面から`license_grace_started`を一度だけ作成。
宛先は本人の合成UUID、配信ruleは既存のin-app/遅延0の1件で、masterは変更しない。
入力pasteの競合報告後は、画面のJSON全体が準備したpayloadと一致することを確認して
送信した。nativeの作成toastとexact event receipt、source=admin_manualを照合した。

通常POSTのpostcommit wakeから実processorが約2秒後にevent processed/in-app deliveredを
記録した。保存title/body/summary/metadataが一致し、手動wake/定期処理呼出/状態変更は0。
イベントログはprocessed、配信ログはUIの更新ボタンで本人の短縮ID/in_app/deliveredを確認。
同じSafariの通知メニュー・受信一覧は本文と日時を表示し、個別既読/read_via=appも一致した。
これは手動の合成イベントであり、実ライセンス期限切れの発生証拠には使わない。

UI logout後、所有する通知/event/settings/Auth user各1件とAuth cascadeを除去。
別のread-only processで既存全表row hash、Auth3/7/2、Master25表、FK0を保持した。
正当なMFA世代+2とwake世代+1/ack一致は残し、世代を巻き戻さない。合成password/TOTP、
入力ファイルと操作セッション内の認証情報も除去済み。再seed/再submit/再runnerは不要。
[限定証拠](evidence/staging-notification-manual-native-2026-10-06.json)。

配備/secret変更、追加mail、実ユーザー移送、DNS変更は0。他の管理画面、実provider新規登録、
外部配信、運用採用と実端末/最終統合は残る。六項目全体は未完了。

## 通知管理のルール切替・テンプレート編集を実Safariで受け入れ（2026-10-06 JST）

現行Worker `471faabe-3aff-4312-ba22-cd326dc821e1`を保持し、専用合成管理者1件の
既存TOTPを`/admin`で検証。同一session/factorのMFA assuranceをD1で確認した。
`AdminNotificationManager`から専用rule1件を有効→無効へ切り替え、各`updated_at`が
進んだ。専用日本語in-app template1件のtitle/body/summary/activeを保存し、D1の
正確な値と、UIの「更新」後に再表示した編集フォームの全入力値が一致した。
本文の絵文字・`{{fanmark_name}}`・literal `$&`も保持した。

初回の通常signinで残った合成MFA challenge/attempts2行をfixtureが除外しておらず、
保持チェックは一度失敗した。SDKの識別子/value/同じ期限/作成日時で所有を確定し、
exact2 IDだけをpinして再照合した。全verification行を除外する緩和は行っていない。
UI logout後、専用rule/template/settings各1件とAuth user/所有cascade・上記2行を除去。
独立read-only processで既存全表row hash、Auth3/7/2、Master25表、FK0を保持した。
MFA世代の正当な+2は残し、wake世代とWorker versionは不変。合成password/TOTP secret、
UI入力ファイルと操作セッション内の認証情報も除去済み。再seed/再runnerは不要。
[限定証拠](evidence/staging-notification-admin-native-2026-10-06.json)。

この管理画面の編集操作は受け入れ済み。通知送信UI・他の管理画面、provider新規登録、
運用採用と実端末/最終統合は別の残件。配備/secret変更、追加mail、実ユーザー移送、
DNS変更は0。六項目全体は未完了。

## 4言語のアプリ内通知を実Safariで受け入れ（2026-10-06 JST）

現在のWorker `471faabe-3aff-4312-ba22-cd326dc821e1`（runtime bdc23da）を保持し、専用合成account1件に
JA/EN/KO/IDの通知を各1件配信。payload.languageを与えず本人profileの優先言語を
APIで変更し、D1 pending INSERTと通常sign-outのpostcommit wakeから実processorへ通した。
各event processed・in-app delivered・正確なtitle/body・literalの$&とJSONB object表記が一致。
同じSafariのreload後は画面の言語も一致し、本文表示・個別既読・read_via=appを確認した。
一覧はbodyを表示する仕様で、titleは保存payloadの照合である。

UI logout後、所有する通知4/event4/rule1/template4/settings1/Auth account1/user1を除去。
独立read-only processで既存全表の全row hash、Auth3/7/2、Master25表、FK0を保持。
wake世代の正当な+4とack一致を残し、世代は巻き戻さず、合成passwordを除去した。
最初のprepare引数はimported旧runnerの既存journal guardでexit1となったが、
旧runnerはmutation前に停止し、目的fixtureは準備済み。別processで保持を再確認し、
引数はseed-ownedへ変更した。再seed・完了runner再実行は不要。
[限定証拠](evidence/staging-notification-locales-native-2026-10-06.json)。

配備/secret変更、追加mail、本番Stripe、実ユーザー移送、DNS変更は0。
曖昧な複数channel・import codec/任意精度・外部caller、他event発生元と外部配信、
実スマホ/standalone・全言語/全フローの最終確認は引き続き別条件。全体移行は未完了。

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

## 全Master用のnative実アプリ隔離構成（2026-10-08 JST）

d2d9c3a/CI37664045796は両job成功。新しい隔離Workerは実アプリ・別SQLite DO・
native collector/restorerを接続し、非ユーザーMaster全12,254行をlocalで受け入れた。
通常SDK loginと停止、旧session/challenge失効と新login、絵文字3,944件全ページ、
reference4/4/5/16件、全hash/FK0、guard解除後のcollector拒否を確認した。
initialize262/collect251/restore786 SQLはSDK/復旧後APIを含む。8MiB境界と一回限りの
claims、改ざん前拒否、所有外/未完了cleanup拒否も確認。
[限定証拠](evidence/application-recovery-transport-full-master-local-2026-10-08.json)。
remote driverは実version/bindingsと2 namespace/全before-afterを検査する実装まで。
次候補のCI受入れと新規owned remoteでの実行はまだ残る。通常main運用や全移行の完了とはしない。

## 全Masterと通常アプリのlocal一式復旧（2026-10-08 JST）

f931782/CI37660877665はアプリ・Worker両job成功。招待登録とプロフィールの実ブラウザに
固定local proxyを使う候補、小さいfixtureでの通常SDK/DO fence/file復旧を含む。
追加の保存済み非ユーザーMaster全量caseは、独立archive/schema/rows pin照合後に
新規local source/targetへ接続した。通常signin、両fence停止、共通collector、同一private
fileからの復旧、session/challenge失効、旧cookie拒否、新signinが成功。Master12,254行の
全hashを保持、実catalog API全3,944件/参照master4・4・5・16件/FK0を確認した。
capture246/restore752 statements、最大batch233、一式file6,681,319 bytes。
local復旧約4.94秒はproduction RTOではない。新caseと小fixture回帰はlocal成功。
[限定証拠](evidence/application-writer-full-master-local-2026-10-08.json)。

これで作業4/5のlocal全Masterと通常SDK接続を前進させた。owned remote接続、通常mainの
初回停止/外部writer lease、画像class/最大容量、backup運用の採用、全source意味論、
実providerと最終端末受入れは残る。ユーザーデータ/DNS/live billingの変更は0。

## 完了までに閉じる六つの作業

バックアップ運用について、受け入れ済みのsource暗号化/R2 canary/現行schemaの一式復旧と、
未採用の担当・鍵・off-host定期保存・retention・RPO/RTO・Auth失効方針を
[運用監査](backup-operations.md)に分けた。合成復旧の再試験を運用採用の代わりにしない。

| 作業 | 現在の証拠と不足 | 今回の完了条件 | 対応Issue |
| --- | --- | --- | --- |
| 1. 移行元・移行先・呼び出し元の照合 | 40表、58関数、37登録trigger、77policyのcatalogと211箇所のfrontend対応表があり、77policy全件のidentity/hash→40表の現行経路・実装・検証への対応表を作成済み。分類reportは全体照合未完了のまま。sequence keyの3候補indexは現行writer/importの契約を照合し、空/NULL配列等の残る差を最後のデータ工程の条件へ明記した。任意外部consumerとfull converterのgateは保持する。 | 各object/actionについて、source定義hash、権限、実行経路、targetまたは不使用の根拠、契約差、対応する検証を結び付ける。未実装の現行経路・未説明の差を残さない。実データでしか判断できない事項はデータ工程へ明示的に移す。 | #30, #33, #34 |
| 2. アプリと認証・業務処理の仕上げ | 多くのsession/権限/競合/失敗時rollbackは受け入れ済み。退会388044b/Worker4a8d85ddはnative66・remote6を受け入れ済み。検索・お気に入りの4既知event/count不整合もbce8993、CI37094750732両job、Workerc09ece05のlocal17・remote4/cleanup/独立readbackで解消済み。取得の通常CI漏れを修正し、既存21と現行25 Business/4 Auth/8 Master・実signin/TOTP/停止・登録の5件（local26/26）を確認した。新規管理者MFA登録UIも本人のSafari操作後、verified factor・同一session assurance・logout失効・合成cleanupと既存全表hash/FK0保持で受け入れた。[限定証拠](evidence/staging-admin-mfa-enrollment-native-2026-10-06.json)。有料退会も実Safari、Stripe test解約、Tier C返却、Auth cascade、署名解約通知の修正配備/実Cron完了、exact-owned cleanup/独立保持照合を受け入れた。[限定証拠](evidence/staging-native-paid-deletion-accepted-2026-10-06.json)。通知管理の専用rule切替・日本語template全入力値の保存/再取得も実Safari・D1・exact-owned cleanup/独立保持照合で受け入れた。[限定証拠](evidence/staging-notification-admin-native-2026-10-06.json)。手動通知のnative作成→実processor→管理ログ→本人の受信/既読も同じWorkerで受け入れた。[限定証拠](evidence/staging-notification-manual-native-2026-10-06.json)。無効な招待コードのnative編集/再取得/cleanupも確認した。[限定証拠](evidence/staging-invitation-edit-native-2026-10-06.json)。通常`/auth`のTOTP段階と管理画面reset/告知test各1通のDelivered、canonical復元、所有fixture cleanup/独立保持照合も確認した。[限定証拠](evidence/staging-main-auth-mfa-admin-mail-native-2026-10-07.json)。メールtemplateのnative保存/reload再取得/元行復元/独立cleanupも確認した。[限定証拠](evidence/staging-email-template-admin-native-2026-10-07.json)。招待必須の日本語登録/消費/実メール確認/link/login/dashboard/logoutとowned cleanupを実stagingで受け入れ、未登録受信先の待ちは解消した。[限定証拠](evidence/staging-invitation-signup-native-2026-10-08.json)。確認リンクの1時間へ4言語signup本文を合わせたtarget補正と独立保持照合を別途受け入れた。修正後の日本語メール1通のResend Delivered/本文1時間/JWT3600秒とowned cleanup/独立保持照合を受け入れた。[限定証拠](evidence/staging-auth-verification-copy-delivery-2026-10-08.json)。本人のGmail受信や残る3言語の新しい実配信へは拡張しない。全画面・実provider・最終統合は未完了。 | 現行画面の必須操作、管理者MFA、登録/password setup/reset、ライセンス取得・返却・移管・抽選・上限・クーポンを統合構成で確認する。現在修正中の既知不具合を解消し、必要な新経路をstagingで確認する。 | #31, #33, #34 |
| 3. 実サービスとのテスト接続 | GitHubは0fb4976/CI37180854336両job・Worker07bf9d61で実callback/provisioning/初回password保存/logout/session失効/同一identity再loginを受け入れた。Googleのcallback保存・既存資格情報のstaging保存とGoogle/GitHub capabilitiesはWorker8bb6b4d9で確認済み。Googleも実callback/provisioning/本人の初回password保存/logout/session失効/同一identity再loginを受け入れた。DiscordもWorkerfa4ef348で実callbackによる既存Google userへの連携・session失効・同一identity再loginを受け入れた。新規Discord user作成/初回設定は未確認。Appleは本人の契約同意・callback追加許可後に本番設定を保持してstaging URLを保存し、Vaultの既存鍵で更新した90日有効なsecretを保存した。初回実callbackのorigin拒否を限定修正し、7e6cf76/CI37192167542両job成功後のWorker495b3ce4でremote form POSTとstate拒否を確認した。実Apple callbackで既存Google userへの連携とsession失効・同一account再ログインを確認した。Apple新規user/初回設定/relayは未受け入れ。Stripeはtest料金19件・専用10 event Webhook（testのみ有効）・test default Portalを作成し、test key/署名secretをstagingへ保存した。Business test Price/modeとMasterのprivate test Price派生版を照合済み。87b61ef/CI37200812928両job成功・Workerca971193でtest Checkout→Creator、Portal支払い確定→Business、Free即時解約→署名反映、重複単一適用・処理済みeventの逆順再送・自然retryと専用合成userのcleanupを確認した。同じWorkerで実登録→Sティア1か月JPY2,000延長、拒否時未延長、3DS成功、実署名自然処理とdelivery2/効果各1・cleanupの独立照合も受け入れた。定期請求の実拒否/past_due、未受信の古い成功eventをdelivery1で初回逆順配送して失敗状態を維持、成功支払いからBusiness/activeと失敗状態クリア、解約/cleanup・独立保持照合も受け入れた。定期請求の実payment_action_required投影、保存済みカードのhosted3DS完了、同じInvoice/PaymentIntentの成功復旧・独立cleanupも受け入れた。12fa13f/Workercc6d9da7で同一合成userの実signin/プラン選択/Checkout→Creator/Portal支払い→Business/警告確認→Free/logoutと独立cleanupを受け入れた。移管の発行/申請/承認、クーポン延長/返却、抽選申込/取消/結果、実test購読からの5件→Free3件の上限選択、有料退会は個別native UIの証拠がある。有料延長の途切れないCheckout復帰と、所有合成licenseの移管lock中の再発行表示は8586601/Workerf6d162c5で受け入れた。短時間の成功toast自体は未捕捉。同じ最終candidateの全フローは未受け入れ。Resendの実登録・メール確認・再設定・変更後のログインは上記の限定証拠で受け入れ済み。本人の既存メール検証accountは保持する。追加の管理reset/告知test各1通はnative送信・Delivered・監査一致を確認し、専用合成actor/draftのみcleanup済み。bulk/実署名provider通知は別条件。Apple/Discord/GitHub/Googleを公開する。 | Stripe sandboxのCheckout/Portal/変更/延長/署名Webhook・重複/逆順/再試行、テスト宛先の認証メール、4 providerの開始/callback/初回設定を確認する。Apple relayも含む。必要なprovider資格情報・テスト設定・テスト送信の許可が必要。本番課金・本番宛先送信は行わない。 | #31, #32, #34, #37 |
| 4. ジョブ・運用・復旧 | 通知DOの起動/排出/停止・復旧、期限処理の合成一回実行、archive smoke、Time Travel/R2 replayの個別証拠はある。隔離実Cronでarchive2件/残す2件・履歴payload/FK・cleanupを受け入れ、独立inventoryも一致した。mainの日次expiry/archive・Paid/CPU30,000msは有効化・配備/readback済みで、2026-10-05 09:00:15 JSTの自然expiry/graceは対象0/競合0・完了台帳を確認した。旧監視の秒完全一致による取りこぼしを修正し、10月6日09:00:57 JSTのmain expiry/grace/archive自然実行は完了/例外0/競合0/残り0で受け入れた。対象0件のhandler観測と隔離環境の有データarchive試験は分ける。監視専用tokenを二つのRead権限・対象account限定・期限11/4で発行し、Macキーチェーン保管と専用CLIの実readを受け入れた。新規一時D1のSELECT成功・非ゼロINSERT認可拒否・同一SQLの配備権限positive controlを確認し、所有D1の削除と独立inventory一致も受け入れた。Authの共通capture/暗号化/空target復旧と明示失効方式を実装し、合成SDK/native D1の失効後login・rollback・lost-ACK保持/再実行拒否を確認した。[限定証拠](evidence/auth-recovery-shared-local-2026-10-07.json)。Business/Masterもnative共通復旧を追加し、R2は新規7 bucket/Workerでclass補完なしの8項目と全資源cleanup/inventory一致を受け入れた。[R2の限定証拠](evidence/r2-recovery-shared-remote-2026-10-08.json)。共通一式collectorは新規6 D1/5 R2/WorkerでMacの保存fileから全desired hash/FK/明示session失効とcleanupを受け入れた（小さい合成fixture）。[限定証拠](evidence/recovery-set-isolated-remote-2026-10-08.json)。通常アプリの整合点・定期監視/秘密運用全体/retention/担当/RPO-RTO・失効方針採用と最終運用は未受け入れ。 | 起動条件/周期/再開/監視、保存期間、担当と権限、秘密の保管・交換、停止時間/復旧時間目標を確定し、合成障害から復旧を実測する。測定で有料planが必要なら設定前に明示する。 | #30, #34, #37 |
| 5. 移送器の合成データ受け入れ | 最新27 Business/4 Authで、同じ暗号化保存bundleから全Master25表/12,254行/98定義、合成Auth9表/16行/30定義、業務40表/15行と分離R2画像2件を2組の新規実D1/R2へ復旧。各Business targetの全27 migration/schemaが現行runtime profileに一致し、全hash/FK0、commit後中断再開、R2 replayと実SDK/owner/catalog/画像を確認。全所有資源削除と独立inventory/main全表hash/Auth3/7/2/Worker d437保持を確認。所要132917/310412msは本番RTOではない。[限定証拠](evidence/full-combined-file-remote-recovery-v27-2026-10-06.json)。実ユーザー移送は0。source converterの4 blocking groups/deployable=false、運用鍵/off-host/retention/失効方針と実運用採用は残る。 | source全schemaの残る4分類を判断し、運用鍵/保存先/失効方針を採用した最終構成で未説明差分0と所要時間を記録する。合成復旧から実ユーザーidentityの移送成立を推定しない。 | #35, #37 |
| 6. 最終統合と引き渡し | desktop・390px viewportのeditor/favorites、API/static/PWA/noindexなどの個別証拠がある。旧source→現行frontendのローカル実ブラウザーで、SW更新/自動reload/旧API cache退役・合成設定保持と現行PWA画面を確認した。現行Workerの同じSafariでJA/EN/KO/IDのアプリ内通知配信・本文・優先言語反映・個別既読と独立cleanupを受け入れた。全言語の全利用フロー、実スマホ・実ユーザーのインストール済みPWAを含む最終通し確認は未完了。PR #41はdraft。 | 同じ最終candidateで主要利用フロー、provider、ジョブ、PC/スマホ、言語、旧client更新、障害/復旧を一巡する。実行結果と残すデータ/DNS工程の手順を更新し、PRの最終差分・CIをレビュー可能にする。 | #33, #37 |

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

## 過去のチェックポイント（2026-10-04〜05）

以下は当時の候補・設定・残件を残した記録。現在の状態と未完了条件は、冒頭の
最新チェックポイントと「完了までに閉じる六つの作業」で判断する。

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

## ステージングの運用backup方針とwriter調査（2026-10-09 JST）

運用方針の質問は回答済み。所有者・毎日/30日・非公開R2・Keychain/Vault・復旧時session失効を
採用し、archive鍵と既存SDK鍵の暗号化escrowを保管・読み戻し確認した。実スマホは未確認。
main97826bffではHTTP/Cronのwriter lifecycleをcontextへ登録し、新規ticketに開始時刻/versionを
保持する。e53558b/CI37856413174両jobとlocal関連検査は成功。通常8種類GET後に旧形式34件/
新形式未終了0件を観測し、データ・設定を独立保持照合した。旧形式34の原因/終了確認は未了。
実archive/同運用鍵のremote復旧・毎日Cron/失敗監視は未受け入れ。
[backupの現在状態](backup-operations.md)・[限定証拠](evidence/staging-writer-lifecycle-remote-2026-10-09.json)。
実ユーザー移送と本番ドメインは引き続き最後の別工程。

### 2026-10-09: fresh staging scope candidate

旧ticket34の終了は未判定のまま保持する。全5 storeを別resourceへ分離するcandidateを
用意し、3D1 schema/非ユーザーマスター/共通6表106行/Auth user・session0と旧全表保持を
独立確認した。旧通知DOが新Businessへ書けないID照合とV2 namespaceを追加した。
現行mainは97826bff/旧scope。新configは配備前でbackup admission pending/Cron0。
実運用archive/隔離復旧/定期運用は未受け入れ。
詳細は[backup operations](backup-operations.md)末尾と[candidate evidence](evidence/staging-resource-scope-v2-candidate-2026-10-09.json)。

### 2026-10-09: fresh stagingの実保存・運用鍵での隔離復旧

205b168/CI37866060471両job成功。新5 store/V2を配備・独立確認した後、main1b57012dで
fresh scope限定のadmissionを採用し、初回6,739,307 bytesの暗号化R2保存・復号/全hash/owner
解除を確認した。保存物から別3D1/2R2への復旧14,591ms・FK0・全回復表/R2の独立照合を
確認し、全所有target/operatorを除去した。旧全表と旧namespace/未判定ticket34は保持。
保存元Auth user/credential/session0、画像R2空での受け入れ。本番利用者移送の証拠ではない。
日次候補09:05 JSTのlocal11件成功、実Cron0/失敗通知未受け入れ。残るprovider/端末と
六工程全体は未完了。詳細は[backup operations](backup-operations.md)末尾と
[限定native結果](evidence/staging-resource-scope-v2-operational-2026-10-09.json)。
