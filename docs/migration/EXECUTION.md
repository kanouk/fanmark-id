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

## 2026-10-06：最新sourceメタデータと手動対応表を機械照合

`source-runtime-review.mjs --counterparts`を追加。最新04:15:10.854785Zのcatalogで
58関数のsignature/hash/型/権限属性/接続数が手動traceと一致し、欠落0。
37 bindings/fingerprintも維持した。定義変更・欠落・重複・過剰approval・aliasの拒否を
含む13 focused試験とeslintが通過。frontend対応表の古い告知送信記述を修正し、
211 callerのcurrent AST/一意mapping2件も通過した。
54 semantic pendingとconverter gateは外さず、本文/trace proseはreportへ複製しない。
source/user/Auth行移送・stored function呼出・main配備は0。
[限定証拠](evidence/source-runtime-counterpart-linkage-2026-10-06.json)。

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

# 2026-10-05 認証メール設定をstagingへ配備

## Saved complete synthetic Auth real-D1 recovery accepted (2026-10-06 JST)

Exact code159f5c1/CI37407917794 both jobs passed before resource creation. The
saved AES-GCM archive, with source runtime already disposed, restored all9
nonempty tables/14 rows/30 schema objects and full column hashes/FK0 into one
owned isolated D1. No trigger correction was needed; existing target refused
before writes. Restore/target verification1144ms excludes deploy, application
checks and cleanup and is not production RTO. A private allowlisted temporary
Worker used the actual router/Better Auth and matching synthetic SDK secret.
Exact bindings, incarnation/origin/private gates and100% version were checked.

Restored session/then-unexpired TOTP assurance, logout/stale cookie, original
password/TOTP, backup consumption/replay refusal and wrong-password/unverified/
suspended refusal passed. Signup/enrollment/deletion/SQL stayed closed. Saved
bytes unchanged; exact-receipt D1/Worker deletion and independent03:24:35.917Z
RO readback preserved all main DB table hashes/FK0, original Auth3/7/2, three-DB/
Worker inventory and Worker8cbe1e5f. No real export, main DB write, main Worker/
R2/DNS change or additional email. [Bounded proof](evidence/synthetic-auth-file-remote-recovery-2026-10-06.json).
Operational keys/retention/revocation and final combined/six-package acceptance
remain open. Mac unlock request remains pending.

## Deferred identity preflight prepared (2026-10-06 JST)

The remaining sequence-key gate now has an executable aggregate-only source
preflight, `scripts/migration/identity-readiness.sql`. It is prepared for the
final user-data stage and has not read actual source rows. All four strict
identity-array importer tables are included: fanmarks, discoveries, favorites
and events. Canonical duplicates block only the three unique identities;
favorites include their owner, events preserve repeated identities. The query
also checks the additional fanmark display-identity unique constraint. NULL,
empty, NULL-element, dimension and lower-bound blockers are counted rather
than repaired, merged, trimmed or skipped.

The same SQL classifier ran on PostgreSQL with only typed synthetic VALUES:
valid8 rows admitted, blocked16 rows rejected with the exact expected aggregate
counts. Order, repetitions, historical length6, different favorite owners and
repeated event history remain valid. The actual importer tests confirm these
retentions and shape refusals on all four tables. Oracle/importer13 cases and
lint pass; normal migration CI now pins the literal observations to current
SQL hashes. No stored application function, real user row, Cloudflare config,
Worker deployment or domain was changed.
[Deferred preparation and bounds](evidence/deferred-identity-preflight-preparation-2026-10-06.json).

Caller-map5ba5f5f / CI37396865202 completed successfully in both jobs. Its
superseded lottery-doc52790bf / CI37396416191 was canceled, not accepted as a
completed CI run; the runtime remains0ed4213 / Workerb3a770b3 at100%.
The generic converter's four groups remain explicit: the identity input/data
policy and uncopied SQL functions/RLS/triggers. This preflight does not claim
whole-source semantic approval or start the deferred real-data migration.
Broadcast's exact one-recipient/message approval question is pending; no send
selector has been enabled. Native paid deletion/admin MFA, provider new-signup/
relay, operational adoption and final integration remain open.

## Current frontend caller map bound to source (2026-10-06 JST)

The old mapping test compared two static documents. Current AST extraction
still yields211 calls, but16 auth/profile/reset call locations had moved while
the documents passed that test. A new comparison rejected these stale rows;
the frontend table and semantic references now match current locations, kinds,
targets, operations and dynamic expressions. All211 have exactly one semantic
entry, with zero operation/target/expression drift. Focused mapping2/2 and the
existing inventory extraction fixture suite pass. Ordinary migration CI runs
both checks; no runtime/API/schema/configuration was changed or deployed.
[Current bounded caller proof](evidence/current-frontend-callsite-refresh-2026-10-06.json).

This closes a stale-evidence gap, not whole-program dataflow or full58-function/
77-policy semantic acceptance. Existing accepted paths are retained; the four
converter blocking groups, provider/operational/final integration gates remain.
Runtime remains0ed4213 / Workerb3a770b3 at100%. Lottery-result UI52790bf is
pushed; its CI37396416191 was still running at this checkpoint.

## Native lottery results accepted (2026-10-06 JST)

Three disposable credential users were created in staging. Actual authenticated
registration, single return and two lottery application APIs produced the
fixture. Only its grace deadline/license end was advanced. One loopback
Wrangler `dev --test-scheduled` request executed the current deployed source
with remote staging D1 bindings; archive and notification wake were disabled
in that local invocation. The deployed Worker, its configuration and daily
Cron were not changed. This is an actual Worker execution with remote D1,
not a naturally triggered deployed Cron with candidates.

The grace finalizer completed one candidate with no conflict, persisted its
seed/input/selection and two-entry history, expired the old license, marked one
entry won/one lost, and issued one active winner license. An actual deployed
Auth POST woke the existing notification DO; all six owned outbox events were
processed and four in-app notifications delivered, without fabricated result
rows or manual notification dispatch.

Native Safari showed the winner's active 🧷/1 of 3 and the loser’s empty/0 of 3
dashboards. Notifications showed the winner's 2026/10/14 09:00 JST expiry and
the loser’s two-applicant result. The winner's mark-read operation persisted
`read_via=app`; both UI logouts left zero owned sessions. After scoped cleanup,
independent read-only verification preserved human Auth3/7/2, all24 Master table
hashes, original profiles/MFA/templates, anonymous history5/8, pre-existing
lifecycle and protected-access rows, all unowned scoped hashes and FK0.
Notification wake23→29/29 was retained. The local dev process and agent-created
native tab were closed. No payment/provider calls were made for this test.
[Result UI and independent cleanup](evidence/staging-lottery-result-native-ui-2026-10-06.json).

Runtime remains0ed4213 / Workerb3a770b3 at100%. The preceding documentation
commit a36b94a has CI37395116307 success in both jobs. This evidence closes
native lottery-result display for the synthetic path. Paid deletion, native
admin MFA, provider new-signup/relay, broadcast approval and final
source/operations/recovery/phone/PWA/language integration remain open.
Older lottery-result pending statements below are historical checkpoints.

## Populated Free downgrade native UI accepted (2026-10-06 JST)

After human approval of the prepared sandbox form, native Safari submitted the
single Creator test Checkout (JPY1,000/month, save-information unchecked).
Signed natural dispatch updated the exact synthetic profile to Creator. The
return page initially retained Free while dispatch was pending; authoritative
reload then showed Creator. This is not proof of uninterrupted automatic
Checkout-return polling.

Five S-tier fanmarks were registered via the actual owner API. Native `/plans`
showed all five, required three selections for Free, and prevented a fourth
selection. Final confirmation returned the excluded two and submitted actual
test subscription cancellation. The Free dashboard showed3/3, the selected
three active and the excluded two returning. Independent D1 reads confirmed
Free, canceled subscription, one submitted test change command, three active
and two returned grace licenses matching the exact selection. The signed Free
reconciliation batch saw three active licenses and returned zero additional
licenses; it did not duplicate the UI returns. Four real signed receipts all
reached terminal states. The invoice's initial reconciliation retry completed
naturally on attempt2; no manual replay or plan override was used.

UI logout revoked the synthetic session. Owned Auth/Business, notification and
billing ledger rows were removed after drain. Separate least-privilege readback
verified Auth3/7/2, all24 Master table hashes, existing profiles/MFA/templates,
all unowned scoped Business hashes, anonymous history5/8 and FK0. Notification
wake advanced21→23/23 and was preserved. Stripe retains the canceled test
customer/subscription and historical invoice/payment artifacts; no live charge
or live account was touched. This does not accept paid-account deletion UI.
[Populated downgrade and independent cleanup](evidence/staging-populated-plan-limit-native-ui-2026-10-06.json).

The separate protected-profile/redirect fixture was already cleaned while this
capacity account was retained (Auth4/8/3 at that earlier checkpoint). Both are
now gone from staging D1. Runtime remains0ed4213 / Workerb3a770b3 at100%.
Paid deletion, lottery results, admin MFA, provider new-signup/relay and final
source/operations/recovery/phone/PWA/language integration remain open.
Older statements below listing populated plan-limit selection as pending are
historical checkpoints.

## Native protected-profile and redirect UI accepted (2026-10-06 JST)

The actual owner settings/profile APIs configured one disposable protected
profile. Native Safari showed the password gate and rendered the exact synthetic
Japanese name/bio after the correct code. The native viewer was the separate
capacity fixture, not the owner or an anonymous session; signing in did not
bypass the fanmark password. The owner API then changed the same license to a
protected redirect without resetting the password. Password generation remained
the same and access generation advanced. A reload showed the gate again, and
correct entry reached the exact configured URL in the actual browser.

Two successful short-selector proofs/attempts were independently observed.
Cookie-free short/emoji reads remained locked with no profile name, bio or target
URL; the standalone public-profile route correctly returned 404 for the protected
profile. This is not native acceptance of a distinct profile-selector proof.
Journal-owned Business/Auth/password/proof/attempt and unshared rate rows were
removed. Separate least-privilege readback verified absence and unchanged
Master24/profile/MFA/templates/wake/anonymous5/8/pre-existing access state/FK0.
Retained Auth4/8/3 comprises original human3/7/2 plus the independent capacity
fixture1/1/1; its session and Checkout were preserved for the next UI check.
[Native profile/redirect and cleanup proof](evidence/staging-protected-profile-redirect-native-ui-2026-10-06.json).

CI37392979553 for da15074 passed both jobs. Runtime remains0ed4213 / Worker
b3a770b3 at100%. Populated plan-limit selection, paid deletion, lottery results,
admin MFA and provider/operations/source/recovery/final integration remain open.
Older statements below that still list protected-profile/redirect as pending
are historical checkpoints. Real-user data migration and domain cutover remain
deferred.

## Native protected-text UI accepted (2026-10-06 JST)

A disposable verified credential/Free profile was seeded, and the actual register
and owner-settings APIs configured protected text on S-tier 🧷. The setup session
was revoked before native Safari accessed the short-ID page without a Better Auth
session. A wrong four-digit entry kept the message hidden and cleared the input;
a correct entry rendered the exact synthetic Japanese message.

The actual emoji URL resolves and redirects to `/a/:shortId` before password
entry. It showed the password gate again and the correct entry rendered the same
message. D1 contains one failure, two successes and two **short-selector** proofs.
This proves both user entry paths, not separate emoji-selector verification or
proof isolation. Cookie-free short-ID and emoji API reads remained locked with
null text. The earlier API selector-binding evidence remains separate.

Journal-owned Business/Auth rows, password config/runtime evidence, proofs,
reservations/audits and two unshared synthetic rate buckets were removed. A
separate least-privilege read-only process verified absence, retained Auth 3/7/2,
all 24 Master hashes against the prior baseline, profiles/MFA/templates/wake,
anonymous history 5/8 and FK 0. The pre-existing audit, reservation and rate bucket
were unchanged; no shared requester bucket was reset. No provider or payment
call, deployment, source-user migration or domain change occurred.
[Native UI and independent cleanup proof](evidence/staging-protected-text-native-ui-2026-10-06.json).

CI 37391902928 for 7988123 passed both jobs. Runtime remains 0ed4213 / Worker
b3a770b3 at 100%. Main natural daily observation is complete; do not restart it.
Next functional UI gates include populated plan-limit selection and paid deletion,
lottery results and protected profile/redirect behavior. Provider new signup,
phone/PWA/language integration and operations/source/recovery gates remain open.
Older pending-Cron and protected-text statements below are historical checkpoints.


## Main natural daily expiry/grace/archive accepted (2026-10-06 JST)

The existing observer29527 completed successfully; it was not restarted or
manually triggered. It received the real `0 0 * * *` invocation scheduled at
2026-10-06T00:00:57Z (09:00:57 JST). Handler outcome is ok with zero exceptions;
expiry and grace finalization are completed with candidates/processed/conflicts0,
and notification archive is completed with archived/remaining/conflicts0.
The completion version check confirms Worker b3a770b3 remains100%.

A separate least-privilege read-only query confirms the exact captured time in
both completed lifecycle D1 ledgers, and the registered daily schedule. This
closes main natural-handler acceptance for an empty eligible set; it does not
prove nonempty archive payload retention or replace the prior isolated populated
archive test. No deployment, source/user migration or DNS change occurred.
[Main daily invocation and independent readback](evidence/staging-natural-daily-2026-10-06.json).
The observer has exit0/one accepted event and is now terminal; do not resume it.

Coupon/return/lottery-entry UI evidence is pushed as bbee951 after two transient
GitHub server failures; no force push or ref rewrite was used. CI37390439255 for
692208d passed both jobs. Operational owner/retention/RPO-RTO policy, broadcast
send permission, populated plan-limit/paid-deletion/protected-password UI,
new social-provider signup/relay and final phone/PWA/language integration remain
separate open work. Earlier daily-pending and live-process statements are
historical checkpoints.

## Native coupon, return and lottery-entry UI accepted (2026-10-06 JST)

Two synthetic Free identities and one disposable coupon were prepared. Native
Safari coupon redemption extends S-tier 🪁 from2026/10/13 to2026/11/13 (38 days);
read-only D1 confirms exactly one completed command and one usage. The first
fixture code exceeded the existing20-character UI limit; the unused synthetic
code was shortened before redemption. No source-backed coupon was consumed.
The same actual UI returned the license, showing active count0/3 and a grace
countdown; D1 confirms grace/is_returned and a future grace deadline.

The other synthetic identity opened details -> search and applied to the same
fanmark's lottery. UI shows one applicant and a cancel button; D1 confirms its
pending entry. UI cancellation returns to zero applicants/apply button and D1
shows the same entry cancelled with user_request. This proves entry operations,
not winner drawing/award/finalization. Native logout leaves zero synthetic
sessions. The owner-return and lottery-application events processed, with one
in-app owner-return notification delivered; wake advances19 ->21/21 and stays
there. No provider call, payment or runtime deployment occurred.

Only journal-owned coupon/usage/command, license/config/entry/audit/notification,
Business profile and Auth rows were removed. Independent least-privilege readback
preserves human Auth3/7/2, retained profiles/MFA, all24 Master table hashes,
four existing coupon definitions, templates and FK0. Actual search added one
candidate/event: anonymous history is now5/8 and is retained, with only the
owned fanmark pointer unlinked. [Scoped UI and cleanup proof](evidence/staging-coupon-return-lottery-ui-2026-10-06.json).
Daily observer29527 remains live for09:00 JST; CI37390439255 for692208d passed both jobs. Next functional UI work is populated plan-limit selection and paid
account deletion, with provider/new-signup/phone/PWA/operations gates retained.
Earlier checkpoint counts and process IDs below are historical.

## Native transfer UI and independent cleanup accepted (2026-10-06 JST)

After the user's explicit approval of the displayed transfer disclaimer, two
synthetic Free identities completed native Safari issue -> recipient apply ->
sender approval -> recipient re-login. The sender shows expired/active count0;
the recipient shows S-tier 🪁, active1/3,7 days through2026/10/13 and inactive.
Read-only D1 confirms completed code/approved request, old expired and new active
licenses, the new inactive basic config and exact30-day transfer lock. Two
transfer events reached processed and their in-app notifications delivered.
The reissue dialog was viewed and cancelled; UI enforcement of the lock was
not tested. Former profile/password settings were not seeded in this fixture.

Both native sessions were signed out; exact synthetic session count is0. The
cleanup helper's first ordering attempted to remove incarnation before license;
the D1 batch rolled back and read-only scoped snapshots remained identical.
Corrected cleanup removed only the journal-owned Business/Auth rows. Separate
least-privilege readback preserved existing3 users/7 accounts/2 sessions, retained
profiles/MFA, all24 Master table hashes, templates, anonymous history4/7 and FK0.
Wake legitimately advanced17 ->19 and remains19/19; it was never reset.
No provider send, paid Checkout or runtime deployment was performed.
[Bounded UI and cleanup evidence](evidence/staging-transfer-ui-2026-10-06.json).

The sender dashboard also rendered in JA/EN/KO/ID with matching license data,
then returned to Japanese. This is dashboard smoke, not all translated flows or
actual mobile-device acceptance. The current frontend callsite map now reflects
configured Auth Resend delivery and accepted verification/reset/login, while
keeping broadcast, administrator-initiated reset and invitation-gated signup
acceptance separate. Runtime remains0ed4213/Worker b3a770b3 at100%.
CI37388658554 for f7707b7 succeeded in both jobs. Daily observer29527 remains
connected for09:00 JST; broadcast message permission and operational policy
approval remain pending. Next UI work includes return/lottery/coupon, plan-limit
selection and paid deletion, followed by the same final integration gates.
Older process IDs and configuration statements below are historical.

## Deployed source Edge bodies verified (2026-10-06 JST)

All35 ACTIVE source functions were read-only downloaded separately with stable
before/after metadata.31 entrypoints and24 complete extracted bundles match the
checkout; four prepared entrypoints and two shared-helper paths differ across
61 file occurrences. Registration316 and its helpers match, binding the valid-
configuration rule consumer review to deployed source. Broadcast36's older
helper uses user_roles admin without current MFA; target Auth adminRole/exact-
session MFA plus Business admin plan is an explicit authorization change.
Billing3/local receipt/pricing preparations and manual expiry14 remain distinct
from deployed source. [Source bodies and dispositions](source-edge-bodies-review.md).
No source function invocation, source mutation, user-row read, provider send,
runtime deployment or DNS change occurred. SQL/RLS/trigger/external-caller and
whole migration acceptance remain false. Preflightddf881a CI37332214832 passed
both jobs. Extension return UI/owned cleanup remain Mac-unlock pending; daily
observer57805 still watches the unchanged b3a770b3 for2026-10-06 09:00 JST.

## Broadcast configuration and master/queue readback (2026-10-06 JST)

The read-only preflight against Worker b3a770b3 at100% confirmed the shared
Resend key/from and Auth Resend/D1 selectors are configured. Bulk/test-send
selectors, the fixed recipient and broadcast signing secret remain absent.
All16 Auth and12 broadcast template content baselines match; drafts/runs/
recipients/suppressions/webhook events/test-send audits and pending email/
Web Push notifications are0. No provider send, D1 write or runtime deploy was
performed. [Bounded evidence](evidence/staging-broadcast-readonly-preflight-2026-10-06.json).

The reusable `scripts/migration/staging-broadcast-preflight.mjs` requires
`--read-only` and an explicit `--expected-version=<UUID>`, verifies identified
app-config Wrangler OAuth/account and split D1 bindings, validates read receipts,
and exports only configuration-presence flags, template baseline state and
aggregate counts. It does not use the least-privilege monitor credential.
September statements that Resend itself was unconfigured are historical;
broadcast provider acceptance remains open independently of accepted Auth mail.
A fixed-recipient rehearsal still needs its exact draft/owned cleanup journal
prepared and explicit message/address authorization before any send.

Source notification processing delivers immediate in-app notifications only;
other channels and delayed notifications remain pending in both source and
target. The checked-in sender search found no separate delivery implementation,
but does not prove external/deployed consumers absent. Do not add speculative
email/Web Push delivery as an assumed migration requirement.

Docs5776d6a CI37329575605 succeeded in both jobs. The extension payment helper
session28440 and daily observer57805 remain alive; Mac unlock/actual returned
UI and owned cleanup, and the2026-10-06 09:00 JST natural daily result are still
pending. Do not replay the paid Checkout or redeploy the watched Worker.
Earlier entries below are historical checkpoints.

## Extension UI payment submitted; return UI requires Mac unlock (2026-10-05 JST)

The retained3/7/2 identity/session baseline and Worker b3a770b3 at100% were
freshly checked. A new synthetic Free owner in an independent signed-out Safari
normal window acquired one S-tier emoji through the actual app. The extension
dialog showed1 month / JPY2,000 and2026/10/13 ->2026/11/13. Its actual sandbox
Checkout was submitted using Stripe's documented test-card values.

Provider readback confirms test-only payment complete/paid for the exact owned
checkout. Natural signed dispatch applied one application, one effect and one
LICENSE_EXTENDED audit; the license is active through2026-11-13. A separate
read-only process verified the exact ledger relationships, original retained
identity/session digests, profiles, Master/reference history, MFA and FK0.
Existing anonymous history3/6 is preserved; the current history is4/7.
[Payment-only evidence](evidence/staging-extension-ui-payment-only-2026-10-05.json).

The Mac locked after payment submission. The return dashboard/date and UI logout
are not yet observed, and the journal-owned synthetic account/license/intent
remain for that verification. Do not replay the paid checkout, create another
fixture or declare whole extension UI/cleanup accepted. On unlock, inspect the
current Safari window and compare its date with the already-applied D1 result;
then remove only the journal-owned fixture and run independent cleanup readback.
Current helper session28440 is the active extension coordinator;
`/tmp/fanmark-stripe-license-ui-journal-2026-10-05-v7.json` is its private journal.
The helper consumed and removed its private Stripe key input file; credentials
are not in Git, Vite or normal logs. No runtime redeploy/user-data/DNS change.

The docs-only d2e9b39 CI37326499893 completed successfully in both jobs. The
[source rule-table review](source-availability-rule-review.md) also resolves the
checked-in valid-configuration caller: enabled rules still return availability
true and calculated price/payment are unused. No speculative enforcement or
whole-source gate approval is introduced.
Earlier entries below are historical checkpoints.

## Acquisition/settings/text UI and independent cleanup accepted (2026-10-05 JST)

Browser connectivity recovered. The retained IAB Google account reaches the
staging dashboard. A separate Safari normal window was confirmed signed out
before using a new synthetic Free owner; the retained human sessions were not
replaced. Actual UI search/availability, acquisition of one S-tier emoji,
settings navigation, text/name save, dashboard 1/3 and seven-day license display,
settings reopen, and public text rendering passed. An anonymous API read without
cookies matched the saved text. A changed unsaved draft survived same-tab reload
while the public API still returned the prior saved text; saving that restored
draft updated the public API. UI logout completed.

The journal-owned synthetic Auth user/accounts/sessions, business profile,
license/settings and fanmark were removed. A separate read-only process verified
their absence, unchanged retained3 users/7 accounts/2 sessions, profiles, Master
release/reference history, MFA and FK0. Anonymous discovery/event history was
retained at3/6; only the pointer to the removed journal-owned fanmark was unlinked.
No anonymous actor ownership was inferred. Notification/Stripe backlog/failure
counts remain0 and wake remains17/17. The human-created mail test account remains.
No billing/provider operation, runtime deploy, real-user migration or DNS change
occurred. This accepts the bounded acquisition/text/settings/draft UI path;
other access types, extension/over-limit/paid-deletion UI and final integration
remain open. [Scoped UI evidence](evidence/staging-acquisition-settings-ui-2026-10-05.json).

Observer6448be6 CI37323113576 completed successfully in both jobs. The existing
read-only daily observer remains connected for2026-10-06 09:00 JST; natural
expiry/grace/archive acceptance awaits the invocation and final version check.
Runtime remains0ed4213 / Worker b3a770b3-8735-4b31-abdd-f4fca99e05cd at100%.
Earlier entries below are historical checkpoints.

## Email/password login after human reset accepted (2026-10-05 JST)

The user logged in through the dedicated Safari private window. The app renders
`/dashboard` and its user menu displays the approved test recipient. Read-only
Auth D1 inspection confirms one active session for the exact journal-owned
user, created after reset completion; the account is credential-only and its
email remains verified. The consumed reset verification record is absent.
No password/hash/session-token values were read. This accepts the functional
signup, confirmation, password-reset and subsequent email/password login path.

An independent baseline excluding only that exact test user/profile/accounts/
sessions preserves the original2 users/6 accounts/1 session identity digest,
Master history, MFA/wake and anonymous search. The approved test account and
its new session remain retained; cleanup is pending. The IAB original Google
session was not replaced. Full mail-test closure and migration acceptance are
still open. No runtime deploy, production-user migration or DNS change occurred.
[Scoped login evidence](evidence/staging-email-password-login-2026-10-05.json).
Earlier observations below are historical checkpoints.


## Human password reset completed; email/password login pending (2026-10-05 JST)

The user submitted the new password. Read-only Auth D1 inspection confirmed
that the exact approved test user's credential `updatedAt` advanced and its
reset verification record was consumed. `emailVerified` remains true; password
and hash values were not read. The test user still has zero sessions, so this
accepts password reset only. The IAB root page retains the preexisting human
Google session and is not evidence of test-user login. An independent baseline
excluding only the exact approved mail-test account preserved the original
2 users/6 accounts/1 session, Master history, MFA/wake and anonymous search.

Chrome was no longer available for the isolated login check. A Safari private
window now shows the staging login form with the approved test email filled
and password blank. Human login with the newly chosen password, exact session
readback and test-account cleanup remain pending. Do not replay the consumed
reset token. No runtime deployment or production data/domain change was needed.
[Scoped reset completion evidence](evidence/staging-email-password-reset-completion-2026-10-05.json).


## Recovery route repaired and actual mail-link form reached (2026-10-05 JST)

The delivered recovery URL correctly points to `/reset-password`, and its
unconsumed verification record was still valid. The app router had retained an
old Better Auth condition that sent both recovery pages to `/auth`. Runtime
`0ed4213ac55620ec45b4d59fcc173005cb1e1de3` removes that condition, preserving
the existing capabilities/token checks in the recovery pages. Application
and Worker CI37298341592 both passed; local typecheck, focused lint and all15
auth-client tests passed. Worker `b3a770b3-8735-4b31-abdd-f4fca99e05cd` is at100%.
Both deployed JS/CSS bytes match the isolated `dist-staging` build. An initial
readback mistakenly compared the unrelated `dist` directory; the mismatch was
resolved read-only against the configured output, without another deployment.
The auth gateway script, other bindings/Crons, original account identity digest,
Master/MFA/wake/anonymous search and the approved new mail-test account are kept.

The existing browser loaded the previous JS bundle initially. A normal reload
loaded the matching new bundle. Reopening the same delivered, still-valid mail
link now displays the Japanese new-password and confirmation fields. The IAB
tab is visible and marked for human continuation; both fields were blank and
no new password was entered/submitted by the agent. The preexisting IAB human
session was not logged out or replaced. This is the rendered reset form check,
not reset completion, relogin, all-client PWA-update or full migration acceptance.
[Scoped route and asset evidence](evidence/staging-password-recovery-route-fix-2026-10-05.json).
The recipient/URL token remain in private custody only. Do not replay a token
already consumed by a subsequent human reset. Preserve the approved test
account until its remaining password/session flow is checked.

## Verification signup accepted; reset-email delivery confirmed (2026-10-05 JST)

On runtime00fc6e7/Worker92413959, the approved recipient completed native signup
and reported receiving/opening the confirmation mail. Read-only D1 inspection
confirmed one new credential account, the exact UUID/command-owned completed
signup attempt and Free profile, and `emailVerified=true`. The mail's callback
returns to the staging root `/`; reaching that guest page does not mean failure
or establish an authenticated session. The verification URL/token is not
recorded in repository evidence and was not replayed by the agent.

The app password-reset request returned200/statustrue for that exact verified
user. Resend's `fanmark-app-staging` key-filtered Sending view lists both the
Japanese confirmation and recovery emails as Delivered. This accepts provider
delivery and the user's reported confirmation receipt/link, not completion of
the password-reset/relogin flow. Reset receipt, human password entry, subsequent
login/session behavior and exact test-account cleanup remain pending.
[Scoped delivery and verification evidence](evidence/resend-staging-verification-delivery-2026-10-05.json).

An independent read-only baseline excluded only the exact journal-owned signup
user/profile/accounts/sessions and preserved the original2 users/6 accounts/
1 session identity digest, all Master history, MFA/wake and anonymous search2/5.
Keep the new approved test account until its remaining flow is checked; do not
run helpers that assume the total Auth count is still2/6/1. No production user
export/import, payment, DNS or runtime deployment occurred in this mail test.
The earlier configuration snapshot below records the pre-email observation.

## Resend staging configuration deployed (2026-10-05 JST)

Runtime `00fc6e7c2d01cdd5ec3174e2216f401b560db383` passed both jobs of
CI37285576515 and is deployed as Worker
`92413959-b8ea-4b62-a841-011acaa0304c` at 100% (09:04:22 UTC).
The user-approved sending-only key is restricted to the already verified
`fanmark.id` domain and was saved/read back in Mac Keychain and the Worker.
The approved private test mailbox is kept outside the repository.
`AUTH_EMAIL_BACKEND=resend`, the staging sender, and
`INVITATION_SIGNUP_BACKEND=d1` are active. Remote capabilities and the native
Japanese auth screen expose signup, verification and password reset.
Bulk broadcast and broadcast-test delivery remain disabled.

The gateway now forwards the selected D1 email-template backend, topology and
Business binding into Better Auth and includes them in its cache identity.
All 50 Auth D1 regressions and 289 migration-boundary tests passed. Verification
and recovery use the selected D1 copy; inactive templates fail without static
fallback. The post-deploy readback preserves the original 2 users/6 accounts/
1 session, all Master history, MFA/wake, anonymous discoveries2/events5,
16 exact auth-template contents, other bindings and both Cron schedules.
The earlier secret-only candidate was not deployed. A terminated deploy
process had uploaded and verified the runtime candidate but had not switched
traffic; read-only reconciliation confirmed the old live version before a
guarded deploy of the existing candidate, without another upload.
[Configuration and preservation evidence](evidence/resend-staging-configuration-2026-10-05.json).

No email has been sent yet. Actual receipt, verification link, password reset,
relogin and exact fixture cleanup remain unaccepted. Chrome's existing
Fanmark mail-test tab is prepared with the approved address and blank password
fields. The user must enter, confirm and submit the new password themselves.
Credential custody and enabled capabilities do not establish mail acceptance.
Production Supabase, real user migration and DNS remain outside this work.
Earlier checkpoints below describe their observation times and do not override
this runtime/configuration checkpoint.


## Current candidate remote recovery (2026-10-05 JST)

Candidate4c2a8c5/CI37246478014 passed both jobs and the combined local step.
Only documentation differs from deployed runtime12fa13f/Workercc6d9da7.
The explicit conductor restored the same40-table/15-row synthetic bundle into
fresh25 Business/4 Auth/8 Master schemas and two split R2 buckets, then restored
it into a second physical target/incarnation. Both accepted source hash/count,
Master/asset equality, real app Storage GET/HEAD, FK and single-wake checks;
primary committed-credential interruption/resume also passed. Fresh provision/
restore took96988ms; this is not a production RTO. The Master fixture contains
3 emojis/4 tiers and is not a backup of the full deployed Master dataset.
Both owned target groups were cleaned. Independent00:25:38.639Z metadata reads
found the original3 D1/3 R2/2 Worker inventory unchanged and all owned targets
absent. Independent00:25:34.927Z app readback retained original2 users/6 accounts/
1 session, Master history, MFA/wake/schema and anonymous search2/5 counts.
No real user/Auth export, DNS, main runtime/selector/secret change occurred.
Auth remains a seeded synthetic dependency user, not credential recovery.
[Current bounded proof](evidence/isolated-combined-recovery-2026-10-05.json).
Private journal:/tmp/fanmark-combined-remote-4c32Hd/journal.json; session34294
exited0. Do not replay this cleaned journal. Main archive natural invocation,
whole-app/provider/mobile/PWA acceptance and operations decisions remain open.

The next license UI helperv5 is prepared but not run: native Chrome reconnection
is still required, followed by a fresh read-only preflight. Search events are
always anonymous, so no ownership inference or DELETE of discoveries/events
is allowed. The helper refuses a preexisting fixture emoji sequence, unlinks
only the journal-owned fanmark pointer, and retains anonymous history. A
transaction guard refuses foreign/null-owner licenses, favorites via discovery
and conflicting discovery identities;9 local SQLite cases pass, including
rollback and source-equivalent sequence matching across case/whitespace/NULLs. This is helper preparation, not actual D1/UI acceptance. Private
helper:/tmp/fanmark-stripe-license-ui-rehearsal-2026-10-05-v5.mjs. No v5 fixture
or provider asset exists. Never replay cleanedv1–v4 journals.

## Fresh source and browser checkpoint (2026-10-05 JST)

Runtime12fa13f/Workercc6d9da7 is unchanged; documentation674d0dd/CI37245109681
passed both jobs. Source metadata was read in four read-only transactions at
23:39–23:40 UTC: all schema sections/locale/regex probe,58 functions,37 bindings,
77 policies and both source Cron definitions/states match the prior records.
The current manual58/77/37 indexes also match identities and hashes exactly.
[source evidence](evidence/source-current-readonly-refresh-2026-10-05.json).
Converterv43 retains four groups and full runtime/authorization/converter flags
stay false. The unchanged13-row synthetic import was not repeated.
The freshv4 license UI fixture was created but native Chrome CUA initialization
failed before registration/payment; the child exited and exact journal cleanup
succeeded. Independent23:33:34.203Z readback preserved original2 users/6 accounts/
1 session, all owned Business counts, Master history, MFA/wake and schemas.
Mac console was unlocked. IAB2/Resend23 is responsive at/login; native Chrome
returns initialize timeout. Native reconnection and Resend login remain pending.
Never replay cleaned billing journalsv1–v4. The main natural lifecycle ledger now
shows expiry/grace completed at00:00:15 UTC with zero candidates/conflicts.
An exact-second observer filter discarded the daily tail result, so main archive
and complete handler outcome remain unaccepted; minute invocations were ok.
Independent00:07:32Z reads retain2/6/1, Master/MFA/wake/schema and other counts.
Anonymous search activity added2 discoveries/5 search events at23:41–23:42 UTC;
provenance is unknown and rows were preserved. Do not require these tables empty
or delete unknown activity. [Scoped daily proof](evidence/main-natural-lifecycle-ledger-2026-10-05.json).
Operations decisions and remaining UI/provider/final integration stay open.


## Current source preparation checkpoint (2026-10-05 JST)

Runtime remains12fa13f/Workercc6d9da7; documentation7a7e717 CI37242431058
passed both jobs. No runtime was redeployed by this preparation run.
Converterv43 with an explicit credential descriptor on the saved
2026-10-02T14:21:25.605664+00:00 catalog retains four blocking groups:
sequence-key input contract, functions, RLS policies and triggers. All58
captured function hashes match the independent October3 counterpart evidence;
this is correspondence, not semantic approval or a new source observation.
Current25 Business/4 Auth local schemas accepted40 checkpoints/13 synthetic
rows, committed interruption/resume, fresh-target restore69056ms, one wake
and credential-coverage tamper refusal. Master/R2 and real Auth credentials
are excluded; full runtime/converter/migration flags remain false.
[Scoped evidence](evidence/schema-current-preparation-2026-10-05.json).
Frontend Stripe/private-price mapping and current staging schedule descriptions
now match the accepted test-only connection and enabled daily selectors.
Resend is at the in-app login handoff; no mail or credential change occurred.


runtime `12fa13f` / CI37208535583両job成功・100% Worker `cc6d9da7` を維持。
前回の記録58a066d / CI37209348857も両job成功した。Mac解除後、保持する本人IABの
古い`/plans`は旧JSのため設定エラーが残ったが、通常reloadで新JSへ更新され、
Free/Creator/Businessの価格0/1,000/2,000円と上限3/10/50を実画面で確認した。
本人の有料ボタンは押していない。これは当該画面の更新で、全PWA更新の証拠ではない。

別のChrome専用タブで新しい合成ownerを通常ログインし、dashboard Free/0件/上限3から
実プラン選択→sandbox Checkoutの公式4242カード支払い→Creatorの現在プラン表示、
実Business変更→Portalの未払い請求/保存済みtestカード確定→日割り1,000円支払い済み→
アプリへ戻ってBusinessの現在プラン表示、Freeの警告確認→即時解約→Freeの現在表示と
上限3、通常logout後のguest画面を確認した。自然毎分処理を待ち、D1を直接変更せず、
支払い後の手動reloadも行っていない。provider APIと別processの読み取り専用照合は
Business/active/2,000円、Free/canceledと一致した。正確な反映時間やtimeout toastの
不在は測定していない。全license/延長/上限超過選択/有料退会のUI成功とは扱わない。

解約通知を含む7 receiptはapplied6/ignored1・各delivery1でdrain済み。
所有test Customerを閉じ、所有Auth/profile/契約/command/台帳等を限定cleanupした。
独立23:01:29.999Z readbackで元の2 user/6 account/session1・40表所有件数・Master全履歴・
MFA/wake・schemaの一致を確認した。test請求/event履歴と設定用料金を保持する。
実課金・ユーザー移送・DNS・runtime/schema再配備はない。
[実画面と独立照合の証拠](evidence/stripe-staging-subscription-ui-2026-10-05.json)。

Chrome extensionの操作は応答せず、native操作へ切り替えた。先行v2 fixtureはCustomer/
Checkoutを作る前にcleanup済み。六作業の完了条件はCOMPLETIONを維持し、日次自然発火、
Resend、Apple/Discord新規登録/relay、source/converter照合と最終統合は残る。
以下は過去のcheckpoint。

# 2026-10-04 実プラン画面の設定503を修正・staging APIを確認

専用合成ownerの実Chromeシークレットログインでdashboard Free/0件/上限3を確認し、
「もっとファンマを増やす」から実`/plans`へ移動したところ、設定読取エラーを確認した。
公開設定APIがprivateにしたtest Stripe Price IDにもpublic flagを要求して503を返していた。
価格IDを公開読取から外し、公開設定11キー／MFA付き管理者設定19キーに分けた。
旧sourceのpublic flag付きlive価格IDも公開応答へ返さない。管理者読取はtest/live価格IDの
旧flag1とprivate flag0を扱い、実値を変更する監査付き更新では当該価格IDをprivateへ揃える。
Enterpriseの厳格なprivate flag確認、料金を既定値で隠さないエラー表示は維持する。

`12fa13f`はclient4件、Worker/Lifecycle13件、両typecheck、変更箇所ESLintと
[CI37208535583](https://github.com/kanouk/fanmark-id/actions/runs/37208535583)両jobが成功。
専用whoamiと元状態を照合後、100% Worker`cc6d9da7-b81b-45fe-b0be-6c0978570232`へ配備した。
独立監視tokenで公開設定200/no-store・exact11キー・価格IDなし、匿名管理設定401、
元の2 user/6 account/session1・40表所有件数・Master全履歴・MFA/wake・他binding/
秘密14名称・毎分/日次Cron・schema不変を確認した。元のprivate test価格IDは維持する。
決済前の合成ownerはCustomer/Checkout/請求を作る前に片付けた。初回cleanupのD1要求は
失敗したが、CLI認証を更新した別processで同じjournalの所有fixtureだけを回復・削除し、
独立read-only照合で元状態一致を確認した。アプリ障害とは混同しない。

配備後の実画面操作はMacがロックされ、自動解除も失敗したため未実施。
Macの手動解除を依頼済み。再確認用のprivate v2 fixture/preflight/独立readbackを準備したが、
新fixtureはまだ開始していない。公開設定APIの回復から実画面・同一利用者の決済フローの
成功を推定しない。[設定修正の証拠](evidence/plan-settings-public-projection-2026-10-04.json)。
以前のStripe testサービス受け入れは過去証拠として保持し、新runtimeの全体統合成功とは
扱わない。六作業の完了条件と実ユーザー移送・本番課金・公開domain/DNSの除外は維持する。
以下は過去のcheckpoint。

# 2026-10-04 定期請求の追加認証・同じPaymentIntentの復旧を確認

runtimeは`87b61ef`/CI37200812928両job成功・Worker`ca971193`を維持。
前回記録`440b124`のCI37205271256も両job成功した。新しい専用合成ownerの
paid Creator契約をprovider APIで作り、アプリのBusiness変更APIで生じた未払い請求に
公式always-authenticateのtest PaymentMethodを使った。実PaymentIntent requires_action、
invoice open/支払い0と、実署名invoice.payment_failed/payment_action_requiredを確認。
自然毎分処理後、D1/本人用DTOはpast_dueとinvoice.payment_action_requiredになり、
未決済のプランはCreatorを保持した。別processのread-only照合も一致した。

同じ請求のhosted画面で保存済みVisa3184の確認ボタンから公式3DS Test Pageを開き、
COMPLETEを実行した。画面はJPY1,000の支払い済み表示になった。同じinvoice/
PaymentIntentがpaid/succeededとなったことをprovider APIで確認し、自然署名処理後に
Business/activeと失敗時刻/typeのNULL化を独立read-only processで確認した。
アプリFree解約→署名反映後、所有test Customerを閉じ、全dispatch完了後に専用
Auth/profile/契約/command/台帳/receipt/fence等だけを片付けた。独立確認で合成行0、
元の2 user/6 account/session1、40表所有件数・Master全履歴・MFA/wakeが一致した。
app/auth200・attention空。Webhookの10 event選択は変更しなかった。
[定期請求の追加認証証拠](evidence/stripe-staging-invoice-authentication-2026-10-04.json)。

初期契約はprovider API fixtureで、本人用HTTP sessionとhosted Stripe画面の検証。
同一利用者のアプリ全画面、実スマホ、Resend、Apple/Discord新規登録/relay、
日次自然発火・運用・最終統合とsource/converter照合は残る。実課金・実ユーザー
移送・公開domain/DNS変更、コード/schema/再配備はない。六作業の完了条件は
COMPLETIONを維持する。以下は過去のcheckpoint。

# 2026-10-04 定期請求失敗・初回逆順配信・復旧を確認

runtimeは`87b61ef`/CI37200812928両job成功・Worker`ca971193`を維持する。
前回記録`7118315`のCI37203735982も両job成功。専用合成ownerのStripe test契約を
provider APIで作成し、アプリAPIでCreatorからBusinessへ変更を要求した。
公式拒否payment methodによる実請求の402/card_declined、未払いopenを確認。
実署名invoice.payment_failedの自然毎分処理後、D1と本人用subscription DTOに
past_due/失敗時刻/失敗typeが反映され、プランはCreatorのままだった。

最初の成功通知だけを専用test endpointのevent選択から一時保留し、初期契約作成後に
元の10 eventへ戻した。失敗適用後も古い成功receiptが存在しないことを別processで
確認してからStripe CLIでその実eventを初めて配送した。delivery1/appliedとなり、
台帳は古いsource invoiceから現在の失敗invoiceを再取得してpayment_failedを維持した。
古い成功で失敗を消さないことを独立read-only照合でも確認した。
その後同じ未払い請求を公式成功payment methodで支払い、実署名処理後に
Business/active・失敗時刻/typeのNULL化を独立確認した。

アプリFree即時解約の署名反映後、所有test Customerだけを閉じ、全dispatch完了後に
専用Auth/profile/契約/command/台帳/receipt/fence等を片付けた。別processで合成行0、
元の2 user/6 account/session1、40表所有件数・Master全履歴・MFA/wakeの一致、
app/auth200・attention空を確認した。test請求/event履歴と設定は保持する。
[定期請求の実サービス証拠](evidence/stripe-staging-invoice-provider-2026-10-04.json)。

今回はprovider API fixtureと本人用HTTP APIの検証で、同一利用者の画面全体や
新規app Checkoutの追加証明ではない。subscription invoice payment_action_required、
Resend、Apple/Discord新規登録/relay、日次自然発火・運用・最終統合は残る。
コード/schema/配備の変更、実課金・実ユーザー移送・公開domain/DNS変更はない。
六作業の完了条件はCOMPLETIONを維持する。以下は過去のcheckpoint。

# 2026-10-04 Stripe実延長・カード拒否・3DS・重複単一適用を確認

runtimeは引き続き`87b61ef`/CI37200812928両job成功・Worker`ca971193`。
前回記録head`5abbd06`のCI37202161221も両job成功した。コード/schema/配備の
追加変更はない。専用の合成Auth userで実signinし、アプリの登録APIから
1絵文字のSティア（内部4）を取得し、同じ延長requestの2回送信で同一Checkoutを確認。
1か月JPY2,000のStripe hosted Checkoutで公式拒否カードの失敗表示を確認し、
その時点の期限・application/effect/auditが未変更/0であることを確認した。
続いて公式3DSカードのchallengeを完了し、Stripe画面で成功/3DS認証成功/拒否履歴を
確認した。実署名checkout.session.completedを自然毎分dispatchが処理し、期限が
2026-10-12 UTCから2026-11-12 UTCへ延び、application/effect/監査各1件になった。
同eventのStripe Dashboard再送後もdelivery2・効果各1件、期限は同じだった。
別processのread-only monitorで延長・重複単一適用を独立確認した。

fixture所有journalをmutation前に保存し、receipt/dispatch完了後に専用Auth user/
account/session、profile、fanmark/license/config、intent/application/effect、監査、
receipt/dispatchを片付けた。別processで合成行0、元の2 user/6 account/session1、
元の40表の所有件数・Master全履歴・MFA/wakeの完全一致、app/auth200・attention空を
確認した。Stripe test支払い/event履歴、19料金/Webhook/Portal設定は残す。
[実延長と独立照合](evidence/stripe-staging-extension-provider-2026-10-04.json)。

最初のharnessは1絵文字を内部Tier1と誤指定して決済前guardで停止した。アプリの
登録は成功しており、所有fixtureのcleanup・独立baseline一致後、実Masterの
Tier4条件で再実行した。この検証手順の失敗も証拠へ残し、runtime変更は行わない。

今回の拒否/3DSは一回払いの延長Checkoutであり、subscription invoice failure/
payment_action_requiredやasync/expired延長、未受信eventの初回逆順配信は未確認。
Hosted Stripe UIと合成userのHTTP sessionは別で、本人のブラウザsessionを保持した。
同一利用者のアプリ全画面・実スマホは未受け入れ。次はsubscriptionの失敗通知・
初回逆順配信、承認済み宛先Resend、Apple/Discord新規登録、日次自然発火・運用・
最終統合。六作業の完了条件はCOMPLETIONを維持する。実課金・本番Stripe・
実ユーザー移送・公開domain/DNSは変更していない。以下は過去のcheckpoint。

# 2026-10-04 Stripeの実test決済・Portal・プラン変更・cleanupを確認

`87b61ef`/CI37200812928はアプリ・Workerの両job成功。空POST streamのPortal拒否を
修正してWorker `ca971193`へ配備し、4 provider/secret14名称・Cron2件と元の人の
account/profile、Master/MFA/wakeを保持した。Portal回帰7件と型確認も成功。

アプリAPIから専用合成userのtest Checkoutを作成し、同request再試行で同sessionを
確認した。Stripe公式4242 test cardで支払いを完了し、実署名Webhookと自然毎分Cronで
Creator ¥1,000が反映された。Business変更では追加確定が必要となり、修正後Portalに
「テスト環境」・未処理請求を表示し、公式テストカードによる支払い確定を行って、
Business ¥2,000/activeへの反映を確認した。アプリAPIからFree変更を要求し、
実subscription.deletedの自然処理でFree/canceledへ反映された。

古い作成eventをStripe Dashboardから再送し、delivery3・application1を独立確認した。
Business反映後の古いevent再送でもCreatorへ戻らなかった。これは処理済みeventの
逆順再送であり、未受信eventの初回逆順配信は未受け入れ。private flag修正前に保留した
subscription/invoiceが自然retryで成功し、最終全7 receipt/dispatchは正常に完了した。

保存済み所有journalだけを使い、解約・drain後に専用test Customer、合成Auth user/
account/session・Business profile/commands/projection/receipts/fenceを片付けた。
別processのread-only monitorで合成行0と元の2 user/6 account/session1、元の40表の
所有行件数、Master全履歴、MFA/wakeが一致することを確認した。Stripe側のtest
請求書/支払い/event履歴と設定用19料金・Webhook/Portalは保持する。
[実サービス検証と独立readback](evidence/stripe-staging-real-provider-2026-10-04.json)。

Hosted Checkout/Portalのブラウザと、合成userのHTTP sessionは別であり、既存人の
ブラウザsessionは保持した。同一利用者によるアプリ画面全体の受入とは区別する。
次は実延長Checkout、支払い失敗/3DS、初回逆順配信、承認済み宛先Resend、
Apple/Discord新規登録、日次自然発火・運用・最終統合。全移行は未完了。
実課金・本番Stripe・実ユーザー移送・公開domain/DNSは変更していない。
以下は過去のcheckpoint。

# 2026-10-04 Stripe test-only runtime配備・Webhook有効化を確認

ebfbcf6/CI37199647817はアプリ・Workerの両job成功。
Worker b79307caに6 billing selectorと毎分Stripe dispatchを配備した。
読み取り専用監視tokenで配備version/100%、selector、Cron2件、secret14名称を
独立確認した。匿名Checkout401・foreign Origin403・未署名Webhook400を確認。
配備前後で人の2 user/6 account/session1、MFA、Master generation13と全履歴、
その他bindingとwakeを保持した。専用10 event test Webhookを有効化した。
[配備と有効化の証拠](evidence/stripe-staging-billing-deployment-2026-10-04.json)。

専用の合成userで実test Checkoutの支払い成功と署名Webhook3件の保存を確認した。
日次Cronとは別の毎分dispatchも実行され、sourceから継承したtest Price設定の
公開flagを安全側の照合が拒否した。test Price3件だけをCASでprivateへ修正し、
同じID・価格を保持した。自然retryによるプラン反映を確認中。
料金PortalはCloudflareの空POST streamを非空本文と誤認して400となるため、
EOFを許可して実データの最初のbyteを拒否する修正と回帰試験を追加した。
同修正のCI・配備・実Portalは未受け入れ。
合成userのpassword/cookieをファイル・ログへ保存せず、既存人のアカウントは維持する。
実課金・本番Stripe変更・実ユーザー移送・公開domain/DNSは行っていない。
以下は過去のcheckpoint。

# 2026-10-04 Stripeテスト接続を設定、決済runtimeのCI・配備前

本人のStripeログイン後、Fanmarkのtest accountと既存test keyの接続を確認した。
従来のstaging設定のPriceはtest accountに存在せず、月額3件・延長16件のtest
Product/Priceを作成した。API versionは既存と同じ2025-08-27.basil。stagingだけに
STRIPE_SECRET_KEY_TEST/STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRETを保存し、
Worker088becec/runtime7e6cf76・secret14名称となった。既存2 user/6 accountと
MFA fingerprint、その他bindingsを保持した。10 eventの専用Webhookは無効で待機。

Businessのtest Price 3設定とstripe_mode=testをCASで保存し、Masterは元版を保持して
private test Price IDだけを差し替える派生版を作成した。最初の派生版でティア価格の
単位変換誤りをreadbackが検出したため元版へrollbackし、物理centsを配備前に照合して
修正版をpromoteした。最終generation13、元の価格・他マスター内容と全履歴を保持。
料金ポータルはtest defaultを作成し、請求履歴/支払い方法更新のみを許可する。
[設定と修正の証拠](evidence/stripe-staging-test-setup-2026-10-04.json)。

077c30eのCIで、日次のみ・provider無効を想定する試験fixtureが現在の設定を継承して
失敗した。fixtureを明示的に無効化し、実staging設定のStripe test-only/毎分dispatchを
別に照合した。0e75c88では隔離local editorのprovider無効guardもStripe設定の継承で
拒否したため、同fixtureの6 billing selectorを明示的に除外した。local Worker/25 Business・
4 Auth・8 Master/実cookie/browser/保存・画像・所有権の通し試験が成功した。実スマホの
検証ではない。inert rehearsalのtarget guardは緩めず、ローカルmigration289件は成功。
次は修正後候補のCI確認・staging配備、
その後に専用test Webhookの有効化と実Stripe Checkout/Portal/変更/延長の確認。
毎分通知pollingはDO selectorで選択されない。日次expiry/archiveはUTC00:00のまま。
実課金、実ユーザー移送、公開domain/DNSは後工程。Resend宛先と別Apple/Discord
新規登録用アカウントの回答も待つ。以下は過去のcheckpoint。

# 2026-10-04 監視tokenの実D1書込み拒否・後片付けを確認

2f45451/CI37195682605は両job成功。専用identity確認後、新規一時D1で
監視tokenのSELECT成功、1行INSERTの認可拒否・保存0、同一INSERTの配備権限
positive control成功を確認した。UUID/name/作成時刻を照合して所有D1だけを削除し、
別processの独立readbackで元の3 D1 inventoryの完全一致とprobe D1不在を確認した。
Worker495b3ce4、設定、保持4 provider identityとsessionは不変。
[書込み拒否の実証拠](evidence/staging-monitor-write-denial-2026-10-04.json)。

先行ゼロ行UPDATEの限界を、実際の非ゼロ書込み拒否で補った。定期監視と秘密更新/
復旧運用の全体完了は推定しない。Stripeのin-appログイン画面tab17を開き本人の
ログイン待ち。Resendテスト宛先と別Apple/Discord新規登録用アカウントを確認中。
これらを待つ間もsource/運用/最終統合の残項目を進める。実ユーザーデータ移送と
公開domain/DNSは後工程。以下は過去のcheckpoint。

# 2026-10-04 Apple既存account連携・session失効・再ログインを確認

本人の新しいApple認証でdashboardへ復帰し、最初のcallbackと同じApple account・
Google user・Business profileへの対応とsession1を独立readbackで確認した。
Auth user2/account6/session1、Business profile2。元GitHub/Google credentialと
Discord連携を保持する。通常logout/session0・/auth再読込時の未認証も確認済み。
Worker495b3ce4/runtime7e6cf76は不変で、今回コード・資格情報・schemaは変更しない。
[実callback/logout/reloginの証拠](evidence/apple-staging-real-auth-2026-10-04.json)。

この実フローは既存Google userへの連携であり、Apple新規user/初回password setup
とrelayは未受け入れ。Discord新規登録も残る。次はこれらとStripe sandbox、
承認済みテスト宛先Resend、自然Cron・運用・最終統合。実ユーザーデータ移送と
公開domain/DNS切替は後工程。以下は過去のcheckpoint。

# 2026-10-04 Apple既存account連携・session失効を確認、再ログイン待ち

Worker495b3ce4/runtime7e6cf76で本人の実Apple callbackがdashboardへ戻り、
既存Google userへのApple account連携とsession所有者の一致を確認した。
Auth user2/account6/session1、Business profile2。元のGitHub/Google identity・
credentialとDiscord連携を保持する。通常logoutでsession0、/authの再読込も未認証。
再ログインは開始から10分以上後にstate_mismatchで戻り、session0/account6を
再確認した。期限切れは有力な仮説だが、cookieの具体的な失敗は取得していない。
[実callback/logoutの証拠](evidence/apple-staging-real-auth-2026-10-04.json)。

次は本人が/authのAppleボタンから開始し、続けて認証する。先にOAuthを開始して
長時間待たない。再ログイン、新規Apple user/初回password setup、relayは未受け入れ。
staging appで待機し、資格情報・schema・Worker配備・本番データ/DNSは変更しない。
fdc3bf7の文書CI37193005708は両job成功。以下は過去のcheckpoint。

# 2026-10-04 Apple form POST修正をstaging配備・本人パスワード入力待ち

7e6cf76/CI37192167542は両job成功。保持データ/設定のguardを確認して配備し、
100% Worker `495b3ce4-7733-40c5-82e6-c7d4c180d287`でApple由来form POSTの302、
redirect先で不正state/cookieなしの拒否、Apple Originで他の認証操作の403を確認した。
secret11名称・他binding/limits、GitHub/Google user2/account5（Discord連携含む）/
session0とMaster/参照履歴・MFA/wakeの一致を配備前後と合成probe後に確認した。
DB schema/資格情報は変更していない。独立監視はapp/auth200・attentionなし。
[配備とremote probeの証拠](evidence/apple-form-post-deployment-2026-10-04.json)。

新しいstaging開始から既に承認済みの同じApple app/scopesへ進み、本人の
Apple Accountパスワード入力画面（tab8）に到達した。パスワードは入力していない。
実Apple callback/provisioning/初回設定/logout/reloginはまだ未受け入れ。
次は本人サインイン後の実callback/session確認。古いcallbackを再送しない。
ユーザーデータ実移送/DNS切替は後工程。以下は過去のcheckpoint。

# 2026-10-04 Apple callback origin拒否を再現・限定修正、配備前

本人のApple認証がcallback画面の`forbidden_origin`で停止した。
以前の合成callbackはアプリOriginを送っており、実Appleのcross-site form POSTを
再現していなかった。テストをcookieなしのApple Origin POST→cookie付きGETへ修正し、
修正前gatewayで403を再現した。専用path/POST/正確なApple Origin/form-urlencodedだけ
受け付けるよう変更し、共通trustedOrigins/CORSは広げない。業務policy/schema再確認と
SDKの元state cookie照合は保持する。OAuth66件、Auth48件、型と変更箇所ESLintが成功。
[回帰証拠](evidence/apple-form-post-regression-2026-10-04.json)。
CIと保持account/master/設定の再確認後にstagingへ配備する。現時点では未配備で、
実Apple callback/初回設定/logout/reloginは未受け入れ。以下は過去のcheckpoint。

# 2026-10-04 Apple staging callback・有効な資格情報を保存

本人の追加保存許可後、既存Services IDへstaging domain/callbackを保存し、設定を
開き直して本番domain/callbackとの併存とFanmark Primary App ID保持を確認した。
Vaultの既存Fanmark用.p8とApple Keyの対応、source JWTの署名一致を検証した。
source secretは期限切れだったため再利用せず、同じ鍵で90日有効なJWTをメモリ内生成。
source設定/secretは変更せず、秘密鍵再発行と鍵本体のuploadも行っていない。
JWTは標準入力だけでstaging Workerへ保存し、値を出力・Git・通常ファイルへ保存しない。
有効期限は2027-01-02T09:08:25Z（JST 18:08）。それ以前の更新が必要で、
更新運用・実Apple認証・relay/初回設定・logout/reloginは未受け入れ。

HEAD a3dbb5c/CI37189226939両job成功のcandidateでsecret設定のみを更新した。
Workerは100% `4bc50d76-ec1d-4565-af73-b9199e79bfa9`、runtime codeは`0fb4976`。
GitHub/Google user2・Discord連携を含むaccount5・session1とBusiness profile2、
Master/参照履歴・MFA/wake・他binding/CPU limitsの保存前後一致を確認した。
secret11名称、capabilitiesはApple/Discord/GitHub/Google。独立監視はattentionなし。
[値を含まないApple設定証拠](evidence/apple-staging-credential-installation-2026-10-04.json)。
その後、通常logoutでApple実認証を始めるためstaging /authを開いた。
既存試験identityは保持し、本番ユーザー移送・DNS切替はしていない。
次は本人のApple認証、Discord新規登録、Stripe sandbox、承認済み宛先Resend、
自然Cron・運用・最終統合。以下は過去のcheckpoint。

# 2026-10-04 Apple同意後の設定準備・既存secret期限切れ

本人のApple契約同意後、Identifiersへのアクセスを確認した。既存Services IDと
source Client IDの一致、Fanmark Primary App ID、本番domain/callbackを確認した。
staging domain/return URLは追加フォームへ入力済みだが保存前で、具体的な承認待ち。
source secretのJWT payloadを秘密値の出力なしで読み、subject/audience一致と
`exp=2026-05-25T22:39:40Z`を確認した。署名/Apple側の検証は未実施。
期限切れsecretは保存せず、source設定もSaveせず閉じ、秘密値の保持を解除した。
repo/Downloadsに`.p8`は見つからず、既存鍵の場所を本人へ確認中。
remote設定保存・再配備・本番切替は行っていない。詳細はHANDOFF最新checkpoint。
以下は過去のcheckpoint。

# 2026-10-04 Discord既存account連携・失効・再ログインを受け入れ

最初の本人認証は`state_mismatch`で/authへ戻った。直近の失敗URLからerror codeだけを
確認した。期限切れは可能性の一つであり断定しない。新しい開始から同じapp・既に
許可済みのidentify/email範囲で再認証すると、dashboardへ戻った。
実Discord accountのsession所有者は既存Googleユーザーと一致し、元のGoogle/GitHub
user/profile・credentialを保持している。Auth user2/account5/session1、Business profile2。
通常ログアウトでsession0、再読込後も未認証、同じDiscordの再ログインで同じidentityと
session1・dashboard復帰をremote readbackとブラウザで確認した。
[Discord実認証証拠](evidence/discord-staging-real-auth-2026-10-04.json)。
この実認証は既存Googleユーザーへのaccount連携であり、Discord新規user作成と
初回password setupは通っていない。新規登録経路の実受け入れは未完了として保持する。
試験identity/credentialは削除せず、旧owned行0件canaryは使わない。
Worker `fa4ef348`/runtime code `0fb4976` は不変。直前HEAD `19e953d`の
CI37188231327は両job成功。今回コード修正・再配備は行っていない。

Appleの既存source client設定を読み取り、provider Save/secret revealはしていない。
Apple Developerにはログイン済みだが、最新Program License Agreementへの同意前は
Certificates, Identifiers & Profilesへ入れない。契約レビューをtab16で開き、同意ボタンは
押していない。本人の契約確認/同意待ちで、Apple callback/資格情報は未保存。
次はApple設定、Discord新規登録、Stripe sandbox、承認済み宛先のResend、日次自然発火、
運用と最終統合。既存ユーザー/Auth/Storageの実移送・公開domain/DNS切替は後工程。
以下は過去のcheckpoint。

# 2026-10-04 Discord callback・既存資格情報保存、本人ログイン待ち

本人の具体的な承認後、移行元と一致する既存Discordアプリへstaging callbackを追加・
保存し、再読込で本番`https://auth.fanmark.id/auth/v1/callback`と両方の存在を確認した。
既存Client ID/SecretをSupabaseから読み、FIFOとWrangler stdinでapp stagingへ保存した。
移行元provider設定のSaveとsecret再発行は行っていない。秘密値は出力/Git/通常ファイルへ
保存せず、private FIFOはinstaller終了後に削除した。
Workerは100% `fa4ef348-c19c-4c33-87b5-2183db983cfd`、runtime codeは`0fb4976`。
設定を保存したcandidate `b08deeb`はCI37186918306両job成功。アプリ/schema再配備はない。
保存前後の本人管理GitHub/Google account、Masterと参照履歴、MFA/wake、その他binding/
CPU limitsの一致を確認した。secretは9名称、capabilitiesはDiscord/GitHub/Google。
[値を含まないDiscord設定証拠](evidence/discord-staging-credential-installation-2026-10-04.json)。
Google sessionを通常ログアウトし、stagingのDiscordボタンから実認証を開始した。
Discord側の本人ログイン画面（tab8）で入力待ち。実callback/provisioning/初回設定と
logout/reloginは未受け入れ。試験アカウントは保持し、旧全owned行0件canaryは使わない。
Google/GitHubの実認証受け入れは完了。残りはDiscord実認証、Apple、Stripe sandbox、
承認済み宛先のResend、日次自然発火、運用と最終統合。
既存ユーザー/Auth/Storageの実移送・公開domain/DNS切替は後工程。
以下は過去のcheckpoint。

# 2026-10-04 Google初回パスワード保存・失効・再ログインを受け入れ

本人のパスワード保存後、credential作成とsetup flag0、dashboard到達を確認した。
通常ログアウトでAuth session0となり、ページ再読込後も未認証だった。同じGoogleで
再ログインし、同じuser/profile/accountを保持してsession1・dashboardへ戻ることを
実ブラウザとremote readbackで確認した。パスワード値/hashは取得していない。
[Google実認証の証拠](evidence/google-staging-real-auth-2026-10-04.json)。
GitHubとGoogleの本人管理staging user2/account4・Business profile2を保持する。
元のGitHub identity/credentialのdigestは一致し、旧全owned行0件canaryは使わない。
Workerは`8bb6b4d9-a9e1-42c4-8963-6348e05d05ce`、runtime codeは`0fb4976`。
直前HEAD `6bc760b`のCI37185439067は両job成功。今回コード修正・再配備は行っていない。
次はDiscord/Apple、Stripe sandbox、承認済み宛先のResend、日次自然発火、運用と最終統合。
既存ユーザー/Auth/Storageの実移送・公開domain/DNS切替は後工程。
以下は過去のcheckpoint。

# 2026-10-04 Google設定保存・資格情報移送と監視tokenの実接続

本人の具体的な承認後、既存Google OAuth clientへstaging callbackを追加・保存し、
本番`https://auth.fanmark.id/auth/v1/callback`を保持した。既存secretはSupabaseの
Google設定から読み取り、値をファイル/ログ/Gitへ入れずFIFOとWrangler stdinから
`fanmark-app-staging`の`GOOGLE_OAUTH_CLIENT_ID/SECRET`へ保存した。
移行元のprovider設定とsecretは変更・再発行していない。
保存による100% Worker版は`8bb6b4d9-a9e1-42c4-8963-6348e05d05ce`。
アプリruntime codeは受入済み`0fb4976`、監視tool candidateは`6e527b5`で
CI37183202677の両job成功。アプリ/Worker/schemaの再配備はしていない。
設定前後の同じ試験アカウント/認証情報・Master/料金履歴・MFA・wake・その他bindingを
照合し保持を確認した。capabilitiesはGitHubとGoogleだけを公開する。
[値を含まないGoogle設定証拠](evidence/google-staging-credential-installation-2026-10-04.json)。
Googleの実認証はアカウント選択後の名前/写真/メール共有の個別承認待ちで、未受け入れ。
Google検証開始前にGitHub sessionを通常ログアウトした。試験アカウントを削除しない。

監視tokenは対象accountだけのWorkers Scripts Read/D1 Read、有効期限2026-11-04で
発行し、Macキーチェーンへ保存した。既存entryを置き換えず、値はFIFO/プロセス
stdin・環境だけで渡した。キーチェーンreadback後の専用CLIはexit0、attentionは空。
[監視資格情報の証拠](evidence/dedicated-staging-monitor-credential-2026-10-04.json)。
IAM作成画面の対象/二つのRead権限は確認済み。ゼロ行UPDATEは変更0で成功したため、
実書込み拒否の証拠にはならず、reportのleastPrivilegeAcceptedはfalseを保持する。
定期監視・鍵運用全体の受け入れも別条件。

次はGoogleの実callback/初回設定、Discord/Apple、Stripe sandbox、承認済み宛先の
Resend、日次自然発火（2026-10-05 09:00 JST）、運用条件と最終統合。
既存ユーザー/Auth/Storageの実移送と公開domain/DNS切替は後工程。
以下は過去のcheckpoint。

# 2026-10-04 GitHub実認証の受け入れと監視専用token経路

`0fb4976`/CI37180854336両job成功、Worker
`07bf9d61-d9be-43db-875e-492ed6e2e7c5`へ100%配備済み。
実GitHub callback/初回パスワード保存に加え、ログアウトでsession0・再読込後の未認証、
同一GitHubの再ログインで同じuser/profile・session1・setup flag0を確認した。
配備前後のアカウント/認証情報・Master/料金履歴・MFA世代を保持している。
[実認証の証拠](evidence/github-staging-real-auth-2026-10-04.json)。
本人管理の試験アカウントは保持し、旧全owned行0件canaryへ合わせて削除しない。
最初の再読込は旧PWA moduleを使ったため、現行moduleの実行と配信bytes一致を確認して
ログアウトを再検証した。通常HTML navigationの/auth・/dashboard・/pwaは200で、
HTML指定のない要求の404は不具合ではなかった。
[配備版のnavigation証拠](evidence/staging-navigation-2026-10-04.json)。

本変更は配備用資格情報を使わない監視CLI経路とその回帰試験を追加する。
`--read-only --monitor-token`は専用環境tokenを要求し、Wrangler/一般tokenへ戻らない。
固定account/Worker/DBとread receiptを検証する。実tokenの作成・IAM policy・定期監視・
秘密の保管/運用条件は別の受け入れ。アプリ/Worker/config/schemaは変更しないため、
この監視tool変更のためのWorker再配備・合成canary反復は不要。
Google callback追加・資格情報保存は具体的な本人承認待ち。
日次自然発火（2026-10-05 09:00 JST）、他provider/email/Stripe/運用/最終統合は残る。
既存ユーザー/Auth/Storageの実移送・公開ドメイン切替は後工程。
以下は過去のcheckpoint。

# 2026-10-04 GitHub初回登録・パスワード保存とログアウト修正

`f2881a5`/CI37172900459の両job成功後、Worker
`22628cfe-22a6-4047-991f-20a16244d916`で実GitHub callbackとsessionを確認した。
本人のGitHub識別子に対応するAuthユーザー・Businessプロフィールは各1件で、
provisioningは完了。本人が初回パスワードを保存し、credential accountの作成と
`requires_password_setup=0`、dashboard到達を確認した。
[資格情報を含まない証拠](evidence/github-staging-first-password-2026-10-04.json)。

実ログアウトはContent-Type欠落で拒否され、sessionが残った。今回の修正は
JSONの空objectを送信し、失効成功後だけローカル認証状態を消す。
失敗はヘッダーの既存エラー表示へ伝え、成功表示・guest遷移を行わない。
frontend clientから実Worker/D1を通す回帰試験は、空streamを伴うPOSTで
修正前の415を再現し、修正後のcookie失効・session削除・旧cookie拒否を確認する。
この修正のCI/配備と、実ブラウザのログアウト・同一GitHub再ログインはまだ未受け入れ。

この本人管理のstaging試験アカウントは保持する。旧canaryの全owned行0件guardは
適用できないため、無断で緩和・cleanupせず、限定baseline照合または隔離環境を使う。
Google callback追加・資格情報保存は本人の具体的な承認待ち。
日次自然発火（次回2026-10-05 09:00 JST）、残りprovider/email/Stripe/運用/最終統合は未完了。
既存ユーザーの移送・公開ドメイン切替は後工程。
以下は過去のcheckpoint。

# 2026-10-04 日次ジョブ配備とGitHub接続の準備

`b80fefc`/CI37168103288はapplication・Worker両jobが成功し、Worker
`62052d66-41af-4595-ba15-ec042d3f7fce`へ100%配備した。独立readbackがCPU30,000ms、
日次expiry/archiveとCron `0 0 * * *`、マスター3,944/公開行7,888・料金/履歴の保持を確認。
app/auth200、FK0、wake17/17、滞留/失敗/open run0。
[配備証拠](evidence/staging-daily-job-activation-2026-10-04.json)。
mainの日次自然発火は未確認で、次回は2026-10-05 09:00 JST。

ユーザーがstaging専用GitHub OAuthアプリを登録した。本人提供のClient ID/Secretを
Wranglerのstdinから対象Worker secretsへ保存し、既存3secretを保持した。
secret保存後のversionは`e5569745-1236-4937-bcc6-f3177b02b1c9`。
[値を含まない証拠](evidence/github-staging-credential-installation-2026-10-04.json)。
本変更では`AUTH_SOCIAL_BACKEND=better-auth`を準備する。資格情報はconfig/Viteへ入れず、
local editor fixtureはprovider selectorを除く。CI・selector配備・実GitHub callback/session・
初回password setupは未受け入れ。既存Supabase callback、実ユーザー移送、DNSは変更しない。
以下は過去のcheckpoint。

# 2026-10-04 Workers Paidと日次ジョブ有効化の準備

ユーザーのPaid有効化後、対象accountのPaid「現在のプラン」を確認した。
[証拠](evidence/workers-paid-plan-2026-10-04.json)。Supabase管理画面にもログイン済み。
app staging configで日次expiry/archiveとCPU設定30,000msを準備している。
既存のremote合成smoke guardはactive jobを拒否するままで、通常CIのfixtureを
停止baselineと運用configへ分けた。配備・実行はまだ受け入れていない。
Stripe/Resend/OAuth実接続、鍵管理・運用担当/保存期間/RPO-RTO、最終統合は残る。
以下は過去のcheckpoint。

# 2026-10-04 通常CIの公開参照15件と運用確認手順

`f5ceed0`/CI37163953832はcompleted/success、application・Worker両job成功。
Worker logで00:12:08.8189911Zに専用public-access15/15の実行・成功を確認した。
runtime/schema差分はなく、受入済みcode0e86688/Workerbddc0dadを再配備していない。
PR #41の本文を最終実装・受け入れ・残件へ整理し、draftを維持する。

[運用手順](OPERATIONS.md)と`staging-operations-status.mjs --read-only`を用意した。
固定account/identity/remote三D1 binding/単一100% version/全25 migrationを確認したうえで、
値を含まない集計とapp/auth healthを観測する。00:29:17.839Zの実行はexit0。
appと`/api/auth/ok`が200、FK0、wake17/17、通知滞留/失敗・expiry/finalization open run・
Stripe滞留/dead-letterが0だった。[証拠](evidence/staging-operations-observation-2026-10-04.json)。
remoteのexpiry/archive/Stripe/broadcast send selectorは未設定。観測成功は定常運用の完了ではない。

準備中、Wranglerのremote --fileがSELECTの結果ではなくimport要約を返すため、
固定SELECTだけを--commandで実行するよう修正した。--file試行のprovider要約は
rows written0で、業務行を書き換えるSQLはなかった。auth probeも既存契約の`/api/auth/ok`へ
合わせた。準備時の404を実アプリの認証障害として扱わない。

対象accountの契約画面でWorkers Free（現在のプラン）を確認した。
subscriptions APIは403/10000、account settingsのusage model standardだけでは契約を
判定できなかった。Paid変更の許可を依頼済みで、購入はしていない。
provider設定場所/テスト送信、main日次有効化/CPU適合、担当/最小権限/鍵保管先/保存期間/
RPO・RTO、同じ最終candidateでPC・実スマホ・言語・旧PWA/provider/job/recoveryが残る。
実ユーザー/Auth/Storage移送、DNS、Supabase本番writer停止は行っていない。
以下は過去のcheckpoint。

# 2026-10-04 Tier C公開・保護参照のstaging受け入れ

code0e86688/CI37130360266のapplication・Worker両job成功。Workerbddc0dadへ反映し、
合成2 accountの無期限short/emoji投影一致、本人settings/password設定、locked秘匿、
誤password拒否、正しいemoji proof/保護内容、別selector拒否、grace失効、有限期限拒否を
実APIで確認した。journal ilxWGNはverified-and-cleaned。独立00:01:53.330Z readbackで
Business/Auth非マスター行0、Master7888/料金/履歴保持・reference世代10/new activation0・
wake17/17とMFA世代保持を確認。[証拠](evidence/tier-c-public-access-2026-10-04.json)。
public15/registration26/protected13はlocal成功。0e CIにはregistration26/protected13が入り、
専用public15は漏れていたので通常test:api-contracts-d1へ追加した。次HEADでCIを確認する。
runtime/schema差分はなく、同じstaging試験を再実行しない。

前の自動turnはモデル容量エラーで停止していた。起動済みcanaryはexit0で完走しており、
そのプロセスを再起動していない。provider設定場所の入力待ちと、main定常ジョブ/
Workers plan/鍵管理/運用RTO/最終PC・スマホ・言語・PWA統合が残る。
実ユーザーデータ/Auth/Storageの実移送・ドメインは未実行。以下は過去のcheckpoint。

# 2026-10-03 Tier C公開・保護参照の修正candidate

無期限のactiveライセンスをemoji参照から除外するsource由来の条件を、PRODUCTに合わせて
公開projection・パスワード検証・atomic proof発行・保護内容取得で修正した。
複数ライセンスの曖昧さ、有限の期限、selector-bound proofと世代の確認は維持する。
local public15/registration26/protected13、Worker typecheck・変更箇所lintを確認。
registrationの現行schema fixtureに、active releaseと別に保持するcanonical IDを追加し、
実sessionで取得したS/A/Cのshort/emoji参照が同じ投影を返すことを確認した。
CIとstaging受入は次HEADで実行する。main stagingはまだWorker51db2c90/code6a1870a。
source RPC/実ユーザーデータ・provider設定・ドメインは変更していない。

前HEAD ef25b50/CI37125702795はcompleted/success、application/Worker両job成功。
実Chromeで同一networkIdの取消しreceiptを確認してcontinueRequest拒否を扱う修正が
Linuxでも成功した。以前のe68e6e8失敗を最新CIの状態とは扱わない。
58関数のidentity/hash/権限と既存counterpart行を結び付けた
[evidence](evidence/source-function-counterparts-2026-10-03.json)を追加した。
54 classifier pendingは未実装件数ではなく、手動照合を取り込んでいない分類数。
semantic承認/fullRuntimeReconciled/converterDeployableは引き続きfalse。
保護お気に入り一覧は47b69c5のremote受入と変わらない実装hashを照合し、対応表の古い
未受入表記を訂正した。実Cron archiveの受入も保持し、同じremote試験を繰り返さない。
以下は過去のcheckpoint。

# 2026-10-03 ブラウザ取消し競合の修正candidate

最新`e68e6e8`/CI37124843575はcompleted/failure。Workerは成功、applicationの
actual local Worker editor試験が`Fetch.continueRequest:-32602:invalid_interception_id`
で失敗した。前の`dae2a70`/CI37123979783成功は保持するが、最新CI成功とはしない。

Network.loadingFailed(canceled=true)の同一networkIdを確認できる場合だけ、
continueRequestの上記拒否を正常な取消しとして扱うhelperを追加した。
取消しreceiptがない、別ID、別method/code/kindの拒否は引き続き失敗させる。
native6/6、変更箇所lint、check:ci、diff check成功。actual local Worker/Chromeでも
通信をpause→AbortController取消し→Chrome receipt→無効ID拒否の順で再現し、
fixtureの取消し1件を確認した。実API応答のみでeditor既存フロー・FK0が成功し、
server停止/port閉鎖/local DB削除も確認した。前のCI失敗時に取消しreceiptを記録して
いなかったため、元の1件の原因を断定しない。新HEAD CIでLinuxの回帰を確認する。

実Cron archiveは前項のaccepted-and-cleanedを保持し、再実行しない。
この変更はbrowser harness/通常CIの回帰のみ。runtime/source data/ドメインは未変更。

# 2026-10-03 実Cronアーカイブと最新CIの受け入れ

`dae2a70`/CI37123979783はcompleted/success、application/Worker両job成功。
前回失敗したactual local Worker/split D1のeditor試験も成功した。
CDPのmethod/code/固定kindの診断追加は受け入れ、秘密のraw値を出力しない。
以前のprotocol拒否は今回再現せず、race修正とは主張しない。拒否を無視する変更はない。
runtime/schemaは未変更で、main stagingは引き続きWorker51db2c90・code6a1870a。

隔離した実Cron→archiveも受け入れ済み。全25 Businessの新しい合成D1で、
古いdelivered/failed2件を履歴へ移し、pendingと新しいdelivered2件を残した。
実schedule/binding、received/selected/start/completed、履歴ID/payload、FK違反0を確認。
2回目のconductor34190はterminal/exit0、verified-and-cleaned。
最初のfixtureのonly-archive期待値誤りによる失敗も保持し、アプリ不具合とは扱わない。
所有した一時Worker/D1を削除、独立12:52:07.842Z metadata readで元の3 D1/2 Workersと
一致した。[受け入れ](evidence/isolated-notification-archive-cron-2026-10-03.json)。
同じ実Cron検証は再実行不要。main stagingの日次archive selectorは未設定。
次は日次運用/保存期間/CPU・plan適合と、実provider設定待ちの残件。
providerの現行OAuth signup hookと必要入力は[接続準備](staging-provider-readiness.md)。
実ユーザーデータ・既存staging業務/Auth行・provider設定・ドメインは未変更。
この証拠追記とconductor追加の新HEAD CIは別に追跡する。以下は過去のcheckpoint。

# 2026-10-03 最新CIのブラウザ失敗を診断中

`e3d5615`/CI37121269163はcompleted/failure。Worker jobは成功したが、
actual local Worker/split D1のeditor試験が`browser_cdp_command_failed`で失敗した。
直前の取得API追加`a2d09dd`/CI37120631839の両job成功は保持する。
最新branchのCI成功・完了は主張しない。

CDP helperの拒否診断にmethod・数値code・固定kindだけを追加した。
raw provider message、URL、cookie、request引数は出力しない。
手元のactual Worker/25 Business/4 Auth/8 Master/R2/Chrome試験は成功し、
loopback server停止・port閉鎖・local DB削除を確認した。合成protocolエラーでも
秘密値を出さないことを確認した。原因は未再現であり、race修正の証拠ではない。
この診断変更の新HEAD CIで切り分ける。runtime再配備は不要。

隔離した実Cron→archive確認は同じlive processで追跡中。20分で観測を打ち切り、
所有した一時Worker/D1の削除とinventory照合を行う。main stagingのarchive
selectorは依然未設定。実ユーザーデータ・ドメインは変更しない。

# 2026-10-03 取得の現行schema/session検証とCI組込み

取得の通常Worker CI漏れを修正し、既存21回帰と全25 Business/4 Auth/8 Master・実sessionの
5件がlocal26/26成功。実admin signin/TOTP/停止による旧cookie拒否と、canonical ID・
順序/肌色・全ownerお気に入り連携・有限/無期限取得を確認。typecheck/変更箇所lint成功。
[取得API](fanmark-registration-api.md)。`a2d09dd`/CI37120631839のアプリ・Worker両job成功。
CIのWorker logで新旧両fileと26/26の実行を確認した。runtime再デプロイは不要。
[sequence review](source-sequence-key-review.md)は現行writer/importと3indexを照合し、
空/NULL/shape/衝突・外部consumerの差を最後のデータ工程へ明記。generic converterのgateは保持。
今回runtime/schema/staging deploymentは変更しない。実稼働の受入は以下の画像checkpointを保持。
通知read3関数とwaitlist2関数の定義hash・現行経路・既存受入を照合し、古い対応表を更新した。
legacy toggleには現行実行callerがなく、汎用RPCの互換性を推定しない。
provider/運用/全source/最終統合は未完了。次はイベント生成・archiveの運用条件を具体化する。

# 2026-10-03 画像参照の実staging受け入れ

`6a1870a`/CI37118191381両job成功。11:10:37.101ZにWorker51db2c90へ反映し、
Supabase形式を保持した合成画像をR2から編集・公開表示、変更なし保存、既存key削除する
実API/Chrome試験を受け入れた。合成2 account/2画像は削除済み。
独立11:15:19.120Z readbackで業務/Authの非マスター行0、Master7888/release/history/料金値保持、
reference世代10・activation追加0、wake17/17・MFA240・secret3名称を確認した。
[画像URL対応](storage-image-url-mapping.md)と[受入証拠](evidence/storage-image-projection-2026-10-03.json)。
前のread-only helperは過去の受入versionを新versionと比較して停止した。元の受入journalは
保持し、今回preflight.oldVersionとの比較へ修正した。実稼働newVersionは独立照合し、再確認が成功。
全実行handleはterminal。実ユーザー/Storage/DNSは未変更、実スマホ/provider/運用/全sourceと
最終統合は未完了。次はCOMPLETION項目1の契約差/残件照合。以下は過去のcheckpoint。

# 2026-10-03 画像参照対応

[画像URL対応](storage-image-url-mapping.md)のlocal実Worker/D1/R2/Chrome試験が成功。元行を保持したDTO変換をowner/public/password-protected/admin経路へ適用する。現行candidateのCIとstaging反映は未受け入れ。既存合成remote復旧の証拠は保持する。

# Cloudflare移行の実行・再開手順

## 2026-10-03：一式remote合成復旧を受け入れ

2cbf4e0/CI37115000097は両job成功。実行process28956はexit0で終了した。
新規3 D1/2 R2/Workerを各targetに作り、同じbundleをprimaryと別incarnationへ
取り込んだ。40表/15行（非空9表）のcount/source hash、Master、2画像のbytes/MIME、
物理key一覧と実Storage GET/HEAD、全store FK、wake1/0を確認した。
primaryは保護閲覧credential commit直後の意図した中断→checkpoint再開が成功。
Authは4 migration下の固定依存userのseedで、Auth credential backupではない。
初期404/503は有限GET readiness後に正しいidentityとなり、認証拒否条件は維持した。
primary102090ms/fresh90726msは小さな合成fixtureの資源作成込み所要時間。

10:16:12.536Zに受け入れ、両targetの画像・Worker・R2・D1をreceipt/version照合後に
削除した。final metadataは元のD1 3件/R2 3件/Worker2件と一致。
独立10:18:30.138Z read-only API確認でも同じ一覧を確認した。journalは
/tmp/fanmark-combined-remote-KjkWWK/journal.json。比較した両import reportとbundleも
同directoryに保持。review可能な値を含まない証拠は
[evidence](evidence/isolated-combined-recovery-2026-10-03.json)。

source URL変換とブラウザ表示、運用RTO、全source converter/最終統合は未完了。
converter deployable/fullMigrationReconciledはfalseを維持する。
既存アプリruntimecbb90c7/Workere0a4b16e、実ユーザー/source行、DNSは変更していない。
次は画像参照のtarget URL対応を閉じる。六項目は[COMPLETION](COMPLETION.md)。

## 2026-10-03：検索・お気に入りの既知不整合をstagingで解消

bce8993のCI37094750732は両job成功。全25 Business migrationのnative17/17、
検索詳細13/13、client12/12、migration-data278/278を通過した。04:04:32Zの
完全preflightと04:04:56Zのread-only Auth schema確認後、04:05:27Zに
c09ece05-8169-488f-bc7c-8b5a0ab653feを100%配備。Auth schemaは既存でDDLなし。
JS/CSS bytes・noindex・robots200・sitemap404が一致し、実provider/signup/emailは
閉鎖のまま、匿名session nullを確認した。

実Worker/session/分離D1で既知の4障害を再現した。お気に入り追加event抑止、
favorite_count更新抑止、検索event抑止、削除event抑止はすべて503/no-storeで、
discovery/favorite/event全行とevent sequenceを完全rollbackする。各scoped triggerを
外すと200で再試行でき、他userのお気に入りは不変。重複add/removeはfalseで追加event/
件数変更なし。journalはdiscovery-repair-KeQ2x4/canary.json、verified-and-cleaned。
Auth2user、Business4discoveryと関連favorite/event/profile、一時triggerを削除し、
両store FK0・trigger復元・cookie無効を確認した。成功した操作のevent IDは進み、
sequenceをリセットしない。int64境界の証拠はnativeのみでremoteへ拡大解釈しない。

独立04:07:49.929Z readbackでWorkerc09、owned Auth/Business0、ledger25、
Master3944/release7888・inventory/active/history、MFA236、wake17:17、3 secret namesを
確認。private受入は/tmp/fanmark-discovery-bce8993-staging-acceptance.json。
これは検索・お気に入りの4既知不具合を閉じる証拠であり、旧featureの一律再実行、
source/RLS/caller全照合、実provider/実phone、移送器・運用全体の受入ではない。
六項目の残件は[COMPLETION.md](COMPLETION.md)。実user移送・DNSは最後に残す。

## 2026-10-03：OAuth登録基盤のstaging配備と合成受け入れ

47b69c5のCI37085997181は両job成功。専用native OAuth54に加え、Worker全suiteと
アプリの実local Worker/browser editorが通過した。01:34:21Zの全体preflight後、
Auth0009をAuthだけへ適用し、01:35:14Zにledger4・marker6列・unique index4・
Auth owned0/FK0・MFA generation不変をreadback。更新後も全体baselineを再確認し、
01:37:00Zにb5a07a34-a086-4543-9569-31fa8a904defを100%配備した。
AUTH_SOCIAL_PROVISIONING_BACKEND=d1は配備済み。JS/CSS bytes/noindex・root/robots200・
sitemap404が一致。provider資格情報はなく、01:39:54Zのcapabilitiesはprovider一覧空、
4provider start/callback403・cookieなし、匿名session nullを維持する。

実remote split D1でseedしたmarker付きAuth/credential user5ケースは成功。
未作成profileの作成・作成済みprofileの再認識、同じUUID/所有者とmarker completed、
private marker非公開、既存credentialを使うpassword setup再試行、API編集の保持を確認。
profile ID衝突・provider account欠落は409、completed profile欠落は500でsessionを
出さず、既存行を変更しない。Auth userとcredentialはseedなので、remote新規SDK/
OAuth userや新OAuth credential作成の証拠ではない。journalはoauth-session-guard-BtQmD3。

同じ47b配備のcombined real browser editor/favorites canaryも成功。2user実signinと
UUID session、desktop→390、503時の元行/下書き保持、reload/retry/save/reopen/preview、
public/private、他所有者とgrace拒否、両userの保護redirect/text favorites・SQL NULL・
proof-looking Cookie拒否・元config/disabled後の内容保持を確認。journalはcanary-Etytn8。
両canaryはverified-and-cleaned。01:44:48.995Zの独立全体readbackでowned Auth/Business0、
ledger25、Master release/import/active/history digest、wake5:5とsecret names不変を確認。
合成license incarnation tombstonesは保持する。private受け入れは
/tmp/fanmark-oauth-signup-47b69c5-staging-acceptance.json。実phone/provider/full migrationは
未受け入れ。source/runtime/認可/定常job/ops・実provider接続の残りを進める。

## 2026-10-03：OAuth設定のstaging受け入れと新規登録の復旧実装

55b40e0のCI37083522230は両job成功。00:54:45Zの完全preflight後、00:56:12Zに
workers.devへa0fcd645-1409-473e-8816-997e87b3797eを100%配備した。JS/CSS bytes、
root/robots200・sitemap404・noindex一致を確認。00:57:21Zのprovider未設定readbackで
capabilitiesのprovider一覧空、4provider start/callback403、session cookieなし、
匿名session nullを確認した。01:00:34.127Zの独立readbackがledger25・owned Auth/
Business0・Master inventory・wake5:5・secret namesを再確認した。
private報告は/tmp/fanmark-oauth-policy-55b40e0-staging-acceptance.json。
provider key/selectorがないため、実設定済みproviderのremote policyは検証していない。
8144df2のcombined editor/favorites canaryは別の過去受け入れで、55bへ再実行とは扱わない。

次のcandidateは`oauth-signup-provisioning.mjs`とAuth0009 migrationで新OAuth登録を
実装する。公開SDK APIのserver contextからcommand/profile UUIDとproviderを保持し、
元provider factoryのaccount subjectをAuthのprivate markerへ結び付ける。pending userの
account作成失敗は同じprovider/subjectの正式callbackで復旧し、profile ID/所有者の
readback後だけcompleted/sessionへ進む。commit前失敗と応答だけ失われる失敗を区別し、
どちらでもAuth/Business行を削除しない。既存edited profile、停止状態、別identity、
衝突、partial marker、schema不足を検証する。選択しなければ新SNS登録は閉じたまま。

最初の4providerテストはcallback hookのpath誤認で失敗した。SDKは`/callback/:id`と
`params.id`を渡すため、それに合わせて修正。Apple POST後の正式GET redirectも追う。
停止済みpending userのtestでplugin hookがcore guardより先にprofileを作る問題を再現し、
共通停止検証をrepair/profile書込み前にも適用した。native54/54、既存Auth47/47、
credential signup15/15、shared bcrypt/UUID/TOTP/MFA6/6が成功。native54はall25 Business/
Auth core0003・0007・0008・0009で各case後FK checkも行う。Worker CIのnpm testへ追加。
詳細は[OAuth登録の復旧契約](oauth-signup-provisioning.md)。

新candidateのexact-head CI・Auth0009 remote適用/readback・staging selector有効化と
配備はまだ必要。現stagingは55b/a0fのまま。実providerキー、メール・課金、実phone、
全source runtime/認可移植の受け入れは未完了。実ユーザーデータとDNSは移行しない。

初回candidate4f62045のWorker CIでは、generic Vitestのglobが新D1専用fileも拾い、
Business migration provideなしで実行して失敗した。専用fileをgeneric excludeへ加え、
専用config経由の54ケースだけをnpm test内で実行する。次の配備準備としてAuth/app
configのAuth allowlistへ0009を追加し、Master側には含めない。app configでは
AUTH_SOCIAL_PROVISIONING_BACKEND=d1を選び、実local editorもAuth4 migrationに合わせる。
この選択はまだremoteに反映されていない。修正後のCIとAuth0009 readbackが配備条件。
修正したgeneric suite56/56とmigration allowlist6/6が成功。all25 Business/4 Auth/
8 Masterで実local HTTPS Worker/browserを接続したeditorもverified、API応答模擬0、
provider/remote/source read0。実フォームsignin、保存失敗時の行/下書き保持、reload/
retry/save、公開/非公開、他所有者・停止拒否、FK違反0、server/port/state cleanupを確認。
private reportはfanmark-local-editor-compose-MOMyEH/report.json。これは修正working treeの
local証拠で、4f62045のCI成功やremote検証ではない。

## 2026-10-03：UUID認証修正の配備・受け入れとOAuth設定の適用

8144df2のCI37082406423は両job成功。00:37:42Zの完全preflight後、00:38:19Zに
workers.dev stagingへf443eb15-d8ac-48a9-af90-da2aa587e976を100%配備した。
配信JS/CSS bytes、root/robots200・sitemap404・noindexを確認。合成2accountの実signinで
SDKが生成するsession IDのUUID形式と本人IDを確認した。user ID自体はseed fixtureなので、
remote新規user生成の証拠にはしない。新規user生成は別のnative signup15ケースで検証済み。

combined editor/favorites canary-Pa2CR6はverified-and-cleaned。最初の入力、desktop→390px、
503保存失敗時の元D1行/下書き保持、reload/復元/retry/実保存、再open/preview、他人拒否、
両userの保護redirect/text favoriteとgrace拒否が成功。scoped cleanup後にowned Business/Auth0、
retained baseline一致を確認。00:41:56.364Zの独立readbackでaccount/version/ledger25、
Master release metadata/active/history digest、wake5:5とsecret namesを再確認した。
private報告は/tmp/fanmark-editor-8144df2-acceptance.json。実phone/provider/移行全体は未完了。

次のOAuth gateway reviewで、provider key pairのみを条件にし、管理設定を適用しない不具合を
native10ケースで再現。設定false、招待mode true、認証開始後の設定変更、missing/malformed/
binding/read失敗でもcapabilitiesやcallbackへ進んでいた。現在の修正はBusiness D1の2設定を
capabilities/start/callbackで毎回照会する。Resend readinessと独立させ、Auth cacheへ設定状態を
保持しない。無効時はprovider network、Auth user/account/session/verificationの変更を拒否する。

全25 canonical Business migrationsをAuth suiteへ加え、Auth47/47で10修正ケース、JSON文字列/
on-off/1-0表記3ケースと従来34ケースが成功。既存の通知master MFA試験は欠落bindingを
明示し、full Business fixtureへの変更後も503境界の検証を保持する。新policy codeには別の
exact-HEAD CI/配備が必要。disableSignUp=trueは維持し、新OAuth userのBusiness provisioning、
初回password setupまでのrecoverable flowと実provider受け入れは引き続き必要。

installed Better Auth1.7.5の公開APIにはaddOAuthServerContext/getOAuthStateがあり、
server contextはclient additionalDataで上書きできないことをソースで確認した。これを新規
provisioningの実装候補として記録したが、native counterpart/ACK不明/restart/collisionの
検証前なので完了とは扱わない。source/real user rows/DNS/provider設定は変更していない。

## 2026-10-03：editor/favoritesの実staging受け入れと新規Auth IDの不整合

49cf07fのCI37081023518はapplication/Workerとも成功。00:20:54Zの完全preflight後、
00:21:33Zにworkers.devへ5c3b4214-f285-4616-92d2-657ea080f715を100%配備した。
00:21:40ZのJS/CSS bytes照合・root/robots200・sitemap404・noindexが成功。
実合成canaryは2account signinと無期限profile API境界に加え、desktop→390px、
最初の入力、503保存失敗時の元行/下書き保持、reload/復元/retry、D1保存、再open、
公開preview、他所有者の編集拒否が成功。protected favoritesはowner/他userのredirect/
textで名称・URL・本文NULL、proof-looking Cookieで解除されないこと、元config不変、
保護disabled時の元内容、favorite count0を確認。grace拒否も成功した。
scoped cleanupはverified-and-cleaned、owned Business/Auth0、retained baseline一致、
license incarnation tombstone2。00:25:03Zの独立readbackが全baselineを再確認した。
private報告は/tmp/fanmark-editor-49cf07f-acceptance.jsonとcanary-Olyt5G/canary.json。
390pxはviewportで、実端末・provider接続・実data/domain移行は別の未完了工程。

次の認証reviewで、createAuthにgenerateId overrideがなく、SDK既定の32文字英数字IDが
billing APIのUUID actor契約と不一致であることを確認した。既存UUID fixtureのlogin
成功は新規ID生成の証拠ではなかった。実native signup4言語へUUID契約assertを追加し、
4失敗/11対象外のfocused再現を取得（/tmp/fanmark-auth-new-id-format-reproduction.log）。
advanced.database.generateId=uuidへ変更し、実signup由来IDをcustomer portalのactor
checkへ渡すと401ではなくprovider未設定503になることを確認した。resolverは合成で、
Stripe clientは作成禁止・key全unset。実email確認/session/billing通し試験の証拠ではない。
全signup15/15、Auth34/34、shared bcrypt/UUID/TOTP/MFA6/6、型/変更箇所lintと
workflow isolationは成功。最初の型checkは試験側の誤った
STRIPE_TEST_SECRET_KEY名で失敗し、既存Envに合わせKEY_TEST/KEY_LIVEへ修正した。
既存ID・real Auth/Business行・source/DNS/provider設定は変更していない。新Auth codeは
現在の49cf07f配備とは別で、new exact-HEAD CIと再配備が必要。

## 2026-10-03：最新staging配備とスマホ幅検証の見逃しを修正

コードe4d9064のCI37079353334はapplication/Workerとも成功。D1 read quota復旧後の
完全preflightが00:04:41Zに成功し、00:05:19Zにworkers.dev Worker
73f934f5-d171-431b-8153-14f5cad1c371へ配備した。配信JS/CSSはstaging buildとbytes一致、
noindex、robots200、sitemap404を確認した。最初のstatic照合は誤って通常distを
参照して失敗したため、Wrangler assets.directoryのdist-stagingを使って再照合した。

private Master guardの総release行数3944という前提も誤りだった。metadata-only
readbackで公開10ec42/ready3944、rollback試験d78d798/ready3944、failed35b34/0と
generation1→2→3の履歴を確認。総7888を保持し、import metadata/manifest SHA-256・
active pointer・履歴を固定digest5dddb310…で照合する。Master書込みは行わない。

合成canaryは2accountの実signin、無期限profile作成/更新、公開/非公開、他人のread/write
拒否まで進んだが、desktop→390px時のcanary_editor_mobile_overflowで停止した。
保存失敗/復元/実browser保存とprotected favoritesは未到達で、合格扱いにしない。
scoped cleanup後はowned Business/Auth0、全retained baseline一致、tombstone2を確認。
00:08:27Zの独立readbackもaccount/version/ledger25/owned0/wake5:5/secret names/
master inventoryの保持を確認した。

同じbuilt UIのoffline再現でclientWidth390に対してinnerWidth/scrollWidth454、
visualViewport scale0.859を確認した。既存local試験は拡大したinnerWidthとの比較だけで
見逃していた。SNS handle inputの既定最小幅とgrid cardが原因で、両方をmin-w-0にする。
入力モード/正規化は維持する。offline/local composed試験は390を明示assertし、cold
caseはdesktop→mobile切替も確認する。診断再実行はwidth/client/scroll390、scale1、
offender0。新HEADのCI・配備・combined canaryは別途必要。実phone未検証、実user移送・
source writer停止・公開domain/DNS・provider送信/課金・Paid upgradeは行わない。

修正後の型/lint/staging build、offline8 casesと実local Worker/全25 Business・3 Auth・
8 Master D1/browserが成功。390px明示確認、保存失敗時の行/下書き保持、reload/retry、
公開/非公開、他人拒否、停止session拒否とserver/port/local state cleanupを含む。
実行時はe4d9064に未commit変更を重ねたworktreeであり、新HEAD CIの証拠ではない。
private報告はfanmark-local-editor-compose-Ubh8GS/report.json、logは
/tmp/fanmark-editor-mobile-width-{build,offline,compose}.log。

## 2026-10-03：編集フォームの初回入力とsequence keyのsource前提を修正

head2ad6b07 CI37078676014のapplicationはoffline保存失敗caseで下書き待機が
timeoutした。PATCH送信前で、フォーム表示からpassive保存監視開始までの隙間が
あった。EmojiProfileFormは下書き復元後にフォームを表示し、layout effectで監視を
開始する。型/lint/build/offline8と実local Worker/3D1/browserの保存失敗・復元・再試行・
他人拒否・停止account拒否が成功し、server/port/local DB cleanupも確認した。
旧runのWorker jobは成功、applicationは失敗で確定。移行ツール全278/278は成功。

seq_keyfbe91b15のliteral-only source PostgreSQL oracle7 casesでNULL要素省略と
空配列hashを確認した。以前の「source helperは空/NULL要素を拒否」という前提は誤り。
converter42/42は4つのJSON配列がsourceの2つのkey同値classへ入る差を再現し、
3つのUUID配列indexへseq_key_input_contract_requires_review gateを維持する。
現catalogの40table/66candidate indexは引き続きdeployable=false。詳細は
[source sequence key](source-sequence-key-review.md)。実source行・既存schema/indexは
変更していない。新head CIが必要でstaging010a4d7aを保持し、D1上限解除後に完全
preflightから進める。実user/domain/providerの変更はなし。

## 2026-10-03：新規登録を全migration構成とsource初期値で検証

signup native suiteを一部schemaから全25 Business migrationとAuth core/0007/0008、
停止account selectorへ変更した。既存のslot競合・lost-ack・メール失敗復旧・再試行に
加え、4言語とcaller metadata/plan/ID/roleを転送しないケースを検証し15/15成功。
各case後に両DBのforeign_key_checkが空であることを確認した。
source handle_new_user09d55e8dとgenerate_safe_display_name1f7d9d41の取得済み定義を
再照合し、literal-only read-only PostgreSQL oracle10 casesを取得した。アプリ/Auth行や
stored application function/triggerは読取り・呼出しなし。メールprefix helperは
provisioningから呼ばれておらず、OAuth setup=true分岐はcredentialとは別に残る。
既存UUIDのlinkingと初回password setup APIには合成検証がある。source OAuth新規
userのBusiness provisioning実装と、callbackから初回setupまでの実provider受け入れは残る。
詳細は[source signup provisioning](source-signup-provisioning.md)。
新しい変更はexact-HEAD CIとprivate canary pin更新が必要。stagingは010a4d7aのまま、
D1上限の解除後に完全preflightをやり直す。実user/domain/providerは変更していない。

## 2026-10-03：source定期writerの現状を読み取り専用で確認

新`source-scheduled-writers.sql`の21:44:12.512016Z read-only transactionでcron.job
2jobの時刻帯・active・command SHA-256と固定operation mentionを取得した。
session UTC / cron GMT。check-expired-licensesを記した日次0:00 jobはactive、
process-notification-eventsを記した毎分jobはinactive。manual expiry/archiveを
直接記すjobは0。本文・URL・job名・credentialとapplication/Auth行は取得しない。
metadata scope/型/ID重複/SHA-256検証は成功。mention/activeは実invocationの成功を
意味せず、間接/外部callerは未確認。source/Cloudflare scheduleは変更せず、daily
staging execution selectorも未設定を保持した。private証拠と残るgateは
[source scheduled writers](source-scheduled-writers.md)。source writer停止は最終
cutoverに属し、今回実行しない。

## 2026-10-03：検索のsource照合と全Business schemaのnative検証

source complete-data、public/secure availability、combined lottery searchの4定義を
取得済みcatalog-only証拠から再照合した。complete-dataのlatest NULL-firstと、
availabilityの現在blocker earliest/NULL-lastは別の契約であり、一律に統合しない。
本人抽選状態はauth.uid由来、target検索は設定内容をqueryせずに狭いDTOを返す。
source本番・業務/Authデータの読出し/変更は行っていない。hashと残るtie/external
caller gateは[検索API](fanmark-search-api.md)へ記録した。

従来検索試験はmock応答だったため、canonical Business migration全25件と
native local D1、実Better Auth signin/session、実Worker routerを使う12ケースを追加。
2sessionのpending本人行・cancelledを除く件数・anonymous false/null、3種の
caller指定ID拒否、元行不変、active NULL/future1us/exact/past、grace fallbackとoverride、
expired NULL、NULL-first選択、owner/他人/匿名で保護config非公開を確認した。
最初の12失敗はseedに必須tier_levelを欠いたためで、application bugとは扱わない。
修正後12/12、Worker typecheck/変更箇所lint、正しい`npm run check:ci`でisolation成功。
誤ったcheck script pathによるMODULE_NOT_FOUNDはisolation成功の証拠にしていない。
native検索も通常Worker CIの`test:api-contracts-d1`へ含める。

保護favorites head20026f7 / CI37066581254は両job success（21:29:14Z完了）。
private editor canaryを拡張し、2accountのprotected redirect/text、disabled response、
保存config不変、favorite countとscoped event/favorite/discovery cleanupを準備した。
全25schemaのlocal SQLiteでcleanup/retry/NULL-linked partial seed、無関係な合成
discovery保持、FK違反0、license tombstone2保持を確認。flagなしはremote call前に拒否。
新smokeはまだ実行していない。記録は`/tmp/fanmark-favorites-protected-preparation.json`。
新head CI成功後にprivate HEAD/CI pinを更新し、D1 quota解除後に完全preflightから
配備/native editor・favorite受け入れへ進む。stagingは010a4d7aのまま。

## 2026-10-03：お気に入り一覧から保護内容が漏れる経路を修正

fresh sourceの7function/2policyを照合したところ、sourceのfavorite listは本人の
お気に入り行に絞るが、fanmarkのpassword保護内容を伏せていなかった。targetも同じ
SQLを使っており、native D1で名称・redirect URL・本文が返ることを再現した。
既存verified-access仕様の「ログインではpassword確認を省略しない」に合わせ、
enabled password configの3fieldをSQLでNULLへ伏せる。Worker clientも保護flagと
非NULL内容が矛盾する応答を拒否する。DBに保存された内容やsource既定経路は変更しない。

native favoritesは11/11、clientは6/6。active perpetual licenseのowner/他ユーザー、
redirect/text、proof-looking cookie、config不変、disabled/absent protectionを確認した。
最初の再現試験のundefined fixture定数エラーはbugの証拠ではなく、helper修正後の
native応答で漏えいを確認している。通常Worker CIのD1契約群へfavoritesを追加した。
application/Worker typecheck、変更箇所lint、通常staging build、pinned dry-run、
workflow isolation、offline Chromeのeditor8ケースも成功。詳細とsource hashは
[favorites API](favorites-api.md)。全RLS/外部caller照合は未完了。

catalog head `effdf4be49b750c2143c43935ca8de8eaf8aeeb8` / CI `37065555307` は
application・Worker両jobがsuccess（2026-10-02T21:20:59Zに完了）。今回のfavorite
runtime変更は新exact-head CIが必要。stagingは010a4d7aのまま。D1 quota解除後の
完全preflight、配備、native editor/保護favorite受け入れが次のgate。

## 2026-10-03：カタログの深いページのD1読み取りを削減

D1 quota待機中にlocalの実D1/Worker repositoryで読み取り量を測定した。
合成カタログ10,000行・offset9500/limit500の旧SQLは500行の返却に10,000行を読んだ。
既存の`(release_version, ordinal)` unique indexを使うordinal範囲指定へ変更すると、
同じ9501〜10000の500行を500行の読み取りで返した（その条件で95%減）。
offset/limit/version/nextOffsetの外部形式、最大500件、ページ件数・連番・DTO検証、
ready版と版固定は保持する。公開版の連番と不変性は既存stage/activationで検証される。
この結果から現在accountのquota消費の原因や本番全体の削減率は断定しない。

native D1 APIは読み取りbudget、部分/空ページ、版切替時pin、欠落/metadata外の
ordinal拒否を含め7/7。full-schema immutable release/activation/rollbackは7/7、
frontend pagination/integrityは7/7、Worker typecheck/変更箇所ESLint成功。
通常bundleとWrangler4.139.0のstaging deploy dry-run、workflow isolationも成功。
API試験は通常Worker CIへ追加した。ログは`/tmp/fanmark-catalog-budget-{before,
boundaries,release,client,typecheck,lint}.log`、正確な測定は
`/tmp/fanmark-catalog-read-metrics.log`。詳細は[versioned emoji catalog](emoji-releases.md)。
stagingは010a4d7aのまま。D1無料枠が復旧して完全なpreflightが成功するまで、
配備とnative editor受け入れは未完了。source/user/domain/provider/schemaは未変更。
前の認可監査head62d1672 / CI37064985605はapplication job成功、Worker jobは
追加runtime修正をpushする前の確認時点で実行中。次のexact-head CIで両方を再検証する。

## 2026-10-03：編集修正のCI成功、D1無料枠で配備前確認を保留

head `287a257e603a9ed3249dc20e230d90d558a568c1` / CI `37063201944` は
application・Worker両jobがsuccess。8画面ケースはChromeのcleanupを含めて成功した。
通常のstaging buildとWrangler 4.139.0のdeploy dry-runも成功。
再確認したidentityは専用Cloudflare accountで、latest deploymentは010a4d7aの100%。
その後のBusiness D1 migration ledger readでAPI code7500を受けた。
エラーはD1 Free daily row read limit exceededで、認証失敗ではない。
preflightが完了していないためdeployと合成seedは実行していない。
remoteのsource/Authゼロ・baseline不変は今回再検証できておらず、前回の証拠を保持する。
有料プラン変更の承認はなく、無料枠のUTC00:00（日本時間09:00）リセット後に再確認する。
公式条件は[Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)。
ログは`/tmp/fanmark-perpetual-editor-preflight.log`とprivate
`/tmp/fanmark-editor-preflight-command-error.json`、build/dry-runは
`/tmp/fanmark-profile-editor-deploy-{build,dry-run}.log`。

D1待機に依存しないsource authorization監査を追加した。
`2026-10-02T21:03:48.240925+00:00`のcatalog-only transactionで40table+1view、
77policy、58function（trigger13/ordinary45）、service_roleのRLS bypassと
view security_invokerを確認。全58function body hashは既存runtime readbackと一致。
権限・式/本文hashだけのreportはEXECUTE付きtriggerを普通のRPCと区別し、
値を出さず、不完全scope/role/privilege/重複・dangling policyを拒否する。
9監査テストが成功。通知の未読数はsourceのcaller-supplied UUIDを引き継がず、
targetのsession owner限定を別ユーザーの異なる件数とquery拒否で追加検証する。
通知native-D1は16/16、migration-dataは266/266（skip0）、Worker typecheck、
変更箇所ESLint、workflow isolationとdiff checkが成功した。
通知native-D1もWorkerの`test:api-contracts-d1`へ含め、今後のCIで省かれないようにした。
全RLS移行完了とは扱わない。詳細は[source authorization review](source-authorization-review.md)。
新headをcommit/pushした場合、再開用private preflight/smokeのHEAD/CI pinを
両job成功した新headへ更新し、通常buildを作り直してから配備する。

## 2026-10-03：保存失敗時のプロフィール下書き消失を修正

CI37062006317 / head ae2c568はapplication jobが成功し、runner上でも新しい画面試験
7ケースが通った（Worker jobは確認時点で実行中）。CI待機中に追加のlocal Chrome
fixtureでPATCH503を注入し、失敗toastは表示されるがsessionStorageの下書きが消える
不具合を再現した。pageのhandleSaveが例外を処理して正常終了扱いにしていたため、
formは保存成功と誤認して下書きを削除していた。

失敗toast後に同じ例外をformへ伝播させる。formの既存catchとfinallyを保ち、失敗時は
編集画面と下書きを保持する。新しい8番目の描画試験は、503・未保存入力保持・同じ
タブのreloadで復元・retry成功・成功後だけdraft削除まで確認した。8/8、staging build、
application typecheck、変更箇所ESLint、workflow isolationが成功。旧失敗は
`/tmp/fanmark-profile-editor-save-failure-before.log`、成功は
`/tmp/fanmark-profile-editor-draft-{build,browser,typecheck,eslint}.log`。
新headのCIとremote editor受け入れはまだ未確認。配備は引き続き010a4d7a。
provider設定・実ユーザーデータ・DNSは未変更。

head4889ec9 / CI37062485010のapplication logでは8ケースすべてのassertionが成功した。
その後、Chromeのprofile directory cleanupがENOTEMPTYで失敗しjob全体はfailure。
fs.rmにbounded retriesを追加する。caseを削除/skipしたりcleanupを成功扱いにはしない。
成功logはcleanup完了後にだけ出す。変更後の8ケースはlocalでもcleanup込みで成功。
新headのCI完了を待って配備する。証拠は
`/tmp/fanmark-profile-editor-draft-ci-job.log`（source rowsやcredentialsを含まない）。

並行してcatalog-only source readbackを再実行。`2026-10-02T20:46:32.597978+00:00`も
58関数/37接続/外部Auth接続1/event0で、runtime fingerprint
`8ee600ced4b859664feba7e29c94b2166734473a40f920b0c8aef991be11b579`が前回と一致。
private `fanmark-source-bindings-KhOjiA/{query,review}.json`。inactive4件・reportでの
runtimeレビュー未接続54件を保持し、fullRuntimeReconciled/deployableはfalseのまま。

## 2026-10-03：プロフィール編集の認証復元・取得失敗を修正

Worker `010a4d7a`の実signin Cookieで編集URLを直接開いたところ、認証復元前に
`/auth`へ移り、その後`/dashboard`へ送られる問題を再現した。private journal
`fanmark-perpetual-editor-canary-Thyl2a`はfailed-and-cleaned。合成Business/Authは0、
retained baseline一致を確認済みで、この失敗を画面受け入れ成功とは扱わない。
前のdocumentation head `81ba302`のCI37059744542は両job成功、watcher exit0。

編集画面とprofile hookは認証復元を待ち、Workerログイン後は内部edit URLへ戻る。
取得拒否/通信失敗をauthorizedなprofile nullと区別し、フォームの代わりに再試行と戻る
操作を表示する。obsolete readはgenerationで無効化する。4言語のエラー表示を追加。
ローカルfixtureを使った実Chrome描画で、旧取得処理の404/network時の空フォームと
旧sign-inのdashboard固定遷移も再現した。

`npm run build:cloudflare-staging && npm run test:staging-profile-editor-ui`の7ケース成功。
delayed session・anonymous return target・実login formからの復帰・authorized null・
404・network・retryを検証する。復元後の入力space保持と390pxで横overflowなしも確認。
全browser通信はlocal fulfill/blockし、外部APIへのwrite/readを行わない。
API client5/5、application typecheck、変更ファイルESLint、workflow isolation成功。
CI application jobに同じ描画試験を追加した。新headのCIとremote画面のsave/再表示は
まだ未確認で、現配備は引き続き010a4d7a。実ユーザー・DNS/provider設定は未変更。

最初の新CI37061182268はapplicationの描画stepで失敗した。job logでGit管理外の
`.env.cloudflare-staging`がrunnerにないことを確認。fixtureのenv file依存を除き、
bundleが要求するcatalog versionを返す。CI buildは空のenvDirと公開staging origin・
synthetic Supabase初期化値を明示する。これはsecret/source接続の追加ではない。
同じ空envDirでbuildと7ケースを再検証した。通常の配備buildは別途作り直す。
`useAuthForm`の既存Hook lint警告2件は残る（error 0）。新CI完了前に配備しない。

次のCI37061645755は既存workflow isolationで拒否された。合成URLのdomain文字列と
build stepの複数行化が既存の厳格な検査に合わなかった。checkerは変更せず、
`https://synthetic-db.example.invalid`へ初期化URLを替え、空envDir作成を別stepにして
既存のbuild commandを保持した。`npm run check:ci`のexit0と成功出力を直接確認。
前回のローカルcheck commandは後続diff checkのexitで失敗を隠していたため、
そのwrapperのexit0はisolation成功の証拠にしない。新しいsynthetic URLでもbuildと
7ケースを再検証して成功。ここまでremote配備は行っていない。

## 2026-10-03：無期限プロフィールのstaging合成受け入れ成功

code head f4bd1aa / CI37058393397はapplication・Worker両job成功、watcher exit 0。
固定account、旧ea309178、ledger25、source/Auth 0、secret名3件をfresh確認した。
staging buildとpinned dry-run成功後、Worker `010a4d7a-9cd2-4683-b38f-ff6ad0dd82ec`を
100% workers.devへ配備。version作成時刻`2026-10-02T20:13:07.300605Z`。
通知DO namespace `2c27a340fd6c4248bfdbbb8d8bfb457c`と日次Cronを保持し、DB migrationは
再適用しない。HTML/JSのexact一致、noindex/robots/session null/catalog3944、
匿名wake GET/POST 401、Origin欠落403、Stripe404を確認した。

private harness `/tmp/fanmark-perpetual-profile-smoke.mjs`はcode head/CI/version/account/
ledger/secret/空source/Authを要求し、write前に予定UUIDとbaselineをatomic private journalへ
保存する。最初は絵文字VS16表記差のfixture lookupでwrite前に拒否した。
`fanmark-perpetual-profile-canary-De6f0I`はrefused-before-writesとして記録する。
source/profile code変更は不要で、公開catalog表記を使うfixture選択に修正し再実行した。

retry exit0、`fanmark-perpetual-profile-canary-5TgapW/canary.json`はverified-and-cleaned。
2件の合成Authを実signinし、NULL-end owner GET200、profile create/update200、入力spaceと
native row readback一致、公開profile200、private404、再公開200、他人のGET/PATCH404を確認。
native active→grace後は本人GET/PATCHも公開profileも404、拒否されたprofile値は不変。
全source-owned Business/Auth8表を0件へ戻し、両session null、2件のincarnation tombstoneを保持。
Business master/config、公開3944件digest、Master版/count、3-store schema、Auth generation、
既存incarnationとwake baselineの一致を確認した。

独立readback `2026-10-02T20:16:33.846Z`もcurrent version/ledger25/source/Auth0/wake5/5/
secret名3件を確認。証拠は`/tmp/fanmark-perpetual-profile-{preflight,build,deploy,http,
staging-smoke-retry,final-readback}.log`とversion/deployments/http/readback JSON。
API経路の受け入れであり、無期限editorのbrowser/mobile、残るfunctions/RLS/triggers、
provider/CPU/運用は未完了。実ユーザーmigration/domain/DNSは実行していない。

## 2026-10-03：無期限Tier Cのownerプロフィール修正

Workerの設定/公開プロフィールは無期限を扱う一方、owner profile read/saveだけが
元editor/INSERT policyの`license_end > now()`をコピーして404にしていた。
新しいlocal split-D1 regressionで修正前404を再現し、両SELECTへ
`license_end IS NULL OR license_end > captured_now`を適用した。PRODUCTの無期限契約に
合わせるtarget修正で、live Supabase policy/default frontendは変更しない。

owner suite 8/8: 無期限read/update/recreation、入力space保持、generation更新、
他人の無期限拒否、grace/expired拒否、finite+perpetual重複所有の拒否、write barrierで
nativeにgraceへ遷移した場合の404/profile/generation不変を確認。
public suite 14/14: future 1usなら公開、期限ちょうど/過去なら同じ404/no-storeを確認。
settings 18/18、migration-data 257/257・skip 0、Worker typecheck/ESLint、
pinned staging deploy dry-run成功。ログは`/tmp/fanmark-perpetual-profile-{before,final,typecheck,eslint}.log`
と`/tmp/fanmark-profile-expiry-boundary.log`。beforeは1 failed/5 passed、finalは8 passed。

catalog-only readback `2026-10-02T20:02:54.411923+00:00`で6 function SHAが前回と一致し、
旧`get_public_fanmark_profile`が参照するprofile `fanmark_id`列が現在存在しないことを確認。
実UI/OGPはlicense-ID RPCを使う。旧ownership helper 2件はNULLをactive扱いしない。
実行callsiteや他のcaptured関数本文での名前参照は見つからないが、外部consumerの不在は
証明していないため普通のRPCを自動除外しない。private rawは`fanmark-profile-runtime-7fkpOj`。
詳細は`public-profile-runtime-review.md`。emoji/short-IDの元selection差は保持しgate未完了。

前head91c2606/CI37057194961は両job成功、watcher exit 0。今回のpredicate修正はremote
未配備・perpetual acceptance未実施。staging current ea309178/ledger25のまま。
runtime/schema/ユーザー/DNSは未変更。次はCI後のguarded配備とjournaled合成受け入れ。

## 2026-10-03：source runtimeの全schema接続先を確認

public-tableだけのtrigger catalogではAuthの新規ユーザー処理を捕捉しないため、
`source-runtime-bindings.sql`を追加した。固定project/CLI/private link dirでBEGIN READ ONLYの
catalog queryを実行し、`2026-10-02T19:45:33.736244+00:00`に58関数・37trigger・public event
binding 0を確認。58 definition SHAはv41と全件一致。追加1件はenabled Auth
`on_auth_user_created -> handle_new_user`。実ユーザー/Auth rowsは読んでいない。

全schemaで接続のないexact trigger関数4件を分類した。`log_profile_cache_access`、
`log_waitlist_access`、`sync_public_profile_cache`、`validate_display_name`を新しいactive
D1 triggerとして導入しない。通常RPC `generate_safe_display_name`と既存waitlist監査は
別レビューのまま保持する。新しいreport builderはfull scope/Auth依存/identity/定義・型・
security metadata/接続を検証し、disabled/外部/event接続の追加でも再レビューへ戻す。
raw SQL本文はreportへ含めず、private atomic出力とinput alias拒否を確認した。
focused 9/9、migration-data 257/257・skip 0、ESLint/syntax成功。CIにも追加した。

private raw query/reportは`fanmark-source-bindings-tdCL5H`、value-free fingerprintは
`8ee600ced4b859664feba7e29c94b2166734473a40f920b0c8aef991be11b579`。
詳細: `source-runtime-review.md`。残る54関数はこのreportへのruntime証拠紐付け待ち。
fullRuntimeReconciled/deployableとconverterの全体gateは未完了で、既存feature受け入れを
取り消したり自動で全体完了にしたりしない。source/target rows、runtime schema/Worker配備、
実user migration、domain/DNSは未変更。前の記録head24c510aのCI37055294792は両job成功。

## 2026-10-03：通知alarmの実signin/TOTP合成受け入れ成功

修正head `41cefc3` / CI `37053995420`は両job成功。専用account、old version、
ledger 25、source/Auth 0、secret名3件を再確認し、Worker
`ea309178-690c-4cc3-b72e-b3619cd5b444`を100% workers.devへ反映した。
作成時刻`2026-10-02T19:32:21.361171Z`、SQLite namespaceは保持、Cronは日次のみ。
公開HTML/JS exact一致、catalog 3,944、匿名wake GET/POST 401、Origin欠落403、
Stripe 404を確認した。

pinned `--notification-alarm-roundtrip` exit 0。real signin/TOTP/session rotation/MFA、
手動通知201、実alarm/1 pending/generation 3/3、日本語配信後NULL/empty 3/3。
native futureイベントはNULL alarm/1 pending/4 requested・3 ackを保持し、GETで修復しない。
MFA repairはfutureを保持してalarm/4 ackへ復旧。due-time変更とrepair後の2件目の
exact配信・NULL/empty 5/5を確認した。scoped cleanupもNULL/empty 5/5で完了。
8 Auth表/source-owned Business 0、session null、Master/config/catalog/Auth保持fingerprint
一致。private journal `fanmark-notification-alarm-canary-Hwogoy/canary.json`は
`verified-and-cleaned`、authRows 0、fixture 2。終端journalの書込みも既存atomic helperへ
統一するscript-only follow-upにsyntax/lintを実施した（remote smokeは変更前headで実行）。
証拠は`/tmp/fanmark-notification-returning-{ci,preflight,deploy,http,staging-smoke}.log`と
version/deployments/http-readback JSON。以前の503は以下の失敗記録を保持する。
通知event schedulerの合成受け入れであり、delayed/他channel/provider、残るsource
functions/RLS/triggers、CPU/運用/mobileを完了扱いしない。実ユーザー・domain/DNSは除外。

## 2026-10-03：通知alarmの配備と実APIの503修正

head `7ec0c00` / CI `37051952726`は両job成功。専用account、空のsource/Auth、
旧version、ledgerを再確認し、Business 0024の4 schema objectとledger 25を適用・照合した。
Worker `49d22f73-3684-4f66-b457-17f63c07ca52`は100% workers.dev配備済み。
SQLite DO namespaceは`2c27a340fd6c4248bfdbbb8d8bfb457c`、Cronは日次だけ。
公開HTML/JS一致、noindex、robots、catalog 3,944、匿名wake 401、Origin欠落403、
Stripe 404を確認した。

最初のreal signin/TOTP alarm smokeは通知作成503で失敗した。private journalで
Auth/通知fixtureを削除し、NULL alarm、generation 1/1、空source/Authを確認した。
その後のguarded native D1 probeは、1行のRETURNING receiptに`meta.changes=2`が
付くことを実測した。event INSERTとwake trigger UPDATEの合計であり、APIが1件と
比較して保存済みイベントを失敗と判定していた。probeは事前journalのexact ID/source/
payload nonceで削除しsource 0を確認した。generationはrewindせず次のreplayへ残す。

APIを`INSERT ... RETURNING id`のexact receipt判定へ修正した。修正前503を再現した
full-schema regressionを含むlocal wake 20/20、notification master 6/6、Worker
typecheck成功。IGNORE/missing wake markerの拒否も確認した。修正版CI・再配備・
full alarm smokeは未実施で、配備済みだけでは受け入れ完了と扱わない。
証拠: `/tmp/fanmark-notification-alarm-{deploy,staging-smoke}.log`、
`/tmp/fanmark-notification-metadata-probe.log`、
`/tmp/fanmark-notification-returning-{regression-before,wake,master,typecheck}.log`。
実ユーザーデータ・domain/DNS・実課金/メールは未実施。

## 2026-10-03：通知alarmのstaging設定と検証ツール対応（配備前）

checked-in staging configをSQLite coordinator binding / class migrationと
`NOTIFICATION_WAKE_BACKEND=durable-object`、日次Cronだけへ変更した。
shared target guardsはcomplete legacy-Cron / alarm baselineを判別し、partial設定を拒否する。
notification/expiry/archiveのlocal scheduled rehearsalにはwake disabled overrideを追加し、
local DOがremote D1の起動世代をackしない。disposable recovery Workerは既存の独立
config/vars allowlistを確認し、namespace/migration非継承をguard testで固定した。
focused設定/隔離17/17、syntax/diff check成功。remote Worker/D1は未変更。
CI後に空userdata/Auth・canonical ledger・専用accountを再確認し、0024をexact適用/照合、
workers.dev deployとversion固定の通知alarm smoke/cleanupを行う。

## 2026-10-03：通知workerの起動・停止と復旧経路（local検証済み）

常時毎分実行から、pending保存で起動・空queueでalarm削除するSQLite Durable Objectへ
置換する経路を準備した。追加Business 0024は同じD1 transactionで単調な起動世代を
保存し、HTTP/scheduled producerがpost-commitでflushする。future、processing lease、
同時追加、障害とfreezeを扱い、payloadや認証情報をcoordinatorへ複製しない。
明示Originと同一session管理者MFAで状態確認/再起動を行う。拒否された再起動要求が
共通fetch finallyから起動しないことも修正・実runtimeで検証した。

全25 Business migrationを適用したworkerd D1/SQLite DO suite 17/17、既存通知15/15、
general API 56/56、reset regression 15/15、migration-data 246/246、Worker typecheck、
ESLint、alarm local/staging dry-run成功。前docs headのCI `37046873764`は両job成功を
live確認した。今回のcode head `41b5d50` / CI `37050466908`も両job成功、
watcher exit 0とfresh run readbackのcompleted/successを確認した。

TOTP smokeの`--notification-alarm-roundtrip`を準備した。固定account/version/D1、
SQLite namespace/class、dailyのみのCron、provider/expiry/archive selector無効、
0024 exact trigger/ledgerと空source/Authを要求する。書込前のprivate journalにAuth IDsと
fixture payload nonceを保存し、応答不明でもrecipient/nonceでscoped cleanupする。
実API起動とalarm時刻、配信後NULL、native future eventの未bridge状態とMFA repair、
due-time更新/配信、Master/設定/catalog保持とAuth cleanupを検証する設計。
guard test 2/2とsyntax/lint成功。現在の設定では検証を拒否する。

remoteはWorker `13dca8cf`、Business ledger 24、旧毎分Cronのまま。0024、namespace、
selectorは未適用で、alarm staging acceptanceは未実施。fresh専用account readbackで
canonical 24 ledger / 0024直前、40 source tableのuserdata合計0、8 Auth counts 0、
notification/event/profile 0、wake schemaなしとprovider secret未登録を確認した。
次に既存Cron guard・local processor override・disposable Worker isolationを
新設定へ対応させ、fresh preflight→0024 exact apply/readback→workers.dev配備→version
固定smokeと独立readbackを行う。D1/DO間は1transactionではなく、hard interruptionの
commit-to-bridge gapにはreplay/運用復旧が必要。包括source gateやprovider/CPU/mobileを
完了と扱わない。実userdata/Storageとdomain/DNS移行は対象外のまま。
詳細：`notification-worker-wake.md`。

## 2026-10-03：管理データリセットのstaging/API/desktop検証

code head `03eee80` / CI `37045419633`はapplication/Worker両job成功。
専用account/binding/空source・Auth・canonical ledger guard後に0023/ledgerを適用し、
全24 ledger・reset table・2 triggerのchecked-in SQLとのexact一致を確認した。
fresh build/dry-runでWorker `13dca8cf-c089-417b-8f1e-e27880a86775`を100%配備、
created_on `2026-10-02T18:14:03.15368Z`。workers.devのみでreset Worker/D1を有効化。
Node HTTP gates/noindexとpublic/local HTML・JS hash一致。Python urllibの初回root probeは
403だったが、Nodeと実Chromeでは200を確認した。

version固定の`--admin-data-reset-browser`が実signin/TOTP/session MFA、8テーブル削除と
exact件数/監査/receipt、confirmation/actor不正拒否、後続行を残す同操作IDのretry、
role除去後403と拒否監査を確認した。一時native DELETE guardは検証用8 UUIDのみを
許可し、remote SQLをexact照合した。実画面のDELETE必須/入力/送信と1件結果を確認し、
画面が取得したAPI応答とactor-bound receiptを照合。private screenshotを目視した。
保持Master/設定/Authのfingerprint、公開3,944絵文字SHA-256は不変。scoped cleanup後に
journal `verified-and-cleaned`、source business/Auth rows 0、reset receiptsとguard 0を
確認した。process exit 0。local D1 15/15、guard 2/2、migration-data 244/244。

証拠：`/tmp/fanmark-admin-reset-staging-smoke.log`、
`/tmp/fanmark-reset-canary-final-readback.json`、journal/screenshotは
`/var/folders/c4/_087tnms6n95sb58l4rg8vpw0000gn/T/fanmark-admin-reset-canary-KuFSKS/`。
desktopのみでmobileは未検証。包括DB functions/RLS/triggers、provider、CPU/運用gateは残る。
実ユーザー/Storage移行、production Supabase write、実決済/配信、domain/DNS切替は行っていない。

## 2026-10-03：管理データリセットの合成検証ガード（配備前）

前checkpointの修正head `23b2415` / CI `37043190892`は両job成功をlive確認した。
8テーブルに検証用UUID以外のDELETEをABORTする一時native guardを準備し、
空データ確認後に別の行が入った場合もreset全体がrollbackするlocal D1 testを追加した。
D1 15/15、guard 2/2、migration-data 244/244、Worker typecheck/ESLint成功。
`--admin-data-reset-browser`は専用account/version/ledger/trigger/空userdata guard、private
復旧journal、実signin/TOTP/MFA、8件削除/監査/receipt、後続行を残すretry、typed DELETE
画面とAPI応答の照合、Master/Auth保持、検証用profileを含むcleanupを実装した。
次のstaging build/server configはWorker/D1を選ぶが、remote 0023適用・有効化・合成実行は
まだ行っていない。実ユーザーとdomain/DNSは引き続き除外する。

## 2026-10-03：管理データリセットのWorker/D1経路（local準備）

未移行のAdminDataResetを調べ、旧Edge Functionが8回の削除結果を個別に検証しないことを
確認した。追加Business `0023_admin_data_reset.sql`とMFA保護Worker APIを実装し、8テーブル
削除・件数・exact auditを1つのtransactionで確定する。ABORT/IGNOREや監査改変は全rollback。
同じrequest IDは保存済み結果を返し、後から作られた行を再削除しない。nil UUIDとnative FKを
保持する。クーポン利用履歴/target失効journalが制約となる場合は全体を409で拒否し保持する。
認証済みnon-adminの拒否監査もserver role gateで保存し、メールやcookieを複製しない。

全24 Business migrationを実適用したlocal D1 14/14、frontend adapter/mode 6/6、migration-data
242/242、Worker/app typecheck、ESLint、staging build成功。Worker opt-in adapter/dialogも準備し、
DELETE入力と不確定結果後の同じ操作IDによるretryを使用する。staging frontendはdisabled、
server selector未設定のまま。0023のremote適用・有効化・TOTP合成reset/cleanup・画面acceptanceは
未実施。次にprivate journal/空userdata guardとcanary-only native delete guardを準備して検証する。
初回code head `6c4e8c4`のCI `37042692784`ではapplicationが成功し、Workerはdefault Vitestの
includeにD1専用testが混入してbindingがないため失敗した。既存default exclude一覧へ追加し、
専用npm testはfull Worker chainで維持する。これは初回full CI成功の証拠には使わない。
実ユーザー移行、Supabase production write、domain/DNS切替は行っていない。

## 2026-10-03：待機リスト拒否監査・運用警告のstaging照合

code head `5744231`のCI run `37039256333`はapplication/Worker両job成功。fresh staging
build/dry-run後、Worker `4199fd09-8080-4944-8c09-6932e94913b2`を100%で配備した。
HTTP gates/noindex、local/public HTML・JS hash一致を確認。version/account/empty Authを
確認した合成canaryは許可hash-list/reveal、合成管理者だけのplan変更、一覧・メール参照の
403拒否、対象ID/risk/UTC時刻のexact D1監査を検証した。version固定のlive operator tailは
警告の4 fieldだけを抽出し、2件ともD1監査のID/action/timeと一致した。raw request header、
Cookie、token、メール、IPは保存していない。private journalはverified-and-cleaned、
user-owned Auth 0、合成waitlist/profile/auditはscoped cleanup完了。tailは停止・exit 0。

sourceのuser_settings INSERT/UPDATE権限triggerもowner PATCH/signup経路でレビューした。
clientからplan/identity/billingを書き換えられず、signupは検証済みAuth lease後にFree literalを
挿入する。既存profile D1 10/10、invitation signup D1 10/10を再実行し成功。詳細は
source-user-settings-guards.md。包括catalog、実provider、CPU/運用gateは残す。
実ユーザー移行、production Supabase write、domain/DNS切替は行っていない。

## 2026-10-03：Master履歴画面のacceptanceと待機リスト警告（local準備記録）

Worker `1eb5d9ac-815e-4957-8381-b6024dac33e8`で合成signin/TOTPを通し、
管理者本人のユーザー詳細画面をheadless Chromeで開いた。履歴20件のaction/metadataと
順序が画面の取得したAPI応答に一致し、そのうち18件が最新Master監査とexact一致した。
先頭2件はその後の管理画面一覧/詳細read監査。private screenshotを目視し、監査見出しと
絵文字変更内容を確認した。Master/Auth/Business cleanupとcatalog digest保持が成功した。
smokeに`--emoji-master-audit-browser`を追加した。desktop acceptanceで、mobileは未検証。

schema-only source reviewでは、`notify_security_breach`は2種類のアクセス拒否auditで
DB NOTICEを出すだけで、外部配信を行わない。Workerで不許可メール参照のresource IDが
NULLになり、警告の投影もないことをfailing testで再現した。メール拒否の対象ID、
CRITICAL_RISK/email_addressを保持し、audit確定後にevent/action/audit ID/UTC時刻だけの
structured warningを出すよう修正。メール/IP/actor/token/cookieは警告へ複製しない。
waitlist local D1 tests 9/9、Worker typecheck/ESLint成功。audit失敗は503で閉じ、警告を
成功扱いで出さない。既存の管理role＋同session MFA＋admin planの認可は維持する。
`--waitlist-security-roundtrip`にversion/account/empty Auth guard・private recovery journal、
許可hash-list/revealとadmin plan除去後の2拒否・exact audit・scoped cleanupを準備した。
新しいdiagnostic Workerのdeploy/remote log照合は未実施。包括catalog/provider/CPU gateは残る。
実ユーザー移行とdomain/DNS切替は行っていない。

## 2026-10-03：発見・お気に入り連携とMaster履歴をstaging検証

code head `4279db0`のCI run `37035931199`はapplication/Worker両job成功。
Business stagingへ追加`0022_fanmark_discovery_link.sql`とledgerをprivate file importで
適用し、全23件のledger順序・新triggerのchecked-in SQLとのexact一致・source row 0を
読み戻した。fresh build/dry-run後、Worker `1eb5d9ac-815e-4957-8381-b6024dac33e8`を
workers.dev限定で配備した。created_on `2026-10-02T16:51:13.579131Z`の最新版は100%。
root/robots/session/catalog/languages 200、session=null、匿名admin/transfer 401、無効Stripe
webhook 404。noindex header・local/public HTMLとJS SHA-256一致を確認した。

versionをpinしたMaster監査canaryは実signin/TOTP/MFAを通し、draft create/updateと100件
mixed importによる102監査を照合した。ユーザー詳細APIの最新20件がMaster監査のID/
actor/action/resource/metadata/timeとexact一致した。公開3,944件のcatalog digestは不変。
scoped Master/Business/Auth cleanupが完了し、private journalは`verified-and-cleaned`。
これはdeployed DTOの検証であり、新しい履歴行のブラウザ描画は別のacceptanceとして残す。

registration/discovery canaryも成功。未取得の合成discoveryとfavoriteを先に作り、実ログイン
で取得すると両方のfanmark_idとowned_by_userが反映され、お気に入り一覧APIも200で
同じID・表示・登録時刻を返した。発見日時・search/favorite countは不変。R2 coverの
upload/read/profile保存/delete、owner/bucket拒否、lottery申込/重複拒否/取消、匿名・認証済み
whois projectionも成功。合成source tables 0、Auth user/account/session 0、cover 404へ戻し、
notification/system/email/coupon master baselineを保持した。private journalはverified-and-cleaned。
incarnation tombstonesとMFA generationは再利用防止metadataとして保持する。

補助の全23 migrationローカル適用probeは完了出力が得られず、実際のremoteスキーマ/
trigger/統合canaryが完了した後に停止した。これを合格証拠には使わない。local registration
18/18、admin history 14/14、migration-data 237/237、typecheck/ESLintとCIは成功。
包括functions/RLS/triggers gate、provider接続、CPU/運用fitは未完了。
実ユーザーデータ移行、production Supabase write、domain/DNS切替は実施していない。

## 2026-10-03：発見・お気に入り連携とMaster履歴（local）

sourceの新規fanmark INSERTによるdiscovery/favorites連携を、追加Business migration
`0022_fanmark_discovery_link.sql`のnative AFTER INSERT triggerへ実装した。
正規化UUIDの順序・case・NULL省略・JSON空白を扱い、全ownerのお気に入りを同じ
transactionで紐付ける。表示/日時/件数は変更しない。更新拒否・RAISE(IGNORE)による
抑止・同一identityの重複は取得全体をrollbackする。registration D1 suite 18/18。
trusted SQL INSERTも連携し、正常retryは1回だけ確定する。既適用migrationは変更しない。

管理者ユーザー詳細はBusiness/Auth/Masterの本人actor監査を最新20件に統合する。
小数桁をUTC microsecondへ正規化して並べ、他actor/NULL actorは除外する。
必要binding/query failureでは部分履歴を返さない。user management D1 suite 14/14、
Worker typecheck/targeted ESLint、migration-data 237/237成功。
両staging smokeをversion/trigger guard付きで拡張した。registration smokeは新flag
`--run-live-staging-write --verify-discovery-link`と環境変数`FANMARK_EXPECTED_STAGING_VERSION`
を要求し、空Auth・40-source-table/master baselineを確認してprivate synthetic journalを残す。
新Worker/0022のremote反映と両smokeは未実施。包括catalog/provider/CPU gateを保持する。
実ユーザー移行、production Supabase write、domain/DNS切替はしていない。

## 2026-10-03：絵文字マスター監査をstaging検証

head `ff7bcb8`のCI run `37031840989`はstaging application / Worker APIの両job成功。
Master D1へ追加`0008_emoji_master_change_audits.sql`とledgerをprivate file importで適用し、
3つのnative triggerをchecked-in SQLとexact照合した。canonical 3,944件、audit/context 0、
pending migrationなしを確認した。fresh staging build/dry-run後、Worker
`10f62b09-8592-449e-9040-4e396a395175`をworkers.dev限定で配備。created_onで選ぶ最新版は100%。
HTTP root/robots/session/catalog/languages 200、session=null、匿名admin/transfer 401、無効Stripe
webhook 404。noindex headerとlocal/public JS SHA-256一致も確認した。

versionをpinした合成canaryで実際のsignin/TOTP enrollment/verification/session rotation/MFA
管理認可を通し、draft create/update、古い更新・client actor・API削除の拒否、100件mixed importを検証。
個別監査102件のactor/action/resource/metadata/timeと、import全行の共通request/timeを照合した。
公開3,944件の全ページdigestは前後同一、context leakなし。synthetic canonical/audit rowsと
Auth/Businessプロフィールを除去し、Master基準値とAuth user-owned 0行を復元した。
MFA generationは因子変更に伴うmonotonic counterとして保持する。

初回は機能検証とMaster cleanupが成功した後、旧smokeのtarget cleanup flag一覧に新modeが
含まれず確認用Auth user/profileが各1行残った。private journalのexact ID/usernameで回収し、
毎回作成するtargetを全modeでcleanupするよう修正。fresh rerunは最後まで成功した。
初回journalと成功journalをprivateに保持し、credential/cookie/TOTP secretは出力していない。
Source-trigger追加レビューでは新規fanmark INSERT時のdiscovery/favorites linkageがtargetから欠ける
ことを確認した。これが次の実装対象。Master監査の管理者ユーザー詳細historyへの統合も未検証。
包括catalog gateとprovider/CPU acceptanceは残す。実ユーザー移行とdomain/DNS切替は実施していない。

## 2026-10-03：絵文字マスター変更監査（local）

sourceの`log_emoji_master_changes`に相当する監査がMaster D1 draft編集から欠けていた。
追加Master migration `0008_emoji_master_change_audits.sql`でnative INSERT/UPDATE/DELETE
triggerと監査表を追加し、Workerは認証済み管理者ID・request UUID・操作時刻を変更と同じ
Master D1 batchの一時contextに保持する。監査の未保存・値の改変では編集とcontextをrollbackする。
trusted CLI writeはsource service-roleと同じNULL actorとし、API削除は従来どおり拒否する。
最大100件のimportを1つのJSON INSERT/upsertにまとめ、各行の監査と既存UUID/作成日時を保つ。

Auth/Worker/Master D1 suite 34/34、migration-data 237/237、Worker typecheckとESLint成功。
監査欠落/改変、mixed import rollback/retry、100件取込/upsert、同時actor分離を検証した。
staging smokeに`--emoji-master-audit-roundtrip`を追加し、version/account/trigger guardとprivate
recovery journal、TOTP認証、102件監査、public catalog digest、scoped cleanupを準備した。
Master selectorとrelease guard/fixtureもAuth0008を混ぜず更新した。新migration/Workerはremote未反映。
前head `ea9880f`のCI run `37029293358`は両job成功。詳細は[絵文字監査契約](emoji-master-change-audit.md)。
functions/RLS/triggersの包括gate、外部provider acceptance、CPU/運用fitは残る。
実ユーザー移行、production Supabase write、domain/DNS切替は行っていない。

## 2026-10-03：監査修正をstagingへ反映

head `f3787d8`のCI run `37026002389`はstaging application / Worker APIの両job成功。
`0021_coupon_lottery_status_audit.sql`をbusiness stagingへ適用し、追加triggerと既存0015/0019
triggerをchecked-in SQLとexact照合した。合成クーポン/ライセンス/応募2件で個別監査2件、
同requestの再送後もusage 1件・通知event 2件・取消2件を確認し、source-table合成行とcommandを除去した。
40-source-table/master基準値を復元し、Authは0行。通常のmigrations applyは適用なしで終了したため、
既存工程と同じprivate file importでSQLとledger INSERTをまとめて適用した。初回canaryはD1の
LIKE pattern制限で検証/cleanupに失敗した。private journalの対象IDだけを除去し、eventキーの
exact IN照合へ修正後の再実行は成功。incarnation tombstoneは派生runtime metadataとして保持する。

fresh staging buildとWrangler dry-run成功後、Worker `445dd523-232d-4766-aaef-2c8d175e5bc6`を
workers.dev限定で配備し、最新deployment（created_onで選択）が100%であることを読み戻した。
配備前の最新versionは記録どおり`d2330dd1-ce17-41c0-99d2-a81b242c412d`だった。
先頭の古いdeploymentを現在版と誤認したが、時刻順に選び直して修正した。
root/robots/session/emoji/languagesは200、session=null、匿名admin/transferは401、
無効のStripe webhookは404。配布JSのSHA-256はlocal buildと一致
（`dd779e2f1ef10aaf7c26f7b94100d82353ae6cf91e524af7cfbd498125a6a27d`）。

最新の配備には譲渡・抽選確定・退会・Stripe延長・クーポン延長の個別抽選監査修正を含む。
譲渡のauthenticated synthetic canaryも成功。合成signin、issue/apply/reject/reapply/approve、
応募別監査exact readback、再承認400/監査非重複、日本語通知3件の配信、業務/Auth行cleanupを確認した。
初回は旧3桁deadlineのassertionで止まったがcleanup成功後、現仕様の6桁assertionで再実行成功。
Stripe/Resend/OAuthのsecretは依然未登録で、
外部provider acceptanceは未完了。実ユーザーデータ移行とpublic domain/DNS切替は行っていない。

## 2026-10-03：クーポン延長の応募別監査（local）

クーポン適用では取消対象2件の個別監査が0件になることをregressionで再現した。
既存適用済み0015/0019は変更せず、追加0021でcoupon command markerが新たに設定される
pending→cancelled_by_extensionに限定した監査triggerを追加した。commandのprocessing状態・
license/fanmark・操作時刻を検査し、保存後の申請者/申請/command/action/resource/metadata/timeを確認する。
監査INSERTのIGNOREまたはmetadata改変ではクーポン利用数・usage・license・取消・通知・commandを
すべてrollbackし、再送で1回だけ確定する。旧coupon markerを保持した他writerの更新で重複しない。

coupon redemption 11/11、business migration ledger 3/3、migration data 237/237、Worker typecheck、ESLint、diff check成功。
0021はlocalのみでremote適用前。converter v43、functions/RLS/triggersの包括gateは残す。
先行transfer/lottery/account-deletion修正のCI run 37024045461は両job成功。
Stripe修正97f963cのCI run 37024950939は両job成功。
クーポン修正bfdeb54をcommit済み。専用staging smoke scriptのread-only preflightで
0015/0019 trigger exact readback、business/master基準値、Auth空、ledger末尾0020を確認した。
0021適用と2件の合成応募・再送・cleanupは次のremote検証。
実ユーザー移行、外部provider実接続、Worker deploy、domain/DNS切替は行っていない。

## 2026-10-03：Stripe延長時の抽選取消監査

D1 Stripe extensionでは、2件の取消対象に個別状態変更監査が0件になることをregressionで再現した。
Durable cancellation snapshotのpending申請ごとに、申請者・申請ID・旧/新status・
`license_extended`・application request ID・操作日時を記録するINSERTをbilling batchへ追加した。
`applied`確定前にsnapshotと個別監査のexact値を検査し、未挿入/metadata改変でbatchをrollbackする。
retry後の別receiptによる同じCheckout Sessionの再処理は延長や監査を重複させない。

Stripe ingress/application/invoice/subscription/portal suite 70/70、Worker typecheck、ESLint、diff check成功。
Stripe API/providerはsyntheticのみ。schema/converter版は変更しない。クーポンのcommand-trigger
writerは引き続き未確認で、functions/RLS/triggersの包括gateは残す。
実ユーザー行・Worker deploy・Cloudflare resources・domain/DNSは変更していない。

## 2026-10-03：退会の抽選取消監査とcleanup再開

退会でpending抽選申請を取消す際もsource trigger相当の個別監査が欠けており、
Better Auth/D1 regressionで再現した。申請者・申請ID・旧/新status・`user_request`理由・
captured操作時刻を保存するINSERTをbusiness cleanup batchへ追加した。
監査失敗ではcleanupがrollbackしてAuthとuser settingsを残し、先に確定したライセンス返却は
graceのまま再開する。retryで返却ログや取消ログを重複させずに削除を完了することを確認した。

account deletion suite 6/6、Worker typecheck、ESLint、diff check成功。
譲渡修正 `c58fc5c`のCI run `37023116182`は両job成功。
抽選確定修正 `6d36028`もsource-profile 27/27でlocal検証済み。
両修正はschema/converter版を変えず、Stripe/クーポンのtrigger parityと外部provider
acceptanceは引き続き未完了。実ユーザー行・Worker deploy・Cloudflare resources・domain/DNSは変更しない。

## 2026-10-02：抽選確定の個別監査と復旧検証

source `log_lottery_entry_changes`とD1 finalizerを比較し、pending→won/lostの
個別監査ログの欠落をregressionで再現した。各申請の監査を当落更新と同じbatchへ追加し、
durable operation/entry IDsからdeterministic UUIDを生成する。旧/新status、申請者、
取消理由、captured run timestampを保存する。

既存effect guardとcommit readbackに、各監査のID・申請者・action・resource・request・
metadata・timestampの検査を追加した。監査INSERTをIGNOREするfault、metadataを書き換えるfault、
必須winner eventを欠かすfaultはいずれも抽選全体をrollbackし、同じ保存済みseed/planでretryする。
commit後の応答喪失でも個別ログを検証してrecoverする。新たに抽選をやり直さない。

source-profile integration 27/27、scheduled runner 8/8、Worker typecheck、ESLint、diff check成功。
converter v43とschemaは変更していない。譲渡修正 `c58fc5c`はPRへpush済みで
CI run `37023116182`を確認中。Stripe/クーポン/退会など他のwriterのtrigger parity、
外部provider acceptanceは引き続き未完了。実ユーザー行・Worker deploy・Cloudflare resources・
domain/DNSは変更していない。

## 2026-10-02：譲渡時の抽選取消監査を補完

read-only catalog内の`log_lottery_entry_changes`は、抽選申請のstatus変更ごとに
`LOTTERY_ENTRY_STATUS_CHANGED`を記録する。D1譲渡承認にはこの個別ログがなく、
synthetic regressionで欠落を再現した。承認済みrequestとpending申請をguardした監査INSERTを
取消UPDATEと同じ承認batchへ追加した。申請者・申請ID・旧/新status・取消理由・操作日時を保存する。

D1 suite 11/11で、対象各申請への個別ログ、他license/取消済み行の保持、再承認での重複防止、
監査INSERT失敗時のlicense/code/request/config/outbox全体のrollbackとretryを確認した。
Worker typecheck、ESLint、diff check成功。converterはv43のままでschema変更はない。
この修正は譲渡経路の証拠であり、Stripe/クーポン/退会/抽選実行等の全trigger parityは未確認。

前工程のhead `8d9b0fd`、CI run `37022024473`は両job成功。
実ユーザー行、Worker deployment、Cloudflare resources、domain/DNSを変更していない。

## 2026-10-02 v43：監査ログの操作日時レビュー完了

v41/v42と同じread-only catalog（`2026-10-02T14:21:25.605664Z`）を使用した。
`audit_logs.created_at`のsource-profile runtime writersをレビューした。登録・返却・譲渡・
抽選・ライセンス処理・管理操作・waitlist参照・Stripe・クーポンtriggerは操作時刻をbind、
またはguard済みcommandの操作時刻から取得する。監査ログ自体の日時を変更するUPDATEはない。
旧minimal lifecycle fixtureはsource-profile runtimeではなく、レビューの根拠に含めていない。
抽選の新規申請・再申請、管理plan変更、一斉メールdraftの監査日時を固定clockでreadbackし、
既存のsource lifecycle、管理メールtemplate、waitlistのreadback検証も根拠とした。

converter v43は63個のWorker-operation timestamps、7個のsnapshot-import-only timestamps、
8個のversioned reference-master timestamps、1個のscheduled Worker timestampをreview済み。
既知timestamp defaultsのoperation gateは0。functions/RLS/triggersの3 catalog scopesと
credential descriptor gateは未解消のため`deployable: false`。日時レビュー完了はschema全体の
変換完了やprovider acceptanceを意味しない。
converter 41/41、migration data 237/237、lottery D1 12/12、admin user management 12/12、
broadcast admin 11/11、Worker typecheckと変更ファイルのESLintが成功。
v41 `2c79c29`のCI run `37020954433`は両job成功。
v42 `e73396c`とv43 `096e118`はlocal validationを完了し、次のpush対象。
source rows、Worker deployment、Cloudflare resources、domain/DNSは変更していない。

## 2026-10-02 v42：設定・契約・一斉メールの操作日時

v41と同じread-only schema catalog（`2026-10-02T14:21:25.605664Z`）を使用した。
`user_settings`、`enterprise_user_settings`、`user_subscriptions`、`broadcast_emails`の
`created_at` / `updated_at`をレビューした。招待登録、Enterprise設定の新規作成とupsert、
Stripe契約の新規反映と既存契約更新、一斉メールのdraft作成とretry後完了をD1でreadbackした。
既存レコードの作成日時を維持し、操作・完了日時を更新列へ明示することを確認した。
Stripeとメールのproviderはsynthetic mockであり、実サービス接続のacceptanceではない。

converter v42は62個のWorker-operation timestamp columnsをreview済み。
残るschema/operation blockersは4 locations（`audit_logs.created_at`とfunctions/RLS/triggers
各1）、credential descriptor gateも残り、`deployable: false`。
converter tests 40/40、migration data tests 236/236、admin user management 12/12、
invitation signup 10/10、broadcast admin 11/11、subscription/delivery integration 22/22、
Worker typecheckと変更ファイルのESLintで検証する。v41 commit `2c79c29`はPR #41へpush済み。
ユーザーデータ・domain/DNS・Worker deployment・Cloudflare resourcesは変更していない。

## 2026-10-02 v41：ライセンス操作日時と猶予・失効処理の修正

read-only schema catalogは`2026-10-02T14:21:25.605664Z`。
40 tables / 406 columns / 144 constraints / 139 indexes / 36 triggers /
77 RLS policies / 58 functions / one view。source table rowsは取得していない。

source-profile D1の猶予開始、抽選なし失効、抽選後の旧ライセンス失効の3経路で、
状態変更時に`fanmark_licenses.updated_at`が更新されない問題を再現し修正した。
各経路はserver-captured操作時刻をbindし、応答喪失時のcommit確認もその時刻を検証する。
過去の作成・更新日時を持つsynthetic rowsで回帰テストを実行し、作成日時の保持と更新日時の
進行をreadbackした。登録・譲渡・抽選当選者の新規ライセンスは`license_start`、`created_at`、
`updated_at`が操作時刻になることも確認する。内部claimの取得・解除は業務日時を変更しない。

converter v41は54個のWorker-operation timestamp columns、7個のsnapshot-import-only
columns、8個のversioned reference-master timestamps、1個のscheduled Worker timestampと
11 Auth FKをreview済み。schema/operation blockersは12 locations（timestamp defaults 9、
functions/RLS/triggers各1）。credential descriptor gateも残り、`deployable: false`。
converter tests 39/39、migration data tests 235/235、source lifecycle integration 25/25、
scheduled runner 8/8、registration D1 11/11、transfer D1 9/9、Worker typecheckと変更ファイルの
ESLintを確認する。v40 head `8a17bef`のCI run `37019188514`は両job成功。
ユーザーデータ移行とdomain/DNS切替は引き続き最後の工程に留める。

## 2026-10-02 v40：ファンマ登録日時と再開時の検証

read-only schema catalogを`2026-10-02T14:11:27.866234Z`に取得した。
40 tables / 406 columns / 144 constraints / 139 indexes / 36 triggers /
77 RLS policies / 58 functions / one view。source table rowsは取得していない。

`fanmarks.created_at`と`updated_at`をレビューした。新規登録は同じ操作時刻を両列へbindし、
既存ファンマの再利用は作成時刻を保持して更新時刻だけをbindする。固定clockのD1 testsで
新規作成と過去日時の既存レコード再利用をreadbackした。snapshot importerはsource日時を保持する。
snapshot旧版拒否テストは変換版の定義を参照し、現行版のmanifestを1版下げて拒否を検証する。

converter v40は51個のWorker-operation timestamp columns、7個のsnapshot-import-only
columns、8個のversioned reference-master timestamps、1個のscheduled Worker timestampと
11 Auth FKをreview済み。schema/operation blockersは15 locations（timestamp defaults 12、
functions/RLS/triggers各1）。credential descriptor gateも残り、`deployable: false`。
converter tests 38/38、migration data tests 234/234、registration D1 tests 11/11、
Worker typecheck、変更ファイルのESLintが成功。v39 head `689a4fd`のCI run `37017428670`は
両job成功した。ユーザーデータ移行とdomain/DNS切替は引き続き最後の工程に留める。

## 2026-10-02 v39：system_settings日時のレビュー

read-only schema catalogを`2026-10-02T13:59:11.510813Z`に取得した。
40 tables / 406 columns / 144 constraints / 139 indexes / 36 triggers /
77 RLS policies / 58 functions / one view。source table rowsは取得していない。

`system_settings.created_at`と`updated_at`をレビューした。移行のseedは限定された
allowlistの値だけを出力し、各source timestampを保持する。MFA管理APIの更新は
`created_at`を維持して`updated_at`を明示し、lifecycle設定のinsert/upsertも日時をbindする。
synthetic D1 testsで新規作成、更新、作成日時の保持を確認した。system_settings全件の
コピーやprivate settingの取り込みは行っていない。

converter v39は49個のWorker-operation timestamp columns、7個のsnapshot-import-only
columns、8個のversioned reference-master timestamps、1個のscheduled Worker timestampと
11 Auth FKをreview済み。schema/operation blockersは17 locations（timestamp defaults 14、
functions/RLS/triggers各1）。credential descriptor gateも残り、`deployable: false`。
converter tests 37/37、`npm run test:migration-data` 233/233、system settings/lifecycle
D1 tests 11/11、Worker typecheck、変更ファイルのESLintが成功。PR #41のv38 head `c04efbe`は
run `37016655271`で両job成功。v39 commit `689a4fd`のrun `37017428670`も両job成功。
source rows、Cloudflare resources、Worker deploy、domain/DNSは変更していない。

## 2026-10-02 v38：通知レコード日時のレビュー

read-only schema catalogを`2026-10-02T13:54:20.132166Z`に取得した。
40 tables / 406 columns / 144 constraints / 139 indexes / 36 triggers /
77 RLS policies / 58 functions / one view。source table rowsは取得していない。

`notifications.created_at`、`triggered_at`、`updated_at`は、スケジュールWorkerが
生成時に明示する。`triggered_at`は処理時刻とルールのdelayから計算し、ユーザーが通知を
既読にする更新では`read_at`と同じ時刻を`updated_at`へbindする。synthetic D1 testsで
通常通知・遅延通知・既読更新の時刻をreadbackする。

converter v38は47個のWorker-operation timestamp columns、7個のsnapshot-import-only
columns、8個のversioned reference-master timestamps、1個のscheduled Worker timestampと
11 Auth FKをreview済み。schema/operation blockersは19 locations（timestamp defaults 16、
functions/RLS/triggers各1）。credential descriptor gateも残り、`deployable: false`。
`npm run test:migration-data` 232/232、notification D1 15/15、Worker typecheck、
変更ファイルのESLintが成功。v37 head `3c4b7cb`のCI run `37015863853`も両job成功し、
v38をpushする準備ができた。
source rows、Cloudflare resources、Worker deploy、domain/DNSは変更していない。

## 2026-10-02 v37：通知イベント日時のレビュー

read-only schema catalogを`2026-10-02T13:42:59.427789Z`に取得した。
40 tables / 406 columns / 144 constraints / 139 indexes / 36 triggers /
77 RLS policies / 58 functions / one view。source table rowsは取得していない。

`notification_events.trigger_at`、`created_at`、`updated_at`は、全runtime writerが
eventまたは操作時刻を明示的にbindすることを確認した。対象は管理操作、抽選、返却・譲渡、
ライセンス処理、Stripe処理、クーポンtrigger、通知processor。固定clockのD1 testsで
producerの時刻をreadbackし、processorのclaim/completion時刻も確認する。

converter v37は44個のWorker-operation timestamp columns、7個のsnapshot-import-only
columns、8個のversioned reference-master timestamps、1個のscheduled Worker timestampと
11 Auth FKをreview済み。schema/operation blockersは22 locations（timestamp defaults 19、
functions/RLS/triggers各1）。credential descriptor gateも残り、`deployable: false`。
converter tests 35/35、`npm run test:migration-data` 231/231、対象D1 tests、
Stripe/lifecycle integration tests、Worker typecheck、変更ファイルのESLintが成功。
v36 head `647b900`のCI run `37014590824`はapplicationとWorkerの両jobが成功。
v37 head `3c4b7cb`のCI run `37015863853`はapplicationとWorkerの両jobが成功した。
source rows、Cloudflare resources、Worker deploy、domain/DNSは変更していない。

## 2026-10-02 v36：クーポン日時のレビュー

read-only schema catalogを`2026-10-02T13:38:05.465570Z`に再取得した。
40 tables / 406 columns / 144 constraints / 139 indexes / 36 triggers /
77 RLS policies / 58 functions / one view。source table rowsは取得していない。

`extension_coupons.created_at`はMFA管理APIのcreate時に明示的なUTC時刻をbindし、
限定されたmaster seedはsource時刻を保持する。`updated_at`は管理APIの切替とクーポン利用の
D1 triggerが操作時刻を明示する。`extension_coupon_usages.used_at`はcommandの
`applied_at`から設定される。synthetic Miniflare D1が作成・更新・利用履歴の各時刻をreadbackする。

converter v36は41個のWorker-operation timestamp columns、7個のsnapshot-import-only
columns、8個のversioned reference-master timestamps、1個のscheduled Worker timestampと
11 Auth FKをreview済み。schema/operation blockersは25 locations（timestamp defaults 22、
functions/RLS/triggers各1）。credential descriptor gateも残り、`deployable: false`。
converter tests 34/34、`npm run test:migration-data` 230/230、coupon admin D1 4/4、
coupon application D1 8/8、Worker typecheck、変更ファイルのESLintが成功。
v35 head `8f5ab34`のCI run `37013644032`はapplicationとWorkerの両jobが成功。
v36 head `647b900`のCI run `37014590824`はapplicationとWorkerの両jobが成功した。
source rows、Cloudflare resources、Worker deploy、domain/DNSは変更していない。

## 2026-10-02 v35：利用可能ルール日時のレビュー

v34で取得したread-only schema catalog（`2026-10-02T13:22:08.925059Z`）から再変換した。
catalogは40 tables / 406 columnsで、source table rowsは取得していない。

`fanmark_availability_rules.created_at`はsnapshot importとstaging seedが明示的にbindする。
MFA管理APIの両方の更新経路とアカウント削除処理は`created_at`を保ち、明示的なUTC
`updated_at`をbindする。固定clock D1テストとアカウント削除D1テストで両方をreadbackする。

converter v35は38個のWorker-operation timestamp columns、7個のsnapshot-import-only
columns、8個のversioned reference-master timestamps、1個のscheduled Worker timestampと
11 Auth FKをreview済み。schema/operation blockersは28 locations（timestamp defaults 25、
functions/RLS/triggers各1）。credential descriptor gateも残り、`deployable: false`。
converter tests 33/33、`npm run test:migration-data` 229/229、availability admin D1 4/4、
account deletion D1 5/5、Worker typecheck、変更ファイルのESLintが成功。
v34 head `6ebfd31`のCI run `37012939847`はapplicationとWorkerの両jobが成功。
v35のCIはpush後に確認する。source rows、Cloudflare resources、Worker deploy、domain/DNSは変更していない。

## 2026-10-02 v34：通知ルール日時のレビュー

最新のread-only schema catalogを`2026-10-02T13:22:08.925059Z`に取得した。
40 tables / 406 columns / 144 constraints / 139 indexes / 36 triggers /
77 RLS policies / 58 functions / one viewで、source table rowsは取得していない。

`notification_rules.created_at`と`updated_at`をレビューした。ルールの作成日時はsource
snapshotとstaging seedから明示的にbindされる。MFA管理APIの更新は`created_at`を維持し、
期待値より後の`updated_at`をbindする。固定clockのD1 testが両方をreadbackする。

converter v34は37個のWorker-operation timestamp columns、6個のsnapshot-import-only
columns、8個のversioned reference-master timestamps、1個のscheduled Worker timestampと
11 Auth FKをreview済み。残るblockingは30 locations（timestamp defaults 27、functions/RLS/triggers各1）で
`deployable: false`。converter tests 33/33、`npm run test:migration-data` 229/229、
notification-master D1 tests 6/6、Worker typecheck、変更ファイルのESLintが成功。
前のPR head `e2a1a05`のCI run `37012229177`ではstaging application jobが成功し、Worker jobは実行中。
v34 head `6ebfd31`のCI run `37012939847`はstaging applicationとWorkerの両jobが成功。
source rows、Cloudflare resources、Worker deploy、domain/DNSは変更していない。

## 2026-10-02 v33：通知・メールテンプレートの日時レビュー

最新のread-only schema catalogを`2026-10-02T13:17:06.595505Z`に取得した。
40 tables / 406 columns / 144 constraints / 139 indexes / 36 triggers /
77 RLS policies / 58 functions / one viewで、source table rowsは取得していない。

`email_templates`と`notification_templates`の`created_at` / `updated_at`を確認した。
作成時刻はsnapshot importと限定されたstaging seedだけが明示的にbindし、ランタイム編集は
`created_at`を維持して別途レビュー済みの`updated_at`だけを進める。通知マスターの固定clock
D1 testと認証メールテンプレートのD1 testがreadbackする。

converter v33は36個のWorker-operation timestamp columns、5個のsnapshot-import-only
columns、8個のversioned reference-master timestamps、1個のscheduled Worker timestampと
11 Auth FKをreview済み。残るblockingは32 locations（timestamp defaults 29、functions/RLS/triggers各1）で
`deployable: false`。converter tests 33/33、`npm run test:migration-data` 229/229、
notification-master D1 tests 6/6、admin email-template D1 tests 4/4、Worker typecheck、
変更ファイルのESLintが成功。v33 head `e2a1a05`のCI run `37012229177`ではstaging
application jobが成功し、Worker jobはv34 push前の時点で実行中だった。
source rows、Cloudflare resources、Worker deploy、domain/DNSは変更していない。

## 2026-10-02 v32：転送・抽選の日時レビュー

最新のread-only schema catalogを`2026-10-02T13:03:01.839723Z`に取得した。
40 tables / 406 columns / 144 constraints / 139 indexes / 36 triggers /
77 RLS policies / 58 functions / one viewで、source table rowsは取得していない。

`fanmark_transfer_codes`、`fanmark_transfer_requests`、
`fanmark_lottery_entries`、`fanmark_lottery_history`の計12 timestamp columnsを
Worker operation timestampとしてレビューした。固定clockに加え、拒否・再申請・取消を
次の時刻で実行し、作成/申請時刻の保持と`updated_at`の前進をD1からreadbackする。
ライフサイクル統合テストは抽選履歴の`executed_at`と`created_at`も確認する。
snapshot importはsource timestampを明示的にbindする。

converter v32は34個のWorker-operation timestamp columnsと11 Auth FKをreview済み。
残るblockingは36 locations（timestamp defaults 33、functions/RLS/triggers各1）で
`deployable: false`。converter tests 32/32、`npm run test:migration-data` 228/228、
transfer D1 tests 9/9、lottery D1 tests 12/12、license-expiry integration 25/25、
Worker typecheck、変更ファイルのESLintが成功。PR head `990e841`のGitHub Actions run
`37011388396`はアプリ・Worker両job success。
source rows、Cloudflare resources、Worker deploy、domain/DNSは変更していない。

## 2026-10-02 v31：招待コードtimestampsの限定レビュー

最新のread-only schema catalogを`2026-10-02T12:57:00.005354Z`に取得した。
40 tables / 406 columns / 144 constraints / 139 indexes / 36 triggers /
77 RLS policies / 58 functions / one viewで、source table rowsは取得していない。

`invitation_codes.created_at`と`updated_at`をWorker operation timestampとして追加レビューした。
招待コード管理APIのcreateとpatchはcanonical UTC時刻を明示的にbindする。
固定clockのD1 integration testは作成時の両時刻とpatch後の`updated_at`をreadbackし、
`created_at`が保持されることも確認する。snapshot importはsource timestampsをbindする。

converter v31は22個のWorker-owned timestamp columnsと11 Auth FKをreview済み。
残るblockingは48 locations（timestamp defaults 45、functions/RLS/triggers各1）で
`deployable: false`。converter tests 31/31、`npm run test:migration-data` 227/227、
invitation admin D1 tests 5/5、auth D1 tests 27/27、Worker typecheck、変更ファイルのESLintが成功。
source rows、Cloudflare resources、Worker deploy、domain/DNSは変更していない。

## 2026-10-02 v30：emoji master timestampsの限定レビュー

最新のread-only schema catalogを`2026-10-02T12:49:06.519034Z`に取得した。
40 tables / 406 columns / 144 constraints / 139 indexes / 36 triggers /
77 RLS policies / 58 functions / one viewで、source table rowsは取得していない。

`emoji_master.created_at`と`updated_at`をWorker operation timestampとして追加レビューした。
固定clockのD1 integration testは管理APIのcreate、update、import insert、import upsertを
readbackし、update/upsertが`created_at`を保持して`updated_at`を進めることを確認する。
canonical catalog seedとsnapshot importerもそれぞれ明示的な時刻をbindする。

converter v30は20個のWorker-owned timestamp columnsと11 Auth FKをreview済み。
残るblockingは50 locations（timestamp defaults 47、functions/RLS/triggers各1）で
`deployable: false`。converter tests 30/30、`npm run test:migration-data` 226/226、
Worker `test:auth:d1` 27/27、Worker typecheck、変更ファイルのESLintが成功。
直前のv29 PR head CI run `37008817112`は両job success。v30 headのrequired CIは別途確認する。
source rows、Cloudflare resources、Worker deploy、domain/DNSは変更していない。

## 2026-10-02 v29：Fanmark設定timestampsの限定レビュー

v28で扱った`fanmark_profiles`に加え、
`fanmark_basic_configs`、`fanmark_messageboard_configs`、
`fanmark_password_configs`、`fanmark_redirect_configs`の
`created_at` / `updated_at`をWorker operation timestampとしてレビューした。
設定APIの固定clock D1 testは4種類すべての新規作成・更新時刻をreadbackし、
updateで`created_at`を維持して`updated_at`だけ進むことを確認する。
登録APIはbasic、redirect、messageboardの初期値を固定時計で確認し、
譲渡APIは新しいbasic configの初期時刻をreadbackする。

converter v29は18個のWorker-owned timestamp columnsと11 Auth FKをreview済み。
残るblockingは52 locations（timestamp defaults 49、functions/RLS/triggers各1）で
`deployable: false`。schema-convert tests 29/29、
`npm run test:migration-data` 225/225、profile D1 5/5、settings D1 18/18、
registration D1 11/11、transfer D1 9/9が成功。PR headのrequired CIは
別途検証される。source rows、Cloudflare resources、Worker deploy、domain/DNSは
変更していない。

## 2026-10-02 v28：プロフィールtimestampsの限定レビュー

`2026-10-02T12:25:35.315086Z`のread-only catalogで確認した
`fanmark_profiles.created_at`と`fanmark_profiles.updated_at`を追加レビューした。
プロフィールAPI、設定API、登録APIの各Worker writerはoperation timestampを
明示的にbindし、profile D1 testでは固定clockで新規作成時の両時刻と、
後続更新時に`created_at`を保持して`updated_at`だけ進むことをreadbackした。
registration testとsettings testもそれぞれの生成経路のD1時刻を確認する。

converter v28は10個のWorker-owned timestamp columnsと11 Auth FKをreview済み。
残るblockingは60 locations（timestamp defaults 57、functions/RLS/triggers各1）で
`deployable: false`。schema-convert tests 28/28、
`npm run test:migration-data` 224/224、profile D1 5/5、settings D1 18/18、
registration D1 10/10が成功。
PR headのrequired CIは別途通過が必要で、CIはdeployを行わない。source rows、Cloudflare
resources、Worker deploy、domain/DNSは変更していない。

## 2026-10-02 v27：アクセス分析 timestampsの限定レビュー（12:25 UTC）

linked Supabaseへのread-only catalog queryを再実行し、
`2026-10-02T12:25:35.315086Z`時点で40 tables / 406 columns /
144 constraints / 139 indexes / 36 triggers / 77 RLS policies /
58 functions / one viewを確認した。catalog metadataのみを読み、
source table rowsは取得していない。

converter v27はWorker operation timestampとして次の3列を追加レビューした:
`fanmark_access_logs.accessed_at`、`fanmark_access_daily_stats.created_at`、
`fanmark_access_daily_stats.updated_at`。固定clockで初回アクセスの時刻を確認し、
5分と1ミリ秒後の再訪で集計行の`created_at`を維持しながら
`updated_at`と最新アクセスログを更新することをD1 readbackした。
この契約はD1 operation timeであり、PostgreSQL transaction timeや
sub-millisecond clockとの厳密な同値性は主張しない。

最新のvalue-free credential descriptor付きreportはschema version 27、
11 Auth FKをreview済み、blocking 62 locations（timestamp defaults 59、
functions/RLS/triggers各1）で`deployable: false`。converter tests 27/27、
このv27 checkpointでは`npm run test:migration-data` 223/223、access analytics
D1 tests 11/11が成功し、required CI run `37007064286`も両job success。
source rows、
Cloudflare resources、Worker deploy、domain/DNSは変更していない。

## 2026-10-02 v26：Worker operation timestampsの限定レビュー（12:10 UTC）

linked Supabaseへのread-only catalog queryを再実行し、`2026-10-02T12:10:27Z`時点で
40 tables / 406 columns / 144 constraints / 139 indexes / 36 triggers /
77 RLS policies / 58 functions / one viewを確認した。catalog metadataのみを読み、
source table rowsは取得していない。

converter v26は5列のWorker書込みを、現行コード・明示的UTC formatter・D1
統合readbackで照合した: `waitlist.created_at`, `fanmark_discoveries.first_seen_at`,
`fanmark_discoveries.last_seen_at`, `fanmark_events.created_at`,
`fanmark_favorites.created_at`。D1のoperation timeを
正規UTC形式で保存する契約を採用し、PostgreSQL transaction timeやsub-millisecond
clockとの厳密な同値性は主張しない。新規search/favorite discoveryの両insert経路で
first/last seen、event、favorite timestampsが同一のcanonical valueになることを
readbackした。

value-free credential descriptor付きの最新reportはschema version 26、11 Auth FKを
review済み、blocking 65 locations（timestamp 62、functions/RLS/triggers各1）で
`deployable: false`。converter tests 26/26、`npm run test:migration-data` 222/222、
favorites D1 tests 7/7、waitlist signup D1 tests 6/6が成功。PR #41の直前head `d7acab7`の
required CIも両job successだが、このv26変更はpush後のCI確認が必要。

## 2026-10-02 v25再確認：最新schema-only catalog（12:03 UTC）

linked Supabaseへのread-only queryを再実行し、`2026-10-02T12:03:07Z`時点で
40 tables / 406 columns / 144 constraints / 36 triggers / 77 RLS policies /
58 functionsを確認した。queryはcatalog metadataのみを対象にし、source table rowsは
取得していない。応答と変換reportはprivate temporary directoryに保存した。

value-free credential descriptorを渡したconverter v25は、11本の完全一致した
`auth.users(id)` foreign keyをreviewed dispositionとして記録し、external Auth FKの
blocking locationを0にした。全体は`deployable: false`のままで、4 gate groups /
70 locations（operation-owned timestamp defaults 67、functions/RLS/triggers各1 group）。
timestamp-writer auditは79 defaults、99 explicit-column INSERTs、unparsed INSERT 0件、
直接のliteral writerが見つからないdefaults 11件を報告した。静的writer coverageは
実行時の時刻精度・意味を証明しない。

PR #41 head `0e16d9f`のapplication / Worker API CIはrun `37004143377`で両方success。
実ユーザー行の読出し・移行、Cloudflare staging D1/R2への書込み、Worker deploy、
ドメイン/DNS変更はしていない。

## 2026-10-02 converter v25: exact Auth foreign-key dispositions

現在のschema-only catalog（11:17 UTC）で観測した`auth.users(id)`参照11本を、
constraint名・source table/column・source UUID型・delete actionの完全一致で照合する。
一致する参照はD1 SQLへ出力せず、`reviewedAuthForeignKeys`として変換reportに記録する。
現在の`supabase/remote_schema.sql`をテストで照合し、1本でも名前・列・actionが変われば
従来どおりblocking gateに戻る。その他のexternal FKも引き続きgateする。

D1 import計画は別途Auth参照を検出し、すべての非NULL UUIDをread-only Auth D1 lookupで
業務D1書込み前に確認する。account deletionはBetter Auth経由の既存Worker操作に限定し、
CASCADEとSET NULLを業務D1で処理、`broadcast_emails.created_by`のNO ACTIONは副作用前に
削除を拒否する。これらの経路は既存のD1テストで検証済み。クロスDBの物理FK自体はなく、
function/RLS/triggerおよびtimestamp操作のgateも残るため、schema全体は未deployable。

converter単体24/24、account-deletion D1 5/5、`npm run test:migration-data` 220/220を確認。
PR #41 commit `4515813`はActions run `37003535521`でapplication / Worker APIの両jobがsuccess。
この変更はschema変換準備のみで、実ユーザー行の読出し・移行、staging/production D1/R2への
書込み、Worker deploy、ドメイン/DNS変更はしていない。

## 2026-10-02 最新read-only catalogとsynthetic import再生（11:17 UTC）

`npx --yes supabase@2.119.0 db query --linked --file
scripts/migration/schema-readiness.sql --output-format json`を再実行した。
SQLは`BEGIN READ ONLY`でcatalog metadataのみを読む。観測時刻は
`2026-10-02T11:17:58.694587Z`。40 tables / 406 columns / 58 functions /
36 triggers / 77 RLS policiesを確認した。応答とconverter reportはmode 0700
の一時directory内だけに保存し、終了時に削除した。source table rowsは取得していない。

value-free credential descriptorを渡したconverter v24は`deployable: false`
のまま、5 gate groups / 81 locationsを返した。この後のv25では外部Auth参照11本を
完全一致のreviewed dispositionへ移し、残るblocking gateは4 groups / 70 locationsとなる。
内訳はoperation-owned timestamp defaults 67、未翻訳のfunctions / RLS policies /
triggers各1 group。別のtimestamp-writer auditは79 defaults、99 INSERT column
lists、11 defaults without a direct literal writer、unparsed INSERT 0件を返した。
このaudit countとconverter gate countは範囲が異なる。

同一catalogで`node scripts/migration/test-d1-import-current-schema.mjs <private-catalog>`
を実行し、disposable local Miniflare D1で40/40 checkpoints、12 synthetic rows、
6 external Auth identity lookups、2 credential transforms、inactive credential 1件の
durable deferral、import-only timestamp readback、conflicting coverage rejectionを確認。
結果は`public_rows_reconciled`、`deployable=false`、
`fullMigrationReconciled=false`。source rows、Cloudflare staging D1、R2は使っていない。

PR #41 head `bd7c8bd`のrequired application / Worker API CIはrun
`36999647995`で両方success。headの変更は棚卸しdocumentationのみで、Workerを
redeployしていない。read-only `wrangler secret list`ではstaging secretsは引き続き
`BETTER_AUTH_SECRET`、`REFERENCE_MASTER_SERVICE_SECRET`、
`VERIFIED_ACCESS_SECRET`の3件のみ。Stripe test、Resend、social OAuth acceptanceは
各provider設定後まで未完了。実ユーザーデータ、live payment/email、production route、
domain/DNSへの変更はない。

## 2026-10-02 current checkout and live inventory refresh

PR #41 commit `0b42862` passed both GitHub Actions jobs in run
`36997782249` (Cloudflare application migration boundaries/build and Worker
API contracts/typecheck/bundle dry-run). The offline
frontend scanner was regenerated from this checkout; its base is `63b6018`
and it still finds 211 static callsites. The prior 143 plus the mapped 68
cover each location once; `test:frontend-callsite-mapping.mjs` enforces exact
coverage. The latest owner-license changes use the session-scoped D1 API for
home counts and plan-downgrade selection.

After CI, the current workers.dev-only staging config was built and deployed
to `fanmark-app-staging` as version
`d2330dd1-ce17-41c0-99d2-a81b242c412d` (100%). Wrangler confirmed the existing
`* * * * *` and `0 0 * * *` schedules and split Business/Auth/Master D1 plus
avatar/cover R2 bindings. Read-only GET checks returned 200/no-store for
Better Auth health/session, emoji catalog, and the four-tier reference master;
the session endpoint returned anonymous. The SPA root also returned 200.
Neither license expiry nor notification archival was enabled by this deploy.
No D1 migration or manual D1/R2 write was run; production routes and domains
were untouched.

A read-only production public-schema dump refreshed `supabase/remote_schema.sql`.
The private raw dump was 180,288 bytes with SHA-256
`aac7f38c912b358019a9bb9f282813a10bcd3e20af09e929d1ec41a2705b42cd`; after
normalizing trailing blank lines, the committed snapshot is 180,281 bytes with
SHA-256 `6d0a41fd4f687c51d01963c83d565fe5854dfd19878b03d102716488c2ff656c`.
It contains schema only: 40 tables / 406 columns, 58 functions, one view, one
sequence, four types, and 77 policies. All object-identity differences from
the older snapshot match checked-in migrations. A separate Functions metadata
readback found 35 ACTIVE deployments; all 34 local `verify_jwt` flags match,
with `manual-expire-grace-licenses` remaining live-only. Details and deployed
versions are in [live observations](live-observations.md).

The migration-data suite passes 215/215, application typecheck and targeted
ESLint pass, and CI passes both jobs. The staging deployment did not read or
write user rows or apply a D1 migration. No production schema, route, or
domain/DNS changed. Issue #30
still needs the user's capacity margin, maximum downtime, and configuration
owner targets, plus a disposition for the live-only function authorization gap.
Provider acceptance remains open. A bounded trace covers the known shared
favorites, plan, profile, and emoji-master helpers; arbitrary dynamic aliases
and whole-program call paths remain unproven.

The deployed-only `manual-expire-grace-licenses` source uses the service-role
client without checking administrator role or MFA in the handler. It can
expire every past-due grace license and remove related configuration rows; its
JWT gateway requirement alone does not establish an administrator boundary.
The function was only downloaded to a private temporary directory and reviewed;
it was not invoked or changed. Treat its retirement or mitigation as a
production security gate. Details are in [live observations](live-observations.md).

Separate staging evidence covers the scheduled synthetic lifecycle path and
the guarded post-write recovery rehearsal: one synthetic Stripe extension was
applied once, D1 Time Travel and encrypted R2 restore preserved admin MFA and
the avatar, and five writes during freeze were rejected. The D1 notification
archiver now has an explicit timestamp writer under converter v24, but
`NOTIFICATION_ARCHIVE_BACKEND` remains unset in staging.

## 2026-10-02 最新差分: 通知RPC ACL、callsite分類、CI timeout

PR #41のコードcheckpoint `7f863f3` はActions run `36986104988` の両jobが成功。
フロントエンド211 callsiteは、このcheckpoint時点では141件を分類し70件が未分類だった。
その後、owner-license reads 2件と残る68件の対応表を追加し、静的callsite 211件すべてに
owner、data class、Cloudflare置換先または保持方針を記録した。対応表は
[`repository-inventory.md`](repository-inventory.md) と
[`frontend-callsite-map.md`](frontend-callsite-map.md) を参照。これは静的参照の分類完了であり、
wrapper/indirect call、production reconciliation、provider acceptanceの完了を意味しない。
延長CheckoutはWorker routeとclientを台帳へ反映したが、stagingのStripe selectorと
keysが未設定のため404で閉じている。Stripeへのリクエストは行っていない。

直前のrun `36984142796` では`subscription-application.test.mjs`が3回とも
120秒timeoutした。診断付きrunでは初回に`construct PGlite`と`create base schema`
まで出て、テスト用base schemaを一括実行する`db.exec`から120秒戻らなかった。
fresh processの再試行では同じschema処理が約2秒で終わり、suite 8/8で成功した。
この間欠停止はテスト用PGliteのbase-schema実行内に絞れたが、具体的なSQL文または
hosted runner側の誘因は未特定。Node 22.6.0のローカルでは当該fileとStripe suite
全体が成功した。CIはdeployを行わない。

211件のフロントエンドSupabase callsiteすべてをowner、data class、Cloudflare置換先または
保持方針まで分類した。先行する143件はAuth/Auth-MFA 40件、
本人/ファンマークプロフィール20件、設定/Storage 11件、マスター/参照データ19件、
検索/登録8件、お気に入り3件、譲渡/抽選10件、Realtime 8件、通知操作・管理画面14件、
ダッシュボード/Analytics 8件とowner-license reads 2件。残る68件の分類は
[`frontend-callsite-map.md`](frontend-callsite-map.md) に記録した。
延長CheckoutはWorker clientがあるが、staging APIはselector/secrets未設定で
404のfail-closed状態を保ち、Stripe provider acceptanceは未完了。
認証の本番/defaultはSupabaseのまま、
stagingはBetter Authを選択する。実ユーザーのID/credential/MFA移送は#38に
残している。通知数RPCについてproduction Supabaseをschema-onlyで読み戻し、
`get_unread_notification_count(uuid)` が入力UUIDを認証主体と照合せず、
`anon`にもEXECUTEを許可していることを確認した。返すのは未読件数だけで
内容は含まれないが、既知UUIDを指定して他人の件数を読めるACL/認可差分。
Cloudflare APIはBetter Auth session ownerに限定しており、sourceより狭い。

Supabase側の修正migrationとpgTAP regression testを追加した。使い捨て
PGlite検証では匿名実行拒否、authenticated/service_roleの実行許可、本人の
eligible未読件数、他人UUIDの拒否を確認した。`supabase status` はworktreeに
local DB containerがないため起動できず、pgTAP自体は未実行。migrationは
branch上だけで、Supabase本番には適用していない。ユーザーデータ、R2、
本番route、DNS/domainにも変更なし。

## 2026-10-02 follow-up: archive smoke guard and PGlite runner

Actions run `36991654600` はWorker API jobが成功し、application jobは
`subscription-application.test.mjs`のPGlite初期化で失敗した。3回とも新規processの
base schema statement 1で120秒停止した。どのSQL文が原因かは確認できていない。
このsuiteをNode test worker内でなくstandalone Node processとして実行する変更を
worktreeへ加え、`CI=true npm test --prefix experiments/stripe-receipts`は全suite成功。
PR #41 commit `4ee72f6`のActions run `36993739726`でapplicationとWorker APIの
両jobも成功。CIはdeployを行わない。

通知archival用のstaging canary scriptとtarget guardも追加した。実Workerのselectorは
引き続きunsetのまま、ローカルscheduled Workerに一時selectorを渡してremote business
D1の合成通知だけを検査する。index migration `0020`のreadback、空の通知/履歴と
認証/業務baseline、固定staging identityを全て通らない限り書き込みを始めない。
2026-10-02にbusiness stagingのmigration `0020`を適用し、`idx_notifications_archive_due`と
pending migrationなしをremote readbackした。Actions run `36993739726`成功後にcanaryを実行し、
古いdelivered/failed 2行をarchive、対象外4行を保持、cleanup後の合成通知/履歴0行、
業務/master/public-settings baseline不変、Auth行0件を確認した。ローカルscheduled Workerが
remote staging D1へ接続し、実Worker deployment/Cron/configは変更していない。
production、ユーザーデータ、domain/DNSは変更していない。

## 2026-10-02 owner-license read completion

The Cloudflare staging build selected `VITE_OWNED_FANMARKS_BACKEND=worker`, but
the home-screen license count and shared plan-downgrade selection helper still
queried Supabase directly. Both now use the existing session-scoped
`GET /api/me/fanmarks` route in Worker mode. The projection counts active
perpetual licenses and excludes expired or grace licenses; the legacy Supabase
home count was aligned to include perpetual licenses as well. A focused
projection test passes 2/2, the migration-data suite passes 215/215, root
typecheck and targeted ESLint pass, and the Cloudflare staging build succeeds.
No staging account or user data was read or written for this local change.

## 2026-10-02 PR #41 validation, staging Worker, and D1 readback

PR #41 remains open and draft. GitHub Actions run `36966388049` passed both
the Cloudflare staging application and Worker API jobs. A prior run exposed a
date-sensitive Stripe test fixture whose fixed 2026-10-01 license expiry had
elapsed on 2026-10-02; the fixture now uses a future UTC date, and
`npm --prefix experiments/stripe-receipts test` passes locally. CI validated
code and build only. A separate guarded canary deployed and then restored the
staging Worker.

Using the explicit `fanmark-staging-inapp` profile, Cloudflare readback showed
restored Worker version `6f0d73af-f3db-46b5-94fb-fed521478634` at 100%; the
temporary canary version `89172416-0366-4c2f-b464-d71b200cef48` is no longer
active. The profile identifies `fanmark.id@gmail.com` in the intended
Fanmark.id account. Remote migration readback reported no pending migrations
for Business, Auth, or emoji-master staging D1.

The current staging Worker retains Cron schedules `* * * * *` and
`0 0 * * *`; `NOTIFICATION_PROCESSOR_BACKEND=d1` is configured, while
`LICENSE_EXPIRY_BACKEND` is unset and daily license expiry therefore remains
disabled. The secret-name readback still contains only
`BETTER_AUTH_SECRET`, `REFERENCE_MASTER_SERVICE_SECRET`, and
`VERIFIED_ACCESS_SECRET`; no secret values were read. Stripe/Resend/OAuth
provider acceptance and CPU/plan fit remain open. Converter v23 is also not
deployable: 11 external Auth references, 68 timestamp-default operations, and
functions/RLS/trigger scope gates remain; its fresh-catalog synthetic replay
proves public-row reconciliation only, not full migration reconciliation.
No real user/Auth/Storage rows, production routes, or domain/DNS were changed.

## 2026-10-02 master D1 and scheduled expiry readback (05:10 UTC)

Read-only Master D1 queries returned 3,944 canonical emoji rows. Its active
pointer is generation 3, action `rollback`, release
`10ec42c1a562197c1e66c5fd10316c904188cdfb274ca5b8852c99ba240d3bed`. The
active reference release is generation 8, action `promotion`, release
`ba598c61b719d84c03c10ccaee9e5308d1829fd66b1f48abba6a0e5cde9b9c0c`, with
4 tiers, 4 languages, 5 reserved patterns, and 16 extension prices. The live
emoji API returned all 3,944 rows over eight pages with unique IDs, one stable
version, HTTP 200, and `Cache-Control: no-store`; all four reference-master
API routes also returned HTTP 200/no-store with the expected counts.

`FANMARK_STAGING_CRON_CANARY=1` ran the deployed workers.dev lifecycle path
with synthetic data. The scheduled event finalized one lottery winner
(`winner_finalized`); the harness restored its Cron/selector baseline, the
grace-period setting, and retained lifecycle state. Its result reported zero
synthetic business rows, zero lifecycle journal rows, and no Auth user rows
changed. A separate aggregate D1 readback confirmed zero fanmarks, licenses,
and canary lifecycle runs after cleanup. The active daily selector remains
unset, so recurring license expiry is still intentionally disabled in
staging. No real user data or domain/DNS was migrated.

The latest catalog-only query completed at `2026-10-02T04:34:34Z` under
`BEGIN READ ONLY` and returned 40 tables / 406 columns. The updated writer audit
parsed 143 literal or statically generated INSERT column lists and found zero
unparsed target INSERTs. Twelve timestamp defaults have no direct literal
writer (eight versioned reference-master fields and four user-scoped fields).
The generic snapshot importer is a separate source-shaped path; this audit
does not establish bound-value correctness or transaction-time semantics.
The three previously unparsed master seed builders are now covered by a
regression test. The emoji release bootstrap binds an explicit six-digit UTC
timestamp to newly inserted master rows and verifies both values on readback.
`npm run test:migration-data` passes 205/205; root and Worker typechecks,
JavaScript syntax checks, and `git diff --check` pass.

## 2026-10-02 合成pre-write fallback再試験とstaging secret readback

`npm run test:migration:staging-prewrite-resume`が67,990 msで成功した。
合成署名済みStripe receiptは1件だけ受理され、duplicateは
`duplicate_nonterminal`となり、Stripe API呼出しは0回。Cloudflare write
freeze中も、使い捨てloopback Supabaseへの合成owner-settings更新が
33,654 msで成功した。終了後に通常staging Workerを復元し、receiptと
dispatchは双方0件、合成secretも除去された。

同時に`wrangler secret list --config workers/api/wrangler.app-staging.jsonc`
をread-only実行。`2026-10-01T22:25:49Z`時点で登録名は
`BETTER_AUTH_SECRET`、`REFERENCE_MASTER_SERVICE_SECRET`、
`VERIFIED_ACCESS_SECRET`の3件のみ。Stripe sandbox、Resend、OAuth providerの
staging受け入れには、必要なsecretをCloudflareへ直接登録した後の再検証が必要。
値は読み出していない。実ユーザーデータ、本番route、公開domain/DNSは変更していない。

## 2026-10-02 アプリbundleのCron遅延到達と再現確認（33分監視）

18分監視では未観測だったアプリbundle Cronを、新しい使い捨てWorker `fanmark-app-cron-long-d8523502` で33分監視した。`workers/api/src/index.ts`のbundleを載せ、`* * * * *`、100% persisted invocation logs、`SCHEDULED_DISPATCH_DIAGNOSTICS=true`を有効化。D1/R2 binding、secret、routeは設定していない。version `d95b18ec-e54a-446c-bad5-46281d6ed122`。

最初のscheduled invocationは配備後約19分半、`2026-10-01T21:09:04Z`。その後も毎分継続し、33分のWorker固有tailで30件の`scheduled-dispatch`診断log（1 invocationあたりreceived/selectedの2件）を観測した。Workers invocation logの各確認recordは`outcome=ok`、例外0で、`notification-events`と`stripe-webhook-dispatch`は両方disabled、claim/処理件数0。アプリbundleのscheduled handler自体とCloudflare Cron配達は動作する。前回18分の未観測は、このWorkerで最初のeventが見える前に監視を終了していた時間幅と整合する。

DashboardのCron Eventsは15分および32分時点でも空で、画面は新規Workerで最大30分遅れる旨を表示した。tailとWorker invocation recordはCron event本体・`scheduledTime`・`outcome=ok`を記録しているため、今回の配達証拠にはinvocation logを使い、Past Events画面の反映は未確認扱いにする。

使い捨てWorkerは33分後に削除され、URLは404。一時configも削除済みで、D1 inventoryは既存staging 3件のまま。D1/R2/secret/実データは変更していない。20分だった`postwrite-cloudflare-recovery-smoke.mjs`のdispatch待機を35分へ延長した。次はCI成功後にこの余裕時間で完全な合成post-write recoveryを再実行する。

## 2026-10-02 アプリbundleのCron隔離probe（18分監視）

D1/R2 bindingを持たない使い捨てWorker `fanmark-app-cron-diag-ac3fbf6b` に、`workers/api/src/index.ts`のアプリbundleをそのまま載せ、`* * * * *`、`SCHEDULED_DISPATCH_DIAGNOSTICS=true`、100% persisted invocation logsで配備した。CloudflareからCron scheduleとinvocation log設定をreadbackし、登録を確認。Workerはversion `caf9c907-d5b1-4a39-9b61-eeeb1511e02a`。

18分間のWorker固有`wrangler tail --search scheduled-dispatch`とDashboard Observability > Invocationsライブ/履歴の両方でイベントを受信しなかった。履歴は「イベントなし」。本体のCron未観測はD1/R2 bindingなしでも再現し、Cloudflareの最小WorkerでCronが動いた結果との差はアプリbundle/その実行経路へ絞られる。ただし配送障害とbundle固有の可視化/実行差の最終区別は未確定。実Recoveryを繰り返す前に、この境界をさらに絞る。

probe Workerを削除し、workers.dev URLは404、deployments readbackも削除済みを確認。一時configも削除し、D1 inventoryは既存Auth/Business/emoji-master staging 3件のまま。D1/R2 bindingやsecretを設定せず、実データへのアクセスもない。

## 2026-10-02 対象recovery WorkerのCron登録readbackと実行再検証（19:44–20:06 UTC）

完全recoveryを再試験する前に、使い捨てWorker `fanmark-recovery-1790883885037-e57398c01b666f22` の構成をCloudflareからreadbackした。`triggers.crons`は`* * * * *`、Workers Logsはinvocation logsを含む100% sampling、diagnosticsは有効で、Business/Auth D1とavatar R2 bindingも対象Worker上に存在した。control planeへのCron登録漏れではない。

同じWorkerのObservability > Invocations履歴は7件すべて合成HTTP `fetch` で、Cron invocationはなかった。ライブ表示もイベント待機のままで、終了後の履歴readbackにもscheduled invocationは現れなかった。Worker固有の`wrangler tail --search scheduled`にもmarkerはなく、一度接続が再確立されたため、ログtailだけを完全な連続観測とは扱わない。2つのWorker固有観測経路でscheduled invocationを確認できなかった状態で、配送と可視化のどちらが根因かは未特定。

合成post-write recoveryは19:44:45.036 UTCに開始し、最終deployment version `0c5dee53-e9f0-4762-bc3e-22f54c48780b` は19:46:29.635 UTC。20:06:49.350 UTCに`synthetic_stripe_extension_dispatch_timeout`で停止した。Stripe receipt/dispatchは`received/pending`、attempt 0。合成avatarのreadbackは成功したが、Cron dispatch待ちで停止したためTime Travel bookmarkと暗号化R2 bundle/replayには進んでいない。`r2ObjectCount=0`で、backup objectとprivate recovery directoryは未生成。

cleanup reportはWorker、Business/Auth D1、temporary config、avatar objectの削除をすべて確認した。Worker URLは404、D1 inventoryは既存のAuth/Business/emoji-master staging 3件だけ。`r2ObjectsDeleted=false`と`privateRecoveryArtifactsDeleted=false`は削除対象が生成されていなかったことを表し、cleanup failureではない。新規 Worker Cronは最小probeでは動作したが、recovery WorkerのCron invocationは引き続き未観測。Issue #34/#37と完全recovery gateは未完了。実ユーザーデータ、Supabase rows、本番route、provider、domain/DNSは変更していない。

## 2026-10-02 Cron診断とpost-write recovery再試験（18:54–19:34 UTC）

先に空の使い捨てD1をbindingした最小Workerを配備し、`* * * * *`と初回deployからの100%保存invocation logsを設定した。合成GETは200でWorker固有tailに現れ、約15分33秒後に同じWorkerのscheduled invocationが`outcome=ok`、`cron=* * * * *`で記録された。新規WorkerのCronは配送され、未使用のD1 bindingもCronを止めていない。probeのWorker/D1/configを削除し、削除後URLは404、D1一覧は既存3件だけに戻った。

続けてpost-write recovery smokeを19:12:25.947 UTCに開始し、最終Worker version `7fb687df-4781-43df-a2e0-4068db0aec46`を19:13:35.635 UTCに配備した。configには`* * * * *`、`SCHEDULED_DISPATCH_DIAGNOSTICS=true`、100% sampling、persisted invocation logsを設定。Worker固有tailは`scheduled`をfilterし続けたが、20分超の間scheduled markerは現れなかった。

receipt/dispatchのreadbackは`received/pending`、attempt 0のまま。D1 readback transient error 7403が1回あったが再試行後に状態を読み戻しており、timeoutの説明にはならない。合成avatarは68 bytesのbyte一致、`image/png`とcache-control一致をreadbackした。19:34:02.729 UTCに`synthetic_stripe_extension_dispatch_timeout`で停止し、Time Travelと暗号化R2 bundle/replayには進んでいない。

cleanup readbackはWorker、Business/Auth D1、temporary config、avatar objectすべて削除成功。Worker URLは404、D1 inventoryは既存のAuth/Business/emoji-master 3件のみ。`r2ObjectCount=0`でbundle/backup objectは作られず、失敗phaseがbackup作成前のためprivate recovery directoryも作られていない。reportの`r2ObjectsDeleted=false`と`privateRecoveryArtifactsDeleted=false`は未生成物を削除する対象がなかった状態で、cleanup failureではない。

最小WorkerでCron配送は確認できたが、アプリ本体の使い捨てWorkerでは設定済みscheduleのreadbackとruntime invocationのどちらもまだ確認できていない。Issue #34/#37とrecovery gateは未完了。完全recoveryを再実行する前に、この本体WorkerのCloudflare側schedule登録を直接readbackし、登録と実行を分離して診断する。実ユーザーデータ、Supabase rows、本番route、Stripe/Resend provider、domain/DNSは変更していない。CI run `36909741122`は両必須job成功。

## 2026-10-02 post-write recovery再試験: Cronが未配送（18:25–18:47 UTC）

診断版 `postwrite-cloudflare-recovery-smoke.mjs` でsynthetic-onlyの完全recoveryを再試験した。使い捨てWorkerの最終デプロイは18:26:37 UTCで、最初のデプロイからWorkers Logsの保存・invocation logs・100% samplingを有効にした。health GETは200、tailとWorker専用保存ログには合成HTTP要求が記録されたが、自然発火Cronのinvocation/logは現れなかった。Cloudflareの最大15分伝播時間を過ぎた後も同じ状態だった。

D1 readbackはreceipt `received`、dispatch `pending`、`attempt_count=0`。合成avatarは68 bytes、本文一致、`image/png`とcache-control一致を確認した。最終デプロイから20分のdispatch待機後、18:47:19 UTCに`synthetic_stripe_extension_dispatch_timeout`で停止し、Time Travelと暗号化R2 backup/replayには進まなかった。

cleanup readbackはWorker、使い捨てBusiness/Auth D1、temporary config、合成avatar objectの削除成功。削除後のWorker health URLは404、独立したD1一覧は既存のAuth/Business/emoji-master staging DB 3件のみ。R2 backup object数は0でbundleは未作成。report上の`r2ObjectsDeleted=false`と`privateRecoveryArtifactsDeleted=false`は対象物が生成前で存在しなかったためで、cleanup failureではない。実ユーザーデータ、Supabase rows、production route、Stripe/Resend provider、domain/DNSは変更していない。

Workers Logsを初回デプロイから明示有効にしても新規recovery WorkerのCron deliveryを観測できなかった。Issue #34/#37と完全post-write recovery gateは未完了。同じrecoveryを続けて再実行せず、Cron schedule registrationとruntime deliveryを別々に診断する。

## 2026-10-02 system settings管理画面のstaging検証

`AdminSettings`に最大絵文字数（1〜1,000,000）の編集欄を追加した。D1のsystem settings APIは公開projectionには含めていたものの書込allowlistから漏れていたため、`max_emoji_characters`をCAS/監査付き更新対象に加えた。設定読込失敗時は保存を停止する。招待モードは既存の`AdminInvitationManager`で編集する。

Worker `fanmark-app-staging` version `3293bea8-7929-4d6f-8786-886abd39348d`を100%配信。合成管理者の同一session TOTP/MFA canaryで、system settings APIの匿名拒否・stale拒否・一時更新、AdminSettingsからの`max_emoji_characters`更新/復元、猶予期間フォームの更新/復元を検証。D1の最大絵文字数は5へ戻り、合成設定監査行・管理profile・Auth user-owned rowはcleanup readbackで0。MFA generation counterは単調増加のため保持する。

`npm run test:system-settings-api` 4/4、`npm --prefix workers/api run test:system-settings-d1` 6/6、root/Worker typecheck、変更ファイルESLint、staging build、Wrangler staging deploy dry-run、CI run `36897394913`（head `7f66c5e`）が成功。staging canary harnessの修正もCI run `36899737450`（head `c5bf7a3`）で両job成功。実ユーザーデータ、Supabase行、本番route、Stripe/メールprovider、domain/DNSは変更していない。

最新docs checkpoint `8a45507` のGitHub Actions run `36900588611` もCloudflare staging applicationとWorker APIの両jobが成功。AdminSettingsの最大絵文字数は合成TOTP/MFA browser canaryで5→6→5を更新・復元し、cleanup後の値5と合成ユーザー/監査行0をreadbackした。

## 2026-10-02 disposable Cron API readback: 登録済み・実行未確認（15:06–15:24 UTC）

新規Worker Cronの登録readbackが曖昧だったため、15:06:14 UTCにD1/R2 bindingのない最小Workerを
`fanmark-staging-inapp` profileで配備。最初にprofileを指定せず実行したdeployは、作業tree外の一時
configが別の保存済みprofileを選び、API authentication error 10000で作成前に失敗した。正しいprofileを
明示した再試験は成功し、Cloudflare Cron Schedules APIのGETは200、`* * * * *`を返した。

Workerへの合成GETは200で、Worker固有tailにもfetchが表示されてtail接続を確認した。一方、Cron markerは
15:23:15 UTCまでの約17分間表示されず、Cloudflareの最大15分propagation後にもscheduled invocationを
観測しなかった。[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)の
伝播時間上限を越えている。Worker削除後のSchedules API readbackは404/code 10007、D1一覧は既存の3 staging DBのまま。
一時Workerとローカルdirectoryは削除済み。よってscheduleのcontrol-plane登録とfetch/tail経路は確認したが、
新規WorkerのCron deliveryは未確認。原因を特定するまでフルrecoveryを再実行しない。Issue #34/#37と
recovery gateは未完了。実ユーザーデータ、既存staging D1、R2、production route、domain/DNSは変更していない。

Cloudflare API仕様: [Get Worker Script Schedules](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/schedules/methods/get/)。

15:32 UTC、削除済み診断WorkerのCron Events画面には15:22:21から15:31:21までの成功行が表示された。
新しく開いた既存`fanmark-app-staging`のCron Events画面にも、時刻とCPU時間が一致する同じ10行があり、
そのうち複数は診断Workerの削除readback後の時刻だった。よってこのDashboard履歴はWorker単位に帰属できず、
実行証拠にしない。Cloudflare側の古い/共有/誤帰属データかは特定できていない。Worker固有tailには
fetch記録が届いた一方、scheduled markerは届かなかったため、Cron deliveryは引き続き未確認。

## 2026-10-01 disposable recovery再試験: 新規Worker Cron起動未確認（14:33 UTC）

13:49:57 UTCに始めた試験は14:02:52 UTC、D1 readbackのAPI error 7403で停止した。最終Worker配備
から約11分で、Cloudflareが案内する最大15分のtrigger propagation前だったため、Cronの成否は判定
できない。停止直後の既存`fanmark-business-staging`に対するread-only `SELECT 1`は成功し、継続的な
認証失敗は再現しなかった。PR #41 commit `ab21efb`で、read-only dispatch監視に限って7403を再試行
するよう修正した。Actions run `36873650354`はapplicationとWorker APIの両jobが成功。

再試験は14:11:58.740 UTC開始、最終配備readbackは14:13:22.092 UTC。Worker固有の`wrangler tail`
は接続し、合成avatar fetchのログを受信したが、scheduled invocation/diagnostic logは一度も観測
しなかった。最終配備から15分後を過ぎてもreceiptは`received/pending`、dispatch attempt 0のまま
だった。20分監視は14:33:51.345 UTCに`synthetic_stripe_extension_dispatch_timeout`で終了し、
Time Travelと暗号化backup/R2 replayには進んでいない。7403再発回数は0。

cleanup readbackではWorker、使い捨てbusiness/Auth D1、temporary config、合成avatar objectの削除が
すべて成功し、D1一覧は既存の`fanmark-auth-staging`、`fanmark-business-staging`、
`fanmark-emoji-master-staging`のみ。backup bundleは作成されず、recovery R2 objectも0件。次は
同じrecoveryを繰り返さず、Cloudflare上の新規Worker Cron実行/可視化経路を調べる。Issue #34/#37と
recovery gateは未完了。実ユーザーデータ、production route、domain/DNSは変更していない。

登録と実行を分けるため、14:42:19.836 UTCにD1/R2 bindingのない最小の使い捨てWorkerを配備し、
`* * * * *`を登録した。`wrangler init --from-dash`でCloudflareから構成を読み戻すと、
`triggers.crons`は同じ毎分scheduleだった。Worker固有tailは15分後まで接続を保ったが、scheduled
markerは届かなかった。Cron Events画面も履歴なしと表示したが、新規Workerでは履歴表示に最大30分
かかる旨を示しており、この画面は補助情報とする。Cloudflareの[real-time logs](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/)
はinvocation/custom logを含み、`wrangler tail`で確認できる。今回、scheduleの登録は確認済みだが、
新規Workerのscheduled invocation/ログは未確認のまま。Cron設定資料ではtrigger変更の伝播に最大15分、
新しいWorkerのCron Events履歴に最大30分を案内しているため、tailの欠落と履歴画面は別の証拠として扱う。
15分観測後にWorkerを削除し、APIのdeployment readbackが「Worker does not exist」を返すことを確認した。
local temporary projectも削除済み。Cloudflare Statusにactive incidentは掲載されていなかった。
schedule登録は読み戻しで確認できたため、次はruntime delivery/ログ可視化をCloudflareの観測APIや
サポート情報と照合し、同一recoveryを再実行する前に原因を絞る。

2026-10-02 00:02 JST、ログイン中のWrangler OAuth profileを確認し、Cloudflare APIの
read-only `GET /accounts/{account}/workers/scripts/{script}/schedules`で既存`fanmark-app-staging`の
scheduleを読み戻した。`* * * * *`と`0 0 * * *`が登録済みで、両方の`modified_on`は
`2026-10-01T10:21:15.10331Z`。これは既存staging appのcontrol-plane登録の証拠で、新規Workerの
runtime deliveryを説明しない。[Get Worker Script Schedules](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/schedules/methods/get/)。

## 2026-10-01 新規Worker Cron未確認・dispatcher未処理（13:17 UTC）

既存の`fanmark-app-staging`では12:54:21 UTCに毎分Cronのscheduled invocationを確認した。
Stripe dispatcherは`disabled`・claim 0件、notification processorは処理対象0件で完了している。

一方、使い捨てpost-write recovery Workerは`* * * * *`を登録してdeployし、署名済みの合成
license-extension receiptを受け付けたが、receiptは`received/pending`、`attempt_count=0`のまま
20分待機がtimeoutし、Time Travelと暗号化R2 replayの前で停止した。Workerのdeploy時刻は
2026-10-01 12:56:38 UTC、timeoutは13:17:53 UTC。

約30分後にCloudflare Cron Events履歴を再読込すると、使い捨てWorkerのURLに
13:16:21〜13:32:21 UTCの成功イベントが表示された。しかし同じ行・CPU時間が既存
`fanmark-app-staging`のCron Eventsにも表示され、使い捨てWorkerの履歴には作成開始
12:55:54 UTCより前の12:43〜12:52 UTCの行もあった。Cronなしのemoji master Workerには
イベントがなかった。よって、この画面のデータをWorker単位の実行証拠として帰属できない。
`wrangler tail`でも使い捨てWorkerのscheduled job summaryは取得できておらず、Cron triggerが
発火したか、発火後にhandlerがどのjobを選択したかは未確認。D1 readbackではreceiptが未処理
だった。

Cron Events画面は新規Workerの履歴表示に最大30分かかる場合があると案内していた。
[CloudflareのCron設定資料](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
はtrigger変更の反映に最大15分を見込むよう案内している。イベント履歴にはtimeout後の行もあるが、
Worker単位に帰属できない。削除完了の厳密な時刻は記録していないものの、新しく開いた設定画面
ではWorkerが削除済みと確認した。cleanup後のDashboard一覧には既存Workerが2つだけ表示され、
Cron定義はapp stagingの2つだけだった。Freeプランの
上限はアカウントあたり5 Cron Triggerであり、今回の事象は上限到達では説明できない。
[Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)。

cleanup summaryと独立readbackで使い捨てWorker、Business/Auth D1、config、合成avatarの削除を
確認した。既存staging D1は3つだけで、backup/avatar staging R2は両方object count 0、0 B。
バックアップbundleは開始前の段階で止まっており、R2 backup objectは作られていない。実ユーザー
データ、Supabase行、実Stripe API、メール、production route、domain/DNSは使っていない。

既存WorkerのCronは確認済みだが、使い捨てWorkerのCron起動とStripe dispatcherによるreceipt claimは
未確認。追跡用の`SCHEDULED_DISPATCH_DIAGNOSTICS`ログを追加し、使い捨てrecovery configだけで
有効化する準備をした。Issue #34/#37とpost-write recovery gateは未完了のままにし、この診断を
Cloudflare上で確認するまで同じフル復旧手順を再実行しない。

## 2026-10-01 staging migration selector guard

`wrangler.emoji-api-staging.jsonc` にMASTER_DBのmigration selectorがなく、
`wrangler d1 migrations list` がmaster D1に対してAuth専用の
`0007_auth_signup_command.sql` / `0008_auth_user_suspension.sql`を未適用と誤表示していた。
この確認はread-onlyで、migrationは適用していない。WorkerのMASTER_DBにもmaster用と同じ
selectorを明示し、CLIは`No migrations to apply`を返す。migration selector testはapp、
migration-only、master APIの3設定を照合し、Auth signup/suspension SQLがmaster側に
混入しないことを確認する。

Node 22.6.0の`npm run test:migration-data`は194/194、絵文字master APIのWrangler
deploy dry-runは成功。business/Auth/masterのstaging D1は全てmigration pendingなし。
read-only GETはSPA、Auth health、emoji catalogが200、Stripe webhookはselectorとsecretが
未設定のため404。avatar/cover/backupのstaging R2 bucketは全て存在し、object countは0。
Stripe・Resend・OAuthのstaging credentialsは未設定で、実providerの統合canaryは未完了。
実ユーザーデータ、Supabase application rows、production route、domain/DNSは変更していない。

read-only `GET /api/auth/capabilities`はsignup、password reset、email verification、
social providerが全て無効を返した。Auth機能の管理者向けstaging browser canaryは、
合成ユーザーのsign-in、初回TOTP登録、session rotation、MFA管理者認可、ユーザー一覧/詳細、
Enterprise/Max/Freeの変更、suspend/restore、即時license expiry、session revokeを確認。
未認証の一覧アクセスは拒否され、画面状態とAuth/business D1のreadbackが一致した。
cleanup後、Auth user-owned table、profile、license、audit、notificationのcanary行は0件。
メール/provider連携は実行しておらず、MFA generation counterはfactor lifecycleで進む場合がある。

PR #41 head `61d662f`のActions run `36860303037`再実行はapplicationとWorker APIの両jobが
成功。Stripe receipt/billing/invoice suite、typecheck、migration data boundary、staging buildも
passした。最初の同runでは`subscription-application.test.mjs`が3回120秒timeoutしたが、再実行は
成功し、Node 22.6.0の直接実行も8/8。原因は特定できていないため、まれなPGlite起動停止は
CI上で引き続き監視する。

Cron伝播確認用の使い捨てWorker `fanmark-cron-probe-20261001-2110`は2026-10-01
12:10:29 UTCに1分scheduleでdeployされ、version `7478077e-7928-4c9d-a0a9-87b3f69e9ca5`
が100%だった。20分間のlive `wrangler tail`でscheduled markerは記録されず、probe Workerを
削除し、専用config/sourceもcleanupした。D1/R2/secret bindingはなく、既存staging appのCronは
scheduled invocation済み。新規WorkerのCron trigger登録/伝播経路は未解決で、復旧canaryは
引き続き未完了。実ユーザーデータ、production route、domain/DNSは変更していない。

## 2026-10-01 staging再開確認と管理ユーザーUI修正

再開時に`fanmark-staging-inapp` profileの`wrangler whoami --json`が
`fanmark.id@gmail.com`とstaging設定に固定されたCloudflare account IDを返し、
PR #41の当時のhead `58ba192`はdraft/open/clean、必要なCI 2件がpassだった。
business D1は`0018`/`0019`を含めmigration pendingなし。read-only HTTPはSPA、
Better Auth health/session、emoji catalog、参照マスター価格が200、未認証管理
sessionが401、Stripe webhookが404だった。Authのuser/account/session/verification/
factor/role/assurance/auditとbusinessのprofile/license/audit/notification eventは
0件、emoji masterは3,944件。読み取り時のD1 writesは0件。

合成管理ユーザーのブラウザcanaryで、停止APIとAuth D1更新は成功する一方、確認
ダイアログを閉じるとユーザー詳細Sheetも閉じ、画面上の停止状態を読めない問題を
再現した。`src/components/AdminUserManagement.tsx`で停止確認AlertDialogを詳細Sheet
の子に移し、停止/復旧後も同じ管理画面で詳細が更新されるよう修正した。

対象ESLint、root typecheck、管理ユーザーclient契約7/7、Worker D1 12/12とtypecheck、
staging build（3,723 modules）、Wrangler deploy dry-runが成功。staging Worker
`7a7e2597-fc05-4fcb-b117-ba331dfa54e1`を100%配信後、`--admin-user-management-browser`
canaryがBetter Auth sign-in/TOTP、Free→Max→Free、停止/復旧、即時失効とブラウザ表示を
確認して成功した。Authのuser-owned全表、businessのprofile/license/audit/通知行は
cleanup後0件。MFA generation counterはfactor作成/削除に伴い進む場合がある。

このcanaryは実ユーザー行、Supabase行、メール送信、Stripe API、production route、
domain/DNSを使っていない。Stripe・Resend・OAuthのsecretsは未設定のまま。

## 2026-10-01 Stripe staging test-only isolation

ステージングでStripe test-modeだけを使えるよう、`STRIPE_MODE_POLICY=test_only`
を追加した。staging configにはこのポリシーだけを設定し、Webhook/dispatch/Checkout等の
Stripe selectorsと実secretは引き続き未設定なので、現時点のStripe routeは無効のまま。
本番や未指定環境は従来のtest/live両モード動作を維持する。

このポリシーでは、請求APIはgeneric keyとtest keyが完全一致し、live keyが無い場合だけ
テストStripe clientを作る。延長Checkoutもlive generic keyを拒否する。署名済みlive
WebhookはD1保存前に拒否し、scheduled dispatcherはlive keyを構築せず、既存live receipt
またはdispatchが1件でもあれば処理を停止する。アカウント削除もtest clientのみでcustomer
を探し、live key設定を拒否する。未知のポリシー値はfail closed。

合成D1/fake Stripe検証はWebhook・receipt・dispatch・invoice・subscription suite 68/68、
Plan Checkout 9/9、Plan Change 9/9、Customer Portal 6/6、延長Checkout 6/6、
Stripe account deletion 5/5。Worker typecheck、CI isolation check、staging Wrangler
deploy dry-runもpass。外部Stripe APIは呼んでいない。test-only credentialsをstagingに
設定後、Stripe test-mode Webhookと合成購入のend-to-end canaryが次のゲート。
必要secret名は`STRIPE_SECRET_KEY_TEST`、同値の`STRIPE_SECRET_KEY`、test-mode endpointの
`STRIPE_WEBHOOK_SECRET`。`STRIPE_SECRET_KEY_LIVE`は設定しない。これらの値をチャットに
貼り付けずCloudflare staging secretとして登録する。

CI run `36847883045`（PR #41、head `41b1fd2`）はstaging applicationとWorker APIの
両jobが成功した。既存PGliteテストがCIで60秒を超えたため、そのテストrunnerの外側
timeoutを120秒にし、Node 22.6.0で単体・Stripe receipt suiteが通ることも確認した。
staging build後、2026-10-01 19:21 JSTにWorker version
`59deb036-3aa7-442f-9eba-11875715c43a`を100%配信した。read-only GETは`/`、
`/api/auth/ok`、`/api/emoji/catalog`が200、Stripe selector未設定の
`/api/stripe/webhook`が404。staging secret名のreadbackにもStripe/Resend/OAuthはない。
この反映でStripe API、メール、D1 migration/write、実ユーザーデータ、production route、
domain/DNSは使っていない。

後続のCI run `36848783232`ではWorker API jobは成功したが、application jobの
`subscription-application.test.mjs`が120秒で2回タイムアウトした。そこで同一テストだけ
最大3回の独立プロセス試行に変更した。Node 22.6.0のローカル単体・全suiteが成功し、
CI run `36849762646`もapplication（3m55s）とWorker API（5m37s）の両jobが成功した。
PGliteテストは1回目が120秒で止まった後、2回目の新規プロセスで成功した。

## 2026-09-29 Supabase Stripe non-extension Checkout receipts

The Supabase webhook now persists all supported Checkout Session events before
acknowledging them. Non-extension sessions claim their exact dispatch and are
marked `ignored` / `completed` through a service-role-only RPC fenced by the
current lease token, generation, event type, and normalized Checkout snapshot.
This path does not change subscription entitlement or grant a license; plan
state remains sourced from subscription events. Extension Checkout handling is
unchanged.

The new forward migration is
`20260929200000_terminalize_stripe_noop_checkout_receipts.sql`. Focused PGlite
tests pass 13/13, including the new state, extension-rejection, stale-lease,
and ACL cases; shared TypeScript tests pass 5/5 and the receipt package
typecheck passes. The full Stripe receipt suite passed, and the final dispatch
suite rerun after adding lease-expiry coverage passed 13/13. Root app typecheck,
`deno check` for the webhook, targeted ESLint, CI workflow isolation, and the
191-test migration-data boundary suite all passed. No Supabase migration,
webhook invocation, remote write, Stripe API call, or production change was
made.

## 2026-09-29 scheduled Stripe timestamp regression closure

Stripe invoice/subscription scheduled dispatch now accepts the canonical
six-digit UTC timestamp supplied by the Worker scheduler and preserves its
microseconds through application and fence-lease arithmetic. Before the fix,
both paths returned `retryable` on that input. The focused regressions, shared
timestamp tests (6/6), full Stripe webhook/D1 chain (63/63), Worker typecheck,
and PR validation run `36482153913` all pass. This remains code/test evidence;
no Stripe API call or remote deployment/migration was made.

## 2026-09-29 Stripe plan Checkout event handling

The D1 scheduled Stripe dispatcher previously sent every supported Checkout
Session event into the license-extension application. That diverged from the
Supabase webhook, which only persists/applies extension sessions and otherwise
acknowledges plan Checkout events without granting entitlement. The dispatcher
now atomically terminates Checkout receipts without
`metadata.type = license_extension` as `ignored` / `completed`; subscription
created/updated/deleted events remain responsible for plan state. The focused
webhook/application integration suite passes 13/13 under Node 22.6.0, including
stale-lease rejection. No Stripe selectors or secrets were enabled, and no
remote state changed.

## Fresh Supabase v21 catalog and current-schema synthetic replay (2026-09-29 JST)

Ran the reviewed `schema-readiness.sql` through Supabase CLI 2.118.0 with
`CI=1`, `--yes`, and a private temporary project-link directory. The read-only
query completed at `2026-09-28T18:27:23Z` and returned schema metadata only:
40 tables / 406 columns, 144 constraints, 139 indexes, 15 enum labels, one
view, 58 functions, 36 non-internal triggers, and 77 RLS policies. No
application rows or live sequence values were read.

Descriptor-aware schema converter v21 on this fresh catalog reports five
schema/operation gate groups / 93 locations and remains `deployable: false`:
11 external Auth references, 79 timestamp defaults requiring operation-owned
clock values, and the untranslated function, RLS policy, and trigger scopes.
V21 deliberately omits approximate millisecond D1 clock defaults; all 79
per-column operation gates remain. This report is based on the current
schema-only catalog.

Under Node 22.6.0, `scripts/migration/test-d1-import-current-schema.mjs` passed
against this exact catalog. It reconciled 10 synthetic rows across all 40
tables and checkpoints, bcrypt-transformed two active credentials, durably
deferred one inactive-license credential, read back typed/hash state, and
rejected conflicting credential coverage. The result is
`public_rows_reconciled`; `deployable` and `fullMigrationReconciled` remain
false. The v21 DDL contains no D1 millisecond `strftime(..., 'now')` timestamp
defaults and its private SQL/report files are mode `0600`. No source
application rows, remote D1/R2, production route, or domain/DNS state was
accessed or changed.

## 2026-09-29 D1 license expiry microsecond comparisons

The D1 analytics summary, fanmark details, coupon application, Stripe
extension checkout, and invitation signup used millisecond-rounded date
comparisons for values stored at microsecond precision. These paths now use
fixed-width UTC text ordering. A new forward migration, `0018`, replaces the
invitation-capacity trigger from already-applied migration `0014`; its clock
expression emits the same canonical width. Regression tests cover license,
transfer-lock, invitation, and reservation deadlines one microsecond after the
injected clock. Five focused D1 suites pass 37/37 and Worker typecheck passes.
No remote migration or Worker deploy was made; there are no user-data or
domain/DNS changes.

## 2026-09-28 Auth D1 migration selector collision

Read-only `wrangler d1 migrations list AUTH_DB --remote` against both the app
and Auth staging configs found that the Auth selector
`migrations/000[378]_*.sql` also selected the Master-only
`0007_release_audit_timestamps.sql`, which appeared as pending on Auth D1. It
was not applied. Both Auth configs now use an explicit allowlist containing
only `0003_better_auth_core.sql`, `0007_auth_signup_command.sql`, and
`0008_auth_user_suspension.sql`. A static selector test checks those exact
files and is part of `npm run test:migration-data`; the guarded Auth admin
smoke checks the same allowlist. Re-running `d1 migrations list` for both
configs reports no migrations to apply. The selector test passes 2/2 and
`npm run check:ci` passes. No remote migration was applied, no application
rows were read, and no D1 rows were written.

## 2026-09-27 Workerサブスクリプション表示の前景更新をstaging反映

Worker版の`useSubscription`を、フォーカス/可視化復帰に加えて30秒ごとに
表示中だけ再検証するようにした。間隔更新は既存表示を保ち、読込スピナーを
出さず、フォーカス・可視化イベントとの同時要求をhook内で1つにまとめる。
Supabase版は既存のRealtime更新を維持する。D1 APIは引き続き読み取り専用。

PR #41の`2ecbb25`でstaging Worker version
`c8fce1a1-1c46-4764-b3d9-6042c5930774`を100%配信した。公開GETはSPAとAuth
healthが200、未認証`/api/me/subscription`が401。配信JSのSHA-256
`73d52d0a641ece74d21ebb9763b3d000441e662d8c7cfc16883d04492a02adf3`は
ローカル`dist-staging`と一致する。

ローカルでfrontend typecheck、対象hookのESLint、subscription client/API契約
4/4、Cloudflare staging build（3,722 modules）、Wrangler dry-runが成功した。
PR CI run `36298845071`はstaging applicationとWorker APIの両方が成功。
この確認では認証済みブラウザでの30秒反映やStripe sandboxは試していない。
D1への書込み、Stripe/email送信、実ユーザーデータ、本番route、ドメイン/DNS
変更はない。

## 2026-09-27 staging公開GETとローカル再検証（先行時点の記録）

以下は今回のstaging deploymentより前のスナップショットであり、push/deployと
Cloudflare認証についての記述は現在の状態を表さない。

現在の移行worktreeでNode 22.6.0を使い、frontend typecheck、Cloudflare
staging build、`src/App.tsx`のESLint、Workerの全`npm test`チェーンを再実行し、
すべて成功した。npm 11.8.0はNode 22.6.0をサポート対象外として警告したが、
各検査は終了コード0だった。staging buildは3,719 modulesを変換した。

workers.devへの読み取り専用GETは`/`、`/api/auth/ok`、
`/api/emoji/catalog`、`/api/fanmarks/recent?limit=1`が全て200だった。
応答本文は取得・記録していない。詳細は
[`live-observations.md`](live-observations.md)を参照。これは公開routeの疎通であり、
ブラウザ認証、実データ同等性、Stripe sandbox、本番切替の証拠ではない。

ローカルのplan-selection route guard commitは引き続きPR #41より1 commit先行し、
作業ツリーには無関係な`supabase/.temp/cli-latest`の変更があるため触れていない。
GitHub CLIの認証tokenは無効で、WranglerはmacOS Keychain読み出しexit 51で失敗した。
したがってpush/deployはこの確認では実施していない。

## Stripe extension receipt effect on D1 (2026-09-26 JST)

Added a staging-only D1 schema for Checkout intents, one application per
Session, effect evidence, and per-entry lottery cancellation, plus a local
application function guarded by the active receipt lease and immutable intent
terms. The positive paid path applies license extension, lottery cancellation,
notifications, audits, application state, receipt state, and dispatch state in
one D1 batch. Unpaid sessions wait for asynchronous settlement; expired or
failed sessions grant no time; amount/owner/transfer mismatches dead-letter.

The local Miniflare suite uses the generated 40-table D1 schema and synthetic
records. It covers same-Session retries, competing receipts, async success,
expired/failed no-grant, stale-owner/transfer/amount rejection, and full
rollback after an injected audit failure. The D1 Checkout intent endpoint and
scheduled extension dispatcher are now implemented locally; the default-off
frontend selector is also available. The later staging readback recorded below
supersedes this initial setup snapshot: business migrations `0006` and `0007`
have since been applied, and the shared Worker Cron is active for notifications.
Stripe checkout/webhook/dispatch selectors and Stripe secrets remain unset,
and subscription/invoice event handling is incomplete. No real Stripe call,
user data, production routing, or DNS change was made.

親イシュー: [#28](https://github.com/kanouk/fanmark-id/issues/28)。親の移行仕様・受け入れ条件を正とする。#26と#27の試作はこの移行へ一括マージしない。

## 役割と実装体制

Astraが設計確定、作業分解、差分レビュー、検証結果の確認を行い、GPT-5.6 Luna（max）が範囲を区切った実装を担当する。設計不明点、認可/課金/ID/原子性に関わる変更はAstraが判断する。

ユーザーは2026-09-23に残量確保を停止条件にしないよう指示した。使用量の割合を理由に作業を止めない。実装は段階ごとに保存・検証し、実際のツール制限や未解決のデータ整合性・セキュリティ条件を停止理由として扱う。

## 段階

- [0A: CIと環境境界を分離する](https://github.com/kanouk/fanmark-id/issues/29)
- [0B: 本番棚卸しと移行対応表を確定する](https://github.com/kanouk/fanmark-id/issues/30)
- [0C: Workers・D1上で認証と競合制御を検証する](https://github.com/kanouk/fanmark-id/issues/31)
- [0D: 現行Stripe Webhookの重複適用を防ぐ](https://github.com/kanouk/fanmark-id/issues/32)
- [1: Worker API契約とフロント配信を導入する](https://github.com/kanouk/fanmark-id/issues/33)
- [2A: D1・認証・R2・ジョブを実装する](https://github.com/kanouk/fanmark-id/issues/34)
- [2B: 再実行可能なデータ移行・照合を実装する](https://github.com/kanouk/fanmark-id/issues/35)
- [2C: 絵文字マスターの更新経路を移植する](https://github.com/kanouk/fanmark-id/issues/36)
- [3: 統合試験と切り替え・復旧をリハーサルする](https://github.com/kanouk/fanmark-id/issues/37)
- [4: 本番切り替えと監視・旧基盤終了を実施する](https://github.com/kanouk/fanmark-id/issues/38)

## 作業を渡すとき

対象ファイル、入力/出力、権限、保持するID/制約、変更範囲、依存、検証コマンドと期待結果を指定する。実装者の完了報告だけで段階を閉じず、Astraが差分と検証の証拠を確認する。ローカル実装、staging適用、本番適用、運用確認を分けて記録する。

## 今回の開始状態

- origin/mainから隔離したworktreeで開始。ヒーロー試作側のcheckoutは変更しない。
- #29のCI分離はPR #39でmainへ反映済み（b307dd4）。ローカル型検査・ビルド・workflow否定検査は成功。GitHub workflowはdisabled_manuallyのまま。#30のオフライン棚卸しと#31の初期local proofはPR #40でmainへ反映済み（e5a553c）。棚卸しは構文解析テストと再現性検査まで完了。全体の本番対応表・設定照合は未完了。
- #31は合成ユーザーの認証3テスト、D1同時操作/再試行/rollbackの8テストがlocal runtimeで成功。実OAuth、管理者MFA、既存hash、remote CPU/負荷、実業務全体の受け入れは未完了。
- 本番のread-only観測は [live-observations.md](live-observations.md) を参照。
- 本番データ更新、DNS変更、Cloudflare本番配備、課金操作は未実施。

## 再開時の確認

1. Git状態、親/子イシュー、PRの状態と、利用する実行環境の状態を読む。
2. 未コミット作業を確認し、作業ツリーと実装者の担当範囲を復元する。
3. 前回の成功した検証と未確認条件を区別し、変更/失敗/未解決の理由がある範囲を検証する。
4. 次の未完了の実装単位を指定して再開する。本番切り替えは確認・監視・復旧までの余裕を確保してから開始する。

## 継続中の作業（2026-09-21）

PR #41は棚卸し・本番設定のread-only確認とWorker API境界を保存するdraft。対応案と再現用集計SQL、公開recent APIはコミット済み。以下の未コミット部分を完成済みと扱わない。

- `workers/api/`: 最近取得一覧の公開APIを6ebdf36で保存。応答列の制限、キー種別、Origin、タイムアウト、redirect、件数上限、実entrypointを含む14テスト、型検査、配備用dry-runがAstraの独立実行でも成功。remote未配備。フロントの明示的な接続先切り替えは394a9d0で保存し、9テスト・型検査をAstraも独立実行して成功。設定したWorkerが失敗してもSupabaseへ戻らない。合成Worker originを指定したViteビルドも成功し、値が生成物へ反映されることを確認。Workers Static Assetsの一体配信構成を80a56feで保存。新規Viteビルドに対する13件のlocalテスト・実HTTP smoke・配備用dry-runを確認し、CIへ組み込んだ。API/欠落アセットの404とSPA navigationの境界を維持する。OGP/Auth/admin/PWAの実環境確認とWorker起動コストは未検証。
- live recent-listのview/RPC定義をread-onlyで取得し、active licenseのみ・created_at降順・同時刻の順序未指定などの現行条件を記録（43f5e12）。再現SQLも実行済み。D1版の公開recent repositoryをe8ffc0eで保存。明示切り替え、microsecond保持、実D1 entrypointを含む4テストと既存API14件・静的配信13件・実HTTP smoke・型検査・dry-runが成功。取得可能判定APIとフロントの2箇所の判定を43f7207で接続。API21件・D1 availability7件・recent D1 4件・フロント6件、型検査、未設定/Worker指定build、静的配信13件+実HTTP smoke、dry-runが成功。本番公開RPC5ケースの応答も両validatorを通過。詳細取得/登録/Auth等は既存経路。全体の本番D1 schema/importは未完了。
- `workers/api/` にBetter Authの `/api/auth/*` を接続。Better Auth実装を共有moduleへ移し、signup/OAuth/password-reset/verification-email経路を閉じた状態で、synthetic verified userのログイン、session読戻し、誤password・未verified email拒否、4並列sign-in、credentialed CORSを5件のMiniflareテストで確認。認証schema migrationはuser/account/hash/factor/sessionの行を含めない。`experiments/cloudflare-auth/` の既存MFA/admin-assurance suiteも6件成功。アプリ側のadmin/business authorization、招待・メール配信、OAuth、remote CPU、実因子移送は未完了。詳細は[auth feasibility](auth-feasibility.md)。
- Node 22.6.0のclean installでVitestが解決したVite 8/Rolldownのnative bindingが欠落する問題を確認。Workers/API・Auth・D1 concurrencyのテストpackageをVite 6.4.3へoverrideし、3 packageの`npm ci`を成功させた。Auth/concurrency testもclean install後に再実行して成功。これはテストtoolchainの互換性修正であり、GitHub hosted workflowは引き続きdisabled。
- `experiments/cloudflare-auth/`: bcrypt/TOTPと管理者APIのセッション/factor-bound MFA proofを7a11d4dで保存。7e37827でsingleton MFA generationとguard付き保存を追加。同じ因子のsecret変更、無関係な因子変更、generation欠落、置換・sign-outをlocal D1のbarrierで検証。既存proofは今回共有moduleへ移し、6件のlocal runtimeテストが成功。remote multi-Worker raceは未確認。実OAuth/既存因子移送/remote CPUは未完了。
- `docs/migration/stripe-ledger-design.md`: 現行Webhookの全分岐を受信・適用台帳とoutboxへ写す設計をf0b3a05で保存。BasilのInvoice.parentとD1 batchの境界もレビュー済み。receipt+dispatch保存のPostgreSQL基盤をe63152dで保存し、PGliteによる14テストをAstraも再実行して成功。署名付き受信factoryと正規化adapterを78d51e2で保存。実Stripe SDKの署名、サイズ/時間制限、重複/不正保存結果、PGlite保存経路を含む29テストとSDK型互換性をAstraも実行して成功。受信後のdispatch claim/renew/retryのlease制御を1f4246dで保存。古いtoken/generationの拒否、SQL時刻による期限、途中失敗のrollback、実SQL roleのACLを含む39件がAstraの独立実行でも成功。独立接続のPostgres競合・業務適用/最終化は未完了。現行Webhookへの接続・本番適用は未実施。
- 移行用4パッケージのlocalテストを秘密情報なしのCIへ追加し、deployの依存条件にした（361d5b9）。workflow設定の構文検査・否定検査は成功、GitHub workflow自体はdisabled_manuallyを維持。
- PWAのAPI runtime cacheを廃止し、新Service Workerのactivate時に旧supabase-cacheのみ削除する。APIへのnavigationにはSPA fallbackを返さない（53072a2 / adef0c8）。アプリビルドと生成物検査が成功。本番配備・既存端末の更新確認は未実施。

CloudflareのCLI認証先はfanmark対象アカウントと異なり、対象を明示したread-only呼び出しも認証エラー。対象側はWorkers Free（10 ms/request）。remote配備権限とbcrypt CPU/プラン判断は未解決。ブラウザではSupabase SQL Editorによる秘密値を返さない集計、既存Google/Apple callback、Resendドメインを確認できた。詳細はlive-observationsを参照。

Storageの2 bucketについて、認証付きAPIによる元ファイルの読出し・metadata size照合・SHA-256作成・ローカルファイルの再検証を完了。取得前後の一覧も一致。非公開の一時baselineであり、確定snapshotやR2コピーとは扱わない。詳細は[storage-baseline.md](storage-baseline.md)。

Storage exporter/verifierの再利用可能な実装を追加。23件のオフライン検証に加え、新実装による両bucketのread-only取得と独立verifierの検証が成功。詳細は[storage-export.md](storage-export.md)。非公開一時保存であり、R2転送は未実施。

本番の列・制約・index定義をread-only catalogから取得した（a567ab1）。40表・406列・144制約・139indexの変換条件を[変換境界](schema-conversion.md)へ記録。実測結果は非公開。これをD1 schema適用済みと扱わない。

絵文字カタログ生成はUUID付きJSONの明示入力を追加。Supabase環境変数が存在しても明示入力時はネットワークを使わず、ID・肌色sequenceを保持する。Unicode更新・D1へのmaster書込み・公開配信は未完了。

絵文字の版付きlocal artifact builderを追加。旧UUIDの削除/再割当て、manifest/moduleの混在を拒否し、検証完了後に版別directoryへ保存する。生成系7テスト・型検査が成功。本番emoji_masterをread-onlyで新規取得し、生成版との全UUID/emoji/codepoints照合と取得前後一致を確認。成果物は非公開一時保存。D1 import・APIの版切替・公開rollbackは未実装。

値変換codecを追加。PostgreSQL text入力から正確なcents、安全範囲bigint、UTC microsecond、decimal/JSON text、順序付き配列へ変換する。Storageと合わせ28テスト成功。実D1 bind/readbackで型・値・microsecond順序を検証し、既存競合試験と合わせ9件成功。全表importは未完了。

catalogから全表DDLと列codec対応・未解決条件を生成する[schema converter](schema-generator.md)を追加。NULL許可、整数型/範囲、文字列内のSQL構文、変換できない式/列型/外部Auth参照を検証。Astraの独立実行でStorage・値codecを含む32テストとCI境界検査が成功。実catalogから生成した同一SQLの104文がローカルD1で成功し、40表・131indexを読み戻した。20群の未解決条件があり、`deployable: false`を維持。全表のデータ移送、RLS/trigger/関数相当の業務実装、本番適用は未完了。

指定Node 22.6.0でStorage verifierの`readableWebStream()`完了と明示closeによるnative abortを再現し、64 KiBずつの明示read/closeへ修正。空ファイル・複数buffer・末尾改変の検証を加え、指定版で移行データ33テストが成功。保存済み非公開Storage baselineも新verifierで再検証済み。シェルの既定Nodeは25.5.0だったため、以後は指定版を明示して検証する。

Stripeの請求状態同期を追加。API版をBasilへ固定し、現在のInvoicePayment・顧客・subscription・最新invoiceを検証する。customer fence取得後に読出し、payment fields・台帳・receipt/dispatch完了を同一SQL transactionで更新する。古いイベントから現在状態を推測せず、不明/voidは60秒後の再試行へ戻す。Astraの指定Node 22.6.0による独立実行でStripe全63テスト・型互換性が成功。SQL内の遅延でleaseが失効するケースも、業務更新/台帳がrollbackされることを確認。詳細は[stripe-invoice-projection-validation.md](stripe-invoice-projection-validation.md)。既存Webhook接続・本番migration・独立Postgres接続の競合検証・他の課金効果は未完了。

全表catalogに従う行変換bridgeを追加。PostgreSQLの値を文字列/SQL NULLとして取り出し、列順・enum・NOT NULL・配列次元を検証してD1 bindingへ変換する。UTC microsecondとJSONB textを保持し、BC/infinity/範囲外日付を拒否する。指定Nodeで行変換5テストと合成PostgreSQL投影が成功。consistent snapshotの保存・再実行可能なimport・全行照合は未実装。詳細は[row-conversion.md](row-conversion.md)。

公開アクセスAPIのD1実装を追加。short ID・絵文字・公開profileの読み取りを明示設定で有効にする。公開可否と本文は同一SQLで取得し、password保護時と非選択の表示方式の本文を返さない。既存画面の空画像URL、日本語の文字数、長いZWJ絵文字、表示方式変更後に残る設定を検証。Astraの指定Node 22.6.0による独立実行でD1 entrypoint 11テストと型検査が成功。既存API21件、recent D1 4件、availability D1 7件、静的配信13件・実HTTP smoke・配備dry-runも独立実行で成功。CI項目も追加し、workflow隔離検査が成功。未設定時は503で、frontend接続・password検証経路・本番配備は未実施。

独立接続のPostgreSQL 17.10でStripe競合5テストを追加。未commitの重複受信とcustomer fenceで実際のlock待ちを観測し、SKIP LOCKEDは先行transactionを開いたまま別接続が異なる行を取得することを検証した。期限切れの最終適用拒否と業務更新失敗時のrollbackも成功。AstraのNode22独立実行でも5件成功・skipなし、終了後のpostgresプロセスと一時clusterは0件。管理対象の17.6環境・本番設定の検証とは区別する。詳細は[postgres-concurrency.md](postgres-concurrency.md)。

パスワード付き公開アクセスの[移行設計](verified-access-design.md)を5aca0e4で保存。short ID・絵文字・profileのselectorに結び付けた短期proof、同一SQLでの本文保護、D1による試行予約と世代番号の検証を定義した。アカウント認証とは別の認可経路として扱う。隔離したlocal proofは実装中で、既存password値の互換性・全writerの失効処理・remote CPU・frontend切り替えは未検証。

Storage exportからR2へ移す[再実行可能なimport core](storage-r2-import.md)を追加。既存/新規objectを本文hash・size・metadataで読み戻し、再開時にも全対象を再検証する。条件付き作成により競合objectを上書きせず、応答停止や途中失敗を未完了として保存する。AstraのNode22独立実行で移行データ52テストとloopback Miniflareの実R2検証が成功。16 MiBの競合転送でも上書きなし・停止を確認した。local R2は条件不一致でも本文を全消費するため、早期キャンセルやremoteのmemory/CPUは証明していない。CIへ追加し隔離検査が成功。remote runner・bucket設定・本番upload・URL切り替えは未実施。

DB動作定義のread-only棚卸しを追加。40表のRLS設定、77 policy、36 user trigger、1 view、58 function/procedureの定義・権限情報を非公開artifactへ保存した。収集できたことはD1への変換・認可同等性を証明しない。schema converterの未対応scopeと業務移植の条件は維持する。既存password設定も値を返さない形式/参照関係の初期集計を実施し、UUID/ライセンス対応の異常は観測されなかった。形式変換・本人の既存入力による動作同等性・最終snapshotは別途検証が必要。

public全表を同一read-only repeatable-read transactionから保存する[snapshot exporter/verifier](snapshot-export-design.md)を追加。列・制約・index・enumのcatalog fingerprint、行順序・hash・件数・値codecを検証し、途中失敗を完了として扱わない。partition/inheritanceを明示拒否する。AstraのNode22独立実行で移行データ63件、CIと同じStripe npm test 65件、実psqlとPostgreSQL 17のtransport検証2件が成功（いずれもskipなし）。一度の全体実行停止は単独実行と全体再実行で再現せず、原因は未確定。テストの失敗時cleanupとtimeoutも追加した。sourceの実データexport、暗号化backup、Auth/Storageを含むfreeze、unique/FKの全体照合、二つのsnapshot間比較は未完了。

パスワード付き公開アクセスの隔離local proofを追加。selector/licence/世代に結び付けた短期cookie、D1による二重の試行制限、世代変更・削除再作成時の失効、同一SQLによる本文保護を検証する。AstraのNode22独立実行で専用17件と既存認証6件が成功。遅延要求による期間巻き戻し、finalization再実行、失敗時の部分カウント、Originなし同一site GETも検証し、専用suiteをCIへ追加した。実password変換・全production writer・remote CPU・frontend接続・本番配備は未完了。詳細は[verified access design](verified-access-design.md)。

DB動作の非公開gap inventoryを作成し、元catalogの77 policy・36 trigger・1 view・58 functionの全名称が対応表に含まれることと0600権限をAstraも確認した。暫定分類はpolicyがlocal対応済み0/部分4/未対応73、triggerが0/0/36、viewが0/1/0、functionが3/11/44。対応済みも限定的なlocal実装の証拠であり、本番parityやRLS全体移植を意味しない。次は期限ジョブの状態遷移・競合・付随効果を整理する。

verified snapshotからの[D1 import core](d1-import.md)を追加。parent-first順、全batchのcheckpoint guard、同時実行/ACK不明後の再開、移送先incarnation、application/ledger双方のDDL検証、全値・SQLite保存型・PK・件数・hash・FKの読み戻しを行う。AstraのNode22独立実行でCIと同じコマンドの12件と明示Miniflare integrationが成功し、CI隔離検査も成功。初回report書込失敗からの復旧、改変検知、query/SQL/変換後row上限も含む。結果はpublic_rows_reconciledに限定し、deployable/fullMigrationReconciledはfalse。実40表の行移送、credential変換、外部Auth参照、業務動作の同等性、remote適用、backup/restoreは未完了。

[credential transform設計](credential-transform-design.md)を追加。immutableな非公開sourceと変換後digestを分け、prepared時点でbcrypt結果を固定し、lease/fence付きの再開と全行カバレッジを定義した。Supabase/D1の二重writerは許容せず、freeze後に単一authorityへ切り替える。通常row importerへの変換descriptor統合、変換実装、暗号化sourceによるrehearsalは未完了。[期限ジョブ設計](license-expiry-design.md)も保存し、active→graceのlocal proofに着手。grace→expired/lottery等のparity gateは未解決。

実catalogの40表構造で、各表0行のsynthetic snapshotを新規Miniflare D1へ移すprivate rehearsalが成功。40表/40checkpoint・source/targetとも0行、20群のschema gateを維持したpublic_rows_reconciledを確認し、runtime/temp cleanupの記録も確認した。これはschema接続の検証であり、実データや業務parityではない。既存Supabase CLI権限でlive-only期限処理と定期期限処理のsourceをread-only取得し、非公開0600/0700領域に保存した。body未取得の条件は解消したが、実装差分・呼出運用・認可の同等性は別途確認中。

実catalogの40表に各1行のsyntheticデータを用意したnonzero rehearsalも成功。40 source行→40 D1行、40 checkpoint・complete・readback、内部FK/CHECK/enum/NOT NULL/uniqueと各値型を検証したprivate結果を確認。外部Authはsynthetic UUIDと未解決条件のまま、20群のschema gate、deployable/fullMigrationReconciled=falseを維持する。これは実source行のparityではない。取得した定期期限処理と共有helper計3ファイルがrepoとbyte-for-byte一致することも、Astraがhash付き非公開記録に保存した。

Astraが復元済みのsynthetic generatorを確認し、Node 22.6.0で40表・各1行のnonzero rehearsalを独立再実行した。40行の移送、40表のcomplete/readback、public_rows_reconciledを再確認。cleanup失敗を成功扱いしていたprivate helperの記録を修正し、runtime dispose成功と一時directoryの不存在も確認した。20群の未解決schema条件、deployable/fullMigrationReconciled=falseは維持し、実source行・credential変換・業務parityの証拠とは扱わない。

active→graceの[期限処理local proof](license-expiry-proof.md)を追加。UTC microsecondの期限境界、元設定のparseInt/fallback、owner/end/generation付きCAS、audit/outboxとの同時commit、durable run-itemによる停止後の再開を検証する。ACK再確認でprocessedを変更せず、同runの並行再開でも件数を保持する。AstraがNode22.6の専用npm scriptを独立実行して成功し、CI隔離検査も成功。65行のkeyset traversalと最大32件の返却sampleを確認した。fixtureは縮小したsynthetic schemaで、全schema統合、grace→expired、lottery、cron接続、本番動作の同等性は未完了。

credential変換の[隔離local proof](credential-transform-proof.md)を追加。source envelopeの入力/identity結合、prepared bcrypt結果の再利用、lease/fence、config・generation・台帳の同時適用、ACK不明後の復旧、移送先incarnationと値の再照合を実装した。実clockでD1 batch送信を期限後まで遅らせるprepare/apply拒否も確認。AstraのNode22.6独立実行で17件成功・skipなし、前後のcore/fixture/test hash一致、CI隔離検査成功。合成データ1行単位のproofであり、全行descriptor/importer統合、実credential移送、remote CPU、全writer、本番切替は未完了。

期限処理の必須effect確認を同一D1 batch内のCHECK-backed guardへ補強。audit/outbox/run-itemが0行で成功しても状態変更をrollbackし、guard cleanup欠落も最終SQLでabortする。Node22専用suiteで4種類の欠落と正常再開、ACK/競合後のclaim・guard cleanupを検証して成功。初版7文の補強は独立静的reviewでblocking指摘なし、その指摘を受けcleanup保証を追加した。全schema統合は引き続き未完了。

generic D1 importerはverified catalogにcredential列があれば、report/ledger/target mutation前にcredential_transform_requiredで停止するよう変更。local/allowUnresolvedGatesでも迂回不可。AstraのNode22独立実行で13件成功・skipなし。従来40表synthetic rehearsalも今後はdescriptor統合まで意図的に停止する。認証変換と[lifecycle schema統合設計](lifecycle-schema-integration.md)を揃え、同じsource行へのhash保存、retained incarnation、独立したstate/access/password世代、import前の厳密target profile作成を定義した。設計であり全schema統合は未実装。

disabled credentialの既存UI/RPC/read/delete経路を、repoと取得済みlive catalogで静的調査し、非公開0600文書へ記録した。調査範囲では再有効化は新入力方式だが、全operator/service-role writerとruntime同等性は未証明。disabled行を自動的にdiscard/dummyで完了とせず、未確認範囲が解消するまでdeferred_disabledを維持する。実source credential値の取得やremote変更は行っていない。

credential descriptorのmetadata compilerを追加。6列の対応、PK・validated UNIQUE・license FK、型、bcryptの版/costを検証し、immutable mappingとcanonical digestを生成する。親レビューでnon-enumerableな既知設定がdigestから欠落するケースを拒否し、回帰検証を追加した。Node22.6の親独立実行で移行データ70件が成功・skipなし。source行やDB bindingは受け取らず、変換/importer統合は未完了。credential_transform_requiredの停止条件は維持する。

[lifecycle target schema](lifecycle-target-schema.md)の生成・適用・厳密readbackを追加。全source DDLとextensionを照合し、部分適用、quoted literal/制約変更、未知index/view/triggerを拒否する。親の実catalog検証で4列のNULL条件の誤りを検出・修正し、40表構造の空local D1へ5表・4索引を追加、再適用no-opとreadback、runtime disposeを確認した。Node22.6の親独立実行で2 test group成功・skipなし、実行前後hash一致、CI隔離検査成功。source row import、credential/generation mutator統合、expiry実行接続、本番適用は未完了。

追加reviewでread-only schema inspectionにもsource fingerprintとSQL/inventoryの整合性検証を追加。catalog/report fingerprint・SQL・inventoryの個別改変を拒否し、専用2 test groupと実40表構造rehearsalの再実行が成功。これは入力plan内部の整合性確認であり、外部由来planの真正性やsourceデータ移送完了を保証しない。

世代管理の接続reviewでcredential proofのincarnation台帳欠落を0とみなすfallbackを除去。target read・prepare/apply/finalizeのSQLで台帳の存在を必須にした。予約前の欠落とreconcile read後の削除を検証し、Node22.6のcredential suiteは19件成功・skipなし。source-shaped世代triggerとの接続自体は未完了。

[世代管理trigger](lifecycle-generation-schema.md)を追加し、同日にsourceアクセス内容の失効対象を拡張。license作成時の初期化、削除時のretained incarnation更新、PK変更拒否、password変更、fanmark selector/status、基本設定、redirect URL、messageboard本文、公開profile変更で世代を進める。計24 triggerがlicense incarnationとaccess-versionの整合性、overflow、cascade削除を検査し、失敗時は同じD1 statementをrollbackする。親reviewでinspectionのbase plan結合も追加。Node22.6のschema/generation suite 9/9と、最新40表source catalogを含むexpiry統合12/12が成功。credential applyの二重increment除去、すべての業務writerとの接続、protected runtime、remote適用は未完了。

protected-access proofにもlicense incarnationを独立して保存・照合する境界を追加。同じUUIDの削除/再作成でpassword/access世代が同値になっても古いverificationを拒否する。全体実行の停止を調査し、追加列を反映していなかったreplayテストINSERTを修正、診断ログを除去した。親のNode22.6独立実行で17件成功（4.33秒）、実行前後の3ファイルhash一致。source-shaped runtimeとの接続や本番移行は未完了。当時の20%/22%停止ルールによる保留は、2026-09-23のユーザー指示で撤回された。


ユーザーの「もう少し進めていいです」を受けた当時の1単位。credential import projectionはcanonical snapshot recordの6列とrow hash/PK/ordinalを検証し、通常5列と一度だけ消費できる非公開入力handleへ分離する。parserの秘密値がerror causeへ出ないよう拒否時は固定codeとし、設定変更・handle偽造/複製/再利用も検証。Luna Maxへ委任したが成果物が戻らず中断し、親Astraが実装・検証した。Node22.6のmigration-dataは74件成功・skipなし、実40表catalogと合成1行でも成功、CI隔離検査成功。統合設計の「5列INSERT後にhash UPDATE」を、NOT NULLとtrigger二重更新を避ける単一INSERTへ訂正。実source値取得・hash生成・D1書き込み・importer接続・本番変更は未実施。以後の作業に残量の下限は適用しない。

2026-09-23の順序変更: ユーザー指示により、旧20%/22%停止ルールを解除。基本アプリ・Workers/D1/R2/Auth（合成ユーザー）と許可済みマスターを先行し、#37 synthetic rehearsal後、#38で実ユーザーデータを最後に移送・照合し、公開DNS/ホスト名を最終操作とする。ユーザー数が少ないため計画メンテナンスと個別サポートは許容するが、アカウント/権利/課金の誤紐付け、秘密漏えい、復元不能な欠損は許容範囲に含めない。Supabase本番は最終切替まで唯一の業務書き込み先とする。

認証移行の最新確認: `docs/migration/auth-feasibility.md` に記録済みのlocal workerd + D1 proofでは、Better Auth 1.7.5とbcryptjs 3.0.3を用い、synthetic `$2a$10$`/`$2b$10$` password、UUID維持、誤password拒否、並行sign-in、TOTP challengeを検証済み。Supabaseのread-only observationはhash形式が`$2a$10$`であることのみを確認し、hash本体・user対応・MFA secretは取得していない。実sessionはBetter Auth移行時に失効し、実OAuth callbackとMFA factor移送は未確認。

絵文字マスター先行準備: `workers/api/migrations/0001_emoji_master_release_staging.sql` と `scripts/migration/emoji-master-release-stage.mjs` でverified releaseを既存D1 masterとidentity照合し、別version stagingへbounded batch投入、独立readback後だけ`ready`にする。`0002_emoji_master_release_activation.sql` と `emoji-master-release-activate.mjs` はrelease hash/readbackを再検証してprivate pointerを世代管理で切り替え、履歴とactive行をimmutableにする。metadata-only rollbackは通り、追加されたUUIDを落とすrollbackと改変stagingは拒否する。live public master 3,944件も別途local D1へstaging/readback一致。詳細なAPI/frontend接続と検証結果は[emoji release記録](emoji-releases.md)。hosted CIは未実行。canonical `emoji_master`、remote D1、公開/運用rollbackは未実施。

続けて2026-09-23、Supabase SQL Editorから公開マスターの明示8列だけを2回独立にread-only取得。3,944行の正規化SHA-256は両方とも`84a67b361adf96534bc6e564ec7510249758c2b20492e4d0b97acc7fd88309c0`、UUIDと絵文字はそれぞれ全件一意。版`10ec42c1a562197c1e66c5fd10316c904188cdfb274ca5b8852c99ba240d3bed`をsource-shaped canonical fixture付きの一時Miniflare D1へstagingし、canonical 3,944行・staging 3,944行をreadback。全staging行がverified releaseと一致して`ready`になった。Node 22.6.0で実カタログ検証と関連suiteを再実行し成功。Supabaseへの書込み、remote D1、ユーザー/Authデータ、公開版切替はなし。成果物は非公開一時領域に保持し、リポジトリへ含めていない。詳細は[emoji release記録](emoji-releases.md)。

2026-09-23、#34の`active → grace`をsource-shaped D1へ接続するローカル統合コアを追加。source名の`is_returned`、nullable `user_id`、retained incarnation、別々の`lifecycle_generation`/`access_generation`、既存`audit_logs`/`notification_events`を使い、access世代更新は同じoperation claimに結び付いた共有SQL builder経由で一度だけ行う。Node 22.6.0 + Miniflareの10チェックで成功、nullable owner、password/access世代の分離、ACK不明後の完全readback、audit/notification/access-version/run-item/guard-cleanup欠落時のstate/effects全rollbackと再開、競合記録、厳密な期限境界を確認した。通知は`normalized_emoji`、stable `short_id`、`/f/:shortId` linkをdurable run itemから再現する。fixtureは5つのsource-shaped tableとtarget extensionからなる合成subsetで、全40表へのimport接続、他のlifecycle操作、route/cron接続、本番同等性は未完了。workflowにsuiteを登録したがGitHub hosted CIはdisabledのまま。Cloudflare remote、Supabase本番、user data、domainへの変更なし。

同日、期限処理統合テストを拡張し、同一synthetic D1へsource DDL・lifecycle extension・generation triggers・descriptor-bound credential artifact/coverage schemaを順に適用した。credential schema inspectorでprofile全体のreadbackを確認し、期限runにも当該profileのextension digestが保存されることを読戻した。さらにgeneric importerのpreflightをこのprofileへ接続し、余分なviewは拒否、完全一致profileではreport/ledgerを作らずcredential importを拒否することを確認した。Node 22.6.0 + Miniflareで11チェック成功、skipなし。これは5 source tableのsubsetであり、実40表profile・credential row変換との統合や本番データ移行の証拠ではない。Cloudflare remote、Supabase本番、user data、domainへの変更なし。

2026-09-23、Wrangler login後に`fanmark-emoji-master-staging`をAPACへ作成し、`0000`〜`0002`の絵文字用schemaだけをremote適用。remote `0002`でWrangler SQL splitterがnested `CASE ... END`を誤分割する問題を条件付き`RAISE ... WHERE`へ修正し、7 Miniflare release testsを再通過。`0003_better_auth_core.sql`はremote適用で`incomplete input`となったため今回のmigration patternから除外し、Auth schemaを適用していない。Node 22.6.0で検証したrelease `10ec42c1a562197c1e66c5fd10316c904188cdfb274ca5b8852c99ba240d3bed`をcanonical D1へ3,944件、private stagingへ3,944件投入。別プロセスのremote readbackがcanonical/staging双方の全行一致、`recordsSHA256=84a67b361adf96534bc6e564ec7510249758c2b20492e4d0b97acc7fd88309c0`、`identitySHA256=dddd7cf13528dd44f2bb1329ed1167f83fb30e63504fdd1c673845467ab402fc`、status=`ready`、active pointer/activation history/Auth table各0件を確認。初回Node 25生成版はNode 22.6.0の`verifyRelease`に失敗したためfailedへ隔離し、そのstaging rowsを削除、failure metadataのみ保持。D1はWorker未接続で、deployment、Supabase write、user/Auth data、public activation、domain/DNS変更なし。

続けて、公開絵文字APIだけを持つ`fanmark-emoji-master-staging-api` Workerを`https://fanmark-emoji-master-staging-api.fanmark-id.workers.dev`へ配備。remote D1を通じて版固定ページを全取得し、3,944件の内容、`recordsSHA256`、`identitySHA256`を独立成果物と照合して一致。CORS拒否、versionless時のinactive応答、GET以外の拒否、Auth pathの非公開を確認した。active pointerは引き続き未設定で、SPAは未接続。本番ドメイン、Auth/user data、Supabase書込みは未変更。`wrangler r2 bucket list`はCloudflare error 10042（DashboardでR2有効化が必要）となったためbucketやobjectの移行は未実施。

続けて同日、`0003_better_auth_core.sql`を`fanmark-app-staging`用のmigration patternへ追加。通常のremote `d1 migrations apply` query経路は`incomplete input`で失敗したが、同じSQLはisolated local D1でWranglerのsplitter経由でも25 query成功。通常の`d1_migrations` rowを含むSQLをWranglerのremote `--file` importでtransactionalに適用し、remote readbackでAuth table 8件、MFA generation trigger 6件、generation singleton 1件/generation=0、migration ledger row 1件を確認。user/account/session/verification/twoFactor/adminRole/mfaAssuranceは全て0行。

`fanmark-app-staging` Worker version `b69bdc6b-7faa-4dca-b994-53251eca3fbe`を`https://fanmark-app-staging.fanmark-id.workers.dev`へdeployし、staging専用ランダムBetter Auth secretをCloudflare Secret Storeへ登録（secret値は読み戻さず、出力もrepo保存もしていない）。許可originからのAPI ok/session、許可外origin 403、signup 403を確認。synthetic `example.invalid` userのsign-in 200、session read 200、logout 200、誤password 401を確認後に削除し、全Auth user-owned rowsが0であることを再readback。UI authはまだSupabase context、signup/email/OAuth、業務・管理API認可も未接続。アプリSPAのnoindex/robots/sitemap設定、版固定catalog全3,944件のremote fetchと両artifact hash一致を確認。production app/DB、Supabase write、public domain/DNSは未変更。R2はerror 10042で引き続き未有効。

2026-09-23、絵文字マスターremote staging scriptをBetter Auth schema適用後も安全に再実行できるよう更新。8つのAuth表すべてが存在し、user-owned行が全て0、MFA generationが0であることを確認し、release stagingの前後でactive pointer/activation historyが不変であることを検査する。再実行はcanonical 3,944行、ready release 3,944行を一致確認し、既存releaseを再利用、active/history各0のまま完了。D1のcompound SELECT上限に合わせてAuth count検査はscalar subqueryへ変更。専用テストを加え、migration-data suite 79件成功。

同日、既存Supabase `avatars` / `cover-images` を置き換えるWorker-side R2 APIを追加。Better Auth sessionを確認してからowner UUID配下の新規keyをサーバー生成し、avatar 1 MiB / cover 2 MiB、画像signature、許可Origin、owner-only deleteを検証する。公開GET/HEADには1時間cacheと`nosniff`を付ける。Miniflare D1/R2で5統合テストと既存Better Auth 5テスト、API typecheckが成功。テスト用合成画像/アカウントのみで、R2アカウント有効化・remote bucket・frontend切替・実object移行は未実施。frontendは依然Supabase Auth/Storageを使用中。詳細は[Storage API準備](storage-r2-app-api.md)。

続けて`fanmark-app-staging` Workerをversion `c45c7085-387b-44e6-9038-b1d52382dc7f`へ更新。remote D1にpending migrationなしを確認してから配備し、Better Auth health 200、版固定emoji catalog 200、root `X-Robots-Tag: noindex, nofollow`を確認した。Storage upload/public readはいずれも503 `storage_unavailable`でfail closed。配備bindingsにR2はなく、Cloudflare R2は引き続きerror 10042、remote bucket/objectは未作成。Supabase production、user data、public domain/DNSは変更なし。

2026-09-27、オフラインrepository inventoryをHEAD `497626c0ca035066843244128f60e6758677de9c`基準で再生成した。現checkoutのfrontend scanは211 callsites（36 Edge invoke、37 RPC、4 Realtime channelを含む）。`node scripts/migration/test-inventory.mjs`が成功。これは静的checkout inventoryであり、live schema/production inventoryの代わりではない。

続けてremote activation CLIを追加。現在版の明示指定を必須にし、今回は`none`をpreconditionとして初回promote。coreに楽観的な版一致guardを追加し、7件のrelease integration testsが全て成功。隔離APAC D1で版`10ec42c1a562197c1e66c5fd10316c904188cdfb274ca5b8852c99ba240d3bed`をgeneration 1として有効化、activation historyは1行。専用`workers.dev` catalog APIは版なしGETが503から200へ遷移し、全8ページ・3,944行のreadbackでversion、`recordsSHA256=84a67b361adf96534bc6e564ec7510249758c2b20492e4d0b97acc7fd88309c0`、`identitySHA256=dddd7cf13528dd44f2bb1329ed1167f83fb30e63504fdd1c673845467ab402fc`が成果物と一致。再実行時はchanged=falseで履歴を増やさない。Better Auth user-owned行は引き続き0。production app/DB、Supabase write、R2、user data、custom domain/DNSは変更していない。

## 非ユーザー参照マスターの移行（2026-09-23）

`fanmark_tiers`、`languages`、`reserved_emoji_patterns`を明示allowlistとし、Supabase SQL Editorからread-only exportを作成した。型付きsnapshotは非公開一時領域にあり、各4・4・5行、USD decimal text、UUID、microsecond timestampsを保持する。system settings、Auth、user rows、Storageは取得していない。

`workers/api/migrations/0004_reference_master_releases.sql`でimmutable staging release、3つのactive views、atomic pointerとappend-only activation historyを追加。USD値はdecimal textから正確なinteger centsに変換し、既存availability repositoryの境界と合わせる。stage/retry/readback、immutability、promotion、money codec、JSON object key順に依存しない照合、生成SQLのMiniflare integration 5件、API typecheck、build dry-runがNode 22.6.0で成功。手順は[参照マスターの移行](reference-master-data.md)。

Wrangler local D1へ`0000`–`0004`をすべて適用し、実snapshotから生成した20文を実行。stage表・active viewの計13行、3つのsource hash/count、generation 1、migration ledgerを独立read-only comparisonし全件一致。これはlocal persistent D1の証拠でありremote適用ではない。

その後、対象APAC staging D1へのWrangler query/writeが回復し、`0004_reference_master_releases.sql`を適用した。非公開snapshotから3参照表13行をstageしてsource hash・全列・件数を照合し、release `5be91463bd0429cc9fc7a280892a80a922deb2dd9224325374171a4ce7bdc88e`をgeneration 1へ有効化した。active viewsの再照合は成功し、Auth user-owned行は0、既存絵文字releaseは不変。app-staging Workerもversion `caebcf9a-236a-4e1d-a89d-8940ad461c44`へ更新し、noindex、Better Auth health、3,944件の絵文字catalog hash一致、R2未設定時の503を確認。詳細は[live observations](live-observations.md)。

## Better Auth staging UI接続（2026-09-23 JST）

staging modeの認証画面を、同一workers.dev origin上のBetter Authへcookie付きHTTP接続した。ログイン後に`/api/auth/get-session`を再取得し、logoutは`/api/auth/sign-out`へ送る。セッション取得/更新では`credentials: include`と`cache: no-store`を指定し、SupabaseのBearer tokenや擬似Supabase sessionは作らない。stagingではsignup、social OAuth、forgot/reset-password、password-setupを非表示またはauth画面へredirectし、これらからSupabase Authへ誤接続しない。

Node 22.6.0でfrontend client 5テスト、TypeScript typecheck、staging buildが成功。Wrangler deploy dry-run後、`fanmark-app-staging`をworkers.dev限定のversion `36183ffc-bfa4-4d64-b2ff-42ea9a7392dc`へdeploy。read-only HTTP確認はroot 200 + noindex、robots全体Disallow、`/api/auth/ok` 200、cookieなし`/api/auth/get-session` 200/null、固定絵文字catalog 200、R2 public read 503 `storage_unavailable`。bundle scanはBetter Auth endpointsを含み、production Supabase URLは含まず、synthetic Supabase fixture URLのみを確認。remote Auth user/account/session/verification/twoFactor/adminRole/mfaAssurance rowsは全て0。

この確認ではブラウザからの成功ログインを実施していない。frontend helperのrequest/error/session契約とWorkerの未認証経路は確認済みだが、credentialを使ったend-to-end UI、業務API認可、プロフィール/Storage接続は未完了。production Worker/DB、OAuth provider、billing設定、R2 subscription、public domain/DNS、実ユーザーデータには変更なし。R2開始手順はsubscription checkoutを要求するが、Standard monthly allowanceは10 GB-month storage、Class A 1M、Class B 10M、egress freeで、超過usageが従量課金となる。詳細は[Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)と[setup](https://developers.cloudflare.com/r2/get-started/)。

## Recent fanmarks Worker API integration (2026-09-23 JST)

/api/fanmarks/recent now retains the public fanmark_short_id as shortId and the existing fanmark_id as fanmarkId, while keeping the previous license-first id contract. RecentFanmarksScroll and useFanmarkSearch use the shared Worker loader; the search view still uses fanmarkId for its existing operation and shortId for the public page URL. Supabase remains the legacy fallback only when the frontend Worker origin is unset. Both call sites cancel requests on unmount.

Node 22.6.0 validation passed: frontend recent contract 9 tests, Worker Supabase contract 14 tests, local D1 contract 4 tests, frontend and Worker TypeScript typechecks, Cloudflare staging build, and app Worker Wrangler dry-run. Targeted ESLint reported no errors and one pre-existing missing dependency warning in the search-query effect. The dry-run showed the staging config still has no explicit recent backend; the remote D1 contains no business tables. The change was not deployed, and no user data or production service was read or written.

## Public fanmark read frontend adapter (2026-09-23 JST)

`VITE_PUBLIC_ACCESS_READ_BACKEND=worker`を明示した場合に、短縮IDアクセス、絵文字パスの照会、QRページ、公開プロフィール照会が既存Workerのversioned public projectionを使うよう接続した。既定はSupabaseのまま。選択後のHTTP/timeout/JSON/network失敗は別データソースへフォールバックしない。HTTP(S) origin検査、credentials omit、no-store、5秒timeout、64KiB応答上限、DTO検証を持たせた。公開プロフィールDTOは具体型にし、既存Hookの条件付きuseMemoと型エラーも解消した。

Node 22.6.0でfrontend API契約7件、TypeScript typecheck、変更ファイルESLint、Cloudflare staging buildが成功。Worker public-access/D1 integration 11件も成功。staging buildはselectorを未設定のままで、Worker stagingも`PUBLIC_ACCESS_BACKEND=d1`未設定、business D1 schemaなしのため、デプロイやlive-route確認はしていない。Worker選択時はpassword-protected recordのredacted内容をfail closedし、Supabase検証へ混在させない。password検証、アクセス解析、`/f/:shortId` owner/history detailsのWorker移行、source short-id最大長と既存値の再照合が残る。実ユーザーデータ、本番DB、ドメイン/DNS、R2 checkoutは変更なし。

## R2 frontend storage client (2026-09-23 JST)

`src/lib/storage-api.ts`でR2 image API clientを追加し、`useAvatarUpload` / `useCoverImageUpload` の書込み・削除先を`VITE_STORAGE_BACKEND=r2`で選べるようにした。既定はSupabaseで、R2選択はBetter Auth mode以外では拒否。Workerへのcookie credentials、no-store、15秒request timeout、8 KiB JSON上限、responseのowner UUID/key/same-origin URL照合を実装し、R2 HTTP失敗時にSupabaseへ戻らない。Storageはpublic image dataのため、パスワードやBearer tokenは送らない。

Node 22.6.0でfrontend contract 7件、Better Auth client 5件、frontend TypeScript、変更ファイルESLint、Cloudflare staging buildが成功。Worker Miniflare D1/R2 API 5件、Worker TypeScriptも成功。buildでは`VITE_STORAGE_BACKEND=supabase`を明示し、R2 selectorはstagingに設定していない。プロフィールmetadataはSupabase経由のまま、R2 subscription/bucketsは未設定で、この変更はadapter準備に限る。remote deploy、R2 object、ユーザーデータ、production service、domain/DNSに変更なし。

## 参照マスターWorker API接続（2026-09-23 JST）

`GET /api/reference-masters/{fanmark_tiers|languages|reserved_emoji_patterns}`を追加した。D1 active pointer、ready release、table manifest、release-bound rowsを一つの問合せで読み、release version・row count・UUID・domain fieldを検査して最小DTOだけを`no-store`で返す。3マスターを一つのactive release versionに固定し、tier priceはinteger centsで返す。`useLanguages`には明示selector `VITE_LANGUAGE_READ_BACKEND=worker`を追加し、既定Supabaseを維持。Worker障害時にSupabaseへ戻らない。

Node 22.6.0でfrontend contract 5件、Miniflare Worker/D1統合3件、frontend/Worker TypeScript、変更ファイルESLint、staging build、Wrangler deploy dry-runが成功。APAC `fanmark-emoji-master-staging`を読むWorkers.dev app Workerをversion `3f597b51-f8b5-490c-bd0f-b2a0929de03e`へdeploy。read-only HTTPはtier 4、language 4、reserved-pattern 5行すべてでactive release `5be91463bd0429cc9fc7a280892a80a922deb2dd9224325374171a4ce7bdc88e`を返し、`no-store`を確認。app root noindex、Better Auth health、CORS拒否、未知route 404も確認。production app/DB、ユーザー行、Storage、R2、domain/DNSには変更なし。tier / reserved patternのフロント管理画面は引き続きSupabaseのため、アプリ全体のマスター切替ではない。

2026-09-24、`AdminExtensionCoupons`に版付きtier read clientを接続した。`VITE_REFERENCE_MASTER_READ_BACKEND=worker`の明示時のみ4つのtier optionをactive Worker releaseから読む。release digest、4段階の一意性、UUID・項目型、`no-store`、16 KiB上限を検証し、Workerが利用できない場合は新規クーポン作成を止める。クーポン書込みと`AdminTierExtensionPrices`の編集はSupabaseに残る。専用client 5件、既存language client 5件、Miniflare API/D1 3件、root typecheck、変更ファイルESLint、Cloudflare buildが成功。selectorを明示したstaging buildとdry-runの後、app Worker version `82ce7520-1977-470a-89fd-c875c5ef116c`を配備し、root noindex、bundle、active tier API levels 1–4とno-storeをread-onlyで確認した。D1/R2書込み、実ユーザーデータ、production、DNS変更なし。`AdminTierExtensionPrices`のtier日数更新経路とreserved-pattern画面接続は未完了。

## App Workerのadmin session gate（2026-09-24 JST）

`GET /api/admin/session`を追加し、現在のBetter Auth session、admin role、現在verifiedのfactor、同じuser/session/factorにひもづく未期限切れMFA assuranceを確認する。結果は`{"authorized":true}`だけで、admin CRUDや業務データAPIはまだ実装していない。認証テーブルにread-onlyで、route以外の`/api/admin/*`は404を維持する。合成D1テスト8件、Worker typecheck、Wrangler staging dry-runが成功。staging Worker `73b2724e-4abd-4ab6-a0bd-8e3a66cb7760`へ配備し、live unauthenticated GETは401、許可origin OPTIONSは204/credentialed CORS。ユーザー行・業務データ・D1 schemaに変更なし。remote authorized-admin sessionとadmin CRUDの確認は未実施。

## D1 role分離準備（2026-09-24 JST）

`D1_TOPOLOGY=split`では業務`FANMARK_DB`、Better Auth`AUTH_DB`、emoji/reference master`MASTER_DB`を個別に選び、必要bindingの欠落時にfallbackしないselectorを追加した。legacy modeは既存single-D1 local/staging configを維持する。可用性repositoryはemoji masterとtierを`MASTER_DB`、fanmark/licenseを`FANMARK_DB`から読む。catalogとreference-master repositoriesもmaster roleを使う。local fixturesは別D1へ分割し、availabilityのmissing-binding fail-closedを追加。

read-only remote schema inspectionで既存staging D1上の`emoji_master`、`fanmark_tiers`、`languages`、`reserved_emoji_patterns`名のmaster object、およびBetter Auth schemaを確認した。source-shaped 40-table business target/importerはexact object-setを要求するため同DBへ適用しない。Node 22.6.0でWorker typecheck、availability 8件、catalog 3件、reference-master API 3件、Better Auth 8件、emoji master release integration 7件が成功した。その時点ではremote Worker/D1 binding、schema、R2、user data、domain/DNSは変更していなかった。

## Split D1 and R2 staging deployment (2026-09-24 JST)

Created APAC `fanmark-business-staging` and `fanmark-auth-staging`. The business DB remains empty; the Auth DB has only the `0003` Better Auth/MFA schema and migration ledger. Wrangler's regular remote `migrations apply` path returned `incomplete input` for the trigger-bearing migration; read-only verification showed rollback/no application tables, then the previously validated remote file-import path applied 25 statements. Readback confirmed 8 Auth tables, 6 MFA generation triggers, generation 0, one migration record, and zero user-owned rows. No rows were copied from the original master/Auth staging DB.

After the user enabled R2, created empty APAC Standard avatar and cover-image buckets. `fanmark-app-staging` version `2dd73277-d1db-4b4a-a7da-0a82815791de` now has split D1 roles and both R2 bindings with `STORAGE_BACKEND=r2`. Local typecheck and focused availability (8), catalog (3), reference-master API (3), Auth (8), Storage/R2 (5), and emoji release (7) tests passed. Live smoke checks passed for noindex, Auth health/session, anonymous admin denial, master APIs, R2 missing-object 404, and unauthenticated upload 401. A temporary synthetic Auth account exercised live sign-in, 16-byte PNG upload/read/delete and was removed; final Auth row counts were zero and the object returned 404 after deletion. Frontend storage selector remains Supabase; no actual Supabase Storage inventory or objects, real Auth/business data, production service, or domain/DNS were touched. R2 usage from the synthetic test is within included Standard free allowances; the invoice dashboard was not inspected.

## Password-protected public access connected to the source-shaped profile (2026-09-24 JST)

Connected `workers/api/src/verified-access.mjs` to the application Worker behind the explicit `VERIFIED_ACCESS_BACKEND=d1` flag. The route resolves business D1 through the split topology and fails closed when the flag, binding, or secret is absent. Added `scripts/migration/verified-access-schema.mjs` to produce and verify the proof/rate-limit extension against exact source, lifecycle, access-generation, and credential-transform descriptors. This extension is used only in disposable local D1 tests; the remote business D1 remains empty and staging keeps the route flag unset.

Node 22.6.0 verification passed: 9 focused protected-access Miniflare tests, 14 full source-profile checks (including synthetic credential-artifact provenance, protected-text verification/read, and old-proof denial after active-to-grace), Worker TypeScript, and frontend TypeScript. The latest real-password format inventory, credential transform/import flow, Cloudflare CPU/plan and multi-instance abuse checks, deployed-origin CSRF/cookie checks, and frontend canary remain open. No real password/user row, remote business DDL, production service, or domain/DNS was changed.

## Protected-access frontend connection (2026-09-24 JST)

Added `src/lib/verified-access-api.ts` behind `VITE_VERIFIED_ACCESS_BACKEND=worker` and connected the existing password prompt on short-ID and emoji access pages. The client verifies once, reads protected text/redirect/profile content with the proof cookie, validates the exact DTO, bounds response size/time, and never falls back. Public-read and protected-verification selectors must match; otherwise the page fails closed. Protected profiles use the nested authorized projection rather than a second anonymous profile lookup. Supabase remains the default and both staging selectors remain unset.

Seven client contract tests, frontend typecheck, targeted ESLint, Worker typecheck, and Cloudflare staging build pass. No password values, real user data, staging selector, remote business schema, production service, or domain/DNS was changed.

## Cloudflare staging admin authentication connection (2026-09-24 JST)

The `cloudflare-staging` frontend mode now uses Better Auth for the admin sign-in path and `GET /api/admin/session` for the authoritative role/MFA decision. The screen handles Better Auth's TOTP sign-in challenge and first-time enrollment, including its returned recovery codes. The Worker distinguishes missing/unverified TOTP setup (`mfa_enrollment_required`) from a verified factor without valid same-session assurance (`mfa_required`). Supabase-mode admin login and MFA remain unchanged; admin CRUD and business-data authorization are still separate work.

Node 22.6.0 verification passed: 9 Better Auth client tests, 9 Worker Auth/D1 tests, frontend and Worker typechecks, targeted ESLint, CI-isolation check, Cloudflare staging build, and Wrangler deploy dry-run. `fanmark-app-staging` was deployed to version `161de18f-44ea-4016-9267-39688619df9b`. Read-only HTTP smoke returned root 200/noindex, JS 200 containing the new admin-auth flow, anonymous `/api/admin/session` 401, and no-cookie `/api/auth/get-session` 200/null. A Wrangler read-only D1 migration-history query returned Cloudflare API 7403; deployment itself succeeded. The deployment uploaded Worker/assets only and made no D1/R2 writes. Remote synthetic-admin login/TOTP completion is unverified; no real Auth/user data, production service, or domain/DNS changed.

## Availability against the versioned reference-master release (2026-09-24 JST)

Added a separate local Miniflare integration that applies the checked-in
`0004_reference_master_releases.sql`, stages and activates a synthetic
release, then calls the availability Worker through the real `fanmark_tiers`
active view. It verifies the integer-cent view value and USD response, another
tier selection, and the inactive-tier result. This closes a fixture gap: the
older focused availability suite still covers request and lifecycle cases,
but it uses a simplified tier table. The new suite is registered in the local
package script and isolated CI job.

Node 22.6.0 verification passed: three new release-backed cases, eight
existing focused availability cases, three reference-master API cases, Worker
typecheck, targeted ESLint, CI isolation, and `git diff --check`. No remote
D1/R2 write, real user data, deployment, production service, or domain/DNS
change occurred.

## Owner-scoped dashboard list API (2026-09-24 JST)

Added `GET /api/me/fanmarks` backed by split business D1 and authenticated with
the existing Better Auth session resolver. The SQL uses only the resolved
session user ID for ownership, includes active/grace/expired dashboard rows,
and returns the minimum view model without email or user ID. Duplicate basic
configs and malformed target values fail closed. Credentialed CORS is
origin-allowlisted; the route is no-store and has no Supabase fallback.
`VITE_OWNED_FANMARKS_BACKEND=worker` is opt-in. The staging-mode build forced
this selector to `supabase`, and no deployment was performed because business
D1 has no application schema or rows. Wrangler staging dry-run successfully
bundled the updated Worker with the split D1 and both active R2 bindings.

The separate Miniflare suite applied Better Auth and a source-shaped synthetic
business fixture. It proved that two synthetic sessions see only their own
rows, a supplied `userId` query parameter cannot select another user, and
ambiguous duplicate configs, malformed projections, anonymous, forbidden-origin,
unsupported-method, and disabled-backend requests are rejected. Four Worker
cases and four frontend contract cases pass. Worker
and frontend typechecks, the Worker base plus verified-access suites (30
tests), the Storage/R2 suite (5), CI workflow-isolation checks, and `git diff
--check` pass. Existing lint errors in `FanmarkDashboard.tsx` are on unrelated
existing `any` expressions; new API files pass targeted ESLint. The staging R2
bucket list still contains both enabled buckets. No remote D1/R2 writes,
deployment, real user data, production changes, or DNS/domain changes occurred.

## R2 staging deployment and extension-price schema (2026-09-25 JST)

Cloudflare confirmed both APAC staging buckets already exist. Applied Master D1
migration `0006_reference_master_extension_prices.sql`; migration readback now
contains `0000`–`0006`. The active reference release remains generation 1 at
`5be91463bd0429cc9fc7a280892a80a922deb2dd9224325374171a4ce7bdc88e`. The
extension-price active view has zero rows until a fresh explicit-column source
snapshot is staged and promoted.

Deployed `fanmark-app-staging` version
`1d1bae79-5793-4341-9b1f-540a55376695` with `STORAGE_BACKEND=r2` and both
staging bucket bindings. Live smoke returned Auth health 200, root 200/noindex,
missing public object 404, and no-session upload 401. No upload or user object
transfer occurred; production and domain/DNS remain unchanged. The
R2/extension-master notes in [live observations](live-observations.md) record
full response and migration evidence.

## Reference master refresh and schema inventory (2026-09-25 JST)

Using Supabase CLI `db query --linked`, a read-only catalog query refreshed the
private 40-table schema metadata: 406 columns, 144 constraints, 139 indexes,
15 enum labels, 36 public triggers, 77 policies, 58 functions, and one view.
Snapshot format version 3 now fingerprints all eight catalog scopes, including
the behavior/security definitions. The version-2 D1 converter generated 40
tables with 20 unresolved gate groups, so business DDL remains unapplied; the
four behavior scopes are explicitly `unsupported_catalog_scope`. The
schema-only DDL artifact lacked trigger DDL, so the catalog query is the
trigger inventory source. Query outputs and generated reports remain under
`/private/tmp` with mode `0600`.

A separate explicit-column read-only query refreshed only the four approved
reference masters. The private snapshot contained 29 rows: 4 tiers, 4
languages, 5 reserved patterns, and 16 extension prices. The exact snapshot
was staged and promoted to active reference generation 2 in the APAC master
D1. Remote row/view comparison passed; all user-owned Auth tables remained
empty and the prior emoji release remained unchanged. The live Worker returned
all four master routes with HTTP 200 and `no-store`; the extension-price DTO
contains no Stripe IDs. The AdminTierExtensionPrices editor and checkout
consumer remain on Supabase until their read/write migration can be completed
together. No user rows, Storage objects, production service, or domain/DNS
settings were changed.

## Better Auth own-profile API (2026-09-25 JST)

Added `GET/PATCH /api/me/profile` behind explicit `PROFILE_BACKEND=d1`.
The Better Auth session supplies the only profile-row identity. Response fields
omit billing and invitation data; PATCH accepts only display name, preferred
language, and a same-owner R2 avatar URL. Plan, password-setup, and billing
fields are not writable. The frontend adapter is opt-in through
`VITE_PROFILE_BACKEND=worker`; `useProfile` and language preference updates
select it only when explicitly enabled, with no Supabase fallback. Existing
R2 upload client remains independently opt-in.

Local synthetic Better Auth/D1 verification passed five Worker integration
tests and four frontend client tests, covering owner scoping, privileged-field
rejection, avatar ownership, CORS, no-store, and fail-closed behavior. Worker
TypeScript checking passed. Business staging D1 remains empty, so this selector
was not enabled or deployed. No real profile rows, R2 objects, production
service, or domain/DNS state changed.

## Notifications inbox API (2026-09-25 JST)

Added a Better Auth session-scoped Worker/D1 path for listing a user's
notifications, unread count, individual read, and eligible bulk read. The
response is limited to the UI DTO, 50 rows, 16 KiB per payload, and 256 KiB per
page. The frontend can explicitly select it with
`VITE_NOTIFICATIONS_BACKEND=worker`; Supabase remains the default and there is
no fallback between backends. Synthetic D1 integration and frontend client
tests pass (six Worker cases and four client cases). Worker/type checks,
targeted ESLint, `npm run check:ci`, and `npm run build:cloudflare-staging`
passed for this change. The build reports the existing large application
chunk warning; it does not fail. The selector remains off because business
staging D1 has no application schema.
Notification generation/delivery and Cron remain on Supabase; no deployment,
user-row import, production change, or domain/DNS change occurred. See
[notifications API migration](notifications-api.md).

## App Worker/Static Assets staging redeployment (2026-09-25 JST)

Rebuilt and deployed the current Worker and staging SPA to the isolated
workers.dev service as version
`77668344-429b-43f4-81e5-0d2f8b3c74ef`. Wrangler dry-run showed split business,
Auth, and master D1 bindings plus the two enabled R2 buckets. The deployment
uploaded Worker/assets only; no D1 migration or R2 object operation ran.

Node 22.6.0 verification passed: root and Worker TypeScript checks, CI
isolation, Cloudflare staging build, 86 migration-data tests, 37 focused Worker
integration tests across Auth/profile/owned-fanmarks/R2/notifications/reference
masters/availability, and 69 frontend client tests across their corresponding
adapters and recent/public/verified access. Wrangler deploy dry-run also
passed. The SPA build retains the existing >500 KiB main-chunk warning.

Read-only live smoke confirmed root 200 with `noindex`, robots disallow, Auth
health 200, null unauthenticated session 200, anonymous admin session 401, and
four versioned reference-master APIs returning 4/4/5/16 rows with `no-store`
at release `49d582cfc482da61f5394fc83ea9d1bb67820a8d47d493dfdfb74218dd4b4c12`.
Disallowed-origin master access returned 403. Profile, owned-fanmark, and
notification routes are deployed but return their expected fail-closed 503
codes while their D1 backend selectors remain unset and business D1 is empty.
The SPA route fallback returned 200 for `/plans` and a synthetic short-ID URL;
the PWA manifest and service worker returned 200, the worker script excludes
`/api/*` from navigation fallback, missing JS stayed 404, and unknown API
routes stayed JSON 404. Both referenced favicon files returned 200.
A fresh remote catalog query found only Cloudflare's internal `_cf_KV` table;
all seven user-owned Auth tables read back zero rows. No real data, production
service, or public domain/DNS was touched.

## D1 UUID and event-sequence defaults (2026-09-25 JST)

The schema converter is now version 3. PostgreSQL `gen_random_uuid()` defaults
on source UUID columns compile to a D1-native expression that returns canonical
RFC 4122 version-4 UUID text. Source/imported IDs remain explicitly bound and
are never regenerated. This closes the UUID-default gate without weakening the
row-import UUID validator. The `fanmark_events.id` `nextval()` default now
compiles to `INTEGER PRIMARY KEY AUTOINCREMENT`, with the exact PostgreSQL
sequence value retained as a final-snapshot import gate. The conversion
contract and snapshot example were updated.

Node 22.6.0 verification passed: migration-data tests 89/89, schema-converter
tests 10/10, lifecycle/credential-schema tests 9/9, D1 importer tests 13/13,
Worker D1 runtime tests 6/6, and Worker TypeScript. The D1 runtime created 256
UUIDs through the generated default and verified canonical version/variant
bits and uniqueness. A sequence test verified monotonic allocation after an
explicit imported ID and deletion. A fresh private conversion of the
2026-09-25 catalog parsed all 40 tables and 66 indexes in isolated SQLite;
foreign-key check returned no errors and `integrity_check` returned `ok`. The
report has 18 blocking groups (10 import, 8 schema/operation) and remains
`deployable: false`. The source database locale is `en_US.UTF-8`; the three
regex-based format checks remain gated until equivalent locale behavior is
proven. No business D1 DDL, user data, production service, or domain/DNS state
was changed.

## Locale-guarded regex CHECK conversion (2026-09-25 JST)

Schema converter v4 now has narrowly allowlisted SQLite equivalents for the
three known ASCII regex checks, but emits them only when the catalog says both
source locale settings are `C`, the column has no explicit non-default
collation, and the table/column/operator/pattern all match exactly. The current
source locale is `en_US.UTF-8`, so all three checks stay gated and the v4 report
remains at 18 unresolved groups with `deployable: false`. Reprocessing the
current private catalog produced 40 tables and 66 indexes; isolated SQLite
reported zero foreign-key violations and `integrity_check=ok`. No generated
DDL was applied to business staging. On Node 22.6.0, `npm run test:migration-data`
passed 90/90 and `npm --prefix workers/api run test:d1-import` passed 13/13.

## Tier/extension-price admin path preparation (2026-09-25 JST)

Added a fail-closed Worker admin route for reading and editing only
`fanmark_tiers.initial_license_days` and extension-price fields. It reuses the
current Better Auth admin-role and same-session TOTP-assurance gate. Every
single-field edit stages a new four-master release, verifies exact D1 row
readback, then compare-and-sets the active pointer against the screen's
expected release version. Public price responses continue to exclude Stripe
IDs. The frontend adapter uses credentialed `no-store` requests and has no
Supabase fallback after an explicit Worker selection.

Synthetic verification passed: reference-master Miniflare/D1 API suite 5/5,
frontend admin API contracts 6/6, Better Auth role/MFA route checks 12/12,
Worker and app TypeScript, targeted ESLint, CI isolation, Cloudflare staging
build, Worker deploy dry-run, and `git diff --check`. The five R2
Miniflare/D1 API tests also pass. No remote D1 edit was
performed. The staging selector remains explicitly disabled because checkout
still reads these settings from Supabase; enabling only the admin writer would
split the source of truth. R2 remains enabled and bound to the existing staging
Worker, with its separate synthetic upload/read/delete smoke already recorded
in [R2 Storage API](storage-r2-app-api.md). No production, user data, or
domain/DNS change was made.

## Paired extension-pricing read path (2026-09-25 JST)

Added a separate HMAC-protected Worker service endpoint for a single extension
price, plus strict Supabase Edge client validation. It selects the test/live
Stripe ID only for the checkout caller; the coupon-based direct extension asks
for price and active state without any Stripe ID. The public extension-price
API remains Stripe-ID-free. The checkout and direct-extension Edge Functions
now support `REFERENCE_MASTER_PRICING_BACKEND=cloudflare` while retaining
Supabase user/license reads and writes, and they fail closed after selecting
Cloudflare. `ExtendLicenseDialog` also has its own disabled D1 pricing selector.
The checkout path no longer writes full pricing rows, Stripe Price IDs, user
IDs, or checkout URLs to function logs.

Validation passed: HMAC helper-to-Worker integration 4/4, private service
endpoint suite 5/5, reference-master D1/API suite 6/6, frontend reference
master contracts 7/7, Worker typecheck, and Deno checks for both Edge Functions.
The app Worker was deployed to staging as version
`763c798c-8e37-456b-a720-54f75be1270b`; a separate staging-only HMAC secret is
stored in Cloudflare and in a mode-0600 local file outside the repository. A
live signed read verified the current release and active tier-2/one-month
record through both checkout and price-only projections. The backend selectors
and Supabase Edge Function secret remain unset, so checkout and license
mutations still use Supabase. No Stripe call, D1 schema/row write, user-data
change, production change, or domain/DNS change occurred.

## Local migration-suite isolation and distribution verification (2026-09-25 JST)

The default Workers Vitest config was also discovering the profile, notification,
and favorites integration files that require their own split-D1 Wrangler
bindings. Those three files are now excluded from the generic config and remain
run by their dedicated CI commands. The static-assets integration expectation
was updated to include the already-reviewed `fanmarkId` and `shortId` fields in
the recent-fanmarks DTO.

On Node 22.6.0, the frontend/Edge contract suite passed 88 tests and migration
data passed 90. The default Worker suite passed 26 plus 9 verified-access tests;
the split-D1 API suites passed: auth 12, storage 5, owned-fanmarks 4, profile 5,
notifications 6, favorites 4, recent D1 6, availability 8, versioned-master
availability 3, public access 11, reference-master API 6, and private reference
service 5. Versioned emoji/reference master integrations passed 7 and 5 cases;
lifecycle/credential schema passed 9; generic D1 importer passed 13; source
license-expiry integration passed 20, scheduler contracts 8, and local R2 import
smoke passed. Static Assets passed 14 cases and its Wrangler HTTP smoke.

The application and Worker type checks, normal and Cloudflare-staging Vite
builds, PWA cache-boundary check, and Worker/Static Assets Wrangler dry-runs
passed. Builds report existing large-chunk and stale browser-data advisories.
The Cloudflare business D1 remains without application DDL; no remote data,
production, or DNS/domain state was changed by these local checks.

## Owner fanmark profile API (2026-09-25 JST)

Added an authenticated Worker/D1 owner profile endpoint and wired the profile
edit/preview screens behind `VITE_FANMARK_PROFILE_BACKEND=worker`. The route
resolves ownership from Better Auth session identity, accepts only profile
fields, applies bounded URL/theme/JSON validation, and supplies UUID/timestamps
at write time. Its active finite-license predicate matches the current edit
screen and source profile INSERT policy. Frontend selection remains disabled
while staging business D1 has no application schema or user rows; the overall
fanmark settings page and its access configuration are still Supabase-backed.

Local validation: dedicated synthetic split-D1 Worker integration 5/5,
frontend API contract 5/5, Worker TypeScript and application TypeScript pass.
No remote database/schema writes, user-data migration, production change, or
domain/DNS change occurred. Contract details are in
[`fanmark-profile-api.md`](fanmark-profile-api.md).

## Empty business-staging schema bootstrap (2026-09-25 JST)

The generated v4 DDL now has its own `workers/api/migrations-business`
directory, configured only for the staging `FANMARK_DB` binding. Cloudflare's
[D1 migration configuration](https://developers.cloudflare.com/d1/reference/migrations/)
supports a per-binding `migrations_dir`, keeping this schema history separate
from Better Auth and master-data migrations.

Before writing, a read-only query confirmed `fanmark-business-staging` held
only Cloudflare's `_cf_KV` table. Wrangler local rehearsal applied all 108
statements; SQLite readback found 40 application tables, 66 indexes, no
foreign-key violations, and `integrity_check=ok`. Wrangler then applied
`0000_business_schema_v4_staging.sql` to the remote APAC business database. A
read-only follow-up confirmed 40 application tables, 66 indexes, the migration
ledger entry, no pending migrations, and an empty `PRAGMA foreign_key_check`.

This applied DDL only: the migration has no row-insert/update/delete/copy
statements. The schema report remains `deployable: false` with 18 unresolved
gates; selectors remain disabled, and the Worker was not redeployed. No
Supabase rows or Auth records, R2 objects, production service, or domain/DNS
state changed. Full details are in [`live-observations.md`](live-observations.md)
and [`schema-generator.md`](schema-generator.md).


## Recent and availability read paths on staging D1 (2026-09-25 JST)

The workers.dev staging Worker now explicitly selects D1 for recent-fanmark
reads and availability; the staging SPA's shared Worker base URL selects the
matching clients. The app code was redeployed as version
`c9d51d92-3b7a-49e9-b152-b210d24a36f1` after a Wrangler dry-run. A temporary
remote synthetic fixture exercised active ordering, grace exclusion, limits,
DTO mapping, exact CORS, no-store, and invalid input; all inserted rows were
removed and remote total counts are zero. Availability resolved a canonical
emoji from Master D1 and returned a valid tier-4 result against empty business
D1. No real rows, Supabase writes, production resources, or DNS were involved.
Tests and evidence are in `recent-api-contract.md`,
`availability-validation.md`, and `live-observations.md`.


## Public access reads on split staging D1 (2026-09-25 JST)

The staging SPA was built with `VITE_PUBLIC_ACCESS_READ_BACKEND=worker`, and
the app Worker config sets `PUBLIC_ACCESS_BACKEND=d1`. A local test using
distinct business and master databases found that emoji normalization was
incorrectly querying the business D1. The repository now selects
`MASTER_DB` for canonical emoji lookup and `FANMARK_DB` for fanmark and
license projections. The split-D1 Worker suite passes 11/11; Worker typecheck,
targeted ESLint, staging build, Wrangler dry-run, and `git diff --check` pass.

Worker version `3733c771-2903-40cd-8bdc-5a0f94412c82` returned HTTP 200 and
`Cache-Control: no-store` for synthetic short-ID, emoji-ID, and published-
profile reads. The input used a canonical emoji present in Master D1 while the
business D1's `emoji_master` remained empty. Four temporary synthetic rows
were deleted and exact-ID readback found zero in each table. No real rows,
Supabase writes, production routes, R2 objects, or domain/DNS settings changed.
The public-read selector is staging-only; protected-password verification,
access analytics, owner/history detail, and complete business API parity
remain outside this slice.

## Authenticated owner APIs on staging (2026-09-25 JST)

The staging Worker config now selects D1 for own profile, owned fanmarks,
owner fanmark profile, favorites, and notifications. The
`build:cloudflare-staging` script sets the matching five
`VITE_*_BACKEND=worker` selectors so a normal staging build reproduces the
deployed frontend. The staging SPA build and Wrangler dry-run passed; deployment
updated `fanmark-app-staging` to version
`70cb8111-2a25-4e43-8662-e59dfd8add8d` with split business/Auth/master D1
and both R2 bindings.

A temporary Better Auth user created only in staging exercised profile
GET/PATCH, owned-fanmark listing, owner fanmark profile GET/PATCH, favorite
add/list/remove, and notification list/unread-count/read. An unauthenticated
profile request returned 401. The initial synthetic credential fixture used
the email for Better Auth `accountId`, which returned 401; cleanup ran and
readback showed zero rows. Using the existing test convention, with the user
ID as `accountId`, passed sign-in and all owner API checks. The Auth
user/account/session and business profile/license/fanmark/config/notification/
favorite/event/discovery rows were deleted; exact-ID/composite remote readback
showed zero. No real user rows were present in the canary and no source writes
were made.

Seven focused local suites passed 31/31: Worker favorites 4, Worker
notifications 6, and frontend profile 4, owned-fanmarks 4, fanmark-profile 5,
favorites 4, and notifications 4. The staging build emits existing stale
browser-data and large-chunk advisories. The canary proves these API routes and
session ownership against the current staging schema; it does not cover the
complete browser acceptance flow, notification generation/delivery, all
business operation/security parity, production data, or DNS/domain cutover.
Those remain outside this stage.

## R2 image uploads on staging (2026-09-25 JST)

The staging build now sets `VITE_STORAGE_BACKEND=r2` along with the five
owner API selectors. Server `STORAGE_BACKEND=r2` and both APAC Standard
buckets were already bound. The new SPA build and Wrangler dry-run passed;
deploying updated the app Worker to `3246cbf2-642f-47f2-a107-0a8a116a8f8a`.

A synthetic Better Auth account uploaded a valid 1×1 PNG to the avatar route,
read identical bytes through its public URL, deleted it through the
owner-checked route, and confirmed the URL returned 404. The synthetic account
and session were removed; D1 readback found no associated canary rows. Local
storage client tests pass 7/7, Worker D1/R2 API tests pass 5/5, Worker
typecheck passes, and staging build/deploy dry-run pass. The bucket object was
deleted; no existing Supabase objects were copied. Production builds continue
to default to Supabase. Profile metadata and overall settings saves are still
split, so this is a staging upload-path check rather than complete profile
cutover.

## Remote emoji release rollback command (2026-09-25 JST)

The remote emoji release activation runner now accepts `--action promotion`
(default) or `--action rollback`. Both require the exact current active version;
rollback also requires a verified immutable artifact for a previously active
release. After activation, readback checks the pointer, generation, action, and
new immutable history entry. A stale `--expected-active` is rejected even if
the candidate is already active, so an uncertain retry must first use the
observed current version. Three synthetic argument/readback tests pass,
`npm run test:migration-data` passes 93/93, and the local Miniflare release
suite passes 7/7. The remote rollback command was not invoked and no Cloudflare
state changed in this step.

## Owner fanmark settings API and runtime password evidence (2026-09-25 JST)

Added local `GET/PATCH /api/me/fanmarks/:fanmarkId/settings` with Better Auth
session ownership, latest-license resolution, active/unexpired write guards,
bounded allowlisted input, and D1 batch writes. The client selector remains
unset. Raw access passwords are not stored in session drafts or returned by the
API; new four-digit passwords are bcrypt-hashed in the Worker. To keep
protected public reads verifiable after a later owner password change without
rewriting the immutable import ledger, the v2 verified-access extension adds
`fanmark_password_runtime_evidence`, which stores only the current license
incarnation, password generation, enabled flag, pinned codec, and timestamps.
The verifier accepts exactly one matching import artifact or runtime evidence
row and rejects stale generations.

The settings Worker suite passed 6/6, the client API suite 5/5, the protected
access D1 suite 10/10, and the full source-profile integration 20/20. The latter
now exercises fresh apply, idempotent apply, and exact v1-to-v2 extension
upgrade/readback. Worker and frontend TypeScript checks pass, as does
`git diff --check`. No staging settings schema or Worker deployment was made:
the remote extension still requires the exact plan-bound base inventory
readback before applying v2, and the feature selectors remain off. A live
check confirmed the account is `fanmark.id@gmail.com` with D1 write permission;
`wrangler d1 list` sees the business D1 and a read-only query succeeds on the
master D1, but querying `fanmark-business-staging` returns Cloudflare error
7403. The logged-in D1 Studio opens that business database and lists its base
application schema, but not the verified-access extension tables. This
CLI-vs-dashboard discrepancy remains unresolved; no DDL was attempted. No user
data, production, or domain/DNS state changed. Details are in
[`fanmark-settings-api.md`](fanmark-settings-api.md) and
[`verified-access-design.md`](verified-access-design.md).

## Live schema refresh and single-return staging canary (2026-09-25 JST)

Linked the migration worktree to the authenticated `fanmark.id` Supabase
project and retrieved the current public schema only. The CLI wrote no row
data. The resulting public schema contains 40 tables, one view, 58 functions,
77 policies, 36 triggers, and 70 indexes. The checked-in business D1 base
migration has matching table and column names; types, defaults, constraints,
indexes, policies, triggers, and function semantics still need separate parity
review.

Added `POST /api/me/fanmarks/return` with Better Auth ownership and D1
transition, audit, and notification-event behavior. Local Worker tests pass
12/12, client tests 4/4, Worker typecheck and staging build pass, and Wrangler
dry-run passes. Deployment `83629969-f48f-4f68-beeb-7b2ef47724c6` is active on
`fanmark-app-staging` at 100%. Live unauthenticated POST returned 401 and GET
returned 405. A synthetic Better Auth owner was blocked by an active transfer
code, then returned successfully after that synthetic code was removed. The
license transition, audit, owner event, and favorite event payload were read
back; exact cleanup returned zero synthetic business and Auth rows. Bulk return and
notification delivery are still on Supabase. No Supabase rows, production
routes, or domain/DNS settings were changed.

## Fanmark registration D1 transaction on staging (2026-09-25 JST)

Implemented and selected the registration API for the Cloudflare staging SPA
and Worker. The Worker validates the submitted ordered IDs against the ready
active emoji release in Master D1, derives normalized IDs from the release's
codepoints, reads the active tier row, and uses one D1 batch for the fanmark,
initial license, requested license-scoped configuration/profile, and audit
record. Reuse checks and the final mutation reject active licenses, unexpired
grace, or pending lottery entries on an expired grace license. Competing
registrations cannot both issue a license. The client sends Better Auth cookies,
uses `no-store`, and does not fall back to Supabase after a selected Worker
failure. Supabase remains the default outside the explicit staging selector.

Verification on Node 22.6.0: `npm run test:fanmark-registration-api` passed
6/6; `npm --prefix workers/api run test:fanmark-registration-d1` passed 8/8;
frontend and Worker typechecks, `npm run check:ci`, the Cloudflare staging
build, Wrangler 4.139.0 deploy dry-run, and `git diff --check` passed. The
staging bundle contains the registration selector and the route config binds
only the existing staging D1/R2 resources. Deployment
`29dd848d-604c-4405-9bf5-58aff04a00f2` is active at 100%.

Live staging rehearsal used a disposable Better Auth identity and the active
catalog's rose emoji. Registration returned 201 and readback verified tier 4,
an active initial license, basic configuration, profile, and audit row. A
duplicate returned 409; unauthenticated access returned 401. Cleanup removed
the Auth user/account/session and all related D1 rows. Exact readback returned
zero for the fanmark, license, config, profile, and audit tables, and the sum
of all 40 business-table row counts was zero. This synthetic staging proof
does not establish Supabase-user behavior, source-row parity, or production
operation parity. The current source function calculates pattern pricing but
does not enforce its `requiresPayment` flag; no new payment policy was added
and no Stripe call was made. No source rows, production service, or domain/DNS
were modified. Contract: [`fanmark-registration-api.md`](fanmark-registration-api.md).

## Fanmark lottery application/cancellation D1 routes (2026-09-25 JST)

Added `POST /api/fanmarks/lottery/apply` and `/cancel`, selected through
`VITE_FANMARK_LOTTERY_BACKEND` only in the Cloudflare staging build. The D1
routes resolve the Better Auth session user server-side, preserve the source
grace/license-plan checks, and guard entry uniqueness and current capacity in
the mutation batch. Apply/reapply/cancel audit rows are written atomically
with their state change, matching the source `log_lottery_entry_changes`
trigger; notification creation is best effort after the saved application.
The default plan capacity remains three when the corresponding setting is
missing, and `admin` remains unlimited. Perpetual active licenses remain
excluded from this lottery query because the source uses a strict `license_end
> now` filter.

Local verification: Worker D1 suite 11/11, frontend Worker-client suite 6/6,
frontend and Worker typechecks, CI isolation check, staging build, and Wrangler
deploy dry-run passed. The local cases cover configured/default limits,
existing and concurrent applications, cancelled-entry reuse, owner-only
cancellation, audit rollback, and notification enqueue failure.

Deployed `513d9cba-2424-4528-814a-3b1d83425b73` to
`fanmark-app-staging` at 100% on workers.dev. A disposable Better Auth user
completed the registration+lottery HTTP rehearsal: register 201, apply 200,
duplicate application 400, cancel 200, unauthenticated application 401. D1
readback verified the lottery row and cleanup verified zero Auth user/account/
session, user settings, fanmark/license/entry/audit/event rows, and zero rows
across all 40 business tables. The first canary exposed missing cleanup for
trigger-equivalent lottery audit rows; cleanup now removes and checks those
exact entry-scoped rows, and the complete rerun passed. This does not cover
winner selection, active-license issuance, imported users, notification
delivery, production routing, or domain cutover. Contract:
[`fanmark-lottery-api.md`](fanmark-lottery-api.md).

## Grace-expiry lottery finalization journal (2026-09-25 JST)

The isolated business-staging D1 now has `0005_lottery_plan_journal_staging.sql`
with exact schema and ledger readback; both lifecycle journal tables remain
empty and the 40 business tables still contain zero rows. The local expiry
finalizer now stores and replays the exact lottery seed, input snapshot, and
selection plan, then applies winner/loser effects with expiration and cleanup in
one guarded D1 batch. Source integration passes 25/25, lottery selection 10/10,
scheduled expiry 8/8, Worker typecheck, and `git diff --check`. A one-shot
synthetic staging canary and transfer canary are recorded below. The deployed
scheduled backend and Cron remain disabled. Real user-data migration and
domain/DNS cutover remain last.

## Transfer lifecycle canary on staging (2026-09-25 JST)

Deployed Worker version `929280ae-3285-4936-af67-a6f146aae03e` to
`fanmark-app-staging` at 100%. The first live approval returned `409` even
though its D1 batch had committed all transfer rows. The handler previously
trusted per-statement change metadata; approval now performs an exact terminal
state readback before returning success. The rerun passed issue, apply, and
approve, including owner/requester scoping, config reset, transfer lock,
pending lottery cancellation, audit/outbox creation, and cleanup.

`npm run test:staging-fanmark-transfer-smoke` passed. Its `finally` cleanup
returned all 40 source business tables and every user-owned Auth table to zero;
the pre-existing global `mfaGeneration` counter was unchanged. The test used
only disposable synthetic identities and rows. It copied no Supabase users,
did not touch production, and did not alter domain/DNS.

## One-shot grace-expiry lottery canary on staging (2026-09-25 JST)

`scripts/migration/staging-license-expiry-lottery-smoke.mjs` invoked Wrangler's
`--test-scheduled` event from the local Worker runtime with the explicitly
remote `FANMARK_DB` binding. Before seeding it checked that all 40 business
tables, user-owned Auth tables, and lifecycle run/item/effect journals were
empty. A single synthetic pending applicant won. Readback confirmed the
old license expired, the winner received an active license, the weighted
history and durable seed/input/plan were saved, audit and both notification
events were written, and there were no conflicts. The four source access
configuration projections were removed; the profile row remained as in the
source function.

The cleanup returned all 40 business tables and lifecycle run/item/effect
journals to zero and matched both retained lifecycle tables to their exact
pre-canary snapshot (including the existing 16-row incarnation registry).
The deployed app still has no `LICENSE_EXPIRY_BACKEND` selector or Cron
trigger, so this was a one-time staging proof, not scheduled activation. No
Auth identities, Supabase rows, production routes, or domain/DNS settings
changed.

## Bulk plan-downgrade return on staging (2026-09-25 JST)

The Cloudflare Worker now implements `POST /api/me/fanmarks/bulk-return` and
the two plan-selection screens route to it under the existing
`VITE_FANMARK_RETURN_BACKEND=worker` selector. The route accepts 1–50 distinct
license IDs, resolves the owner from Better Auth, blocks inactive/expired or
transfer-locked licenses, and processes each item independently. It preserves
the existing 207 partial-result contract and best-effort audit/notification
event behavior. Production still selects Supabase.

The Worker D1 integration suite passes 17/17 and the frontend client suite
passes 7/7; both typechecks, targeted ESLint, staging SPA build, Wrangler
deploy dry-run, and `git diff --check` pass. Staging version
`186255d9-c8ec-47bf-a8e0-32b3296a6ab3` is active at 100%. The live canary
returned HTTP 207 for one successful return plus one transfer-locked license,
then HTTP 200 after the synthetic transfer code was removed. Cleanup confirmed
zero rows in all 40 source business tables and all user-owned Auth tables,
unchanged access-version state and `mfaGeneration`, plus two newly retained
synthetic license-incarnation tombstones. The registry has 21 rows total: 16
pre-existing tombstones and five from the current return-canary attempts. The
one earlier setup attempt hit a duplicate normalized-emoji key and was cleaned
up; it left only the expected non-user anti-reuse tombstone. No Supabase rows,
production route, Cron trigger, or domain/DNS state changed.

## Earlier checkpoint: Stripe extension payment settlement guard (2026-09-25 JST)

The extension Checkout Session now carries the server-selected expected JPY
total and explicitly disables zero-total Stripe fulfillment, consistent with
the Admin free-extension path bypassing Stripe. The webhook processes a paid
completed Session or the async-payment-success event, leaves an unpaid
completion without a grant, and treats async failure/expiry as no-grant events.
Amount/currency changes fail closed for newly created Sessions. Seven new
settlement tests cover positive pricing metadata and paid, unpaid, asynchronous,
zero-total, and mismatch states. Billing tests pass 70/70 under Node 22.6; Deno
checks, Stripe module typecheck, and `git diff --check` also pass.

At this checkpoint the Checkout Session effect was not yet deduplicated or
atomic. The later transaction and webhook integration are recorded below.

## Stripe extension receipt-to-effect transaction (#32, 2026-09-25 JST)

Connected only the paid-license-extension checkout events to the durable
receipt path. The webhook now verifies the raw request bytes under a 256 KiB
streaming cap, stores the redacted normalized receipt, and invokes a
service-only PostgreSQL function. That function keys the effect by live/test
mode plus Checkout Session ID and commits license extension, pending lottery
cancellation, LICENSE_EXTENDED audit, effect-ledger state, receipt status, and
dispatch status in one transaction. It also creates the product-required
lottery cancellation audit and one notification event per canceled applicant.
It rechecks current owner, finite active or grace license state, fanmark tier,
and transfer locks. Unpaid completion is
stored as awaiting payment; a later async success can apply once. Expired or
failed sessions cannot grant time, conflicting metadata or amount/currency
mismatches fail closed, and a repeated event/session cannot extend twice.

Validation: the focused Stripe receipt, payment-settlement, effect-transaction,
and RPC-result suites pass 35/35 under Node v25.5.0. PGlite executes the new
SQL against an isolated source-shaped fixture, including duplicate Session
IDs, DST-boundary UTC rounding, terminal-state rejection,
rollback after synthetic audit and notification failures, per-applicant
notification payloads, and client-role ACLs. Deno checks
pass for both changed Edge Functions and the shared modules; the Stripe
experiment typecheck, CI workflow-isolation check, and `git diff --check` pass.
This migration is local and was applied only in PGlite: it is not applied to
Supabase or D1, and neither Edge Function is deployed. Stripe endpoint/event
settings, production, user/Auth/object data, and domain/DNS were not changed.

Open work remains: Checkout intent creation and Stripe idempotency keys,
non-extension webhook receipt/application paths, independent Postgres
concurrency checks, and Cloudflare D1 porting are outside this slice. A
payment reported after a failed/expired Checkout is dead-lettered without a
license grant; there is no automatic refund or operator alert yet, so add a
monitored reconciliation path before enabling this in production.

## Stripe Checkout intent and idempotency (#32, 2026-09-25 JST)

Added the local Checkout command boundary. The browser supplies a UUID request
ID persisted in `sessionStorage`; a service-only Postgres RPC validates the
current owner and stores the license, tier, months, selected Stripe Price ID,
positive JPY total, and live/test mode before the API call. The Edge Function
reuses an existing intent and its pinned terms, sends an intent-derived
Stripe idempotency key, stores the returned Checkout Session ID, and retrieves
an already bound open Session on retry. The signed webhook associates the
Session with that exact intent and verifies all immutable metadata before
applying the extension.

The local retry window is 20 hours. Stripe says keys may be pruned after they
are at least 24 hours old; an unbound intent past the local window returns a
reconciliation-required result and cannot create another Session. This
retention boundary is documented in the [Stripe API reference](https://docs.stripe.com/api/idempotent_requests).

Validation: the full Stripe receipt experiment passes 90/90, including the
PGlite intent transaction tests; root TypeScript, Deno checks, Stripe experiment typecheck,
CI workflow-isolation check, and `git diff --check` pass. ESLint passes on the
changed files when existing unrelated `any` and hook-dependency findings in
`FanmarkDashboard.tsx` are suppressed. The SQL ran only in PGlite; it is not
applied to Supabase or D1, no Edge Function was deployed, and Stripe or
production state was not changed. User-enabled R2 was not needed for this
Stripe slice.

Remaining: monitored manual reconciliation when Stripe created a Session but
the response and webhook were both lost beyond the local key window;
non-extension webhook and outbound billing commands; independent Postgres
concurrency testing; and the D1 port.

## Fanmark search details read API (#33/#34, 2026-09-25 JST)

Moved the search screen's `get_fanmark_complete_data` detail read behind
`POST /api/fanmarks/search/details` for the Cloudflare staging build. The Worker
reads business D1 and derives the optional lottery-entry projection from the
Better Auth session; caller-supplied user IDs are not accepted. Its versioned
allowlist omits protected redirect/message/password configuration. Frontend
Worker errors do not fall back to Supabase. Search-history writes remain on the
Supabase RPC for the deferred user-data stage.

Frontend contract tests pass 5/5, Worker default suites 30/30, and
verified-access suites 10/10. Root and Worker typechecks, the Cloudflare staging
build, Worker dry-run, and staging-config dry-run pass. Staging deployment
`e3d47df4-eb20-4ade-8857-398cde3aab0d` returned anonymous search details as
`{schemaVersion:1,result:null}` while business D1 remains empty; Better Auth
health returned 200 and unauthenticated admin returned 401. Business D1 has no
pending migrations. User-specific live details against imported rows, history
write migration, real data import, production routing, and domain/DNS are not
proven by this slice.

The related messageboard-preview screen had one remaining direct call to this
RPC. It now selects `getOwnerFanmarkSettings()` under the existing
`VITE_FANMARK_SETTINGS_BACKEND=worker` staging selector and keeps the RPC only
for regular Supabase builds. The settings frontend suite passes 5/5; app
typecheck and staging build pass. Deployment `e3d47df4-eb20-4ade-8857-398cde3aab0d`
returned 401 for the owner-settings GET without a Better Auth session. A
populated-row browser preview remains unverified because staging D1 is empty.

## Lifecycle settings Worker path (#34, 2026-09-25 JST)

Split the grace-period setting from the generic settings hook. The dashboard
and admin page now use one lifecycle hook; the staging frontend reads the
single public D1 value through `GET /api/system/lifecycle`, while
`PATCH /api/admin/system-settings/lifecycle` requires the existing Better Auth
administrator and session-bound MFA check. The patch accepts only an integer
from 1 through 365, uses a 1 KiB body limit, refuses a private-key collision,
and verifies the saved value by readback. Production builds remain on
Supabase. Product and architecture docs record the configured range and the
dedicated API contract.

A direct read-only Supabase query returned one public
`grace_period_days=1` value. After confirming staging D1 had no licenses or
lifecycle journals, inserted only that one public config row. No user rows or
other settings were copied. The current staging Worker is
`bf951bd0-4aee-42f2-a9a7-997beffe06de`; live public GET returned 200/no-store
with the exact value, anonymous admin PATCH returned 401, root returned
200/noindex, and Better Auth health returned 200.

Frontend client tests pass 4/4; combined settings D1 tests 9/9; Worker standard
and verified-access suites 30/30 and 10/10. Both TypeScript checks, focused
ESLint, staging build, Wrangler dry-run, and `git diff --check` pass. Full-file
lint of `FanmarkDashboard.tsx` continues to report existing `any` and hook
dependency findings. A rerun of the scheduled canary with safe setting
preservation failed at the local Wrangler test-scheduled transport
(`ECONNRESET`); cleanup restored the setting, zeroed canary license/journal
rows, and preserved 22 retained incarnation records. No Cron was enabled.
Authenticated admin browser use and the scheduler Cron remain unverified.
# 2026-09-25: 空き状況APIをactive emoji releaseへ統一

空き状況D1 repositoryがmutableな`emoji_master` mirrorを参照していたため、登録・お気に入りと同じversioned active releaseを参照するよう変更した。ready metadataのないpointerはupstream errorでfail closedし、mirrorにだけ残る旧IDは`invalid_emoji_ids`となる。canonical値がactive releaseと異なる場合もactive releaseのemoji identityを使う回帰テストを追加した。

Node 22.6.0でfocused D1 tests 10/10、versioned emoji/reference-master integration 4/4、Worker default suite 30/30、Worker/Frontend TypeScript、staging build、変更ファイルESLint、Wrangler staging dry-runが成功。Staging app Worker `b381e0b3-7e03-41c2-a217-aeb1d5c5cf68`を100%配備。GET-only live smokeでroot/auth health、3,944件のactive catalog version、同catalogから得たIDによるavailability 200を確認。remote D1、R2、Supabase、production、user data、domain/DNSへの書込み・切替なし。詳細は`docs/migration/availability-validation.md`。

## Maintenance settings Worker path (#34, 2026-09-25 JST)

`maintenance_mode`、`maintenance_message`、`maintenance_end_time`だけを扱う公開GETと管理者PATCHを追加した。staging buildは`VITE_MAINTENANCE_SETTINGS_BACKEND=worker`を選び、Workerは`MAINTENANCE_SETTINGS_BACKEND=d1`とsplit business D1を使う。admin PATCHは既存のBetter Auth管理者・session-bound MFA検証へ接続した。未取得やWorkerエラーをSupabaseへフォールバックせず、一般ユーザーの画面を閉じる。管理画面のメンテナンス項目は1回のPATCHにまとめ、猶予日数設定だけは従来のSupabase経路に残した。

Node 22.6.0でフロント契約テスト4/4、専用Worker D1テスト5/5、Worker標準suite 30/30、verified-access suite 10/10、root/Worker型チェック、対象ESLint、staging build、Wrangler dry-run、`git diff --check`が成功。Worker version `b7b208c7-68f8-4918-bfd9-b785ef66003d`をstagingへ配備し、公開GETがmaintenance offの既定値を`no-store`で返すこと、未認証PATCHが401となること、後続GETで値が変わらないことを確認した。認証済みPATCH、設定行の作成、maintenance modeの切替は実施していない。Supabaseや本番、ユーザーデータ、ドメイン/DNSにも変更なし。

## Deployed grace-expiry lottery Cron canary (2026-09-26 JST)

Ran `scripts/migration/staging-license-expiry-lottery-smoke.mjs` with
`FANMARK_STAGING_CRON_CANARY=1` against the APAC `fanmark-business-staging`
D1. Preflight verified the 40-table business profile had only its public
`grace_period_days=1` row, the user-owned Auth tables and lifecycle journals
were empty, and retained lifecycle rows could be snapshotted. The script seeded
only synthetic IDs, temporarily changed that public setting to `14`, and
deployed the workers.dev Worker with `LICENSE_EXPIRY_BACKEND=d1`, a unique
target-incarnation/schema digest, a four-page bound, and `* * * * *`.

The deployed scheduled event completed the expiry and lottery finalization.
Exact D1 readback confirmed the old license expired, the single pending entry
won, one active winner license was issued, history and durable seed/input/plan
were stored, the four old access-config rows were removed while the profile
remained, both notification events and an audit row were written, and there
were no conflicts. An initial short wait had no journal; Cloudflare documents
Cron changes can take up to 15 minutes to propagate, so that attempt was
inconclusive. The rerun used a 17-minute bound and succeeded.

The script redeployed immediately from the staging config, whose
`triggers.crons` is now explicitly `[]`, and removed the temporary backend
selector before detailed readback and cleanup. The final exact checks restored
`grace_period_days=1`, all non-settings business tables and lifecycle journals
to empty, the retained lifecycle state to its pre-canary snapshot, and all
Auth user tables to empty. Independent remote readback confirmed zero
fanmarks, settings users, licenses, notifications, audits, expiry/finalizer
runs/items, and effect guards. Cloudflare Settings now reports no Cron trigger;
the current app version `507c5143-0bd5-476a-b29f-22c646db1652` serves `/` with
HTTP 200. This proves one synthetic scheduled execution on staging only; no
Supabase user rows, production resource, or domain/DNS setting changed. It does
not enable recurring Cron or prove populated-user behavior/production CPU fit.

## Supabase schema refresh and notification master seed preparation (2026-09-26 JST)

The earlier “latest Supabase schema waiting for terminal input” status was
incorrect: it described an earlier `db dump` attempt that needed a local Docker
daemon. The current `npx supabase@2.118.0 db query --linked` path uses the
Management API and reads catalog metadata without Docker. The fresh private
catalog contains 40 base tables/406 table columns, 144 constraints, 139
indexes, 15 enum labels, 36 triggers, 77 RLS policies, one view, and 58
functions. The separate 411-column information-schema total includes five view
columns. Converter v4 still has 18 blocking groups; its table and column names
match the checked-in 40-table staging baseline. No application rows were read.

Exported the global notification masters into a private source snapshot and
prepared `scripts/migration/staging-notification-master-seed.sql`: 10 in-app
rules and 40 active in-app templates (10 per locale for en/id/ja/ko). Auth-owned
`created_by` was excluded. Local SQLite rehearsal matched every projected
source field exactly, confirmed repeat safety and a clean FK check, and left
preferences/events/notifications empty. The remote staging D1 still has zero
rows in the master tables. Wrangler remote D1 query/list-migrations returned
Cloudflare API 7403 even though `whoami` confirms the configured account and
`d1:write`; a read-only query in Dashboard D1 Studio succeeded. At this
checkpoint the seed was not applied. The D1 write-path blocker was resolved
later the same day; see the successful application and exact readback below.

## D1 notification event processor local slice (2026-09-26 JST)

Added `workers/api/src/notifications-scheduled.ts` and connected it to the
existing Worker scheduled entrypoint. With the explicit
`NOTIFICATION_PROCESSOR_BACKEND=d1` selector, it claims due events, applies
enabled rules, user preferences, segment filters, cooldown and per-user limits,
renders locale templates with the source function's date-placeholder behavior,
and atomically writes notifications plus the processed event state. Immediate
in-app items are marked delivered; delayed and other channels remain pending
for their channel delivery path. A stale processing claim is bounded to a
10-minute lease before recovery.

The notification D1 suite passes 12/12 and the Worker TypeScript check passes.
Local synthetic tests cover rendered in-app content, immediate/delayed status,
repeat polling, and the disabled selector. At this checkpoint the processor had
not run against remote D1; a later one-shot staging canary is recorded below.
The staging selector remains unset and no Cron trigger is configured. Email and
Web Push delivery, event creation parity, notification archival, and populated-
user CPU/authorization review remain open.

## Remote notification-master seed and exact readback (2026-09-26 JST)

The earlier Wrangler D1 7403 failure was retried from the authorized account;
read-only queries and the staging-only write both succeeded on the exact
`fanmark-business-staging` database ID
`d4bb0c48-f24a-491f-8693-fa393ab0b873`. Before the write, the migration ledger
was confirmed at `0000`–`0005`, and rules, templates, preferences, events,
notifications, user settings, fanmarks, and licenses were all empty. Applied
the two-statement staging seed, which only inserts global templates and rules;
Wrangler reported two executed statements.

`scripts/migration/verify-staging-notification-master-seed.mjs` then compared
all projected rows against the private Supabase master snapshot with source
SHA-256 `900f9f3a00bd5d0e68de541a0ad2a10a47c24def6613b89be69739b34584b3fb`.
Readback matched all 10 rules and 40 templates exactly, with `created_by` NULL.
Preferences/events/notifications, user settings, fanmarks, and licenses remain
zero, and the singleton public `grace_period_days=1` setting was preserved.
The remote notification master-data stage is complete. The processor has also
passed a one-shot scheduled-handler canary against remote staging D1, but no
deployed selector or recurring Cron is enabled; channel delivery and full app
verification remain separate.

A wider table-count audit found the expected six migration-ledger rows, the
50 notification masters, and one public settings row. The access-security
extension also has its singleton policy plus one failed synthetic audit, one
finished reservation, and one resource rate-limit bucket dated 2026-09-25.
These are the documented protected-access canary's digest/counter state, not
source user rows; they were preserved rather than cleared.

## Remote D1 notification processor canary (2026-09-26 JST)

`npm run test:staging-notification-processor-smoke` inserted one random
synthetic user-settings row and one due `favorite_fanmark_available` event in
the exact business staging database, then invoked the Worker `scheduled`
handler locally with `NOTIFICATION_PROCESSOR_BACKEND=d1`. Remote readback
confirmed the event reached `processed`, generated exactly one delivered
Japanese in-app notification with the synthetic fanmark name, and did not
increment retries. Cleanup removed the notification, event, and user-settings
row. All notification event/notification/preference/user-settings counts
returned to zero; the 10 rules, 40 templates, public grace-period setting, and
protected-access state matched their pre-run baselines. Worker tests passed
12/12, Worker typecheck, targeted ESLint, staging SPA build, smoke-script syntax,
and `git diff --check` passed. This exercised a local Worker against remote
staging D1; it did not deploy code, change Cron configuration, or process real
user data. The reusable script is
`scripts/migration/staging-notification-processor-smoke.mjs`.

## Staging Better Auth TOTP and emoji-admin integration (2026-09-26 JST)

Ran `workers/api/test/staging-admin-totp-smoke.mjs` with its explicit staging
write/database/master-roundtrip flags. Against the currently deployed
workers.dev app it provisioned a random synthetic administrator, signed in,
enrolled and verified a first TOTP factor, verified session rotation and
session-bound MFA assurance, then edited a release-protected emoji draft. The
deletion guard returned 409 as required; the script restored the original
draft and read back an unchanged active public catalog/version. It deleted the
synthetic account, factor, assurance, and session; all seven user-owned Auth
tables read back zero. A separate read-only Auth D1 query found the singleton
`mfaGeneration` row intact at generation 6. No actual user credential or factor
was used.

Read-only requests to the same deployed app returned 200 for `/`,
`/manifest.webmanifest`, `/sw.js`, and `/robots.txt`; the manifest identifies
`fanmark.id` with standalone display, and robots disallows indexing. This
verifies deployed asset and PWA-shell routes only; browser installation, offline
operation, signup/email/OAuth, and broad admin workflows remain unverified.
The staging SPA build, Worker typecheck, and targeted ESLint passed. No Worker
deployment, production route, real user data, or domain/DNS setting changed.

## Initial Stripe ingress schema port to local D1 (2026-09-26 JST)

Added a local-only business-D1 migration for Stripe webhook receipts and their
one-to-one durable dispatch rows, a signature-verifying `POST
/api/stripe/webhook` route behind an unset backend selector and signing secret,
and D1 claim/renew/retry lease primitives. It carries over live/test event
uniqueness, redacted normalized JSON, raw-body hashes without raw-body storage,
composite receipt binding, terminal-state rules, and lease/fencing constraints.
A fresh Miniflare D1 integration passes 20/20 cases, including concurrent
duplicate delivery and claim convergence, terminal-state repair, immutable
event conflict handling, valid SDK-signed request handling, stale/invalid
signature rejection, expired-lease fencing, retry transitions, and atomic
rollback on dispatch/receipt write failures. Worker API typecheck, targeted
ESLint, Node 22.6.0 tests, and Wrangler staging dry-run pass.

The D1 migration was not applied remotely; the route was not deployed or
enabled. No processing worker, Stripe API call, Stripe Dashboard change, or
billing effect was added. This is local schema, ingress, and lease evidence only, not
completion of issue #32. Details: [Stripe D1 ingress validation](stripe-d1-ingress-validation.md).
The read-only staging Worker secret inventory contains no Stripe webhook
secret. A read-only remote D1 migration-list call returned error 7403; the
remote ledger therefore remains unrefreshed for this checkpoint.

## Local Stripe Checkout dispatcher and notification-master admin slices (2026-09-26 JST)

Added a D1 extension Checkout endpoint and frontend client behind independent
selectors. It pins the active versioned Master D1 price, derives the caller
from Better Auth, checks license ownership/transfer/grace limits, persists an
intent before calling Stripe, and reuses an open Session with a stable key.
The D1 scheduled dispatcher claims test/live receipts sequentially, applies
extension events, retries transient errors with bounded backoff, and
dead-letters unported subscription/invoice events for review. Four synthetic
Checkout integration cases, five existing/new D1 receipt/application/scheduler
cases groups totaling 30, and five client contracts pass; fake Stripe clients
were used, with no real Stripe request.

Added an MFA-gated admin API/client for listing and editing only global
notification rules and translated templates. DTOs omit `created_by` and
template payload schema; updates compare `updated_at` to prevent stale
overwrites. The initial master-only screen change passed five D1 API tests,
four client contracts, and 13 Better Auth admin authorization tests. This
worktree now also routes manual event creation and event/delivery logs to the
same MFA-gated D1 API; the expanded suites pass six Worker tests and five
client tests. That new route/client slice has not been deployed or remotely
exercised. Details: [Stripe D1 validation](stripe-d1-ingress-validation.md)
and [notification API](notifications-api.md).

The initial R2 inventory confirmed the avatar and cover staging buckets. Since
that read-only inventory, later dated sections document the D1/R2 selectors,
notification Cron, applied business migrations `0006`/`0007`, and synthetic
staging canaries. Those staging changes did not touch Stripe APIs, real user or
Auth rows, production routes, or domain/DNS state. Historical test counts in
the earlier local-only snapshot above describe that earlier checkpoint, not
the current suite.

## Local invitation-code admin API slice (2026-09-26 JST)

Added a separate MFA-gated D1 admin API and frontend selector for invitation
code list/create/update/active-state/delete operations. The Worker creates
random codes when the admin leaves code generation automatic, owns initial
usage fields and creator attribution, returns a DTO without creator IDs, and
uses `updated_at` compare-and-set for edits. Existing user-settings references
prevent deleting a code.

The D1 integration suite passes 5/5; frontend client contracts pass 4/4.
Root/Worker typechecks and focused ESLint pass. `VITE_INVITATION_ADMIN_BACKEND`
and `INVITATION_ADMIN_BACKEND` remain unset for staging because invitation
codes have not been imported. The invitation-mode toggle, signup validation
and consumption, Better Auth signup, and email verification are still on the
existing Supabase path or closed. No remote D1 write, Worker deployment,
production, real user/Auth data, or domain/DNS state changed. Details:
[invitation admin API](invitation-admin-api.md).

## Remote Stripe schema preparation on staging (2026-09-26 JST)

Following successful local Worker/client/migration-data suites, Wrangler
read-only checks showed that only business migrations `0006` and `0007` were
pending on the intended APAC `fanmark-business-staging` database. The existing
lottery table required by the DDL was present. Both additive schema migrations
applied successfully. Remote readback found the six Stripe receipt,
dispatch, intent, application, effect, and lottery-entry tables empty;
`fanmarks`, `fanmark_licenses`, and `user_settings` also remained empty. The
next migration-list query returned no pending work.

The staging Worker was not redeployed, and the Stripe secrets, selectors, and
Cron remain absent. No Stripe API call, production state, real user data, or
DNS/domain setting changed. The empty schema is staging preparation only;
subscription/invoice parity and sandbox transaction rehearsal remain open.

## Transfer-generated notification events through the deployed Cron (2026-09-26 JST)

Extended and ran `scripts/migration/staging-fanmark-transfer-smoke.mjs` on the
current workers.dev staging app. The synthetic owner issued a code, a second
user applied, the owner rejected the request, and the code was reapplied and
approved. The deployed one-minute Cron processed `transfer_rejected`,
`transfer_requested`, and `transfer_approved`, producing exactly one Japanese
in-app notification in `delivered` state for each intended recipient.
The smoke waits up to 90 seconds and fails on failed events, duplicate
notifications, wrong recipients, missing Japanese text, or timeout.

Cleanup removed notifications before events and deleted all synthetic transfer,
fanmark, license, audit, settings, and Better Auth rows. Exact post-run readback
reported zero synthetic business and Auth rows and left the MFA generation
baseline unchanged. Only Cloudflare staging and synthetic users were used;
real user data, production, and domain/DNS state were untouched.

## Return-generated notification events through the deployed Cron (2026-09-26 JST)

Extended and ran `scripts/migration/staging-fanmark-return-smoke.mjs` against
the current workers.dev app. The synthetic account first confirmed an active
transfer code blocks return, then returned its fanmark successfully; D1
contained exactly one `fanmark_returned_owner` event and one
`favorite_fanmark_available` event from the two event-producing paths.

The deployed one-minute Cron processed both events. Each generated exactly one
delivered in-app notification with a Japanese-rendered body and the expected
synthetic fanmark metadata/link. The test waited up to 90 seconds for Cron and
failed if an event became failed or delivery was missing. Cleanup removed the
notification children before events and then removed all associated synthetic
business/Auth rows; exact readback returned zero notifications, events, audit,
fanmark, license, transfer, favorite, discovery, user, account, and session
rows. Read-only master inspection before the run confirmed enabled rules and
active translated templates for both event types. No user data, production
resource, or DNS/domain setting changed.

## All migrated in-app notification rules through deployed Cron (2026-09-26 JST)

Extended `scripts/migration/staging-notification-processor-smoke.mjs` to submit
one synthetic payload for each of the 10 active in-app rules. The staging Cron
processed all events and produced exactly one delivered Japanese notification
per rule, with expected title, recipient, fanmark ID, and zero retries. The
canary cleaned notification/event/settings rows and read back zero; global
notification masters, public settings, and protected-access state were
unchanged. No worker config change or deployment was needed; the Cron remains
enabled for staging.

## Authenticated whois details and R2 staging verification (2026-09-26 JST)

Implemented `POST /api/fanmarks/details` on the integrated Worker. Anonymous
requests use a separate SQL projection that does not select owner identities,
history, favorite rows, or lottery entries. Authenticated requests resolve the
caller from Better Auth and return bounded ownership history plus derived
caller state without user IDs, emails, or license IDs. The staging frontend
selects this route explicitly; the normal build keeps the existing Supabase
RPC and Worker errors do not fall back.

Worker D1 tests passed 3/3; client DTO/fetch tests passed 4/4; frontend and
Worker typechecks and Cloudflare staging build passed. The full Worker package
suite passed 84 tests. Wrangler dry-run showed the split D1 bindings and both
R2 buckets, and remote Business/Auth/Master D1 checks found no pending
migrations. Staging deployed as version
`44d56b91-dbcf-46ce-ac9a-900431b143f9`; readback returned SPA 200, Auth health
200, and a no-store null result for an absent short ID.

The staging registration smoke confirmed the anonymous whois projection
omits history and personal state while a synthetic Better Auth owner receives
one history row and their pending lottery state. Cleanup read back zero
business/Auth rows. The staging R2 profile smoke uploaded, read, and deleted
one synthetic image in each bucket and confirmed both public object URLs
returned 404 after cleanup. These are workers.dev synthetic checks only; no
user-data import, production route, or domain/DNS change occurred.

## Availability rules and registration configuration on staging (2026-09-26)

Seeded four read-only-verified Supabase availability rules into staging D1;
all remained disabled and the source admin UUIDs were omitted. The staging
frontend now uses the Worker admin API guarded by current-session admin MFA;
its live TOTP canary listed the rules, performed a CAS update, rejected a stale
revision, restored the original value, and confirmed all four remain disabled.

Copied only the public `max_emoji_characters=5` system setting after confirming
the key was absent in staging. Readback shows that setting and the existing
`grace_period_days=1`; `system_settings` remains an explicit allowlist rather
than a table-wide copy. The deployed registration Worker reads the configured
maximum from D1. A synthetic staging registration/lottery/details and R2
cover-profile canary passed and cleaned its Auth, business, and object rows.
The registration route also rejects six distinct emoji IDs with
`invalid_emoji_count`. The Worker is version
`00ebddee-9f63-4840-abc8-f00dfe847ff5` at 100% on
workers.dev.

The full Worker package suite passes 88/88; registration D1 tests pass 10/10
and migration-data tests pass 93/93. Frontend/Worker typechecks, rule-admin
client tests 5/5, baseline validation 2/2, CI workflow isolation, targeted
lint, staging build, and Wrangler dry-run pass. Production, real user/Auth
data, Stripe, and domain/DNS remain untouched.

## Public OGP routes on workers.dev staging (2026-09-26 JST)

Added `/a/:shortId` crawler HTML and `/api/ogp-image` SVG generation to
`workers/api/src/ogp.ts`. Metadata uses the shared public D1 access/profile
projection. Published profile names are included only for an eligible,
unprotected profile; protected profile data is not queried. The existing
browser route still serves the SPA. Crawler HTML is `no-store` with
`Vary: user-agent`, and the staging response carries `X-Robots-Tag`.

Deployed Worker version `767ff630-81c2-4b01-bf89-012fc43e8a29` to the existing
workers.dev app. Read-only live checks returned crawler fallback 200, browser
SPA 200, SVG 200, six-character image input 400, root 200, and Auth health
200. The crawler fallback URL used the workers.dev host. No business row or R2
object was written. Local D1 public-access tests passed 13/13, the full Worker
suite 88/88, Worker/frontend typechecks, targeted lint, staging build, and
Wrangler staging dry-run passed. Remote staging has no public profile row, so
live profile-name/protected-profile rendering remains locally verified only.
The production Supabase OGP functions and public domain remain unchanged.

## Emoji-path OGP parity on workers.dev staging (2026-09-26 JST)

Extended crawler metadata to the legacy `/:emojiPath` URL. The Worker resolves
one exact active spelling to its short ID and then reuses the shared public D1
projection; duplicate active spellings fail closed to generic metadata. The
canonical crawler URL uses `/a/:shortId`, while non-crawler browser navigation
continues through Static Assets to the SPA.

Deployed `fanmark-app-staging` version
`4988be1e-5f1b-4839-8f3f-511d0a4238f6`. Live empty-D1 crawler fallback for an
emoji path returned 200 with `no-store`, `Vary: user-agent`, and staging
no-index. A browser-style navigation request for the same path returned the SPA
with 200. Local synthetic D1 verifies canonicalization, duplicate rejection,
protected-profile redaction, HTML/XML escaping, and navigation fallback. The
focused public-access suite passed 13/13; the full Worker suite passed 88/88;
Worker/frontend typechecks, staging build, targeted ESLint, CI isolation,
Wrangler dry-run, and `git diff --check` passed. Staging has no public fanmark
rows, so only generic remote OGP fallback is claimed. No D1 or R2 row/object,
user data, production routing, or domain/DNS setting was changed.

## Snapshot sequence-state rehearsal (2026-09-26 JST)

Snapshot format 4 now records the reviewed `fanmark_events.id` PostgreSQL
sequence definition, exact decimal watermark, and `isCalled` state. Export and
offline verification reject unsupported, missing, extra, or changed sequence
metadata. The local D1 importer seeds and reads back `sqlite_sequence` after
row import; Miniflare confirms the next generated ID for both called and
unused source sequences. The import report records exact source and target
watermarks. The migration-data suite, now including the D1 importer, passes
111/111 with no skips. A final source snapshot still requires event writers to
be frozen because sequence advancement is outside PostgreSQL MVCC. No source
event rows or live sequence values were read and no remote D1/R2 write was
performed; the schema remains `deployable: false` with 18 blocking gates.

## Encrypted snapshot archive rehearsal (2026-09-26 JST)

Added a Git-external backup bundle containing one AES-256-GCM ciphertext and a
small private-mode header. Source paths, table/file counts, and exact file
sizes remain inside the authenticated archive; only total ciphertext size
rounded to 64 KiB is exposed. Restore authenticates the complete ciphertext
before unpacking into a private temporary directory, verifies the snapshot,
and publishes it only after verification. The local D1 importer composes this
restore path and removes its plaintext scratch tree after the import attempt.
Key mismatch, ciphertext tampering, private modes, bundle metadata exposure,
snapshot verification, and synthetic D1 import all pass. The migration-data
suite passes 115/115 with no skips. No live source rows or sequence values
were read, no remote D1/R2 write was made, and the schema remains
`deployable: false` with 18 blocking gates. Operational backup destination,
separate key custody, retention/deletion policy, and restore from a persisted
artifact remain open; a real snapshot remains in the final user-data stage.

## Public access analytics D1 write path (2026-09-26 JST)

Added a Worker `POST /api/fanmarks/access` endpoint and an opt-in frontend
adapter for the existing public short-id access event. The endpoint bounds and
validates input, confirms the active fanmark ID/short-ID pair, resolves the
current active/grace license, and preserves the source's daily user-agent hash
without collecting IP addresses. A single D1 batch gates the five-minute
duplicate window, inserts the raw event, and updates daily device/referrer/type
counts and unique-visitor count atomically. Six concurrent identical synthetic
requests produced one log and one aggregate increment. Worker D1 tests pass
5/5; frontend adapter tests pass 3/3; frontend and Worker typechecks, staging
build, Worker deploy dry-run, CI workflow isolation, and `git diff --check`
pass. The staging selectors remain off because `/analytics` and dashboard
aggregate reads still use Supabase; no staging analytics rows or production
data were written. The raw referral and user-agent retention contract, public
ingress abuse controls, and owner-authorized read API remain open.

## Paired access-analytics staging enablement (2026-09-26 JST)

Follow-up to the local-only writer checkpoint above: added session-scoped D1
read APIs for the analytics page and dashboard, connected both frontend
surfaces, and enabled the writer and readers together in the workers.dev
staging build. The deployed Worker selects `FANMARK_ACCESS_ANALYTICS_BACKEND=d1`
and `FANMARK_ANALYTICS_BACKEND=d1`; the SPA selects the corresponding
`VITE_*_BACKEND=worker` adapters. Production/default selectors remain Supabase.

The synthetic staging smoke wrote one event, suppressed four repeats, checked
owner fanmark/metrics/summary responses and anonymous 401, then deleted its
temporary Auth and business rows. Readback found zero business rows after
cleanup and the baseline masters/settings unchanged. Worker integration tests
passed 8/8; both frontend client suites passed 3/3; frontend/Worker typechecks,
Cloudflare staging build, and `npm run check:ci` passed. App Worker version
`2d23439f-359a-4e0b-8ed2-c91c523dd44f` is active at 100% on workers.dev.
Historical analytics were not copied; abuse controls, retention policy,
populated-user authorization, and production CPU/plan fit remain open. No
production route or domain/DNS setting changed.

## Access-analytics ingress limiter on staging (2026-09-28 JST)

Added a dedicated Cloudflare Rate Limiting binding to the app-staging Worker:
120 requests per client key per 60 seconds. The Worker hashes
`cf-connecting-ip` into a versioned limiter key and never stores the raw IP.
Missing, failing, or malformed limiter responses fail closed before D1 writes;
local tests also verify the 429 path. The staging config remains workers.dev
only and keeps its existing split D1 and R2 bindings.

Worker full suite passed, including the 10 access-analytics tests;
`npm run test:migration-data` passed 172/172; typecheck, staging build,
Wrangler dry-run, ESLint, and CI workflow isolation passed. Deployed staging
version `82413f00-f60e-4a01-aeb0-2a071e01178a` and read back 100% traffic.
The rendered `/analytics` synthetic canary recorded one event, suppressed
four concurrent duplicates, showed total access `1` and unique visitors `1`,
verified both Worker reads and anonymous 401, then independently read zero
synthetic business/Auth rows after cleanup. No historical analytics, real
user data, production routing, or domain/DNS were changed. Raw referrer and
user-agent retention policy, populated-user authorization, and production
CPU/plan fit remain open.

## Rendered WhoIs owner/history staging canary (2026-09-28 JST)

Added `npm run test:staging-fanmark-details-ui` to verify the deployed
`/f/:shortId` details page with the same tightly scoped synthetic fixture used
by the analytics canary. Against staging version
`82413f00-f60e-4a01-aeb0-2a071e01178a`, the authenticated owner page fetched
`/api/fanmarks/details` and rendered the synthetic fanmark plus one history
row. The isolated browser then cleared its session cookie, reloaded the page,
and showed the login prompt with no history rows or owner name. Independent
cleanup readback found zero synthetic business and Auth user/account/session
rows; the temporary Chrome profile was removed. Local details Worker tests
passed 3/3 and the canary script passed syntax and ESLint checks. No real user
data, production route, or domain/DNS state was used or changed. Imported-row
parity and production routing remain open.

## Reference-master editor paired-cutover gate (2026-09-26 JST)

The existing versioned D1 editor is tested, but its writer selector must move
with the Supabase Edge checkout reader because both depend on the same tier
amounts and Stripe IDs. The Edge Function secret and checkout selectors remain
unset. An interim staging deployment briefly included the editor selectors;
no authenticated request or edit was sent. It was immediately replaced by
version `7a2a780d-3fed-476b-a84e-905fc6d29aad` with both editor selectors
unset, leaving the final staging editor on its Supabase path and preserving the
active reference release unchanged.

Admin client tests pass 6/6, reference-master Worker/D1 tests pass 6/6, and the
same-session admin authorization suite passes 13/13. Frontend typecheck, CI
workflow isolation, staging build, and Wrangler dry-run passed. After redeploy,
public masters returned 4 tiers, 4 languages, 5 reserved patterns, and 16
extension prices with `no-store`; the gated admin API returned 503. The
authenticated editor and paired checkout cutover remain open. No user data,
Stripe object, production route, or domain/DNS setting changed.

## Notification admin logs moved to staging Worker (2026-09-26 JST)

`AdminNotificationManager` now selects D1 for manual event creation and the
event/delivery logs when `VITE_NOTIFICATION_MASTER_BACKEND=worker`. The
MFA-gated Worker endpoint accepts only the three event types offered by the
screen, caps JSON input at 16 KiB, returns bounded 100-row logs, excludes
payloads, and returns only an eight-character user ID preview. Six Worker D1
tests and five frontend API contract tests pass; Worker/frontend typechecks,
the full Worker package test command, staging build, Wrangler dry-run, focused
lint, and `git diff --check` pass.

Deployed workers.dev staging version
`938f880d-f3db-46d5-9634-60612e4e2814`. Anonymous reads of both new log routes
returned 401; `/api/auth/ok` and the SPA returned 200. The synthetic
administrator sign-in/TOTP/MFA canary then read 10 rules, 40 templates, and
both logs; before/after notification counts were unchanged and synthetic Auth
rows were removed. Manual event POST passed only the synthetic local D1 test;
it was not called remotely because the staging Cron can process pending events.
No real user data, production route, or domain/DNS state changed.

## Worker Cron schedule separation (2026-09-26 JST)

The Worker now dispatches by `ScheduledController.cron`: `0 0 * * *` selects
the source-compatible daily UTC license-expiry job, while `* * * * *` selects
notification processing and Stripe receipt dispatch. The staging config
contains both triggers and sets `LICENSE_EXPIRY_CRON=0 0 * * *`; it deliberately
does not set `LICENSE_EXPIRY_BACKEND`, so daily lifecycle invocations exit
before opening D1. The expiry canary overrides the lifecycle cron only for its
temporary synthetic run. Unit tests cover default routing, custom test routing,
and unrelated triggers.

Deployed workers.dev version `1413b726-0930-45f4-b779-67865fffa24d`. The
staging TOTP/MFA canary passed on that version, and read-only probes returned
Auth health 200, anonymous admin/log routes 401, and SPA 200. Remote aggregate
readback showed zero licenses, lifecycle runs, notifications, notification
events, and invitation rows. The Worker package test command passes all 152
tests; Worker/frontend typechecks and Wrangler dry-run pass. The new daily
trigger is configured but has not yet fired in production-like operation; the
existing synthetic lifecycle Cron canary remains the runtime evidence. No
license/user row, production route, or domain/DNS state changed.

## Conditional Better Auth email and social-provider wiring (2026-09-26 JST)

The current worktree adds Resend verification and password-reset callbacks,
same-origin HTTPS URL validation, and a capability endpoint that returns only
configured provider names/booleans. Google, GitHub, Discord, and Apple OAuth
are wired behind a separate selector and complete credential pairs. New-user
signup and Better Auth social signup remain disabled; this only supports
pre-existing Better Auth identities. Frontend reset/social actions are shown
only when the Worker reports the corresponding capability.

Local verification passed for auth-email 3/3, auth-social 3/3, auth D1 15/15,
and Better Auth client 13/13. The full Worker suite, both TypeScript checks,
CI isolation check, and Cloudflare staging build passed on Node 22.6.0. No
Resend or OAuth credentials are configured and no mail or provider callback
was executed. Version `bc5ad53e-5f08-492b-81fb-8046c9be9600` is deployed at
100% to workers.dev staging. Live capability readback returned all email and
signup flags false with no social providers; synthetic signup, reset,
social-sign-in, and callback requests returned 403. Auth health returned 200,
anonymous admin session 401, and browser navigations to `/auth`,
`/forgot-password`, and `/reset-password` served the SPA with 200. No real
users, production routes, or domain/DNS settings were changed. See
[auth feasibility](auth-feasibility.md).

## Stripe invoice payment-state projection on D1 (2026-09-26)

Added the additive staging migration `0008_stripe_invoice_projection_staging.sql`
and a D1 runtime for the existing pinned-Basil invoice reconciler. The Worker
re-fetches the source invoice and current subscription/latest invoice from
Stripe under a customer-generation fence. It requires the exact D1 customer
and subscription mapping and never joins by email. One D1 batch updates only
payment-failure fields plus the application ledger, fence, receipt, and
dispatch terminal state. It does not change plan, subscription entitlement,
license, or notification data. Runtime lease checks use the current clock after
provider reads; Stripe requests are limited to 10 seconds with no SDK retries.

Nine Miniflare cases pass for paid/failure/action-required projection, both
stale-event directions, missing mapping, fence contention/recovery, database
rollback followed by retry, scheduled dispatch, a provider call that outlasts
the dispatch lease, and the disabled-by-default scheduled path. The full Stripe
ingress/application/projection suite passes 39/39, Worker typecheck passes, and
the Wrangler dry-run bundles the new runtime. Migration `0008` is applied to the
empty APAC `fanmark-business-staging` database, and Worker version
`68a2e0bf-3236-444c-9c7a-a46294037855` is deployed at 100% to workers.dev
staging. Stripe selectors/API secrets remain unset, so the feature stays
disabled. No Stripe call, user data, production route, or domain/DNS change was
made.

## 2026-09-26 subscription reconciliation staging deployment

PR #41 commit `0ed264a` added subscription deleted handling and guarded Free-plan license returns. Worker typecheck, Stripe integration tests (54/54), staging frontend build, Wrangler deploy dry-run, and `git diff --check` passed. Business D1 migration `0011_stripe_subscription_free_return.sql` was applied and read back before deploy; Wrangler reports no pending migrations.

Workers.dev staging now runs version `cec31381-d388-492d-906c-879b70d03cf3` at 100%. The staging config retains the existing `* * * * *` notification/Stripe-dispatch trigger and `0 0 * * *` expiry trigger. Notification processing remains selected; expiry is disabled because `LICENSE_EXPIRY_BACKEND` is unset. Stripe selectors and Stripe secrets are absent, so webhook GET returns 404 and dispatch stays disabled.

Read-only canaries after deploy returned 200 for `/`, `/robots.txt`, and `/api/auth/ok`, and 404 for `/api/stripe/webhook`. Remote business-D1 readback found zero users, fanmarks, licenses, return batches/items, and notification events. No Stripe API call, real user data, production route, or DNS/domain setting was changed.


## 2026-09-26 Customer Portal D1 API staging rollout

Added an authenticated Worker endpoint for opening Stripe Customer Portal from the profile page. It reads only the signed-in owner’s exact D1 stripe_customer_id, refuses email-based customer search, pins return_url to the allowlisted Better Auth origin at /plans, and validates Stripe’s HTTPS response URL. The client is enabled for the staging build and does not fall back to Supabase on Worker errors.

The endpoint requires STRIPE_CUSTOMER_PORTAL_BACKEND=d1, the D1 webhook/dispatch selectors and signing secret, a matching STRIPE_SECRET_KEY plus test/live dispatcher keys, and a Better Auth session. Those Stripe selectors and secrets remain unset, so POST /api/billing/customer-portal returns 404. Stripe webhook remains 404.

Worker version d895ec75-76fb-457e-a74d-fd8102ff7110 is active at 100% on workers.dev. Post-deploy read-only checks returned 200 for / and /api/auth/ok, 404 for both billing routes. No Stripe call or D1 write occurred. Local verification passed the Stripe Worker suite 59/59, Customer Portal client tests 5/5, both TypeScript checks, staging build, and Wrangler deploy dry-run.


## 2026-09-26 Free-to-paid plan Checkout D1 rollout

Added a Better Auth-owned `POST /api/billing/plan-checkout` path for the
Free-to-paid subscription flow and connected `/plans` to its Worker client in
the Cloudflare staging build. The request is limited to an allowlisted HTTPS
origin and `creator`/`max`/`business` plans. The Worker reads the exact owner's
email from Auth D1, requires one matching free-plan row in business D1, selects
the mode-specific plan Price, and verifies that Stripe returns an active
monthly JPY Price in the same mode. It never searches Customers by email and
does not grant a plan; subscription reconciliation remains authoritative.

Business migration `0012_stripe_plan_checkout_commands.sql` adds a durable
Customer creation fence and owner/plan/Price/mode-bound Checkout command ledger.
An unknown Stripe Customer response is retried with the same provider key; if
the local result remains unresolved past the provider idempotency window, the
route stops for reconciliation instead of blindly creating another Customer.
Repeated requests return the same open Checkout Session, and request UUID reuse
with changed terms fails closed.

The migration was applied only to APAC `fanmark-business-staging` and read back:
both command tables, `user_settings`, and `user_subscriptions` each contain zero
rows; Wrangler reports no pending migrations. Worker version
`a67b6abe-0080-4784-bcf2-87efed59f83a` is active at 100% on workers.dev staging.
Read-only checks returned 200 for `/`, `/robots.txt`, and `/api/auth/ok`, and
404 for Stripe webhook, Customer Portal, and plan Checkout routes. Wrangler's
secret-name list contains no Stripe secret, and no Stripe selector is present
in the staging Worker config, so these billing paths remain closed.

The full Worker package suite, the 116-case migration-data suite, the 8-case
plan Checkout D1 suite, the 6-case frontend client suite, both TypeScript
checks, CI workflow isolation check, targeted ESLint, staging build, Wrangler
deploy dry-run, and `git diff --check` passed. No Stripe API transaction, user
data migration, production route, or DNS/domain change occurred. Paid-to-paid
plan changes and Stripe sandbox acceptance remain incomplete; see the
[D1 plan Checkout contract](stripe-plan-checkout-api.md).


## 2026-09-26 current Supabase catalog / local D1 import rerun

Re-ran the read-only schema catalog query against the linked Supabase project;
the private catalog contains 40 tables, 406 columns, 144 constraints, 139
indexes, one view, 58 functions, 36 triggers, and 77 RLS policies. It was
written outside the repository with mode `0600`; no application rows were
queried. Version-4 conversion still reports 18 unresolved gate groups and
`deployable: false`.

`node scripts/migration/test-d1-import-current-schema.mjs` passed against that
exact catalog using a disposable local D1 and three synthetic rows. All 40
checkpoints completed after injected acknowledgement loss; exact readback,
foreign-key check, transformed synthetic credential, and tampered-coverage
rejection passed. The result remains `public_rows_reconciled`, with
`deployable` and `fullMigrationReconciled` false. No Cloudflare D1, production,
user data, or DNS/domain state changed.


## 2026-09-26 staging lifecycle Cron revalidation

Fixed the opt-in canary's stale baseline checks. It now permits only the
checked-in `* * * * *` notification and `0 0 * * *` lifecycle Cron schedules,
requires the lifecycle execution selector and run bindings to remain unset,
and includes all approved system settings, availability rules, and
notification-master rows in its baseline count. The five configuration tests
and all 121 migration-data tests passed; targeted ESLint and `git diff --check`
passed.

The deployed workers.dev Cron canary completed the synthetic lottery path with
`winner_finalized`, restored the normal staging deployment, and read back the
original grace-period setting and retained lifecycle state. Post-cleanup
business baseline counts matched, lifecycle journals and Auth user tables were
empty, and additional D1 readback found zero plan Checkout command, user,
license, and fanmark rows. Worker version
`a358996e-ce86-4410-be53-40e6f355ee9e` is active at 100%. Read-only HTTP checks
returned 200 for `/`, `/robots.txt`, and `/api/auth/ok`, and 404 for
`/api/stripe/webhook`. The lifecycle backend remains disabled in the restored
configuration; no real user, production, or domain data changed.


## 2026-09-26 paid-plan change command

Added `POST /api/billing/plan-change` and its PlanSelection Worker client for
existing paid subscriptions. The request omits client-supplied current plan,
Customer, Subscription, and Price identifiers. The Worker requires the
Better Auth owner, business profile/customer mapping, one active D1 subscription,
current Stripe subscription/customer/Price, and mode-specific Price settings to
agree. It persists an immutable owner-bound command before Stripe mutation and
uses a unique per-owner open-command slot plus a stable 23-hour idempotency key.
It follows PRODUCT's immediate prorated upgrade, no-proration paid downgrade,
and immediate Free cancellation behavior. A server-side target-limit check
blocks the command until selected license returns are reflected. An SCA/payment
action returns the user to the existing Customer Portal; the PlanSelection
screen resumes profile polling when the user returns. Entitlements are updated
only by the existing signed webhook reconciliation.

Nine Miniflare D1 tests and five frontend client tests passed, covering request
ownership and mode binding, limits before mutation, no direct entitlement
write, upgrade/downgrade/cancel parameters, payment-action fencing, lost
acknowledgement recovery, and competing commands. Frontend/Worker typechecks,
targeted ESLint, CI workflow isolation, staging build, Wrangler dry-run, and
`git diff --check` passed.

Business migration `0013_stripe_plan_change_commands.sql` was the only pending
remote migration. It was applied to the APAC staging business D1; readback
confirmed the command table exists, contains zero rows, and no migrations are
pending. The staging frontend and Worker were deployed with the browser client
selected but with `STRIPE_PLAN_CHANGE_BACKEND` absent and no Stripe secrets.
Worker version `785e5754-21dd-4feb-8903-b0a797821ffb` is active at 100%.
Read-only checks returned 200 for app root, robots, and Better Auth health, and
404 for the disabled plan-change route. No Stripe transaction, user data,
production route, or domain/DNS state changed. Stripe sandbox/integrated
acceptance and other billing commands remain open.

### Staging redeployment and readback

After the portal-return polling fix and command-recovery race check, the full
Worker suite passed, including nine plan-change D1 cases; the five frontend
client cases, both TypeScript checks, targeted ESLint, staging build, and
Wrangler dry-run also passed. The latest app Worker is
`1b8c2bbe-c95d-4037-846a-9a7d67ba932b` at 100%. Read-only probes returned 200
for `/`, `/robots.txt`, and `/api/auth/ok`, and 404 for the plan-change route.
The remote command table remains empty and Wrangler reports no pending business
migrations. Stripe secrets/selectors remain absent; no Stripe call, user data,
production routing, or domain/DNS change occurred.

## Invitation-gated signup staging schema and Worker slice (2026-09-26 JST)

Added a split-D1 signup coordinator for the invitation-required Better Auth
flow. It reserves invitation capacity in business D1, creates the Better Auth
identity in auth D1 with a recoverable command marker, then atomically writes
the required profile and consumes the invitation. Business D1 keeps an HMAC
email fingerprint and command state, never the submitted email or password.
The Worker exposes invitation validation and signup capability only when the
explicit backend selector, Resend configuration, and both schema capabilities
are ready. The staging selector remains absent, so signup stays closed there;
the waitlist form is hidden in Worker mode to avoid new Supabase writes.

Nine dedicated synthetic split-D1 tests passed, including last-slot
competition, email-send retry, lost acknowledgement recovery after auth-D1
commit, and duplicate-email privacy. The full Worker suite passed, including
the 15-test Better Auth D1 suite; the frontend client suite passed 14/14.
Frontend and Worker typechecks, CI workflow isolation, Cloudflare staging
build, targeted ESLint, and `git diff --check` passed. Wrangler 4.135.0 does
not support `--dry-run` on `d1 migrations apply`; the migration SQL was
executed by the local synthetic split-D1 suite, and remote `migrations list`
identified only these two pending files before application.

Applied `0007_auth_signup_command.sql` to `fanmark-auth-staging` and
`0014_invitation_signup_attempts.sql` to `fanmark-business-staging`. Remote
readback confirmed the Auth `user.signupCommandId` column, the business
attempts table plus its two indexes and four guards/consumption triggers, zero
signup-attempt rows, and no pending migrations. Deployed app Worker version
`bd78ddce-b8c4-4a77-ac00-1609bd5f0b04` to
`https://fanmark-app-staging.fanmark-id.workers.dev`; `/`, `/robots.txt`,
`/api/auth/ok`, and `/api/auth/capabilities` returned 200, with capabilities
reporting `signUp: false`. Wrangler secret inventory contains only
`BETTER_AUTH_SECRET`, `REFERENCE_MASTER_SERVICE_SECRET`, and
`VERIFIED_ACCESS_SECRET`; no Resend secret or signup selector is configured.
No invitation records were seeded, no real email was sent, and no user data,
production, or domain/DNS state changed.


## Paired D1 extension pricing UI on workers.dev staging (2026-09-26 JST)

The Cloudflare staging build now selects the public extension-price reader, MFA-protected D1 price editor, and extension-checkout client together. The Worker selects `REFERENCE_MASTER_ADMIN_BACKEND=d1`; the browser checkout client sends requests to the Worker and never falls back to the Supabase Edge Function. Production/default builds are unchanged.

Deployed `fanmark-app-staging` version `691ce686-17fc-4ff3-a96b-371e3f2f5ee5` to workers.dev. Live read-only checks returned 200 for the SPA/auth health and all four public masters. Extension prices returned 16 rows from release `49d582cfc482da61f5394fc83ea9d1bb67820a8d47d493dfdfb74218dd4b4c12`, `Cache-Control: no-store`, and no Stripe IDs. The unauthenticated admin API returned 401. The extension Checkout endpoint returned 404 because the Worker-side Stripe Checkout, webhook, and dispatch selectors/secrets are deliberately absent; the staging checkout client therefore fails closed without calling Supabase or Stripe. No authenticated price edit was sent.

Node 22.6 verification passed: frontend reference-master/admin/extension-checkout contract tests 18/18, Worker reference-master D1 6/6, signed price service 5/5, D1 extension-checkout integration 4/4, Better Auth D1 15/15, root/Worker typechecks, CI workflow isolation, Cloudflare staging build, and Wrangler deploy dry-run. Wrangler deployment succeeded. The existing staging Stripe secret inventory contains no Stripe keys. No D1 price record, user data, Stripe object, production route, or domain/DNS state was changed. At this checkpoint legacy coupon and direct-license-extension paths were still on Supabase; the coupon API moved to staging in the later checkpoint below, while direct license extension remains open.

## Extension coupon application and administration on workers.dev staging (2026-09-26 JST)

Added the Better Auth owner route for coupon redemption and a separate administrator/MFA-protected D1 management route. The redemption is one guarded D1 command insert whose triggers atomically claim coupon capacity, record usage, extend the owned license, cancel pending lottery entries, enqueue notifications, write audit records, and preserve the response for retries. A grace-plan command snapshots the plan setting and rejects stale configuration at insert time; concurrent identical request IDs converge on the same stored result. The admin API lists/creates coupons, uses compare-and-swap for active state, deletes only unused coupons, and returns usage details only after MFA authorization. Default/production frontend selectors remain Supabase; the Cloudflare staging build and Worker select D1 with no fallback.

Business migration `0015_extension_coupon_application.sql` was the only pending migration. It applied to `fanmark-business-staging` (`d4bb0c48-f24a-491f-8693-fa393ab0b873`); remote readback found both triggers, both indexes, the command table, and no pending migrations. Read-only counts after deployment are zero for extension coupons, coupon usages, and application commands. No redemption or coupon seed was performed.

The final Worker version `09cb56d8-e0c2-4a4e-af40-d6506922e9a6` is active at 100% on workers.dev. Read-only probes returned 200 for `/` and `/api/auth/ok`; anonymous coupon application and coupon administration returned 401. No authenticated coupon use/admin mutation, user-data import, production route, or domain/DNS change occurred.


## Admin user directory read APIs (2026-09-26 JST)

Added MFA-gated `POST /api/admin/users` and `POST /api/admin/users/:userId`
read routes. The list joins bounded business-profile candidates to Better Auth
users, session-derived last-sign-in time, license counts, and Enterprise
settings across split D1 bindings. Search includes Auth email as well as
username/display name; candidate overflow fails closed instead of silently
truncating. Detail returns recent licenses, TOTP presence, and recent audit
rows. Audit metadata removes keys that can contain credentials or contact
details, and responses are `no-store`.

The frontend uses credentialed same-origin requests with no cache or redirect,
validates the response contract, and never falls back to Supabase after Worker
selection. Cloudflare staging screen mode is read-only; plan, suspension,
reset-link, and immediate-expiry mutations remain disabled pending their D1/Auth
implementations. Synthetic split-D1 API tests pass 3/3, frontend contract tests
pass 3/3, and both root/Worker typechecks pass. The complete Worker `npm test`
suite and Worker typecheck pass with the API included.

Deployed `fanmark-app-staging` version
`54c932cf-9589-4dc6-9409-7651ba0648a5` to
`https://fanmark-app-staging.fanmark-id.workers.dev`. Read-only smoke checks
returned 200 for `/` and `/api/auth/ok`; an anonymous `POST /api/admin/users`
returned 401 with `no-store`. No authenticated admin session or user-row
mutation was used, and no production route or domain/DNS setting changed.
Plan mutation, suspension, password-reset, and immediate-license-expiry
controls remain disabled in Worker mode; migrate those routes and run an
authenticated staging canary before calling user management complete.

## Auth email-template D1 seed and staging rollout (2026-09-26 JST)

Added the same-origin SPA adapter and MFA-gated D1 list/CAS editor for the four
auth template types, plus Better Auth D1 lookup for verification and password
reset. The runtime selects the user locale from `user_settings`, escapes D1
copy for HTML, and fails closed when the selected D1 template is missing or
inactive. The checked-in staging seed contains 16 allowlisted source master
rows; the readback verifier compares every field with a private row manifest
and confirms core user-owned business tables are empty.

Auth email tests pass 7/7, email-admin D1 tests 4/4 including a concurrent CAS
race, frontend contracts 3/3, and root/Worker typechecks pass. Wrangler identity
matched the intended Cloudflare account. The remote baseline had zero rows in
the four allowlisted template types and zero rows in the checked user-owned
tables. Reconstructing the seed in isolated SQLite reproduced the pinned source
content digest; the seed SQL digest also matched. Applying the seed wrote 16
templates, and the remote verifier confirmed every selected field, all four
types across four locales, and zero user-owned rows.

The Cloudflare staging SPA build and Wrangler dry-run passed. Worker version
`9b1f777e-76e1-4721-8408-1fd44145b4b0` is active at 100%. Read-only probes
returned 200 for `/`, `/robots.txt`, `/api/auth/ok`, and
`/api/auth/capabilities`; anonymous `/api/admin/session` and
`/api/admin/email-templates` returned 401. A synthetic admin completed the
deployed TOTP/MFA flow, read all 16 template rows from the protected API, and
matched every field to a D1 readback; the GET left D1 unchanged. The canary
deleted its Auth rows and verified all user-owned Auth tables returned to
zero. The capability response keeps signup, email delivery, and social
providers disabled. No email was sent, no real user row was copied, and no
production route or domain/DNS setting changed.

## Active-license disabled credential import coverage (2026-09-26 JST)

Verified the checked-in password settings flow: disabling protection calls
`upsert_fanmark_password_config` with `new_password = '0000'` and
`enable_password = false`; the RPC persists both fields, and the UI requires a
new four-digit value when protection is enabled again. Updated the synthetic
D1 importer to hash the exact credential from disabled rows on active
licenses, preserve `is_enabled = 0`, and atomically record `disabled` coverage
with the artifact and checkpoint. Non-active licenses remain fail-closed and
out of this change.

The synthetic full-import regression confirms bcrypt comparison against the
source fixture, no cleartext in target/artifact/coverage, artifact and coverage
readback, and preserved disabled state. Node 22.6.0 validation passed:
`npm run test:migration-data` (121/121), `npm --prefix workers/api run test:lifecycle-schema`
(15/15), Worker typecheck, syntax checks, and `git diff --check`. No source
credentials, remote D1, Worker deployment, production route, or domain/DNS
setting was changed.

## MFA-protected reference-master pricing readback (2026-09-26 JST)

Extended the staging TOTP smoke with a read-only pricing mode. It provisions a
synthetic Better Auth administrator, verifies TOTP/session rotation, and reads
`/api/admin/reference-masters/pricing` under same-session MFA. The returned
release version, generation, all four tier DTOs, and all 16 extension-price
DTOs matched the active Master D1 rows by digest. Anonymous access returned
401; the public price API returned the same release with no Stripe fields.
Read-before/read-after confirmed the active release pointer was unchanged, and
the synthetic Auth identity was removed with all user-owned Auth tables back
at zero. No price master was edited and no Stripe request was made.

Reproduce from `workers/api` with
`node test/staging-admin-totp-smoke.mjs --run-live-staging-write --database=fanmark-auth-staging --reference-master-pricing-readback`.

Node 22.6.0 validation passed: public price client 7/7, admin price client
6/6, Worker reference-master D1 6/6, signed reference-master service 5/5,
Worker typecheck, and syntax/diff checks. The server-side Stripe extension
checkout remains disabled pending its selectors and secrets.

## Admin user directory email search on staging (2026-09-26 JST)

Replaced `LIKE`-pattern email and profile matching with literal, lowercased
`instr` substring matching after the deployed D1 search returned
`LIKE or GLOB pattern too complex` for an ordinary synthetic email. Added a
regression test for literal wildcard characters and a 180-character search.
The focused split-D1 suite passes 4/4; Worker typecheck and staging Wrangler
dry-run pass.

Deployed version `a684314f-2b65-4358-87f2-be97a272850e` to the isolated
workers.dev staging app. The live MFA/TOTP canary verified profile and email
search, the cross-D1 user detail DTO, 401 for anonymous list/detail, and
no-store responses. It removed its synthetic administrator, target Auth user,
profile, and audit rows. Independent remote D1 readback found zero rows in
Auth `user`, `account`, `session`, `verification`, `twoFactor`, `adminRole`,
and `mfaAssurance`, and zero business `user_settings`, `fanmark_licenses`,
and `audit_logs`; the monotonic `mfaGeneration` value remains 1. HTTP probes
returned 200 for `/`, 200 for `/api/auth/ok`, and 401 for anonymous
`/api/admin/session` and `/api/admin/users`.

At that checkpoint, no real user data, production route, email, Stripe request,
or domain/DNS state was accessed or changed. Admin mutations were disabled;
the following staging checkpoint records the plan update that was added later.

## MFA-protected admin plan update on staging (2026-09-26 JST)

Added `POST /api/admin/users/:userId/plan` and connected the admin dialog to
the same-origin Worker client when staging selects D1. The operation checks
both the Auth identity and business profile, then batches the profile plan
change, admin audit insert, and Enterprise override upsert/removal in one D1
transaction. The target D1 table's required `id`, `created_at`, and
`created_by` columns are populated from its default and the authenticated
admin. Invalid negative/non-integer overrides are rejected. The API supports
the `max` option already present in the UI. Audit failure rolls back the plan
and Enterprise setting together.

The D1 suite passes 6/6, Worker/frontend typechecks pass, the same-origin API
client suite passes 4/4, the Cloudflare staging build and Wrangler dry-run pass.
Version `9db2a730-a8e2-49ad-b980-4441368c681e` is active at 100% on
workers.dev. A live TOTP canary changed one synthetic user Free→Enterprise,
read back the exact custom limit, JPY price, notes, and admin actor; changed
the same identity to Max (removing the Enterprise row); and restored Free.
Anonymous plan mutation returned 401. Independent remote D1 readback found
zero profiles, Enterprise settings, audits, licenses, Auth users, accounts,
sessions, factors, roles, and assurances. The monotonic `mfaGeneration`
singleton remains 1.

No email, Stripe request, real user data, production route, or domain/DNS
state was accessed or changed. Suspension, reset-link, and immediate-expiry
operations remain disabled pending their D1/Auth implementations.

## Admin user suspension and restoration on staging (2026-09-27 JST)

Added Auth D1 migration `0008_auth_user_suspension.sql` with Better Auth
compatible suspension fields, a status-audit table, and a session-insert guard.
The Worker activates its suspension hook only when
`AUTH_USER_STATUS_BACKEND=d1`; the status API also fails closed unless that
selector is explicit. The MFA-protected admin route can suspend or restore an
account, revoke its active sessions, validate reason/expiry bounds, and record
the actor and target in the same D1 batch. The admin user screen now uses this
route in Worker mode; password reset and immediate license expiry remain
disabled.

Before applying the schema, a remote read-only preflight confirmed all seven
existing user-owned Auth tables were empty. Only migration `0008` was pending.
It applied to `fanmark-auth-staging` (D1
`2116bc43-32ab-4e3e-b762-9378df88b95f`); remote readback confirmed the three
user columns, the status-audit table, the session trigger, and no pending
migrations. The Workers.dev app was deployed at 100% as version
`2758095a-99fd-4aaf-a1bf-afc441276f05`. The live canary completed synthetic
sign-in, TOTP enrollment, same-session MFA authorization, suspension,
session revocation, status readback, restoration, and audit verification.
Cleanup deleted the synthetic identity and audit rows; independent post-run
readback found all eight user-owned Auth tables empty. The monotonic MFA
generation counter was preserved and may have advanced during factor setup.

Worker `npm test` passed in full, including 18 Auth D1 tests and nine admin
user-management D1 tests. Worker and app typechecks, the five frontend API
contract tests, targeted ESLint, CI workflow isolation, staging SPA build,
Wrangler dry-run, and `git diff --check` passed. Workers.dev `/` and
`/api/auth/ok` returned 200. No Supabase rows, production resources, or
domain/DNS settings were changed. This verifies one synthetic staging flow;
password-reset delivery, immediate expiry, populated-user behavior, the 18
schema gates, integrated rehearsal, production acceptance, user-data import,
and final DNS cutover remain open.

## MFA-protected immediate admin license expiry on staging (2026-09-27 JST)

Added `POST /api/admin/users/:userId/licenses/:licenseId/expire` and connected
the Worker-mode admin user screen. The route requires the same-session admin
MFA assurance, checks that the license belongs to the path user, bounds the
reason, and treats an already-expired license as an idempotent success. One
business D1 batch conditionally changes the license to expired, removes its
basic/redirect/messageboard/password configs, inserts target and admin audit
rows, and queues one `license_expired.v1` event. A failed batch rolls back the
entire operation; production/default routing remains on Supabase.

Worker regression tests cover ownership, anonymous denial, the status and
config changes, both audit rows, notification schema/payload, retry behavior,
and rollback on forced config delete failure. The full Worker suite, root and
Worker typechecks, frontend API client tests, CI isolation check, targeted
lint, staging SPA build, Wrangler dry-run, and `git diff --check` passed.

Deployed workers.dev version `b436c2bc-7f90-40cf-9e89-b116920b405a` is at
100%. The live MFA/TOTP canary suspended and restored a synthetic account,
verified active-session revocation, expired one synthetic active license,
verified four config deletions, both audit rows, one notification event, and
safe repeat behavior, then removed its synthetic rows. Independent readback
found zero user-owned Auth rows, profiles, licenses, favorites, notifications,
user events, expiry audits, and the four config types. Forty-three
license-incarnation tombstones remain as anti-reuse state. No real user data,
production route, email, Stripe transaction, or domain/DNS setting changed.
Password-reset delivery, remaining app/API inventory, integrated rehearsal,
the 18 schema gates, production acceptance, real data import, and domain/DNS
cutover remain open.

## MFA-protected admin password-reset route (2026-09-27 JST)

Commit `094dcdf` adds `POST /api/admin/users/:userId/password-reset` to the
Worker-mode user manager. The route requires the existing same-origin admin
role and same-session MFA checks, resolves the email from Auth D1, and delegates
reset-token creation to Better Auth. The token stays inside Better Auth; the
browser receives only the target ID and request timestamp. A business audit
row records the attempt before calling Resend. The route fails closed with 503
when Resend is not configured and returns 502 if the provider callback fails.
The admin UI now describes the Worker action as email delivery and corrects
its earlier stale read-only banner; the Supabase link-generation flow remains
unchanged.

Synthetic Worker tests cover no-provider 503, MFA denial, mismatched target,
the same-origin header, successful response/audit redaction, and retained
attempt audit after provider failure. A separate Better Auth D1 test stubs the
Resend HTTP call and verifies same-origin reset links without returning the
email or token. The full Worker `npm test` command passes; after the final
query-format adjustment the focused admin D1 suite passes 12/12 and Worker
typecheck passes. Frontend admin API tests pass 7/7; root typecheck, targeted
ESLint, Cloudflare staging build, Wrangler dry-run, and `git diff --check` pass.

Deployed to `fanmark-app-staging` as version
`a4b4886f-9289-435d-b345-843a7b2747a7` at 100% on workers.dev. Read-only live
probes returned 200 for `/` and `/api/auth/ok`; an anonymous synthetic reset
request returned 401/no-store before the handler could read a target or send
email. The staging secret-name list contains no `RESEND_API_KEY` or
`RESEND_FROM_EMAIL`, so no email was attempted and authenticated delivery
acceptance remains gated. No source user rows, production route, Stripe request,
or domain/DNS state changed. PR #41 was updated; `Supabase Preview` remains
skipped by the repository's CI isolation setup.

## Inactive-license credential coverage (2026-09-27 JST)

The source-shaped D1 importer now records credentials for inactive or returned
licenses as `deferred_inactive` using a terminal metadata-only artifact and a
coverage row. It does not hash or persist the source credential in D1 and does
not create a destination password row. Coverage and checkpoint advancement
commit together only while the bound license incarnation/generations remain
inactive and no destination row exists. Replay/readback and final
reconciliation require the exact deferred reason and retain
`fullMigrationReconciled=false`.

The local credential schema/import integration suite passes 11/11, including
an ACK-unknown commit followed by restart, typed readback, and explicit
source/target/deferred row counts. No live source rows, remote D1, production
route, or domain/DNS setting was accessed or changed.

## Integrated synthetic registration rehearsal (2026-09-27 JST)

The registration smoke's initial read-only preflight stopped on the existing
16-row `email_templates` master baseline. The guard now excludes that table
only when all 16 allowed auth templates match the pinned source-content SHA-256;
it rejects extra, missing, duplicate, malformed, or changed rows. The smoke
checks the same digest before and after the canary, so it cannot silently
ignore arbitrary rows by table name. The focused baseline tests pass 3/3.

Ran `npm run test:staging-fanmark-registration-smoke` with Node 22.6.0 against
the isolated workers.dev app and its split staging D1/R2 resources. A synthetic
Better Auth identity completed registration, owner-session checks, R2 cover
upload/public read/owner delete, profile save, lottery apply/cancel, anonymous
and owner details, and expected rejection paths for oversized, duplicate, and
unauthenticated requests. Cross-owner and wrong-bucket image paths were also
rejected. The 16-row email-template baseline matched the exact digest both
before and after the run.

Cleanup read back zero rows across ordinary business tables, zero synthetic
Auth users/accounts/sessions, and an absent R2 canary object. The run sent no
email, made no Stripe call, and touched no Supabase source rows, production
route, or domain/DNS setting. Targeted Node tests (3/3), ESLint, and
`git diff --check` passed. This closes one integrated staging path, not all of
#37: billing sandbox, broader source-event coverage, production acceptance,
the 18 schema gates, user-data migration, and domain cutover remain open.

## Plan and general system settings on staging (2026-09-27 JST)

Added a same-origin Worker adapter for plan selection, plan administration, and
invitation-mode settings. The public route returns a fixed 17-key projection;
the admin route returns the two private Enterprise values only after
Better Auth administrator and same-session MFA authorization. Admin edits use
validated values, a stale-value guard, an atomic D1 update/audit batch, and
readback. The audit contains the setting key but no previous or new value.
Worker failures do not fall back to Supabase, and production/default builds
remain on the Supabase selector.

Exported only the exact 18-key non-user plan/pricing/feature allowlist from
Supabase, stored the source artifact outside the repository with mode 600, and
applied it to staging business D1. The exact D1 readback matched the pinned
source digest
`d1f809c44dcc26152acb3432907e1cad81a599d495fd9f3e48b75ea1e3beb16f`. With the
separate `grace_period_days` and `max_emoji_characters` rows, staging has the
expected 20-row settings manifest. No user or Auth data was included. The
staging script was made idempotent for a previously applied, exact digest so a
retry verifies instead of inserting again.

The SPA/Worker deployment is active at 100% on the isolated workers.dev app as
version `3310b139-f639-4cf2-8a15-ad2b63f9fbd6`. Live checks returned 200 for the
SPA and public settings API, 200/no-store with exactly the expected 17 public
keys, and 401/no-store for anonymous admin settings access. Public setting
values were not printed. Migration-data tests passed 124/124, Worker settings
tests 5/5, client contract tests 4/4, both typechecks, staging build, and
Wrangler dry-run passed. A synthetic Better Auth administrator then completed
TOTP/MFA authorization, read the 19-key admin projection, updated
`free_fanmarks_limit`, read the change back, rejected a stale update, restored
the original value, and verified that both audit rows contain only the setting
key. Cleanup removed the synthetic audit and Auth rows. This exercised the API
directly, not the UI in a browser. Stripe sandbox acceptance, broader
integrated #37 coverage, production, user-data import, and domain/DNS remain
open. Post-canary Auth readback found zero user-owned rows; the monotonic
`mfaGeneration` singleton reads 60 and remains retained by design. See
`system-settings-api.md`.

## Authenticated subscription display through D1 on staging (2026-09-27 JST)

Added read-only `GET /api/me/subscription`. It derives the owner ID from the
Better Auth session and reads only that user's latest `user_subscriptions`
projection from business D1. The DTO excludes Stripe customer/subscription
IDs. The Cloudflare staging build selects the Worker path for the subscription
hook; it no longer calls Supabase `check-subscription`, reads the Supabase
table, or opens a Supabase Realtime subscription in that mode. It refreshes on
focus/visibility and explicit refetch. Stripe state is not fetched or mutated
by this endpoint; the Worker billing projection remains gated on sandbox
acceptance. Default and production builds retain the existing Supabase path.

Client and Worker API contract suites pass 4/4 and 3/3, respectively. Root and
Worker TypeScript checks, focused ESLint, CI workflow-isolation check, staging
SPA build, and Wrangler 4.139 dry-run passed. The new staging deployment is
Worker version `7da3ee3b-62af-45ca-8c92-be5a5d14b2b5` at 100%. The SPA returned
200; an anonymous request to the new endpoint returned 401/no-store with the
allowed staging origin. No subscription row, user/Auth data, Stripe object,
production route, or domain/DNS setting was written or changed. This validates
the anonymous boundary and synthetic API contracts, not an authenticated
browser view or a Stripe sandbox flow.

### Authenticated projection recheck (2026-09-28 JST)

The new `scripts/migration/staging-subscription-display-smoke.mjs` exercised
the deployed endpoint with a synthetic Better Auth user, an owner subscription,
and a decoy subscription under another synthetic user ID. The endpoint first
returned an empty result, then returned only the signed-in owner's projection
without Stripe IDs. A second authenticated GET reflected a D1 period/amount
update, and the `no-store` header remained present. Cleanup independently read
back zero synthetic Auth and subscription rows. This is live API evidence, not
a browser proof of the 30-second foreground poll; no Stripe API, real user,
production, or DNS/domain state was involved.

## Profile username availability on D1 staging (2026-09-27 JST)

Added `GET /api/me/username-availability?username=...`. The Worker requires a
Better Auth session, derives the excluded owner ID from that session, and reads
only an availability boolean from business D1. Duplicate or unknown query
parameters, oversized input, unsupported methods, unauthenticated callers, and
untrusted origins fail closed. The client selects this route under the existing
`VITE_PROFILE_BACKEND=worker` selector and does not fall back to Supabase.
Production/default selectors remain Supabase; this endpoint does not reserve a
username or write user data.

The local Worker integration test verified self-exclusion, another synthetic
user's taken name, case-insensitive candidate input, empty-name behavior,
authentication, backend selection, and request validation. Frontend contract
tests verified cookie credentials, same-origin checks, strict response shape,
and no retries after errors. Both dedicated suites pass (Worker profile D1
8/8, frontend 6/6), the full configured Worker test command passes, both
TypeScript checks pass, focused ESLint and CI workflow isolation pass, and the
Cloudflare staging SPA build and Wrangler dry-run pass. All three remote staging
D1 databases report no pending migrations.

Staging version `6572c37d-3d8c-4bf1-89a6-6a131dc4bb09` is active at 100% on
`https://fanmark-app-staging.fanmark-id.workers.dev`. Live checks returned 200
for the SPA and Better Auth health endpoint, 401/no-store for an anonymous
username lookup, and 400 for a caller-supplied `userId`. The profile/R2 smoke
then used one disposable synthetic account: its existing username and a new
candidate both returned available, while the anonymous route returned 401.
The smoke uploaded/read/deleted one synthetic object in each R2 bucket and
verified profile/Auth row counts returned to zero and both object URLs to 404.
Its preflight was updated to validate the exact pinned 16-row auth-email-master
digest before excluding that approved non-user baseline from the empty-business
check. The earlier preflight stopped before writes when it incorrectly counted
those master rows as user data. No real user/Auth rows, production routes,
Stripe objects, or custom-domain/DNS settings changed. See
`own-profile-api.md`.

## MFA-authorized manual notification event on staging (2026-09-27 JST)

Extended the explicit staging TOTP smoke with an opt-in
`--notification-manual-event` action. Before writing, it requires empty
notification event, delivery, and profile tables, plus the pinned staging
Auth/business D1 targets, notification processor selector, and one-minute Cron.
The anonymous manual-event POST returned 401 and created no row. A synthetic
Better Auth administrator then completed TOTP and same-session MFA
authorization; its manual `favorite_fanmark_available` POST returned 201 and
the event log omitted payload contents.

The workers.dev Cron processed the event and created exactly one delivered
Japanese in-app notification for the synthetic recipient. The smoke deleted
the notification before the event, then removed the synthetic profile and
Auth identities; readback confirmed event, notification, profile, and all
user-owned Auth tables were empty. The retained MFA generation counter was
preserved. The run used
`node workers/api/test/staging-admin-totp-smoke.mjs --run-live-staging-write --database=fanmark-auth-staging --notification-manual-event`.
The focused notification-master D1 suite passes 6/6 and the smoke script
passes `node --check`. No real user data, production resource, or domain/DNS
setting was touched.

## Persisted encrypted snapshot restore across processes (2026-09-27 JST)

Added a synthetic migration-data regression that writes a valid encrypted
snapshot bundle to a private on-disk directory, then starts a separate Node
22.6 process with the test-only key supplied through its environment. The fresh
process authenticates the ciphertext, verifies the snapshot manifest and row
hashes, reads back the synthetic row marker, and deletes the plaintext restore
directory before exiting. The parent verifies that the bundle still contains
only `bundle.header.json` and `snapshot.aesgcm` and that the restored directory
is gone. This proves local process-boundary recovery from persisted files; it
does not prove external backup storage, independent key custody, destination
ACLs, retention/deletion, or production restoration.

`node --test scripts/migration/test-snapshot-encryption.mjs` passes 4/4. The
full `npm run test:migration-data` suite passes 125/125 with no skips. No live
Supabase rows, remote D1, R2 objects, production resource, or domain/DNS state
was read or changed.

## Private R2 destination round-trip for synthetic encrypted backup (2026-09-27 JST)

Created the dedicated `fanmark-migration-backups-staging` R2 bucket in APAC
with Standard storage class. Wrangler identity matched the migration account;
the bucket was absent before creation. Readback confirms `r2.dev` public access
is disabled, no custom domain is attached, the bucket is not bound to the app
Worker, and object count/size returned to zero after the canary.

Added the opt-in
`scripts/migration/test-snapshot-r2-staging.mjs` round-trip. It refuses remote
writes without the exact bucket and explicit staging flags, verifies account,
bucket location/emptiness/privacy, builds a one-row synthetic snapshot, and
uploads only the encrypted header and ciphertext. It downloads both objects,
compares SHA-256, authenticates and verifies the restored snapshot, checks the
synthetic row marker, removes the plaintext restore tree, deletes each R2
object, and confirms missing-object reads plus a zero-byte bucket. The successful
run reported two encrypted objects uploaded/read back and deleted, with one
synthetic source row restored. No real source data was read or copied.

This closes a synthetic staging destination round-trip only. Independent key
custody, least-privilege destination credentials, retention/deletion policy,
production backup destination, and real-user/Auth/Storage backup remain open.
The R2 bucket is intentionally left empty and unbound. No Worker deployment,
production resource, or domain/DNS setting changed.

## Authenticated reference-master editor staging canaries (2026-09-27 JST)

Added explicit opt-in actions to the existing staging MFA smoke. Each refuses
to run without the exact staging Auth D1 name and live-write flag, requires all
Auth-owned tables to start empty, verifies zero business fanmarks/licenses,
and checks the active 29-row reference release and Tier C perpetual baseline.
The canary uses the deployed Worker API with a synthetic TOTP administrator;
it does not write directly to Master D1.

The Tier C canary rejected anonymous writes with 401, changed only Tier C from
null to one day, read back all four reference masters (4 tiers, 4 languages,
5 reserved patterns, 16 extension prices), rejected a stale-release write
with 409 without advancing the pointer, then restored Tier C to null through
the MFA-gated editor API. Canonical reference-master values matched after
restoration, apart from the expected release and edited-row updated_at changes.
A separate extension-price canary changed the active tier-1 one-month
price from ¥500 to ¥501, rejected anonymous and stale-version writes, then
restored ¥500. The public extension-price read returned the restored value
under the current release; canonical comparison confirmed all other
master values and both Stripe IDs were unchanged. The editor used
compare-and-set and wrote append-only activation history. The active release
is generation 8 with Tier C null and the extension price restored. The MFA
generation singleton remains monotonic.

The first run found a test-harness cleanup omission for the synthetic target
user/profile. Those exact example.invalid rows were deleted and read back at
zero, the cleanup condition was corrected, and the repeated Tier run plus the
extension-price run completed with zero Auth users, accounts, sessions,
verifications, factors, admin roles, assurances, status-audit rows, business
profiles, fanmarks, and licenses.

The Worker reference-master API suite passed 6/6, reference-master service
suite 5/5, frontend admin client suite 6/6, Node 22.6 syntax validation, and
git diff whitespace validation. The two live action flags were
--reference-master-tier-roundtrip and
--reference-master-extension-price-roundtrip. No Supabase data, production resource, Stripe
resource, real user-owned row, or domain/DNS setting was changed. The browser
click path, Stripe checkout, and production selectors remain unverified.

## Auth email-template edit/restore staging canary (2026-09-27 JST)

Added the standalone `--auth-email-template-edit-roundtrip` action to the live
MFA smoke. Against the deployed staging Worker it read all 16 allowlisted
templates, rejected an anonymous PATCH (401), changed the Japanese signup
subject through the admin API, rejected a stale `updated_at` PATCH (409), then
restored the original subject, body, and button label. Final D1 readback
confirmed all 16 contents and non-editable fields matched baseline; the
Japanese signup row's `updated_at` advanced as expected. Both synthetic audit
rows and the temporary Auth identity/profile were removed and verified absent.
The staging secret-name list has no Resend key or sender identity, and the
admin template API does not call mail delivery; no email was sent.

The first live attempt exposed a test-harness omission in the shared target
cleanup condition. The exact synthetic target rows were manually removed and
read back at zero, then the harness was fixed and the full live canary passed.
The Worker D1 API tests passed 4/4; the frontend API client tests passed 3/3;
Node syntax and `git diff --check` passed. No user data, production route,
Stripe state, or domain/DNS configuration changed.

## Public waitlist signup on staging (2026-09-27 JST)

The staging SPA now explicitly selects the Worker `POST /api/waitlist` route.
New and duplicate addresses return the same 202 acceptance payload; the route
validates/normalizes the address and writes only split business D1. Staging has
a 120-request/60-second Cloudflare Rate Limiting binding. The production/default
selector remains Supabase.

The live synthetic canary used a randomized `example.invalid` address and
marker. It verified the allowed-origin preflight, rejected an untrusted origin,
accepted the first and duplicate submissions with identical payloads, read
back the normalized `waiting` row, deleted that exact row, and confirmed the
staging waitlist returned to zero. The app root returned 200/noindex and the
deployed JavaScript SHA-256 matched local `dist-staging`. Worker and app CI run
`36272821613` passed. Full Worker tests, typechecks, staging and standard app
builds, migration-data tests, and targeted lint passed locally as well. No
email was sent, real waitlist data was imported, or production/DNS setting was
changed. The live proof and selector contract are recorded in
[`waitlist-signup-api.md`](waitlist-signup-api.md).

## Staging expiry/lottery Cron baseline and cleanup correction (2026-09-27 JST)

The one-shot deployed Cron canary now accepts the 16-row localized
`email_templates` master baseline. An earlier preflight stopped before seeding
because the live digest included `updated_at`, which had advanced during a
successful MFA edit/restore. The check now pins template identity/content while
ignoring only that mutable timestamp; the full snapshot and seed digest still
include every field. A regression test verifies timestamp tolerance and rejects
a changed body.

The next scheduled run finalized one synthetic expiry/grace/lottery path and
emitted the two expected in-app notifications. The first cleanup check found
those two derived rows after source events and test users were removed. Exact
synthetic IDs and a zero-row preflight isolated them; only those two rows were
deleted and global notification count returned to zero. The harness now cleans
them before deleting their source events. A full rerun completed with
`winner_finalized`; the grace-period setting was restored, synthetic business
rows, notifications, events, lifecycle journals, and user-owned Auth rows all
read back at zero, and the 45 pre-existing incarnation tombstones were
unchanged. The temporary schedule and expiry selector were restored to the
disabled lifecycle baseline. The restored Worker is
`243e68a0-df6a-4e7c-b290-1ec20bdd2005` at 100%. No email, Stripe action,
production route, real user data, or DNS setting was touched. This proves only
one synthetic staging scheduled execution; recurring lifecycle activation and
production acceptance remain open.

## Plan-route browser review and auth-gate follow-up (2026-09-27 JST)

The deployed workers.dev home and `/auth` pages rendered in a real browser. A
direct `/plans` visit displayed the generic `errorNoProfile` screen, but the
embedded browser's auth state was not independently isolated, so this does not
prove anonymous behavior. Both `/plans` and the `/plan` alias now use
`ProtectedRoute`, and the route contract is recorded in `docs/ARCHITECTURE.md`.
Node 22.6.0 frontend typecheck, staging build, targeted ESLint, and Wrangler
dry-run passed. A local preview in the same browser profile still displayed
the generic page; the route behavior therefore remains unverified. The route
change is local only: Wrangler could not read macOS Keychain (exit 51), and the
OAuth consent page opened in Chrome under a different Cloudflare account than
the intended staging account. No consent was submitted and no deployment
occurred. Re-deploy and repeat the route check with a fresh unauthenticated
browser profile after the intended Cloudflare account is active in Chrome.
Production, user data, Stripe, and domain/DNS were untouched.

## Verified-unused extension coupon master seed (2026-09-27 JST)

A fresh repeatable-read, read-only Supabase projection selected only coupon
definition fields for rows with `used_count = 0` and no matching usage row. It
returned four definitions with zero source usage rows. A separate aggregate
reported eight definitions total, four consumed definitions, 20 usage rows,
and two definition/use-count mismatches. The consumed records and all usage
history remain outside this staging operation for later user-data reconciliation.

The guarded seed imported only the four verified-unused definitions to
`fanmark-business-staging`, omitted `created_by` and stored it as NULL, then
verified exact D1 readback against source digest
`6472e758c2896f8f83bf5a48da5a3c038b24651e5278866b177231412dda3d79` and zero
staging usage rows. The first Wrangler file execution included progress text
before its JSON result; a read-only check proved the four-row seed had
completed, the result parser was corrected, and a second apply invocation
verified the existing baseline without another write. The private export and
SQL stayed mode 0600 outside Git; no coupon code values were logged.

Staging empty-baseline checks now require this exact coupon digest and zero
usage rows before excluding the four master rows. The migration-data suite
passed 153/153 with Node 22.6.0 and serial test execution; the targeted
coupon/baseline tests passed 7/7, syntax checks and `git diff --check` passed.
No coupon history, license, user, production route, or domain/DNS state was
changed. This seeds only unused master definitions; it does not claim coupon
parity or complete the deferred user-data phase.

## Staging baseline and profile canary follow-up (2026-09-27 JST)

The email-template baseline now verifies both the 16 auth templates and 12
broadcast templates from one read-only D1 query, checking each pinned content
digest and total table count. Live staging readback returned `seeded` with
16 + 12 = 28 rows. The related baseline/coupon unit tests passed 8/8, and the
complete migration-data suite passed 154/154 with Node 22.6.0 using serial
execution.

The staging notification processor, registration/lottery, owner-settings and
password, and R2 profile/storage canaries passed. The R2 run verified anonymous
upload rejection, owner upload and deletion, public object reads, avatar and
cover-image paths, then confirmed Auth/business synthetic rows were zero and
both objects returned 404. The analytics canary suppressed four concurrent
duplicate events, rejected anonymous reads, returned owner-only aggregates,
and cleaned all synthetic rows. The license-return canaries verified transfer
blocking, grace transition, owner/favorite notifications, full transfer
approval, partial bulk return (207), and complete bulk return (200). The bulk
canary removed transient rows and restored access/MFA state; two synthetic
license-incarnation tombstones remain intentionally as security history. The
transfer and single-return notification canaries delivered localized Japanese
notifications. No email was sent, and no production routing, real-user data,
or domain/DNS state changed. Remaining schema gates, integrated rehearsal,
mail delivery, production acceptance, user-data migration, and domain cutover
are still open.

## Authenticated admin user-management browser read canary (2026-09-27 JST)

On staging Worker version `8619222a-dba4-44b4-b085-685c69455c4f`, an isolated
synthetic Better Auth administrator completed the same-session TOTP/MFA flow,
opened `/admin` → user management, and read a synthetic target's directory row
and detail drawer. The browser rendered the target's Free plan, active status,
registration time, and zero license counts. No plan, suspension, or password
reset action was invoked; the reset screen explains that a staging Resend
configuration is required. This verifies the authenticated browser read path
end to end, not broad admin acceptance.

After the browser check, exact synthetic rows were removed from the split
staging databases. Before cleanup, Auth D1 held two synthetic users, one
credential account, two sessions, one TOTP factor, one admin role, and two MFA
assurance rows; the verification and suspension-audit tables had no matching
rows. Business D1 held two synthetic profiles and two audit rows, with no
Enterprise override. Final readback showed zero rows across the Auth user,
account, session, verification, two-factor, admin-role, MFA-assurance, and
suspension-audit tables, and zero matching business profile, Enterprise, and
audit rows. The monotonic `mfaGeneration` marker was retained and may have
advanced when the test factor was removed. Temporary synthetic credentials and
scripts were deleted. No real user data, production route, email, Stripe action,
or domain/DNS setting was used or changed.

## Cloudflare staging frontend selector audit (2026-09-27 JST)

Strengthened `scripts/migration/test-staging-selector-coverage.mjs` to verify
all 43 typed frontend backend selectors are explicitly assigned by the
Cloudflare staging build, referenced by frontend implementation code, and do
not select Supabase. The only non-Worker modes are the disabled destructive
data-reset screen, the D1-native reference-master editor, and the R2-native
Storage client. The two selector tests, CI workflow-isolation check, frontend
typecheck, and Cloudflare staging build passed under Node 22.6.0. The build
completed locally; this guard change was not deployed and does not replace
runtime UI acceptance or resolve the remaining migration gates.

## Manual lifecycle batch route (2026-09-27 JST)

The staging admin expiration button now selects a same-origin Cloudflare API
instead of calling Supabase when `VITE_LIFECYCLE_RUN_BACKEND=worker`. The new
`POST /api/admin/license-expiry/run` requires Better Auth administrator access
with the existing same-session MFA assurance, accepts no body or query, uses
the business D1 binding, and returns bounded aggregate counters without run,
license, or user identifiers. It invokes the same D1 lifecycle engine as the
scheduled job under a request-local `LICENSE_EXPIRY_BACKEND=d1` override; the
manual server selector `LIFECYCLE_RUN_BACKEND=d1` is separate from and does not
enable the Cron selector. Staging's frontend selects Worker, but the currently
deployed server selector remains unset, so requests still fail closed with 503
and never fall back to Supabase. The staging config now enables the manual
route with the exact D1 target/schema profile and a four-page cap while leaving
`LICENSE_EXPIRY_BACKEND` unset. The ordinary frontend build still calls the
existing Supabase function.

Client contract tests pass 4/4 and Worker handler tests pass 5/5, including MFA
denial, origin/method/body checks, zero-byte request-stream handling,
unset-selector behavior, split-D1 selection, identifier stripping, sanitized
failures, and continuation status. Frontend and Worker typechecks, focused
ESLint, all 160 migration-data tests, the full Worker test command, CI
workflow-isolation check, and staging build pass. The
staging Worker was deployed as version
`28e7ca3c-f610-47a4-aea9-f876bd8c3f11` while leaving both lifecycle selectors
unset. Wrangler's secret-name readback also showed no manual lifecycle
selector. The served JavaScript asset is byte-for-byte identical to local
`dist-staging` (2,493,527 bytes, SHA-256
`13582571ce98753679585bef629f57ec03d96534d3095f2ec3d60de70ed97778`). Root
returned 200/noindex and a cookie-less POST to the new route returned 401
`unauthenticated`; no authenticated request or lifecycle execution was sent.
The new staging selector guard (3/3), license-expiry integration/source suite
(25/25), scheduled lifecycle suite (8/8), lifecycle schema suite (16/16),
Worker typecheck, and Wrangler staging dry-run pass. The first local
source-suite attempt exposed a test call that accidentally reused the
target-profile import options while asserting the generic credential guard;
the test now explicitly exercises the generic path.

Staging deployment `4988d9d0-b4ec-44d1-9ccc-00ac501aac36` enables only the
MFA-protected manual lifecycle route. The scheduled `LICENSE_EXPIRY_BACKEND`
selector remains absent while both Cron schedules stay configured. The first
live call exposed that the edge runtime can represent an empty POST as a
zero-byte stream; the handler now reads only until EOF or the first byte with
a one-second bound. Its synthetic authenticated canary then returned HTTP 200
with zero candidates in both phases and aggregate-only results. Exact target,
digest, status, and counters were read back from both run journals before
cleanup. Post-cleanup D1 reads found zero profiles, fanmarks, licenses,
lifecycle journals/items/guards, and user-owned Auth rows (`changed_db=false`,
`rows_written=0`). No user data, email, Stripe call, production route, or
domain/DNS setting was changed. The first 400 response performed no lifecycle
writes.

## Fresh schema refresh and descriptor-aware synthetic rehearsal (2026-09-27 JST)

Re-ran `scripts/migration/schema-readiness.sql` through the linked Supabase
CLI at `2026-09-27T09:40:27Z`. The query returned schema metadata only; no
application rows were read. The CLI wraps the catalog under
`rows[0].jsonb_build_object`, so the private result was unwrapped before
running the converter with the value-free credential descriptor. The current
catalog still contains 40 tables, 406 columns, 144 constraints, and 139
indexes. Conversion remains `deployable=false` with 18 blocking groups: 10
row-conversion groups (227 locations) and 8 schema/operation groups (101
locations).

Under Node 22.6.0, `scripts/migration/test-d1-import-current-schema.mjs`
passed against the refreshed catalog. It imported four generated synthetic
rows, completed checkpoints for all 40 tables, reconciled public rows, and
rejected a conflicting replay. The output correctly keeps `deployable` and
`fullMigrationReconciled` false while schema gates remain. Catalog, descriptor,
generated DDL, and conversion report were stored as mode-0600 `/tmp` artifacts
and are not part of the repository. No Cloudflare D1, source rows, user data,
production route, or domain/DNS state was changed.

## Stripe migration contract validation in CI (2026-09-27 JST)

The isolated `experiments/stripe-receipts` suite passed 90/90 under Node
22.6.0, including PGlite execution of the PostgreSQL receipt, invoice, and
extension transactions; its TypeScript contract check also passed. Two stale
assertions were corrected: a bigint beyond JavaScript's safe integer range is
expected to remain exact decimal text through import, and the transfer-lock
fixture now uses a future timestamp instead of depending on the current date.
These changes do not relax the application-facing bigint gate.

The Cloudflare migration validation workflow now installs this isolated test
package and runs its tests and typecheck. The workflow-isolation check passed
locally. The existing Supabase Webhook still applies subscription and invoice
events outside the full durable reconciliation path; this validation does not
complete issue #32, deploy or apply any Supabase migration, or call Stripe.

The GitHub run `36311114955` completed the Worker job, but its Stripe test step
remained in progress for more than 13 minutes. Running the same 90-test suite
with Node's default file parallelism had completed locally, while an explicit
`--test-concurrency=1` run completed 90/90 in about 16 seconds. The package test
script now serializes test files to reduce resource contention on hosted
runners without skipping coverage. Follow-up GitHub Actions run
`36311897378` passed both `Validate Cloudflare Worker API` and
`Validate Cloudflare staging application` jobs.

## Admin user-management synthetic staging acceptance (2026-09-27 JST)

With Wrangler authenticated to account `bfc2890741f0b3fb236e2d755b6c9adc`,
ran from `workers/api` under Node 22.6.0:

```sh
nodenv exec node test/staging-admin-totp-smoke.mjs \
  --run-live-staging-write \
  --database=fanmark-auth-staging \
  --admin-user-management-readback \
  --admin-user-plan-readback \
  --admin-user-status-readback
```

The script verified the staging target and empty Auth user-owned tables, then
created one synthetic MFA administrator and one synthetic target. The deployed
Worker passed same-session TOTP authorization, cross-D1 list/detail reads,
anonymous denial, Enterprise → Max → Free plan changes with exact override
readback, suspension/restoration with session revocation, and immediate license
expiry with configuration removal, lifecycle/admin audit, notification enqueue,
and repeat safety. Cleanup removed both synthetic identities, sessions,
profiles, license/config rows, notification, and canary audits; final readback
found all user-owned Auth tables empty and the deleted administrator session
unusable. A separate remote read-only aggregate query then returned zero
profiles, Enterprise overrides, fanmarks, licenses, four license config types,
notifications, and admin-expiry notification events (`changed_db=false`,
`rows_written=0`). The monotonic MFA generation marker was preserved and may
have advanced.

This was staging API acceptance only. No real user row, production route,
Resend/email, Stripe request, or domain/DNS state was touched. Admin browser UI
review, password-reset delivery, broader issue #34 acceptance, and integrated
issue #37 recovery drills remain open.

## Admin authorization D1 read consolidation and CPU sample (2026-09-27 JST)

Commit `4a6dd0a` preserves the admin-role check as the first authorization gate,
then reads `twoFactorEnabled`, up to two verified factor IDs, and the
user/session-bound MFA assurance row in one D1 query. It retains the exact
single-verified-factor, same-session, same-factor, and unexpired-assurance
requirements. A regression test confirms that multiple verified factors remain
denied.

Node 22.6.0 verification passed: the focused Auth D1 suite (20/20), complete
Worker test chain, Worker typecheck, `npm run check:ci`, Cloudflare staging
build, and staging-config Wrangler dry-run. The non-staging Worker dry-run also
passed. GitHub Actions run `36316557175` passed its Worker job; the application
job was still running its isolated Stripe contract step when this entry was
written.

Worker version `1ae4ffb0-5af5-4b19-8759-f79cc201b45a` was deployed to
workers.dev staging at 100%. Anonymous `/api/admin/session` returned 401. The
synthetic TOTP admin canary passed same-session authorization and cross-D1 user
list/detail reads; cleanup removed its Auth, profile, and audit rows, and final
readback found the user-owned Auth tables empty. The monotonic MFA generation
counter was preserved and may have advanced. No D1 schema, production route,
real user data, email, Stripe, or domain/DNS state changed.

Wrangler tail recorded CPU/wall samples of 4/83 ms for an authorized admin
session (200), 50/161 ms for its pre-enrollment gate (403), and 2/2 ms for an
anonymous admin-session request (401). TOTP enable and verification sampled
93 ms and 13 ms CPU on the same version. These narrow staging samples do not
prove recurring or production CPU fit; the Free-plan 10 ms CPU gate remains
open.

## Reverified manual lifecycle route on the current staging Worker (2026-09-27 JST)

Reconciled a stale handoff statement against the current code and deployed
configuration. `LIFECYCLE_RUN_BACKEND=d1` enables only the authenticated manual
route; the route supplies `LICENSE_EXPIRY_BACKEND=d1` to a cloned invocation
environment. The deployed `LICENSE_EXPIRY_BACKEND` selector remains absent, so
the configured daily Cron still exits before opening D1.

Ran the guarded `staging-admin-totp-smoke.mjs` with
`--lifecycle-run-readback` against Worker version
`1ae4ffb0-5af5-4b19-8759-f79cc201b45a`. Synthetic Better Auth sign-in, first
TOTP enrollment, session rotation, same-session MFA, and the manual lifecycle
route passed. It returned aggregate-only zero-candidate results. Both empty
lifecycle journals were read back against the configured target/digest and
removed; the synthetic Auth identity was removed, and user-owned Auth tables
read back empty. The monotonic MFA generation counter was preserved and may
have advanced.

This corrects the earlier handoff claim that the manual server selector was
unset. No Supabase schedule, production route, real user data, email, Stripe,
or domain/DNS state changed.

## Fresh Supabase schema-only query and current-catalog rehearsal (2026-09-27T12:13:53Z)

Ran the reviewed `schema-readiness.sql` through `npx supabase@2.118.0
db query --linked` with `CI=1` and `--yes`; the CLI completed without terminal
input. The transaction reads schema catalogs only. It returned 406 columns,
144 constraints, 139 indexes, 15 enum labels, one view, 58 functions, 36
triggers, and 77 RLS policies. The schema converter emitted the current 40-table
profile and retained 18 blocking groups (`deployable: false`): 10 import-stage
groups and 8 schema/operation groups.

Under Node 22.6.0, `scripts/migration/test-d1-import-current-schema.mjs` passed
against that exact private catalog. It reconciled four generated synthetic rows
through all 40 checkpoints and rejected a conflicting replay. It ran only on a
disposable local Miniflare database; no application rows were read from
Supabase and no remote D1, production, or domain/DNS state changed. The
catalog, descriptor, generated SQL, and report remain private mode-0600 files
outside the repository.

## Business staging D1 schema-only parity readback (2026-09-27 12:22 UTC)

Used Wrangler `d1 export --remote --no-data` for `fanmark-business-staging` and
parsed the private schema export in local SQLite. The schema has 73 tables,
98 indexes, and 34 triggers. All 40 source tables and 406 columns match the
fresh catalog's converted SQLite types and nullability; all 66 generated
source-profile indexes are present. The three extra reviewed columns and 32
additional operational indexes are staging extensions. Local `integrity_check`
returned `ok`, and Wrangler's remote migration list showed no pending business
migrations. No table rows were exported, and no remote D1 schema or data was
changed.


## Stripe receipt test runner isolation (2026-09-27 JST)

GitHub Actions run `36318455207` completed its Worker API job, while the app job
stalled after 88 Stripe receipt subtests in the PGlite row-conversion/snapshot
area and was canceled. Reproducing on Node 22.6 showed a hang when TSX was
globally preloaded for JavaScript-only PGlite suites. Splitting TypeScript and
plain-JavaScript suites passed all 90 tests locally and in an Ubuntu Node 22.6
container, but the next GitHub Actions run (`36320827030`) still remained in
the Stripe test step for more than four minutes. Its Worker job passed in 5m2s;
the run was canceled to avoid another prolonged wait, so the two-batch split is
not considered a CI fix.

The runner now starts each of the nine test files in its own Node process,
preloading TSX only for the four files that import TypeScript. Each process has
a 180-second timeout so a stuck suite fails with its file name. Stripe receipt
typecheck, app typecheck, admin auth URL tests (3/3), and Cloudflare staging
build pass locally. The per-file runner still needs a fresh GitHub Actions run.
No production, Supabase, D1, user-data, or domain/DNS state changed.

## Per-file Stripe test runner CI verification (2026-09-27 13:12 UTC)

Commit 14bebed runs each Stripe receipt test file in a separate Node process.
GitHub Actions run 36321290841 completed successfully: the application job
passed migration data boundaries, Stripe receipt/billing/invoice tests, both
typechecks, admin return URL tests, and the Cloudflare staging build; the Worker
job passed its API/D1 tests, typecheck, and no-deployment bundle validation.
This workflow performed no deployment.

## Combined credential-state current-catalog rehearsal (2026-09-27 JST)

The private schema-only catalog was used to run the 40-table synthetic D1
importer rehearsal with one enabled active credential, one disabled active
credential, and one credential attached to an inactive (`grace`) license.
All 40 checkpoints completed and whole-target reconciliation passed for 10
synthetic source rows: two active credentials were bcrypt-transformed and
read back with their enabled states, while the inactive row was recorded as
`deferred_inactive` with no target credential row. Exact source/target/deferred
counts (3/2/1), access generations, foreign keys, and the event sequence were
checked. An injected acknowledgement loss resumed successfully; a conflicting
coverage digest was rejected. The result remains
`public_rows_reconciled`, `deployable: false`, and
`fullMigrationReconciled: false`. This was local Miniflare only: no Supabase
application rows or remote D1 rows were read or written, and no deployment,
user-data import, or domain/DNS change occurred.

The full root `test:migration-data` suite then passed 160/160 under Node
22.6.0. Its bounded fake-`psql` protocol test now allows 15 seconds for process
startup under parallel test load instead of the previous 5-second ceiling;
the command remains time-bounded and the protocol test passes both alone and
inside the full suite.

GitHub Actions run `36323205817`, attempt 2, passed both required jobs,
including Worker API/D1 tests, migration boundaries, all 90 Stripe receipt
tests, both typechecks, admin return-URL tests, the staging build, and the
non-deploying Wrangler validation. The first attempt timed out after 180
seconds in the Stripe PGlite snapshot test. That test passed alone locally and
the full Stripe suite passed locally; retrying the same code passed on GitHub,
so the first failure was not reproduced. The workflow did not deploy.

## Synthetic Stripe receipt continuity during staging freeze (2026-09-28 JST)

Added and ran the guarded
[`staging-stripe-receipt-freeze-smoke.mjs`](../../scripts/migration/staging-stripe-receipt-freeze-smoke.mjs)
with the exact account, Business D1, live-staging-write, and no-Stripe-API
flags. It installed a random temporary webhook signing secret and deployed
`625895a0-931c-4c12-8f18-8ee54d063223` with `CUTOVER_WRITE_FREEZE=true` and only
`STRIPE_WEBHOOK_BACKEND=d1`; it did not configure a Stripe API key, dispatch
selector, Checkout, or Resend.

During freeze, an unauthenticated mutation received 503 `cutover_write_freeze`
and sign-in OPTIONS returned 204. The locally signed synthetic
`customer.updated` event returned `accepted`, and an exact replay returned
`duplicate_nonterminal`. Remote D1 readback found one receipt with
`delivery_count=2`, status `received`, and one `pending` dispatch. No business
handler ran, Stripe API request was made, or email sent. The canary took
29,130 ms from secret setup through cleanup and restore; it is not a measured
production cutover RTO.

Cleanup removed the receipt, dispatch, and one-use secret, then restored the
ordinary staging config as Worker `4c23f796-fa12-419d-85fb-9a905a5f7ceb`.
Independent final readback found zero Stripe receipts/dispatches, zero business
profiles, and zero broadcast delivery rows. `/` and `/api/auth/ok` returned 200,
the unauthenticated admin mutation returned 401, and the disabled Stripe webhook
returned 404. The secret inventory returned to the three pre-existing
Better Auth/reference/verified-access secrets. No Supabase writers, production,
real user data, or domain/DNS settings changed. Stripe sandbox business-effect
acceptance and full pre/post-write recovery drills remain open.

## Staging visibility for a paused broadcast delivery (2026-09-28 JST)

Updated the D1 broadcast list DTO to project only `delivery_status=needs_review`
from the internal error marker, and added a warning in the admin UI stating
that sending is stopped and automatic retries are off. Raw `error_details`,
provider response bodies, and address-like data remain excluded from the DTO.
Focused admin API tests passed 11/11, delivery integration tests 8/8, both
typechecks, targeted ESLint, the Cloudflare staging build, and Wrangler staging
dry-run.

Deployed the ordinary isolated `fanmark-app-staging` configuration as Worker
`30ce0b27-fb72-4400-a8b6-6d86b46b5167`. The business D1 migration list had no
pending work; `BROADCAST_SEND_BACKEND`, test-send selectors, and Resend secrets
were absent. The authenticated synthetic TOTP canary confirmed the test-send
and bulk-send endpoints each returned the expected selector-disabled 503. A
synthetic `needs_review` run and recipient were then inserted temporarily; the
MFA-protected list returned `status=sending` plus `delivery_status=needs_review`
without the synthetic address/provider body. Cleanup removed the run, recipient,
draft, synthetic profiles, audits, Auth identity/session/TOTP rows, and target
identity. Independent APAC-primary D1 reads reported `changed_db=false`, zero
profiles/drafts/runs/recipients/suppressions/webhook events, and zero Auth
users/accounts/sessions/factors/roles/MFA assurances. `/` and `/api/auth/ok`
returned 200, and the deployed asset contains the warning text. No email or
provider request was made. Visual browser review remains open because the host
Mac was locked. Queue retention/reconciliation policy and provider-backed
acceptance remain open.

## スキーマ変換 v5: GIN index のクエリ契約判定 (2026-09-28 JST)

Supabase の `schema-readiness.sql` をリンク先へ read-only で再実行し、
2026-09-27T16:02:02Z 時点のcatalogを取得。40表・406列・144制約・139 index・
15 enum・1 view・58 function・36 trigger・77 RLS policyで、業務データ行は
読んでいない。schema-converter v5は、現在存在する4つのGIN indexを正確な
定義との一致に限り `omitted_after_query_contract_review` として記録する。
配列contains/overlapおよび全文検索の呼び出しはなく、正規化IDはD1のUNIQUE
制約で完全一致検索し、絵文字管理検索は部分一致であることを確認した。
未知または変更されたGIN定義は引き続きblockingにする。

最新変換レポートは17 gate groups (row変換10、schema/operation 7)、
`deployable=false`。今回のreport生成には非公開credential descriptorを
渡していないため、専用password transformは引き続き停止条件となる。
変換器テストはNode 22.6.0で12/12。catalog・DDL・reportはGit外、mode 0600。
既存staging D1へはDDL/dataとも適用していない。

## Schema converter v6 and recent-list limit parity (2026-09-28 JST)

The read-only Supabase catalog refresh at `2026-09-27T16:14:11Z` still has one
`recent_active_fanmarks` view. Converter v6 recognizes it only by exact
single-view scope, kind/name, and definition SHA-256, then records its
replacement by the D1 Worker recent-list query with code/test/document evidence.
Unknown, changed, or additional views remain blocking. The private report has
16 groups (10 row-conversion and 6 schema/operation) and remains
`deployable: false`; the private credential descriptor was not supplied.

The recent Worker API and D1 repository now accept limits through 50 to match
the source RPC, while the landing page continues to request 20. Node 22.6.0
verification passed: schema converter 13/13, migration-data 163/163,
Supabase-backed recent API 15/15, D1 repository 6/6, the complete Worker
`npm test` chain, both typechecks, CI workflow-isolation check, Cloudflare
staging build, Worker deploy dry-run, and `git diff --check`. Catalog, generated
SQL, and report are mode 0600 outside Git. No application rows, remote D1,
production, user data, or domain/DNS settings changed.

## Staging rollout of the current Worker and recent-list contract (2026-09-28 JST)

After Node 22.6.0 local validation and the app CI job passed, deployed the
current branch to the isolated `fanmark-app-staging` workers.dev Worker as
version `708ff90b-abec-405d-9dd0-6a0d14cafe3c`. Wrangler confirmed the split
business/Auth/master D1 bindings and staging R2 buckets; it found no D1
migrations pending. No asset upload was needed because the built staging SPA
assets were unchanged.

Anonymous readback returned 200 for `/` and `/api/auth/ok`; D1-backed
`/api/fanmarks/recent?limit=50` returned 200 with zero items. The
MFA-protected broadcast admin list returned 401 without a session, and the
Stripe webhook returned 404 with selectors absent. A read-only schema/count
check confirmed the four `broadcast_delivery_*` tables exist and contain zero
rows. The staging secret-name list contains only Better Auth, reference-master,
and verified-access secrets; no Resend or Stripe secret was configured. No
production route, business/Auth row, R2 object, D1 row, user data, or
domain/DNS setting changed.

## Integrated synthetic pre-write fallback rehearsal (2026-09-28 JST)

Added the guarded `npm run test:migration:staging-prewrite-resume` path. The
script checks the exact staging account, workers.dev/no-route config, split
business D1, disabled Stripe selectors/secrets, and local Supabase/Docker
prerequisites. It waits on a non-writing invalid-body probe until the deployed
freeze returns `cutover_write_freeze`, then verifies a valid synthetic
`example.invalid` waitlist request is rejected with 503 and absent from D1.
Sign-in preflight remains available.

While staging stayed frozen, a disposable loopback Supabase project passed
synthetic email/password sign-in, UUID preservation, owner-scoped
`user_settings` read/update/readback, and cascade cleanup. The first owner-scoped
`user_settings` update was acknowledged 30,472 ms after the frozen Cloudflare
rejection; this includes local project startup and is not a production
interruption/RTO. The
same freeze preserved one locally signed synthetic Stripe receipt and its
duplicate delivery as one pending dispatch, with no Stripe API or business
effect.

Cleanup restored ordinary staging Worker version
`e54b22c6-b19d-4172-be71-445e2a29b52a`. Independent readback found zero
waitlist/receipt/dispatch/profile rows and zero rows in all seven checked Auth
user-owned tables. Staging SPA/Auth health returned 200, webhook 404, and
unauthenticated admin 401; no local Docker resources remained. The first
attempt exposed that a deploy returning is not by itself a sufficient
workers.dev readiness signal, so the script now waits using the non-writing
probe before attempting the mutation. This closes only the synthetic pre-write
fallback subgate; no linked Supabase writer/Cron was stopped and no live user
rows, production route, or DNS/domain were changed. Issue #37 remains open.

Follow-up rerun on 2026-09-28 passed with temporary Worker
`71094a8b-6cbb-4f42-afcd-47a5957dc69a`, restored Worker
`6da0dd8d-5da3-46f5-9c7e-86258a50b181` at 100%, 31,937 ms to the first
loopback source-shaped write after the freeze response, and 75,970 ms total
harness time. Final receipt/dispatch counts were zero; live deployment and
secret readback confirmed restoration and no temporary Stripe signing secret.

## Rendered subscription foreground-poll canary (2026-09-28 JST)

The opt-in `npm run test:migration:staging-subscription-ui-poll` extends the
staging subscription projection smoke into a disposable headless Chrome
session. It seeds a synthetic Better Auth identity, its minimum D1 profile,
and owner/decoy subscription rows; signs in through the staging API; then loads
`/profile`, opens the Plan section, and confirms the active subscription is
rendered. After changing only the synthetic owner row from `active` to
`canceled`, the visible status changed to inactive on the next 30-second
foreground poll in 29,440 ms.

The API canary and browser run both completed their cleanup readbacks with zero
synthetic subscription/profile/Auth rows. The browser uses a temporary Chrome
profile and is terminated by the script. No Stripe API, email, real user data,
production resource, or domain/DNS setting was used. This verifies one rendered
poll transition; it does not close Stripe sandbox acceptance, recurring CPU
plan fit, or the broader issue #37 integration/recovery gates.

## Anonymous search-record staging canary (2026-09-28 JST)

Added the guarded `npm run test:migration:staging-fanmark-search-record`
acceptance command. It checks the exact Cloudflare account, workers.dev-only
Worker configuration, split business/master D1 IDs, D1 selector, CORS origin,
and rate-limit binding before making one anonymous search request with three
unused synthetic emoji IDs. Staging returned the expected preflight, rejected
an untrusted origin without writing, rejected a malformed ID, then recorded
one valid search. D1 readback confirmed exactly one aggregate and one search
event with `user_id=NULL`; cleanup deleted those exact rows and verified zero
matching rows remained.

The D1 `sqlite_sequence` for `fanmark_events` advanced by one after insert and
delete; it is monotonic bookkeeping and was deliberately not rewound. The
canary does not import historical searches or user attribution. No user data,
production route, Stripe/email effect, or domain/DNS setting was touched.

## Fresh descriptor-aware schema rehearsal (2026-09-28 JST)

Fetched a new linked Supabase schema catalog read-only in a separate private
work directory. Converter v8 retained 14 unresolved gates across nine
row-conversion groups and five schema/operation groups; a value-free credential
descriptor made the active credential transform requirement explicit without
making the catalog deployable. The local synthetic D1 rehearsal passed with 10
synthetic rows, two transformed active credentials, one deferred inactive
credential, all 40 checkpoints, and conflict rejection. The report remains
`public_rows_reconciled`, with deployability and full migration reconciliation
false. No source rows or remote D1/R2 were touched. Full details are in
[`schema-conversion.md`](schema-conversion.md).

## Broadcast send-control browser acceptance (2026-09-28 JST)

Added the guarded `npm run test:migration:staging-broadcast-email-ui` command.
The synthetic MFA admin browser session opened the deployed staging broadcast
tab, read the exact synthetic draft, and confirmed both test-send and send-start
buttons were disabled with the Cloudflare-mode warning visible. The browser
clicked neither button. Existing API canary checks then confirmed both send
routes remain selector-disabled and the paused-run projection redacts private
details. All synthetic Auth, profile, draft, audit, delivery-run, and recipient
rows were cleaned and read back as zero. No provider, real-user, production, or
domain/DNS effect occurred. Provider-backed acceptance and the broader #37
integrated recovery rehearsal remain open.

## Admin user-management mutation browser acceptance (2026-09-28 JST)

Added the guarded `npm run test:migration:staging-admin-user-ui` acceptance
path and deployed the admin-dialog focus fix to the isolated
`fanmark-app-staging` Worker (version
`92b30cf6-1432-4e02-a790-956f193799dc`). A temporary headless Chrome session
authenticated as a synthetic MFA administrator, opened the deployed user
management screen, and changed one synthetic profile Free→Max→Free. It then
suspended and restored that identity through the rendered confirmation
dialogs. The restored row rendered `Free / 有効`; D1 readback confirmed the
Free plan and no Enterprise override, Auth readback confirmed `banned=0` with
null ban metadata, and the two UI status actions were present in the audit log.

The complete TOTP/admin canary passed, including its API plan/status and
immediate-expiry checks. Script cleanup plus its final readback returned the
synthetic Auth-owned tables, target/admin profiles, user-management audits,
license/configuration rows, and expiry notification artifacts to zero. No
email/provider call, real user data, production route, or domain/DNS setting
was used. This closes the rendered admin user-management mutation subgate;
provider-backed acceptance and the complete #37 application recovery
rehearsal remain open.

The same guarded canary was rerun successfully on current staging Worker
`82413f00-f60e-4a01-aeb0-2a071e01178a`. Its timestamp assertions now compare
the requested expiry instant, allowing D1's microsecond timestamp formatting
to differ from the submitted millisecond ISO string. Final readback again
found the synthetic Auth and business-D1 canary rows at zero.

The guarded staging PWA update browser check also passed. A temporary precache
asset was deployed and observed in Workbox; the staging Service Worker updated
and automatically reloaded `/pwa`, preserving synthetic `localStorage` while
discarding an unsaved DOM field. The marker was removed, the ordinary staging
build was redeployed, a second update removed the marker from the precache, and
the asset returned 404. Canary and restored Worker versions were
`f19d38cb-6708-4aa9-87f1-a58a2166337e` and
`c78dbb17-9c9b-42fc-bad5-9dc9ae0cfc65`. The temporary browser profile/storage
were cleaned. At this checkpoint, native install/standalone launch had not yet
been checked; the follow-up acceptance is recorded below. Complete #37 recovery
acceptance remains open. See [`static-assets.md`](static-assets.md).

## Native staging PWA install and standalone launch (2026-09-28 JST)

An isolated temporary Chrome profile on macOS offered the install prompt for
the staging workers.dev `/pwa` route. Installing produced a `fanmark.id` Chrome
app, and launching it rendered the search screen in a standalone window without
browser address controls. The Chrome app's profile path pointed to the isolated
temporary profile. Both the profile and generated app bundle were moved to the
Trash after the check. No application/backend change, production route, or
domain/DNS setting was involved. This closes only native install/standalone
launch at the staging workers.dev origin; authenticated flows, other browsers
and operating systems, custom-domain behavior, and complete #37 recovery remain
open. See [`static-assets.md`](static-assets.md).

## Lifecycle settings AdminSettings browser acceptance (2026-09-28 JST)

The guarded staging canary signed in a synthetic Better Auth administrator,
completed TOTP/MFA, and used an isolated headless Chrome profile to operate the
rendered `AdminSettings` lifecycle form. It read baseline `grace_period_days=1`,
saved synthetic value `2` through the staging Worker, confirmed it through the
public D1-backed endpoint, then restored and reread `1`. The test observed both
successful API responses and the form's saved state. Cleanup removed the
synthetic profile and Auth identity; readback found the user-owned Auth tables
empty. The public setting is at baseline, though `updated_at` advanced and the
MFA generation counter may have advanced during factor enrollment/removal. No
user data, email, Stripe, production route, or domain/DNS was used. The browser
form subgate is closed; complete #37 recovery, broader authenticated UI
acceptance, provider-backed checks, and operational fit remain open. Reproduce
with `npm run test:migration:staging-lifecycle-settings-ui` and see
[`lifecycle-settings-api.md`](lifecycle-settings-api.md).

## Schema converter v9 and current-catalog synthetic replay (2026-09-28 JST)

Converter v9 moves source `date` validation into generated D1 constraints. Its
canonical-calendar `CHECK` rejects malformed and impossible dates on later
writes as well as at import. The fresh schema-only catalog now has 13
unresolved gates across 226 locations (nine row-conversion and four
schema/operation); `deployable` remains false. The generated SQL changed only
for `fanmark_access_daily_stats`.

The migration-data suite passed 167/167 under Node 22.6.0. The fresh-catalog
synthetic local D1 replay passed with 10 synthetic rows, two transformed
credentials, one deferred credential, all 40 table checkpoints, and conflict
rejection. Its status is `public_rows_reconciled`, not full migration
reconciliation. No source application rows were queried; no remote D1/R2,
production route, real user data, or domain/DNS setting was changed.

## Schema converter v10 timestamp write guard (2026-09-28 JST)

Converter v10 adds canonical UTC microsecond timestamp checks to generated D1
DDL. For the fresh schema-only catalog, this affects 103 timestamptz columns
across all 40 tables. The checks require a real date in years 0001–9999,
fixed-width `YYYY-MM-DDTHH:mm:ss.ffffffZ` text, and valid time fields. The
readiness report remains at 13 unresolved groups across 226 locations because
`timestamp_import_precision` still requires operation-level evidence.

Node 22.6.0 verification passes: schema-converter 15/15, row-conversion 7/7,
Miniflare D1 importer 18/18, and the full migration-data suite 168/168. The D1
integration rejects impossible dates and millisecond-only timestamp text on
updates, confirming the existing canonical timestamp remains unchanged. A
separate current-catalog local D1 replay reconciles 10 synthetic rows, two
transformed credentials, one deferred credential, 40/40 checkpoints, and
conflict rejection; its status is
`public_rows_reconciled`, with deployment and full migration reconciliation
false. No application rows, remote D1/R2, production route, real user data, or
domain/DNS setting was read or changed.

Core Worker writes for registration, return, transfer, lottery, settings,
favorites, access analytics, and notification read state now use one shared
UTC microsecond formatter, matching the converter's fixed-width D1 contract.
Their focused D1 suites pass 72/72 locally, and corresponding frontend API
contract tests pass 44/44. The operation-format subgate is partial: the 79
source `now()` default locations and the other D1 writer paths still need
reconciliation before enabling the generated schema.

On 2026-09-28, the same formatter was applied to account deletion,
profile/password setup, admin user management, lifecycle/maintenance/system
settings, waitlist admin/signup, invitation admin/signup, and extension-coupon
admin/application and admin email-template writes. Broadcast email
administration, delivery leases/retries, and Resend webhook event persistence
now use the formatter too. Focused tests assert persisted UTC microsecond text
and pass 107/107 across these added suites. Together with the core API suites,
focused Worker D1 verification is 179/179. Coupon and email-template
administration's monotonic revision timestamps also retain six fractional
digits. This reduces known writer-format drift but does not close the 103-column
timestamp gate or the 79 `now()` default locations; the full writer inventory
remains open. No live user rows, remote D1/R2, or production settings were
accessed.

## Master and scheduled notification D1 timestamps (2026-09-28 JST)

Emoji master create/update/import operations explicitly persist both
`created_at` and `updated_at`; reference-master release creation, verification,
and activation timestamps use fixed-width UTC microsecond text too. Emoji admin
write readback is covered in the Auth D1 suite (21/21); reference-master API
coverage passes 6/6. Scheduled notification processing now formats due times,
cooldown cutoffs, generated trigger times, and operation timestamps the same
way; its D1 suite passes 12/12. No user data or remote D1 was read or changed.

## Stripe D1 timestamp normalization (2026-09-28 JST)

Stripe webhook receipt times, dispatch leases/retries, invoice projection
timestamps, and subscription reconciliation fences and grace dates now use
fixed-width UTC microsecond text when written to D1. The Stripe webhook,
invoice, and subscription synthetic integration suite passes 59/59, including
readback of receipt and dispatch timestamps. Tests use isolated local D1 and
injected providers; no live Stripe provider or user data was accessed. The
timestamp writer/default inventory remains incomplete, so the schema gate and
deployment readiness remain open.

## Master-release audit timestamps and staging writers (2026-09-28 JST)

The emoji and reference-master release tests now read back canonical
six-digit UTC `created_at`, `verified_at`, active-pointer `updated_at`, and
activation-audit `created_at` values. Migration
`0007_release_audit_timestamps.sql` recreates both release audit triggers so
they copy `NEW.updated_at` instead of using SQLite's second-precision default.
Both isolated Miniflare release suites pass (7/7 and 5/5); lifecycle/schema
tests pass 16/16, Worker typecheck and the full `workers/api` test chain pass.
The staging Vite build and Wrangler `--dry-run` pass; the dry-run read the
built assets and exited without deployment. The full migrations 0000–0007
were applied only to disposable local D1 in these tests. Staging configs and
remote migration guards select the exact release-audit filename so they exclude
the Auth-only migration with the same 0007 prefix. A read-only Wrangler remote
list confirmed only `0007_release_audit_timestamps.sql` pending before apply.
After Actions run `36368026109` passed both jobs, Wrangler applied it to
staging Master D1. The follow-up list reported no pending migrations. Readback
confirmed all four emoji/reference audit triggers use `NEW.updated_at`; the
read query reported `changed_db=false` and zero rows written.

Synthetic staging smoke scripts that seed or update business D1 now also write
six-digit UTC values for subscription/profile/notification timestamps, license
period ends, grace expiry, and expected return expiry. This keeps future
canaries compatible with the timestamp checks without touching their staging
data. `git diff --check` passed; CI run `36368026109` passed both required jobs.
The converter still reports 13 open groups / 226 locations and the complete
timestamp writer/default inventory is not reconciled. No source rows or real
user data were accessed. The only remote D1 change was the Master audit-trigger
migration above; no Worker deployment, R2 change, production route, or
domain/DNS setting changed.

## Schema converter v11 `now()` fallback representation (2026-09-28 JST)

The converter emits
`strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')` for `now()` defaults on source
timestamptz columns. SQLite-backed D1 evaluates the parenthesized expression
and the generated timestamp `CHECK` accepts the fixed-width UTC result. The
new Miniflare D1 test confirms an omitted timestamp stores 27 characters in
that shape; the converter unit test confirms the same with SQLite.

The generated value has millisecond resolution padded to six fractional
digits, and does not preserve PostgreSQL transaction-time semantics. The
`timestamp_default_requires_operation` gate remains open; non-timestamptz
defaults remain omitted. Schema conversion version 11 invalidates v10 snapshot
manifests, which must be re-exported before later verification/import.
The 2026-09-28 read-only schema refresh was reprocessed under v11 without the
private credential descriptor. Its report has 13 unresolved groups / 226
locations (8 row-conversion, 5 schema/operation), including
`credential_descriptor_required`, and remains `deployable: false`. All 79
catalog `now()` defaults are timestamptz and produce the new D1 expression;
the generated DDL loaded 40 tables with clean SQLite integrity and foreign-key
checks. No source rows, remote D1, Worker deployment, production route, real
user data, or domain/DNS state was accessed or changed.

The descriptor-aware v11 replay then passed under Node 22.6.0: 10 synthetic
rows completed all 40 checkpoints, two synthetic credentials were
transformed, one inactive credential was durably deferred, typed/hash
readback matched, and conflicting coverage was rejected. The report remains
`deployable: false` with 8 row-conversion groups / 133 locations and 5
schema/operation groups / 93 locations. No source application rows or remote
D1/R2 state was read or changed.

## Current offline source inventory refresh (2026-09-28 JST)

Regenerated `docs/migration/repository-inventory.md` from checkout commit
`1f1d0eeed72fb8d0940409fc8cab33f0d1fb9286` using the offline AST inventory
script. It still reports 40 generated-type tables, one view, 45 typed RPCs,
34 local Edge directories, 18 explicit local `verify_jwt` entries, and 211
frontend Supabase callsites. The current source scan therefore confirms the
previous counts while refreshing line locations changed by the admin
user-management browser acceptance. `node --check scripts/migration/inventory.mjs`,
`node scripts/migration/test-inventory.mjs`, and `git diff --check` passed.
This updates only the checked-out repository report; it does not close #30's
live settings/capacity/maintenance inventory or reconcile production-only
configuration. No network API or database was queried and no rows or secrets
were read.

## Staging Worker, D1 ledger, and secret-name readback (2026-09-28 JST)

Using Wrangler 4.142.0 against the existing Cloudflare account, the app
deployment list confirmed `fanmark-app-staging` version
`6da0dd8d-5da3-46f5-9c7e-86258a50b181` at 100%. Read-only `d1_migrations`
queries returned business migrations `0000`–`0016` (17), Auth migrations
`0003`, `0007`, and `0008` (3), and master migrations `0000`–`0007` (8).
All three query responses reported `changed_db=false` and `rows_written=0`.
The app Worker secret listing returned only the names
`BETTER_AUTH_SECRET`, `REFERENCE_MASTER_SERVICE_SECRET`, and
`VERIFIED_ACCESS_SECRET`; no secret value was read. Thus Stripe, Resend, and
four OAuth provider credentials are not present in staging. This remains an
external acceptance prerequisite for checkout/webhooks, actual email
delivery, and provider callbacks; no provider or billing configuration was
changed.

The account's current Workers Free plan still needs a CPU-fit decision. The
existing staging tail samples for Better Auth/password/TOTP and lifecycle
operations exceed the published Free limit of 10 ms/request. Cloudflare's
current Workers Paid pricing documents a $5 monthly minimum and a 30-second
default per-request CPU limit; no paid-plan change was made. References:
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
and [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).
This was metadata and secret-name readback only; no source rows, credentials,
production route, or domain/DNS were accessed or changed.

## Fresh Supabase catalog and v11 DDL recheck (2026-09-28 05:07 UTC)

Re-ran the reviewed `schema-readiness.sql` using Supabase CLI 2.118.0 in a
private temporary project-link directory; the checkout's existing
`supabase/.temp/cli-latest` state was not used or overwritten. The transaction
read catalogs only and returned 40 tables, 406 columns, 144 constraints, 139
indexes, 15 enum labels, one view, 58 functions, 36 non-internal triggers, and
77 RLS policies. Locale remained `en_US.UTF-8`; each of the five Unicode
regex-range probes found zero extra matches.

Schema-converter v11 ran with the value-free `bcryptjs@3.0.3` / cost-10
descriptor. Its 13 unresolved groups / 226 locations remain: array 9, bigint
range 3, credential transform 1, decimal 1, external foreign key 11, JSON 13,
money cents 2, sequence state 1, timestamp default operation 79, timestamp
import precision 103, and unsupported catalog scope 3. It remains
`deployable: false`. Generated DDL loaded 40 tables into ephemeral SQLite and
passed `integrity_check=ok` with zero foreign-key violations. All query output,
descriptor metadata, DDL, and report were held only in memory or a private
temporary directory that was removed on exit. No source rows, Auth values,
remote D1/R2, production route, or domain/DNS state was read or changed.

## Supabase Auth settings and staging OAuth callback target (2026-09-28 JST)

A fresh read-only request to Supabase Auth's public settings endpoint returned
HTTP 200. The response was reduced to booleans before reporting: signup is
enabled, email confirmation is required (`mailer_autoconfirm=false`), and email,
Apple, Google, GitHub, and Discord are enabled on the source project. This is
provider-toggle metadata only; it does not establish that the OAuth client
credentials exist, that provider consoles contain the required redirect URIs,
or that a browser callback or login works. No Auth users, credentials, or
provider secrets were read.

The installed Better Auth 1.7.5 configuration uses its default `/api/auth`
base path and `/callback/{provider}` callback path. Given the current staging
origin, the expected provider callback URIs are:

- `https://fanmark-app-staging.fanmark-id.workers.dev/api/auth/callback/apple`
- `https://fanmark-app-staging.fanmark-id.workers.dev/api/auth/callback/google`
- `https://fanmark-app-staging.fanmark-id.workers.dev/api/auth/callback/github`
- `https://fanmark-app-staging.fanmark-id.workers.dev/api/auth/callback/discord`

These are code-derived staging targets, not confirmed provider-console entries.
The Cloudflare secret-name readback found no credentials for these providers;
staging browser callbacks remain unverified under #31. No provider settings,
credentials, source rows, production routes, or domain/DNS configuration were
changed.

## Complete frontend backend-selector declaration, staging assignment, and deploy (2026-09-28 JST)

Auditing all frontend TypeScript references found 45 distinct
`VITE_*_BACKEND` selectors, five of which were missing from `ImportMetaEnv`.
Added all five declarations and strengthened
`test-staging-selector-coverage.mjs` to require exact set equality between
source references, type declarations, and the staging build assignments. The
build now explicitly sets `VITE_BROADCAST_SEND_BACKEND=disabled` and
`VITE_BROADCAST_TEST_SEND_BACKEND=disabled`; both controls were already
fail-closed by default, and no sender/provider credentials are configured.

Under Node 22.6.0, the focused selector suite passed 3/3, root typecheck passed,
`npm run build:cloudflare-staging` passed, and the full `npm run
test:migration-data` suite passed 172/172. Wrangler app-config dry-run passed.
Commit `f54d930` passed both PR #41 validation jobs in GitHub Actions run
`36381489669` (`Validate Cloudflare staging application` and `Validate
Cloudflare Worker API`; Supabase Preview was skipped by design).

The app was then deployed to workers.dev staging only. Wrangler recorded
deployment `e14b597b-74a6-4e1b-a850-0e8403ee86ed`, version
`f4c99bda-ea79-468e-addd-38b8f1453f47`, and 100% traffic. The deployed static
asset `/assets/index-DZsrzGFr.js` is 2,498,833 bytes and its SHA-256
`519bd4f92b7aebcf7b13f903a6e674e75278171a69bef83f396e072e75f71246` matches
the local staging artifact. Staging `/` returned 200 with `noindex, nofollow`,
`/api/auth/ok` returned 200 `{ok:true}`, and `/api/emoji/catalog` returned 200
JSON. No D1 migrations or data operations, provider calls, production routes,
or domain/DNS changes occurred. The selector audit is complete statically;
runtime acceptance of the full API/UI inventory remains open.

## Repeat isolated synthetic post-write recovery (2026-09-28 JST)

Two preliminary repeats failed during synthetic write acknowledgement after
their temporary Workers and D1s were created; cleanup confirmed deletion of the
temporary resources. The private report lacked a useful safe stage indicator,
so the harness now records phase and sanitized error labels without request or
row contents. `node --check` and `git diff --check` passed. A rerun of
`npm run test:migration:staging-postwrite-recovery` passed: all 17 business
migrations applied, the synthetic waitlist and duplicate Stripe receipt were
acknowledged, a later write was removed by Time Travel while the Worker stayed
frozen, and the exact acknowledged row/receipt digest matched after restore.
Restore and reconciliation took 4.530 seconds. Cleanup confirmed the temporary
Worker, D1, and config were removed. No real user data, Stripe API call,
production route, or domain/DNS change was involved. This remains an isolated
application-schema drill, not full #37 acceptance.

## Supabase Edge Function settings regression check (2026-09-28 JST)

Added `scripts/migration/test-supabase-function-settings.mjs` to compare the
read-only live-function matrix in `live-observations.md` against all local
`supabase/functions/*/index.*` entrypoints and the explicit `verify_jwt`
settings in `supabase/config.toml`. The check requires the 34 local slugs and
the one documented live-only function to match the reviewed inventory, and
fails if any local function omits or duplicates its JWT boolean. It is included
in `npm run test:migration-data` and is available as
`npm run test:supabase-function-settings`.

Under Node 22.6.0, the standalone check passed and the full migration-data
suite passed 173/173. This protects observed gateway-setting parity only; it
does not prove handler-level authorization, function behavior, or the status
of external callers for the live-only function. No remote setting, deployment,
function invocation, or application row changed.

## Rendered protected-access staging canary (2026-09-28 JST)

Added `npm run test:migration:staging-protected-access-ui`, an opt-in guarded
headless-Chrome check that uses a random synthetic Better Auth user and a
temporary password-protected text fanmark. On the 390x844 viewport, the
workers.dev `/a/:shortId` page kept the synthetic text hidden while locked;
one wrong four-digit password returned 401 and cleared the input, and the
correct password returned 204 followed by a 200 protected read with
`Cache-Control: no-store`. Readback verified the proof cookie was HttpOnly,
Secure, and SameSite=Lax. The public locked projection returned no text or
redirect target. Cleanup and independent D1 reads found zero canary Auth,
business, proof, reservation, or access-audit rows.

The API-only `npm run test:migration:staging-owner-settings` also passed its
unauthenticated 401, owner GET/PATCH 200, wrong-password 401, valid verification
204, protected read 200, and cleanup checks. Targeted ESLint, `node --check`,
and `git diff --check` passed. This verifies the rendered text-password path
for one synthetic Chrome viewport; imported Supabase password compatibility,
other browsers, recurring CPU/abuse-control fit, and production behavior remain
open. No application deployment, real user data, provider call, production
route, or domain/DNS setting changed.

## Read-only Supabase capacity refresh (2026-09-28 JST)

Refreshed aggregate capacity through Supabase CLI 2.118.0 using an isolated
temporary project-link directory. PostgreSQL measured 27,708,563 bytes
(about 26.4 MiB / 27.7 MB). Supabase Storage metadata summed to 13,285,729
bytes (about 12.67 MiB) across 109 objects, with no missing size metadata.
The Storage figure comes from object metadata, not a new body download/hash
pass. Only these aggregate capacity values were added to the public record;
per-table, Auth, Stripe, and per-bucket breakdowns remain outside Git.

This read-only inventory provides transfer-size context only; it does not
measure a frozen snapshot, import/reconciliation time, or user-visible
interruption. No application row values were returned or recorded. It changed
no Supabase, D1, R2, production route, or domain/DNS state.

## Rendered profile and R2 avatar UI canary (2026-09-28 JST)

Extended `scripts/migration/staging-r2-profile-smoke.mjs` to open the deployed
workers.dev `/auth` and `/profile` pages in an isolated headless Chrome profile
at 390x844. The canary signs in through the real form with a synthetic
Better Auth user, observes the Worker email-login request, and verifies the
HttpOnly/Secure/SameSite=Lax session cookie. It selects a complete synthetic
1x1 PNG through the page's file input, observes the Worker storage and profile
requests, and requires Chrome to decode the returned image at its expected
dimensions. It then clicks the profile's own remove control, checks that the
Worker profile API returns a null avatar, and confirms the removed public R2
URL returns 404. The existing REST portions continue to verify anonymous
rejection, same-owner URL rules, and both avatar and cover-image buckets.

The first attempt revealed the previous API fixture was a truncated PNG header:
the API signature check accepted it, but Chrome could not decode it. A
CRC-valid 70-byte synthetic PNG replaced it. The live canary then passed the
rendered upload/delete flow, and final D1/R2 readback found zero synthetic
profile/Auth rows and zero objects. The local Worker/R2 suite also now applies
the same Auth suspension migration selected by its test configuration; this
fixed a fixture that otherwise caused synthetic Better Auth sign-in to return
500. Local Worker/R2 tests pass 5/5. These changes touch only the staging
smoke and test fixture; no source rows, existing Supabase objects, production
routes, or domain/DNS settings changed. PR #41 CI passes both the staging-app
and Worker-API jobs. This proves the synthetic email/password staging path
only; provider-backed login and existing user migration remain separate gates.

## Perpetual Tier C plan-capacity correction (2026-09-28 JST)

Updated the Cloudflare D1 lottery-entry endpoint and source-shaped grace
finalizer so plan capacity counts an unreturned `active` license when
`license_end IS NULL` or the end is later than the captured current time. This
closes a mismatch where lifetime Tier C licenses could be ignored and a winner
could exceed the documented plan cap. The correction is explicit in
`docs/PRODUCT.md`; the old Supabase implementation remains unchanged until the
final cutover stage.

Synthetic tests now cover a perpetual license at the cap, a perpetual license
that fills the slot after a winner plan is prepared, and the authenticated
lottery-entry response. `npm --prefix workers/api run test:fanmark-lottery-d1`
passes 12/12, `npm --prefix workers/api run test:license-expiry-source`
passes 25/25, Worker typecheck and targeted ESLint pass. No remote deployment
of the production Worker or user data was changed in this code slice.

The staging lottery smoke now has an opt-in perpetual-cap scenario. A
workers.dev one-minute-Cron canary completed against only synthetic IDs and
verified that three unreturned active perpetual licenses fill the synthetic
enterprise-plan limit of three: the pending entry finished as `lost`, history
has no winner, and `lottery_limit_exceeded` reports `current_count=3` and
`limit=3`. The old synthetic license expired normally, with no winner license.
Cleanup restored `grace_period_days`, removed all synthetic business rows and
lifecycle journals, left Auth rows unchanged, and matched the retained
incarnation/access-version snapshot. The script restored the checked-in
staging Cron/backend baseline. The local `wrangler dev --test-scheduled` path
reset its connection before execution; that attempt also cleaned up fully.

The earlier CI snapshot-export timeout was isolated to PGlite initialization
when run inside Node's `--test` harness: the latest 15-run reproduction hung
five times before its first SQL completed. The same integration now uses
`PGlite.create()` and runs as a standalone Node process under the migration
test runner; this path passed 15/15 repetitions, and the complete Stripe
receipt suite passed locally on Node 22.6.0. Direct `node --test` can still
reproduce the harness stall, so CI must use the checked-in custom runner path.

The earlier PR CI's Worker job passed, while the staging-app job timed out
twice in `snapshot-export.test.mjs`. After isolating and routing around the
PGlite/`node --test` hang, fresh CI run `36394318652` passed both the staging
application and Worker API jobs, including Worker typecheck and bundle dry-run.
The synthetic staging Cron canary was deployed and restored independently.

## Supabase-format password sign-in in staging (2026-09-28 JST)

Extended `scripts/migration/staging-r2-profile-smoke.mjs` to seed one synthetic
Better Auth credential with a `$2a$10$` bcrypt prefix matching the value-free
format observed in the Supabase Auth aggregate. The synthetic password includes
a non-ASCII character. The real `/auth` form logged in through the deployed
Worker, and `GET /api/auth/get-session` returned the exact seeded UUID. The
session cookie was HttpOnly, Secure, and SameSite=Lax. This does not read or
copy any existing Auth credential.

The same 390x844 browser canary rendered `/profile`, uploaded and decoded the
synthetic 1x1 PNG through R2, saved and cleared its owner-scoped profile URL,
and deleted the object through the UI. Final readback found zero synthetic
Auth user/account/session rows, zero profile rows, and 404 for all temporary
avatar/cover objects. `node --check` and a local bcrypt `$2a$10$` Unicode
fixture check passed. This improves the staging password-compatibility proof;
it does not establish real-user hash compatibility, MFA/OAuth migration,
recurring CPU-plan fit, or production readiness.

The same synthetic `/api/auth/sign-in/email` request was measured with a
100%-sampled Wrangler Tail stream on Worker version
`5e75e611-6145-48c3-a35e-daa2a3f9da5d`: status 200, CPU 143 ms, wall time 229
ms. Authenticated avatar uploads used 4–8 ms in this run. Cloudflare's current
Free limit is 10 ms per HTTP invocation and its documentation allows infrequent
overages before consistently over-limit work is terminated; this successful
sample is therefore not evidence of Free-plan fit. Workers Paid currently
starts at $5/month, but no billing-plan change was made. See Cloudflare's
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
and [pricing](https://developers.cloudflare.com/workers/platform/pricing/).

## Synthetic business/Auth D1 post-write recovery (2026-09-28 JST)

Extended `npm run test:migration:staging-postwrite-recovery` to create isolated
business and Auth D1 databases plus a disposable workers.dev API Worker. It
applied and read back all 17 business migrations and the exact three-migration
Auth allowlist (`0003`, `0007`, `0008`). A synthetic-only Better Auth user and
session passed the temporary Worker login flow. The drill acknowledged one
waitlist row and one pending Stripe receipt/dispatch, bookmarked both D1s,
accepted a later waitlist row and Auth session, and redeployed with
`CUTOVER_WRITE_FREEZE=true`. Both D1s were restored while frozen. The original
waitlist/receipt/session state matched its pre-bookmark digest; the later row
and session disappeared, and the original session cookie still resolved to the
same synthetic UUID. Restore plus reconciliation took 13.660 seconds.

The first remote attempt exposed the known D1/Workers SDK issue where trigger
bodies using lowercase `begin` fail remote migrations with
`incomplete input: SQLITE_ERROR`; the local SQLite path succeeds. The six
trigger keywords in `0003_better_auth_core.sql` are now uppercase, and
`.gitattributes` pins both D1 migration directories to LF. A migration test
guards those remote-safe formatting requirements. This is SQL-equivalent and
does not change the schema. See the current [Workers SDK issue #15314](https://github.com/cloudflare/workers-sdk/issues/15314).

The successful rehearsal used only synthetic rows and a low-cost disposable
bcrypt fixture to reduce CPU for this recovery-only sign-in. Its Worker CPU was
not sampled, so this run does not establish Free-plan fit; the separate
`$2a$10$` staging compatibility canary remains the evidence for that observed
credential format. Cleanup read back zero temporary Worker/D1 resources,
leaving only the three pre-existing staging databases.
No existing Auth/business/master D1, R2 object, Supabase writer, Stripe API,
real user data, production route, or domain/DNS setting was changed.

This closes a combined business/Auth post-write restore subgate, not issue #37.
The rehearsal still has no R2 restoration, applied Stripe business effect,
complete encrypted-backup validation, or coordinated Supabase-writer/Cron
freeze. The coarse estimates remain about 53% end-to-end and 73% for the
prioritized app/infrastructure/non-user-master scope.

## Business/Auth synthetic recovery through private R2 (2026-09-28 JST)

The guarded post-write command was extended to include an encrypted R2 replay
slice. A disposable APAC Business D1 and Auth D1 received only synthetic
state. The command exported six tables from those D1s with table-filtered
`wrangler d1 export --no-schema`, packaged the SQL exports as a synthetic row
in the existing AES-256-GCM snapshot format, and uploaded the header and
ciphertext to the private `fanmark-migration-backups-staging` bucket. R2
download hashes, bundle authentication, manifest verification, and exact
decrypted SQL comparisons passed.

The Time Travel bookmarks restored the acknowledged Business/Auth digest
`a1b36eb8d1a4e488d95314d39bb19b7289bb425a751bb5e0a3a33f884ee67ca3` in
11.992 seconds. The command then removed the six synthetic table rows and
replayed them from the decrypted R2 bundle; the same digest and original
Better Auth session cookie were verified in 28.436 seconds. The Worker freeze
rejected five consecutive valid waitlist writes with 503, accepted none, and
still allowed synthetic sign-in. A preliminary rollout attempt observed a 202
after one readiness probe returned 503, so the gate now requires consecutive
actual write rejections. Wrangler's deployment-list response did not reconcile
the temporary freeze version, limiting this evidence to repeated behavior from
the tested workers.dev origin rather than global rollout completion.

Cleanup verified the temporary Worker, both D1s, local bundle, and two R2
objects were removed; readback showed only the three pre-existing staging D1s
and an empty backup bucket. This is a six-table synthetic slice, not a complete
Business/Auth/Storage backup. It does not apply Stripe business effects, test
Storage-object recovery, freeze Supabase writers/Cron, or import real user
data. Issue #37 remains open; the details and exact private artifact digest are
in [cutover-rehearsal.md](cutover-rehearsal.md).

## Shared D1 operation timestamp formatter (2026-09-28 JST)

Replaced the duplicated UTC millisecond-padding expression in availability,
Stripe plan/extension checkout, availability-rule edits, notification-admin
manual-event/master updates, and owner fanmark-profile writes with the common
`workers/api/src/utc-timestamp.ts` formatter. Existing caller-specific invalid
clock checks and monotonic update rules remain in place. The shared formatter
has direct boundary/invalid-clock tests; all affected focused API suites pass
48/48 and Worker typecheck passes. This does not close the full writer/default
inventory behind v11 `timestamp_import_precision` and
`timestamp_default_requires_operation`. No source rows, remote D1, deployment,
user data, or domain/DNS state changed.

The same pass also replaced the remaining three local timestamp-padding
expressions for Stripe plan-checkout, customer-creation, and plan-change
idempotency deadlines with the shared formatter. Their D1 integration suites
were rerun successfully (17/17); Worker typecheck remains clean.

The same formatter now supplies the default clock for public-access logging
and Stripe webhook application. Their public-access tests pass 13/13 and the
Stripe webhook/invoice/reconciliation D1 suite passes 59/59. Worker typecheck
and Wrangler dry-run bundle validation also pass; no deployment was made.
The canonical implementation now lives in `utc-timestamp.mjs`, with a typed
TypeScript re-export. Verified-access timestamp creation and scheduled expiry
run capture use the same implementation; their tests pass 10/10 and 8/8,
respectively. Typecheck and Worker dry-run pass after adding the declaration.

## Lifecycle trigger timestamp repair (2026-09-28 JST)

A fresh schema-only Supabase catalog showed 22 lifecycle-generation triggers
still emitting three-digit SQLite `%f` timestamps. Added the guarded forward
migration `0017_lifecycle_generation_timestamp_precision.sql`, generated from
the private mode-0600 schema catalog, to replace those 22 definitions without
rewriting applied migration `0002`. The staging apply verified the expected
account, database, ledger, and old trigger shape, then read back all 24 exact
canonical trigger definitions with zero pending migrations. A full isolated
Wrangler replay and synthetic D1 integration test passed; a live synthetic
write also returned six-digit UTC text.

A follow-up deployed scheduled-event canary preserved the two configured
baseline Cron triggers and used a one-off lifecycle schedule. Wrangler's D1
API returned 7403 while the harness polled for the scheduled result, so that
run is incomplete. The harness cleaned up its synthetic rows and redeployed
the staging config; deployment `7f7c79e9-9d12-401c-9466-2518d03b195c` is the
latest 100% version. The prior successful lifecycle Cron canary remains the
scheduler evidence; this attempt does not replace it or close final lifecycle
acceptance. No production data, user data, or domain/DNS was touched.

## Business migration-ledger verification (2026-09-28 JST)

The business staging migration history now has one explicit ordered manifest
through `0017_lifecycle_generation_timestamp_precision.sql`. Guarded staging
verifiers validate that the live ledger is an exact prefix of this manifest,
so later approved migrations no longer make an earlier migration's read-only
verification fail. The manifest test compares every entry with the checked-in
SQL migration directory and rejects gaps, reordering, duplicates, and unknown
names. The migration-data suite passes 177/177.

`apply-stripe-invoice-staging.mjs --verify` and its repeatable `--apply` path
successfully read the current 18-entry staging ledger, the four expected
invoice objects, and zero invoice, receipt, dispatch, and billing-application
rows. Because the invoice migration was already present, `--apply` followed its
read-only verification branch. The business-extension verifier also uses the
shared ledger guard; its live read-only run still requires the private
credential descriptor and was not performed in this environment. No user
data, production route, or domain/DNS state changed.

## Lifecycle Cron canary retry diagnostics (2026-09-28 JST)

The latest guarded lottery-Cron retry completed 47 remote Business D1 reads;
read 48 started before the harness exited with
`staging_cron_disable_failed`. The finalizer attempted to redeploy the baseline
Worker and delete the synthetic fixture, but no successful deployment receipt
or post-cleanup D1 readback was recorded. The current Cron configuration and
canary-row cleanup are unverified, and this attempt is not a passing canary.

Fresh Wrangler identity comparison shows that the stored CLI OAuth profile
does not include the staging account. Read-only `d1 info` and `deployments
list` calls against the configured account fail with Cloudflare authentication
error 10000. The open Dashboard D1 Studio route also returns 404 with
`Unauthorized to access requested resource`. No remote configuration or rows
were changed during these checks. Public route probes only establish basic
health and cannot establish Cron/deployment/cleanup state.

The canary now retains sanitized summaries for its original failure, Cron
restore failure, and synthetic cleanup failure; focused tests cover redaction
of credential-like values and emails. Retry the state readback only after the
Wrangler profile has access to the staging account, then verify the current
Worker version/triggers and zero canary rows before another scheduled canary.
No user data, production route, or domain/DNS state was read or changed.

## Current Supabase catalog gate refresh (2026-09-28 12:07 UTC)

The reviewed catalog-only query was rerun non-interactively with
`npx supabase@2.118.0 db query --linked --file scripts/migration/schema-readiness.sql
--workdir <private-temp-project> --output-format json --yes` under `CI=1`.
Its `BEGIN READ ONLY` transaction observed 40 tables, 406 columns, 144
constraints, 139 indexes, 15 enums, one view, 58 functions, 36 triggers, and
77 RLS policies at `2026-09-28T12:07:48Z`; no application rows were queried.

Schema-converter v11 with the value-free credential descriptor still reports
`deployable: false`, 13 unresolved groups / 226 locations (8 row-conversion /
133 locations, 5 schema-operation / 93 locations). Per-gate counts are array
9, bigint 3, credential transform 1, decimal 1, external Auth reference 11,
JSON 13, money cents 2, sequence state 1, timestamp default 79, timestamp
import 103, and unsupported catalog scope 3. This refresh changed no source or
target state; the catalog and report were kept in memory and the temporary
project-link directory was removed.

Unauthenticated public GETs at `2026-09-28T12:13Z` returned 200 for `/`,
`/robots.txt`, Better Auth health, and a null anonymous session; anonymous
admin session returned 401 and the disabled Stripe webhook returned 404. The
root and robots response both include `X-Robots-Tag: noindex, nofollow`. These
are route-health checks only and do not establish the deployed version, Cron
configuration, or post-canary cleanup.

## Four-provider synthetic OAuth callback contracts (2026-09-28 JST)

Extended `workers/api/test/auth-d1.test.ts` to run successful synthetic
authorization-code callbacks through the app Worker and local Auth D1 for
Apple, Google, GitHub, and Discord. Provider fetches are fully stubbed. Tests
assert verified-email linking to the existing synthetic UUID, social-account
identity persistence, session issuance, and no new user row. Apple’s
`form_post` callback redirect to the follow-up GET is included. A separate
Google callback for a verified but unlinked email returns `signup_disabled`
without creating a user, account, or session. Existing start/state-denial
coverage still tests all four providers, including rejection of a tampered
state with `state_mismatch`. A Google identity with the existing email but
without a provider-verified email returns `account_not_linked` and adds no
account or session.

`npm --prefix workers/api run test:auth:d1` passes 27/27;
`npm --prefix workers/api run test:auth-social` passes 3/3; Worker typecheck,
focused ESLint, and `git diff --check` pass. Only synthetic credentials and
provider responses were used; there were no real OAuth requests, remote D1
writes, deployments, user-data operations, or domain/DNS changes. This is
local callback-contract evidence, not provider-backed staging acceptance.

## Exact money and descriptor-bound credential import (2026-09-28 JST)

Removed the blocking `money_cents_import` schema gate for the two explicitly
mapped source columns, `fanmark_tiers.monthly_price_usd` and
`fanmark_availability_rules.price_usd`. The migration codec now requires the
canonical PostgreSQL `numeric(10,2)` text form, converts with integer
arithmetic, and bounds the result to the exact signed cent range. Generated
D1 DDL rejects non-integer and out-of-range cents. Existing Worker integrations
cover the corresponding reversible read/write API projections.

The full migration-data suite passes 181/181; focused availability-rule admin,
availability/reference-master, reference-master release, and reference-master
API suites pass 4/4, 4/4, 5/5, and 6/6. The exact credential target-profile
importer is also covered by the synthetic 40-table replay, including transformed
active credentials, durable inactive-row deferral, ACK-loss resume, and typed
readback; the generic importer still refuses a missing target profile. The full
migration-data suite passes 182/182. Root and Worker typechecks, focused ESLint,
and `git diff --check` pass. Schema-conversion version 13 rejects older snapshot
manifests, which must be re-exported. The same catalog shape now has 11
unresolved gates across 223 locations (6 row-conversion / 130 locations, 5
schema/operation / 93 locations) and remains `deployable: false`. This is
synthetic/local codec and API evidence only; no Supabase rows, remote D1, Worker
deployment, production route, or domain/DNS state was changed.

## Exact lottery-weight decimal import contract and schema converter v14 (2026-09-28 JST)

The verified lottery lifecycle already parses stored weights as exact decimal
text and computes weighted draws with `BigInt`; the migration report had kept a
generic decimal gate because that complete importer/operation contract was not
bound to the catalog. Added the dedicated
`lottery-weight-positive-decimal-text` codec, emitted only for
`fanmark_lottery_entries.lottery_probability` when the catalog confirms the
non-null numeric column and validated `positive_probability` CHECK. A shared
256-character limit now governs both row import validation and the Worker
selector. Zero/negative, noncanonical, and over-limit source text fails before
a D1 binding is produced; other generic decimal columns remain gated.

A linked read-only aggregate over only the current probability column returned
no noncanonical/nonpositive or over-limit values. It contained no row IDs or
values and was not saved. A fresh descriptor-aware catalog conversion reports
10 blocking groups / 222 locations (5 row-conversion / 129, 5
schema/operation / 93) and remains `deployable: false`. Schema converter
version 14 and D1 import codec version 4 make prior manifests/checkpoints fail
closed rather than silently resuming with changed validation.

`npm run test:migration-data` passes 183/183, Worker lottery API passes 12/12,
lifecycle source integration passes 25/25, Worker typecheck passes, and the
focused converter/snapshot suites pass. No user rows were exported/imported,
no remote D1 or production state changed, and domain/DNS was untouched.

## Exact event sequence import profile and schema converter v15 (2026-09-28 JST)

The existing snapshot format 4 and D1 importer already capture the exact
`fanmark_events_id_seq` definition and state, then seed and verify the target
`sqlite_sequence` watermark after importing rows. Called and unused sequences
are both covered by integration tests, including the next generated event ID.
The schema converter's extra `sequence_state_import_required` gate duplicated
that fail-closed contract and is now removed only when the catalog matches the
exact supported event sequence profile. Other nextval profiles remain gated.

The schema converter advances to v15. A fresh linked, read-only schema
catalog conversion at 2026-09-28 14:25 UTC reports 9 groups / 221 locations
(4 row-conversion / 128, 5 schema/operation / 93); it remains
`deployable: false`. The query returned no application rows. The actual
PostgreSQL sequence state was not queried; it remains a final-freeze requirement
because sequence advancement is outside MVCC. Schema conversion, snapshot-format validation, D1-import tests, and
`npm run test:migration-data` cover the contract. No user rows, live sequence
values, remote D1, production route, or domain/DNS state changed.


## Internal bigint event key and schema converter v16 (2026-09-28 JST)

The linked schema catalog has three bigint columns. The Worker projects the two
discovery counters as numbers, so those import/read-precision gates remain. A
source-code audit found that `fanmark_events.id` is not selected or returned by
Worker code; the table is insert-only at that boundary. The exact importer stores
the signed 64-bit ID without Number conversion, and the snapshot contract
restores the sequence watermark. Schema converter v16 removes the bigint gate
for this column only when the exact supported sequence contract is present.

A fresh linked, read-only schema catalog conversion at 2026-09-28 14:30 UTC
reports 9 groups / 220 locations (4 row-conversion / 127, 5 schema/operation /
93) and remains `deployable: false`. It returned no application rows or live
sequence values. Focused schema/snapshot tests pass 37/37, and the complete
migration-data suite passes 184/184 with no skips.


## Snapshot-validated array schema gate and converter v17 (2026-09-28 JST)

The supported array row envelope already carries per-column SQL-NULL state,
dimension count, and lower bound. Conversion accepts only `text[]`, `uuid[]`,
and `smallint[]`, rejects nested/non-1-based arrays and invalid elements, and
preserves order, duplicates, element NULLs, and empty arrays. These checks run
for each snapshot row before target binding, so the schema converter now shares
the supported type list and suppresses the redundant pre-import array gate only
for these types; an unsupported PostgreSQL array remains blocked.

A fresh linked, read-only query completed without terminal input at
2026-09-28 14:43 UTC and returned the same 40 tables / 406 columns; its nine
arrays all use the three supported types. The v17 report removes the array
gate's nine locations and has 8 groups / 211 locations (3 row-conversion / 118,
5 schema/operation / 93), still `deployable: false`. Focused schema/row tests
pass 27/27 and the complete migration-data suite passes 185/185 with no skips.
No application rows or live sequence values were read.


## Timestamp writer coverage inventory across Workers and migration SQL (2026-09-29 JST)

The read-only schema catalog was refreshed at `2026-09-28T15:14:18Z` using the
reviewed catalog-only query. It still contains 40 tables and 79 columns with
`timestamptz DEFAULT now()`; no application rows were queried. The static
writer audit now scans Worker `.ts`/`.mjs`, app and business D1 migration SQL,
and migration seed SQL. It parsed 98 INSERT column lists with zero timestamp
columns omitted and zero target INSERTs it could not parse.

Twelve timestamp defaults in seven tables have no direct INSERT in those
surfaces. Eight columns across `fanmark_tiers`, `languages`,
`reserved_emoji_patterns`, and `fanmark_tier_extension_prices` are loaded
through the versioned reference-master row snapshots; those tables are read
through release views in the Worker. The other four are
`notification_preferences.created_at/updated_at`, `user_roles.created_at`,
and `notifications_history.created_at`. These are user-owned or legacy data
surfaces and remain for the final data/import disposition. The audit reports
them as unmatched rather than treating the absent direct INSERT as coverage.
It is a column-list inventory only and does not prove transaction-time clock
semantics or close the 103-column operation timestamp gate.

The audit found that the active-to-grace prototype in
`workers/api/src/license-expiry.mjs` omitted `audit_logs.created_at`. It now
binds the same captured operation timestamp used for that transition, and its
local D1 fixture requires and reads back that timestamp. `npm run
test:migration-data` passes 188/188 under Node 22.6.0; the license-expiry D1
integration passes, as does the source-profile lifecycle integration (25/25).
This changes only local source and tests: no production Worker, user data, D1,
or DNS/domain state changed.

## Timestamp writer audit detail and reference-master precision (2026-09-29 JST)

A read-only refresh of the schema catalog completed at
`2026-09-28T19:48:21.174176+00:00` and still found 40 tables with 79 timestamp
defaults. The static audit parsed 98 target INSERTs with none unparsed; its
report now records each writer's source file, line, table, and timestamp-default
columns so the next step can trace bound values per operation. The 12 defaults
without a direct INSERT are the eight timestamps on the four versioned master
tables and four final data/import fields: `notification_preferences.created_at`,
`notification_preferences.updated_at`, `notifications_history.archived_at`,
and `user_roles.created_at`. This remains column-list evidence only; it does not
prove runtime clock semantics, and coverage remains incomplete.

The shared exact-UTC-microsecond validator now protects both reference-master
release imports and admin edits that restage the active snapshot. It preserves
valid six-digit timestamp bytes (`Z` or `+00:00`) and rejects rounded,
impossible-calendar, or non-UTC values before a target release write. Focused
release/API/service and validator tests pass; the admin API regression test
also confirms a malformed active timestamp is rejected before any stage or
batch write. Worker TypeScript typecheck passes. No production Worker, real
user data, remote D1, or DNS/domain state changed.

## Stripe invoice webhook dispatch wiring (2026-09-29 JST)

The existing signed Supabase webhook now routes `invoice.payment_failed`,
`invoice.payment_action_required`, and `invoice.payment_succeeded` through
durable receipt acceptance and an exact-ID dispatch lease. The handler retrieves
the current invoice and subscription from Stripe, then applies the fenced
invoice projection, payment fields, and receipt/dispatch terminal state in one
Supabase transaction. A terminal duplicate returns 200 without a Stripe read;
an active lease or retryable failure returns 503. The new RPC is defined in
`supabase/migrations/20260929170000_add_targeted_stripe_dispatch_claim.sql`.

The focused PGlite projection suite passes 28/28; the full
`experiments/stripe-receipts` `npm test` run exits successfully. Package
typecheck, Deno check for the webhook, targeted ESLint, and `git diff --check`
also pass. This remains local code and test coverage: the migration was not
applied, the webhook was not deployed, and no Stripe API call, user-data
migration, D1 change, or DNS/domain change was made. Issue #32 remains open
because subscription, checkout, and deletion paths still need to be brought
under the same dispatch guarantees.

## JSONB snapshot/import gate and schema converter v19 (2026-09-29 JST)

The `jsonb` snapshot projection wraps PostgreSQL text as an outer JSON string;
the row codec validates the text and preserves it byte-for-byte for the D1
binding. Generated D1 DDL checks `json_valid()` without conflating SQL `NULL`
with JSON `null`. Real SQLite tests read back both null forms distinctly and
retain a nested high-precision decimal unchanged; invalid JSON text is rejected.
The schema converter no longer emits `json_import_validation` for this reviewed
codec contract and advances to v19 so older snapshots cannot claim the new
gate disposition.

Against the last recorded schema shape, this removes 13 JSONB locations and
reduces the calculated report from 7 groups / 209 locations to 6 / 196 (1
row-conversion / 103; 5 schema/operation / 93). No fresh schema query was run,
so this is not a refreshed live report and the converter remains
`deployable: false`. `npm run test:migration-data` passes 190/190 under Node
22.6.0. This work changes local conversion code and tests only; no Supabase
application rows, remote D1, production route, user data, or DNS/domain state
changed.

## D1 business timestamp comparison repairs (2026-09-29 JST)

The invitation capacity guard from applied migration `0014` and coupon
application guard from applied migration `0015` compared timestamp text through
SQLite `julianday()`, which collapses distinct UTC microseconds. Forward
migrations `0018_invitation_capacity_timestamp_precision.sql` and
`0019_extension_coupon_timestamp_precision.sql` recreate those guards with
lexical comparisons on the fixed-width UTC timestamps. The canonical business
migration sequence and Miniflare integration fixtures include both forward
migrations. Tests verify that invitation/reservation expiry, coupon expiry,
transfer locks, and active-license cutoffs retain a one-microsecond difference.

The invitation signup suite passes 10/10, the coupon application suite passes
8/8, and the analytics, details, and Stripe extension-checkout suites pass
20/20. The complete migration-data suite passes 190/190 under Node 22.6.0.
These migrations have not been applied to staging; no source rows, remote D1,
production route, or DNS/domain state changed.

## Schema converter v20 timestamptz import gate (2026-09-29 JST)

The converter previously emitted `timestamp_import_precision` for every
`timestamptz` column even though the complete import path preserves that value
exactly: the PostgreSQL snapshot projection formats UTC microseconds with
`to_char(..., '...US...')`, the row codec validates and returns the six-digit
text without passing it through `Date`, the generated D1 CHECK enforces the
canonical shape, and the Miniflare importer test independently reads back the
same `.123456Z` value. Invalid dates, fractions, offsets, and infinity are
rejected. Default and future-operation clock semantics remain covered by the
separate `timestamp_default_requires_operation` gate.

Schema converter v20 removes only the now-redundant import gate and increments
the conversion version so older manifests cannot silently resume under the new
gate disposition. On the last recorded catalog shape, this removes 103
locations and reduces the calculated report from 6 groups / 196 locations to
5 schema/operation groups / 93 locations. The converter remains
`deployable: false`; no fresh Supabase schema fetch or application-row query
was made. `npm run test:migration-data` verifies the codec, generated DDL, and
synthetic importer contract.

## Business-to-Auth identity preflight (2026-09-29 JST)

The local D1 importer now supports only the reviewed cross-database edge
`public.<uuid-column> -> auth.users(id)`. With the local unresolved-gate option
enabled, it scans and verifies each referencing snapshot stream before creating
the business D1 import ledger. Every non-null identity is checked in batches
of at most 100 through an injected read-only `resolveAuthUserIds` callback;
missing callback results or absent Auth IDs abort before any D1/report write.
Optional NULL values do not require an Auth lookup. No placeholder identities
are created, and the schema report remains `deployable: false` because D1
cannot enforce a foreign key across the separate Auth and business databases.

The local Miniflare tests verify success, missing resolver, absent Auth ID,
NULL handling, and zero target writes on preflight failure. The focused D1
import tests pass 20/20 and `npm run test:migration-data` passes 191/191 under
Node 22.6.0. The 40-table current-catalog synthetic rehearsal reconciles all
40 checkpoints and 10 synthetic rows, including the two transformed and one
deferred credentials. No Supabase application rows, real credentials, remote
D1/R2 state, production route, or domain/DNS state were accessed or changed.

## Scheduled Stripe timestamp precision (2026-09-29 JST)

The scheduled Stripe webhook dispatcher used `Date#toISOString()` for its
explicit D1 operation timestamp, yielding three fractional digits while the
migration contract requires six. It now uses the shared UTC microsecond
formatter and rejects invalid Worker schedule times before invoking dispatch.
A focused test verifies exact `.000000Z` and `.123000Z` output and invalid-time
rejection. The Stripe invoice-projection integration suite passes 12/12 and the
Worker typecheck passes under Node 22.6.0. No remote state changed.

## Current PR validation and read-only staging smoke (2026-09-29 05:43 JST)

PR #41 at `787036c` passed both GitHub validation jobs in run `36480072183`:
the Cloudflare staging application and Worker API/D1 contract suites. Its
Supabase Preview job was skipped by workflow design. The PR remains a draft.

A read-only HTTP smoke against the configured workers.dev URL returned 200 for
the app root, `/robots.txt`, Better Auth `/api/auth/ok`, and
`/api/auth/get-session`; anonymous `/api/admin/session` returned 401 and
`/api/stripe/webhook` returned 404. These checks confirm route health and the
intended closed Stripe route, but do not identify the deployed version or
verify D1/R2 state. Wrangler `whoami` still returns the fragrance.radio account
while the staging config targets the fanmark.id account. No remote D1/R2 write,
deployment, production route, user data, or domain/DNS change occurred.

## Scheduled Stripe dispatcher microsecond compatibility (2026-09-29 JST)

The dispatcher converts Workers `scheduledTime` into fixed-width UTC
microseconds. The invoice and subscription projection entrypoints previously
validated only JavaScript's three-digit `Date#toISOString()` form, so both
scheduled paths returned `retryable` before application. They now normalize
millisecond clock strings and exact microsecond strings, and lease-duration
arithmetic preserves the final three fractional digits. Regression tests run
the synthetic D1 dispatcher with a six-digit scheduled timestamp and read back
the exact application timestamp. Shared timestamp tests pass 6/6; the full
Stripe webhook/receipt/dispatch/invoice/subscription suite passes 63/63, and
Worker TypeScript checking passes. No Stripe API call, user data, remote D1,
production deployment, or domain/DNS change occurred.

## Wrangler target-account authentication and business trigger migrations (2026-09-29 JST)

Created the dedicated `fanmark-staging-inapp` Wrangler profile through the
Cloudflare OAuth flow and bound it to this managed worktree. `wrangler whoami`
confirmed `fanmark.id@gmail.com` and the account ID pinned by the staging
configs (`bfc2890741f0b3fb236e2d755b6c9adc`). The profile has the D1 and Worker
scopes used by staging commands; it does not include public route or DNS scopes.
The pre-existing `default` profile remains associated with a different
account and was not used.

Read-only inventory found the three configured staging D1 databases and the
avatar, cover-image, and private migration-backup R2 buckets. Auth and emoji
master D1 had no pending migrations. Business D1 had only
`0018_invitation_capacity_timestamp_precision.sql` and
`0019_extension_coupon_timestamp_precision.sql` pending. Before applying them,
the invitation code/attempt tables, coupon-use table, and coupon-application
command table each had zero rows; the four non-user coupon master rows remained
present. The two local focused suites passed: invitation signup 10/10 and
extension-coupon application 8/8 (Node 25.5.0).

Applied both forward migrations to the account-pinned APAC staging business
D1. Wrangler reported success for each migration, and the remote migration
ledger now reports no pending migrations. Readback confirmed both trigger
definitions use the exact fixed-width timestamp comparisons from the checked-in
SQL. The five preflight counts were unchanged (0, 0, 4, 0, 0), and D1 reported
zero rows written by the readback. This changed staging schema only; no
application rows were imported, no Supabase migration or Worker deployment
was run, and production routing, real user data, Stripe configuration, and
domain/DNS remain untouched. This supersedes the earlier note that the
account mismatch blocked all Wrangler readback and writes.

## PR #41 application staging deployment (2026-09-29 JST)

The current checked-in application Worker was deployed to the APAC
`fanmark-app-staging` workers.dev service after the staging build, Worker
typecheck, and Wrangler dry-run succeeded. Wrangler reports version
`f6c3ee8d-baca-4938-853c-1ba3b1eaaa62` at 100%. The deployed JS asset
`/assets/index-B6IkPHSy.js` is 2,499,186 bytes and its SHA-256 matches the local
staging build (`c3cb8dcd9a722255414e4c48c841a12de36455a9ae2907ed5535b10765001b74`).

Read-only HTTP checks returned 200 for `/`, `/robots.txt`, `/api/auth/ok`, and
`/api/emoji/catalog`; the catalog and health responses are `no-store`. An
anonymous `/api/admin/session` returned 401 and `/api/stripe/webhook` returned
404, as the Stripe webhook selector/secrets are not enabled. Post-deploy
readback found zero notification events/inbox/history rows and zero Stripe
receipt, dispatch, application, subscription-return, extension-application,
plan-checkout, or plan-change rows. Both declared Cron schedules remain
configured; no real email, payment, user data, production route, or domain/DNS
was exercised or changed. This staging deployment improves runtime evidence
but does not materially change the coarse migration progress estimate.

## Persisted-log staging Cron probe and CI (2026-10-02 JST)

Commits `d461c33` and `9561109` add a guarded synthetic Cron observability
probe, focused tests, and explicit failure/cleanup targets. The temporary
Worker `fanmark-cron-observability-a5f6043b` was deployed using the dedicated
`fanmark-staging-inapp` profile with an every-minute Cron, no D1/R2/secret
bindings, and persisted Workers Logs enabled at full sampling with invocation
logs included. A synthetic GET returned 200 and appeared in its Worker-specific
saved logs. More than 15 minutes after deployment, that view still contained
only the GET and no scheduled invocation record. The probe was deleted, and a
post-delete deployment readback returned Cloudflare error 10007 (Worker does
not exist). The three existing staging D1 databases remain the only D1s in the
account inventory. The existing `fanmark-app-staging` request-log settings
were not changed; its saved logs remain disabled.

The probe tests pass 4/4; `npm run test:migration-data` passes 198/198;
`npm run check:ci`, `npm run typecheck`, targeted ESLint, and `git diff --check`
pass. GitHub Actions run `36892893711` passed both staging-application and
Worker-API jobs on head `9561109`. Repository-wide `npm run lint` still fails
on existing unrelated/generated files (105 errors and 27 warnings); targeted
lint for the changed files passes. The empty Cron log confirms that the
configured persisted-log pipeline did not record a scheduled invocation, but
does not by itself distinguish non-delivery from invocation-log visibility.

Cloudflare says Cron trigger changes may take up to 15 minutes to propagate,
new Workers may take up to 30 minutes to show historical Cron Events, and
Workers Logs can persist Cron invocation records. The probe exceeded the
propagation window and verified the logging configuration. See [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
and [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).
Do not repeat the full synthetic recovery drill until this invocation path is
understood. No real user data, production routing, or domain/DNS state was
accessed or changed.

## Observability query permission check (2026-10-02 JST)

A dry-run event query filtered to the disposable Cron probe was sent to the
Cloudflare Workers Observability telemetry API using the dedicated Wrangler
profile. The API returned HTTP 403 `Authentication error`; no event data was
read and no query was saved. The Wrangler credential was not printed or stored.
Cloudflare's API reference lists `Workers Observability Write` as an accepted
permission for the query endpoint. The existing profile therefore cannot
perform this direct API readback; continue after that scope is granted or use
the browser Query Builder through an already-authorized dashboard session.
This check did not change Worker settings, D1/R2, production routes, or user
data. See [Workers Observability API](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/)
and [Query Builder](https://developers.cloudflare.com/workers/observability/query-builder/).

## Delayed Cron delivery and synthetic post-write recovery (2026-10-02 JST)

The isolated 33-minute app-bundle Cron probe subsequently received its first
scheduled invocation about 19.5 minutes after deployment and then received
repeated invocations. The Worker-specific tail showed successful scheduled
outcomes; the dashboard Past Events view remained empty past its advertised
window. The temporary Worker was deleted and its workers.dev URL returned 404.
This resolves the earlier uncertainty about runtime delivery; the dashboard
history remains stale and is not the source of invocation proof.

After CI run `36928505518` passed both required jobs on `c73f121`,
`npm run test:migration:staging-postwrite-recovery` completed successfully
using only disposable synthetic data. The run took 27m 1s
(`2026-10-01T21:30:45Z`–`2026-10-01T21:57:46Z`), verified 20 business and 3
Auth D1 migrations, applied and recovered a synthetic Stripe extension,
reconciled D1 Time Travel in 18,362 ms, and verified/replayed the encrypted R2
bundle in 50,668 ms. The synthetic avatar survived Time Travel and was also
restored from the encrypted bundle. A storage upload during write freeze was
rejected with `503 cutover_write_freeze`. Cleanup readback confirmed deletion
of the temporary Worker, both D1 databases, temporary config, R2 objects,
synthetic avatar, and private recovery artifacts.

This is staging recovery evidence for #37, not real-user migration or a full
cutover acceptance. Provider sandbox acceptance still needs Stripe and Resend
credentials set directly in Cloudflare; user/Auth/Storage migration and
public domain/DNS cutover remain deferred to #38. No production route, real
user data, live payment, email delivery, or domain/DNS was changed.

## Fresh Supabase catalog and current-schema importer replay (2026-10-02 JST)

Re-ran `scripts/migration/schema-readiness.sql` through Supabase CLI 2.118.0
with `CI=1`, `--linked`, and the explicit configured project ref. The query
completed at `2026-10-01T22:10:49Z` and returned 40 tables, 406 columns, 144
constraints, 139 indexes, 15 enum labels, one view, 58 functions, 36
non-internal triggers, and 77 RLS policies. The SQL is wrapped in
`BEGIN READ ONLY` and queries catalog metadata only; no application rows or
live sequence values were read. Private catalog artifacts were stored in a
mode-0700 temporary directory and removed after validation.

The value-free descriptor plus converter v21 reports no row-conversion gates
and five schema/operation groups / 93 locations: 11 external Auth references,
79 timestamp-default operations, and three unsupported catalog scopes
(functions, RLS policies, and triggers). It remains `deployable: false`.
Under Node 22.6.0, `scripts/migration/test-d1-import-current-schema.mjs`
completed all 40 checkpoints with 10 synthetic rows, two bcrypt-transformed
active credentials, one durably deferred inactive credential, typed/hash
readback, and conflicting-coverage rejection. The scoped result is
`public_rows_reconciled`; `fullMigrationReconciled` remains false. No source
application rows or remote D1/R2 state was read or changed.

## 2026-10-02: expiry lottery Tier lookup follows split D1 roles

The source-shaped grace finalizer read `fanmark_tiers` from business D1 even
though app staging stores the active reference release in Master D1. The Worker
scheduled handler and MFA-admin lifecycle route now pass the explicit master
binding into the finalizer. For a pending lottery, business D1 supplies the
fanmark's tier level and Master D1 supplies its initial license duration; the
duration is then frozen into the existing durable lottery input. A missing
master binding stops before the lottery claim when this input has not yet been
saved. Retries use the frozen input, and no-pending expiry remains independent
of Master D1.

`npm --prefix workers/api run test:license-expiry-source` passed 25/25.
`npm --prefix workers/api run typecheck`, JavaScript syntax checks, and
`git diff --check` passed. A separate synthetic master adapter returned 47 days
while business D1 had no matching Tier row; the saved lottery input preserved
47, and a missing binding left the license unclaimed. No remote resources were
changed; staging expiry remains disabled pending the broader acceptance gate.

## 2026-10-02: converter v22 reviewed reference-master timestamps

Converter v22 gives a reviewed replacement disposition to exactly eight
`now()` defaults: `created_at` and `updated_at` on `fanmark_tiers`, `languages`,
`reserved_emoji_patterns`, and `fanmark_tier_extension_prices`. Import binds
canonical source timestamps to source-shaped rows; Worker reads and admin
writes use active versioned Master D1 releases. A repository audit checks that
no direct Worker or migration SQL `INSERT` targets those base tables. The D1
DDL still omits the defaults; all unrelated `now()` defaults remain gated.

Against the catalog observed at `2026-10-01T23:36:56Z`, the converter reports
five blocking schema/operation groups / 85 locations: 11 external Auth
references, 71 timestamp-default operations, and three unsupported catalog
scopes (functions, RLS policies, triggers). It remains `deployable: false`.
Focused converter and source-audit tests pass 25/25. A v22 current-catalog
synthetic importer replay passed 40/40 checkpoints with 10 synthetic rows,
two transformed credentials, one deferred inactive credential, and conflicting
coverage rejection. The result remains `public_rows_reconciled`, with
`deployable` and `fullMigrationReconciled` false. No source rows, remote D1,
production route, or domain state was read or changed.

## Synthetic Auth MFA recovery extension retry (2026-10-02 JST)

Extended the disposable post-write recovery harness to provision an admin role,
enroll Better Auth TOTP, and include `twoFactor`, `adminRole`, `mfaAssurance`,
and `mfaGeneration` in the encrypted backup fixture. Credential sign-in now
completes the synthetic TOTP challenge. Secret and backup-code values are
compared by hash in memory and are never written to the diagnostic report.

The local Better Auth suite passed 6/6, migration-data suite 205/205, Worker
typecheck, script syntax, focused ESLint, and `git diff --check` passed. The
guarded Cloudflare attempt ran from `2026-10-02T05:36:12Z` to
`2026-10-02T06:13:01Z` (36m49s). It applied 20 business and 3 Auth D1
migrations; synthetic TOTP enrollment and `/api/admin/session` authorization
succeeded, and a synthetic avatar uploaded successfully. The Stripe extension
receipt remained `received/pending` with `attempt_count=0`; the harness timed
out in `wait_for_synthetic_cron_dispatch` before Time Travel or encrypted R2
backup/replay. Do not count this MFA recovery extension as a pass. The earlier
post-write recovery without MFA remains valid evidence for its narrower state.

Cleanup readback marked the temporary Worker, both D1 databases, temporary
config, and synthetic avatar deleted. The Worker URL returned 404, the D1 list
contained only the three expected staging databases, and the exact synthetic
avatar key was absent from R2. The avatar bucket still reported one 128-byte
object; no other key was inspected or changed. The encrypted backup stage was
not reached, so this run created no backup R2 object or private export files.
No real user/Auth/Storage rows, production route, or domain/DNS state changed.

The wider static writer audit at `2026-10-01T23:41:40Z` included Worker code,
all D1 migration SQL, and migration scripts/SQL. Across 79 timestamp defaults
in 40 tables it parsed 140 literal `INSERT` column lists. Twelve defaults had
no supported literal writer: eight reviewed versioned reference-master columns
and four user-scoped columns in notification preferences, archived history,
and user roles. Three generated `INSERT` statements for `emoji_master`,
`extension_coupons`, and `email_templates` remain unparsed. Column coverage and
timestamp-value/transaction-time proof remain incomplete.

## MFA-only post-write recovery slice (2026-10-02 JST)

Added the guarded `test:migration:staging-postwrite-recovery-mfa` command. This
mode deploys a disposable Worker without Cron and leaves Stripe dispatch
disabled, so Auth/TOTP, waitlist, avatar Storage, write freeze, D1 Time Travel,
and encrypted R2 backup/replay can be validated independently. The original
`test:migration:staging-postwrite-recovery` keeps its full Stripe assertions.

The run passed from `2026-10-02T06:38:35Z` to `2026-10-02T06:44:14Z`. It applied
20 business and 3 Auth migrations, verified synthetic TOTP/admin access, and
rejected five consecutive writes during freeze while allowing Auth sign-in.
Time Travel reconciliation preserved the acknowledged digest in 14,148 ms.
The encrypted two-object R2 bundle verified and replayed the exact synthetic
Auth MFA, waitlist, and avatar state in 49,247 ms. The avatar survived Time
Travel and was restored from the encrypted bundle.

Cleanup marked the temporary Worker, both D1s, temporary config, R2 objects,
synthetic avatar, and private artifacts deleted. Independent Wrangler readback
found only the three expected staging D1s and an empty recovery bucket; the
temporary Worker URL returned 404. Report:
`/var/folders/c4/_087tnms6n95sb58l4rg8vpw0000gn/T/fanmark-postwrite-recovery-d3ccc576579f61d4.json`.

This proves the isolated MFA/Auth + waitlist/Storage recovery slice only. It
does not close Stripe integration or full #37 acceptance. Issue #35 remains
blocked by five schema/operation groups / 85 locations (`deployable: false`);
#38 retains live user/Auth/Storage migration and domain/DNS cutover. No real
user data, production route, payment, email delivery, or domain/DNS was used or
changed.

## 2026-10-02 converter v23 and current-catalog import-only timestamp proof

A fresh `schema-readiness.sql` query completed at `2026-10-02T07:02:17Z` under
`BEGIN READ ONLY` and returned catalog metadata only (40 tables / 406 columns).
The v23 converter records three exact import-only timestamp dispositions for
`notification_preferences.created_at/updated_at` and `user_roles.created_at`.
The current Worker repository has no INSERT writer for those tables and no
notification-preference UPDATE writer; the generic importer binds the source
timestamp into the D1 row. Tests keep the target defaults absent and ensure a
new runtime writer cannot be added without revisiting the timestamp contract.

Converter v23 reports five blocking groups / 82 locations: 11 external Auth
references, 68 remaining timestamp-default operations, and three unsupported
catalog scopes (functions, RLS policies, triggers). The report stays
`deployable: false`; `notifications_history.archived_at` remains blocked while
the source archive operation's retention and target contract are unresolved.

The exact-catalog Miniflare replay completed all 40 checkpoints with 12
synthetic rows, two transformed credentials, one durably deferred inactive
credential, and six synthetic Auth identity resolver calls. Preference/role
timestamps read back exactly as six-digit UTC text; a tampered credential
coverage record was rejected. The status remains `public_rows_reconciled`,
with `fullMigrationReconciled: false`. No source application rows, remote D1,
R2, production route, or DNS/domain state was read or changed.

## 2026-10-02 full synthetic post-write recovery and Cron diagnostics

The prior MFA-integrated Stripe recovery attempt timed out before any synthetic
dispatch attempt. To separate Cron delivery from dispatch execution, the
temporary Worker now writes value-free `received`, `selected`, Stripe job
start/completion/failure, and freeze-pause records to a dedicated disposable
D1 binding. The diagnostics binding is absent from `fanmark-app-staging`; the
MFA-only rehearsal does not create it.

The guarded full rehearsal passed from `2026-10-02T07:50:30.142Z` through
`2026-10-02T08:00:31.163Z`. It applied 20 business and 3 Auth migrations to
disposable D1s, completed 5 synthetic signup/write-freeze probes (0 accepted,
5 rejected), and rejected an avatar upload with `503 cutover_write_freeze`.
The diagnostic D1 recorded 5 Cron receipts, 3 selected every-minute jobs,
3 Stripe dispatch starts/completions, and 2 pauses during freeze. The synthetic
extension receipt reached `applied/completed` in one attempt; its business
effect survived both recovery paths. No Stripe API request was made.

D1 Time Travel reconciliation completed in 19,638 ms. The verified encrypted
two-object R2 bundle replay completed in 64,368 ms. Synthetic admin MFA state,
waitlist state, Stripe extension state, and avatar bytes survived Time Travel
and were restored from the encrypted bundle. Cleanup reported true for the
temporary Worker, business/Auth/diagnostics D1s, local config, recovery-bucket
objects, synthetic avatar, and private recovery artifacts. Independent
readback found zero disposable recovery D1s, the Worker returned Cloudflare
`10007` (“does not exist”), and the private recovery bucket had 0 objects / 0
bytes. The avatar cleanup readback checked only the synthetic key.

Worker regression tests, Worker typecheck, focused Cron tests (8/8), migration
data tests (207/207), CI isolation, staging Worker dry-run, targeted ESLint,
script syntax, and `git diff --check` passed. This closes the synthetic
MFA/Auth + Stripe + waitlist + Storage recovery slice only. It does not prove
provider-backed Stripe/Resend/OAuth acceptance, production readiness, source
row parity, real user/Auth/Storage migration, or domain/DNS cutover. No
production route, live payment, email send, real user row, or domain setting
was changed.

## 2026-10-02 prepared MFA-gated local source for manual grace expiry

The read-only Supabase Function inventory still shows
`manual-expire-grace-licenses` ACTIVE at version 14 with platform JWT
verification. Its handler's service-role access was not protected by an
application admin or MFA check. Added a local replacement using the shared
admin role check and Supabase current-session AAL2 verification for the exact
request token; the MFA check fails closed. The function requires POST, pages
the due rows, conditionally updates the captured `grace` state/deadline, and
reports cleanup/audit errors.

Focused MFA tests passed 3/3; the function inventory/config contract covers
all 35 deployed names; Deno type checking, root application typecheck,
targeted ESLint, and migration data tests passed (218/218). The live version
was not invoked or deployed; its partial, non-transactional behavior and
possible external callers remain unresolved. No source rows or Cloudflare
resources were changed.

## 2026-10-02 staging notification archive canary

`npm run test:staging-notification-archive-smoke` passed with six unique
synthetic rows in the staging business D1 and a local scheduled Worker using a
temporary archive selector. It archived the two >90-day delivered/failed rows
with their exact payloads and explicit six-digit UTC archive timestamp, while
retaining four ineligible rows. The script's account/schema/master-baseline
guards passed; cleanup and independent readback found zero synthetic source or
history rows and preserved the existing master/public-settings baseline.
Auth stayed empty. No deployed Worker, Cron configuration, Supabase source
row, production route, actual user data, or domain/DNS setting changed.

## 2026-10-03 scheduled provider activation coverage

Stripe webhook ingress only persists receipt/dispatch rows; Stripe dispatch
and broadcast snapshot/delivery are routed by `* * * * *`. The current
notification-DO baseline registers only the daily Cron and keeps these provider
dispatch selectors off. Enabling a selector alone would leave its queue without
this scheduled execution path.

Added `scheduled-job-coverage.mjs` and `npm run check:cloudflare-schedules`
to compare enabled jobs in the base Wrangler config against registered triggers
and the actual Worker router. Cloudflare validation CI runs this check, and
workflow isolation requires the step. It covers notification Cron fallback,
Stripe dispatch, broadcast delivery, and default/custom expiry/archive schedules.
A minute Cron for Stripe/broadcast does not select notification polling with the
DO backend. Receipt-only frozen rehearsal and draft-only broadcast editing do
not need dispatch. Existing strict staging baseline/secrets guards are unchanged
and must be reconciled separately before provider activation.

Under Node 22.6.0 the first migration-suite run passed 276/276. After adding
a CLI failure-exit case, the focused coverage/selector suite passed 15/15
(11 coverage and 4 selector cases). Config CLI, workflow isolation, targeted
ESLint, and diff checks passed. CI `37068708453` for prior HEAD `a19d7e9`
passed both jobs; this new change still requires CI. This proves local
configuration coverage only, not remote Cron delivery, provider acceptance,
or production readiness. No remote Cron/selector/secret, deployed Worker,
source user row, or domain/DNS state changed. Combined remote profile-editor
and protected-favorites acceptance remains pending after the previous D1
daily-read quota rejection; no deploy/seed before the full guarded preflight.

## 2026-10-03 full-schema notifications and archive authorization

Replaced the reduced notifications fixture with all 25 canonical Business
migrations, including FK constraints and the 0024 wake triggers. Synthetic
notifications now reference real terminal events/disabled rules, and processor
fixtures supply the canonical required timestamps. Extracted the existing
checked-in SQL tokenizer for use by both notifications and search suites.
The first full-schema run exposed one response-size fixture without parent
rows; after fixing that seed, the existing API/processor checks passed.

Expanded archival checks to all 19 original fields, nested JSON, exact cutoff
and 1us before it, a delete-failure trigger proving insertion/deletion rollback
and successful retry, identical prior-history replay without timestamp rewrite,
and a 2,501-row backlog processed as 2,500 then 1. The first backlog assertion
incorrectly expected five batches; actual configured batches are 10 x 250.
This was corrected without changing the archiver. Node 22.6.0 native
notifications passed 19/19, shared-tokenizer search regression passed 12/12,
Worker typecheck, targeted ESLint, and diff checks passed.

The existing source catalog observed 2026-10-02T21:03:48.240925+00:00 confirms
archive RPC effective EXECUTE is false for anon/authenticated and true for
service_role. The history SELECT policy uses is_admin(), whose definition
checks auth.uid() and user_settings.plan_type=admin. Raw grants alone do not
prove RLS access. The target retains an internal archiver; no history-body HTTP
reader exists. Corrected object-map text that had described an admin reader
as if implemented. The archive definition/policy hashes and remaining custom
cutoff/external invocation gates are recorded in notifications-api.md.

This validates local notifications with the full Business schema and the
reviewed source authorization boundary. It does not prove all source callsites,
provider/email/Web Push behavior, recurring archive/retention operations, or
production fit. No remote Worker/Cron/selector/secret, Supabase user row,
real data migration, or domain/DNS state changed. Exact new-HEAD CI and guarded
remote editor/favorites acceptance remain required; remote D1 writes stay
pending the previous daily-read-limit rejection and full baseline preflight.

## 2026-10-03 align native notification/search Auth fixtures with staging

The previous full-Business-schema notification/search suites used only the
Auth core and omitted the staging suspension selector. Both now apply Auth
core/0007 signup marker/0008 suspension migrations and select
AUTH_USER_STATUS_BACKEND=d1. Added warmed-session checks after synthetic
suspension and native session revocation. The old cookie cannot read/list/count
or mark notifications read; all notification rows stay unchanged and another
user's session still works. Public search remains available as anonymous,
preserving aggregate lottery count while withholding the former owner's entry
ID. Both paths reject a new suspended-user signin with BANNED_USER/403 and
create zero sessions.

Node 22.6.0 native notifications passed 20/20 and search 13/13; Worker typecheck,
changed-file lint and diff checks passed. The fixtures emulate the committed
stop/revocation state; the existing admin-user-management suite separately
verifies MFA, audit and the transaction. No runtime application code,
remote deployment/config/rows, source data or domain/DNS state changed. This
closes the local API boundary with the staging Auth selector, not full Auth,
provider acceptance, import parity or production readiness. Current deployed
Worker remains the previous 010a4d7a. New exact-HEAD CI and D1 quota/full
preflight/native editor/favorite acceptance remain required.

## 2026-10-03 source processor parity and boolean segment correction

Read-only downloaded deployed process-notification-events ACTIVE version209;
before/after metadata matched and the 12,390-byte entrypoint matched checked-in
source SHA-256 986b46f37eb62ecf656e80ac357db406975e56ec5ad9b99d64a63b974cc0a301.
It delivers only immediate in-app notifications, leaving other/delayed results
pending. No direct fetch/functions.invoke was found; this is not proof that
other senders/external callers do not exist. No source invocation/deploy/config
change/user export was performed.

Source segment matching uses strict equality. D1's canonical integer boolean
requires_password_setup was compared without decoding, suppressing boolean
matches and incorrectly accepting numeric filters. Six full-schema native cases
reproduced four failures; decode only that column, reject invalid storage values,
and preserve strict comparison for numeric filters and other columns. After the
runtime fix, notifications26/26 and wake20/20 passed, as did Worker typecheck and
changed-file lint. Remote acceptance of this fix remains pending.

Prior b33c128 exact-HEAD CI37070883183 completed both jobs successfully. The
combined preflight pinned to that HEAD passed identity/config/version checks
but stopped on Business D1 API7500 daily-read quota before deployment or seeding.
Worker remains010a4d7a; the new runtime change requires new exact-HEAD CI and
re-pinned private scripts plus the full clean/identity/ledger/baseline preflight.
Source/user/domain/DNS and provider selectors remain unchanged.

## 2026-10-03 source locale/limit scope parity and CI repair

Source version209 uses a truthy payload language override and scopes cooldown/
max_per_user by fanmark ID only when nonempty. Target treated empty language as
an unavailable locale and empty ID as a filtered identifier, bypassing limits.
Two locale and eight limit-scope native cases reproduced three runtime failures;
fixed both paths while preserving nonempty strings and strict boolean segments.
Notifications36/36, migration-data277/277, Worker typecheck/lint/diff passed.
Initial fixture failures for forbidden settings language/missing triggered_at
were corrected and are not counted as runtime regressions.

CI37072572541 application failed because the timestamp writer test pinned line365
rather than verifying the archive INSERT's actual line374. Derive the expected
position from that INSERT, retaining writer-count/column/bind/native timestamp
checks. The full local migration suite now passes. Worker CI remained live while
these follow-up changes were prepared; do not reuse that run for the new HEAD.

Reviewed the live-catalog render_notification_template definition hash730aaec7.
It leaves five date placeholders, selects active ID/version/language and does
not select by channel. Target channel selection and JSONB text/key ordering/
numeric precision need further contract reconciliation; this is not full render
parity acceptance. No source function invocation or real-user data operation,
remote D1 query/write/deployment, provider activation or DNS change was performed.

## 2026-10-03 source PostgreSQL rendering oracle and runtime correction

Linked-source read-only literal query at2026-10-02T22:35:53.411044+00:00 uses
seven synthetic payloads and the source renderer's jsonb_object_keys/->>/replace
operations. No application/Auth relation or application function was accessed.
Preserved original input JSON order and recorded the source expected text/key
order. Checked-in notification-render-oracle.sql is hash-bound by the synthetic
notification-render-source.json fixture, with private collection diagnostics in
fanmark-source-render-jsonb-3AxUat. Never invoke the source processor for this proof.

The native suite reproduced8 failures: dollar REPLACE tokens, nested JSONB text,
array/decimal notation, cascaded and UTF-8 key ordering, and source-compatible
email/webpush rule lookup. Added notification-template-values.ts to match the
source Edge JSON round trip's JSONB output, replaced through literal callbacks,
and removed target-only template channel filtering. Non-in-app/delayed results
remain pending; no provider send was added. Also covered settings/explicit-payload
locale selection for ja/en/ko/id and inactive/version/language fallback.
Notifications53/53, wake20/20 and Worker typecheck/lint passed. This is local only.
Source arbitrary-precision/Unicode import gates and ambiguous multi-channel row
selection remain open; no public render RPC or source grants were added to target.

Prior ba1e901 CI37073066866 application completed successfully while Worker tests
remained live during this change. New HEAD requires its own complete CI; no stale
private deployment pin may be reused. No D1 deploy/query/write, source user data,
provider activation or domain/DNS operation was performed.

## 2026-10-03 full-schema owner profile and daily missed-wake recovery

Converted owner profile native tests from d1-fanmark-profile.sql to all25
canonical Business migrations and staging Auth core/0007/0008 with
AUTH_USER_STATUS_BACKEND=d1. Initial fixture failures were missing required
normalized emoji/start/incarnation data and invalid cleanup order, not runtime
API failures. Canonical license triggers now supply incarnations/access-version
rows; cleanup preserves native retirement triggers. Then three assertions failed
because config/profile seed advances access generation to2. The assertions now
compare before/after generations: a successful update adds1 and a write-barrier
grace transition refuses the update without changing profile/generation.
No canonical trigger or runtime ownership predicate was weakened.

A new actual Better Auth warmed-session case models the committed suspension
state: revoke owner sessions and ban the owner, GET/PATCH401 with unchanged
profiles/access-version rows, other-owner GET200, new signin403/BANNED_USER,
owner session count0. This does not replace admin MFA/audit/transaction proof.
Profile native9/9, Worker typecheck and changed-file lint passed. The unreferenced
reduced fixture is removed. Log: /tmp/fanmark-profile-full-schema-final.log.

Strengthened the actual Worker daily scheduled-entrypoint case: a missing
namespace bridge rejects while retaining the D1 request generation and NULL
alarm; daily0 0 * * * reaches expiry's finally despite its backend being unset,
arms/delivers/acks, and another daily call leaves the empty queue asleep. Wake
native20/20 passes (/tmp/fanmark-daily-wake-replay.log). This conditional replay
narrows the operational gap but does not make D1/DO commits atomic or establish
one-minute recovery after a lost bridge. No new minute polling was introduced.

Previous runtime head9bd59d1 exact CI37073821056 was freshly read as completed
with both jobs successful. Profile/wake test/doc changes need their own HEAD CI
before repinning private deployment/canary scripts. The scripts reject a dirty
working tree, allowing only the unrelated unstaged supabase/.temp/cli-latest.

Read-only provider inventory at2026-10-02T22:50:13.212Z pinned dedicated identity/
account and100% Worker010a4d7a before listing secret names. It observed only
BETTER_AUTH_SECRET, REFERENCE_MASTER_SERVICE_SECRET, VERIFIED_ACCESS_SECRET;
OAuth/Resend/Stripe required names were absent in secrets/checked-in vars.
Selectors are checked-in config observations, not remote plaintext-var reads.
No D1 query, source row, provider call or write occurred. The private report is
/tmp/fanmark-staging-provider-inventory.json; staging-provider-readiness.md now
records callbacks, credential/selector dependencies and real rehearsal gates.

These are local acceptance/preparation changes. Staging remains010a4d7a;
latest editor/favorites/catalog/notification fixes need quota recovery, fresh
baseline checks, deployment and actual browser/API acceptance. Real user/Auth/
business/Storage copy, provider sending/billing and domain/DNS remain untouched.

## 2026-10-03 actual local browser/Worker/split-D1 owner editor composition

Private harness initially failed SQLite statement length when all Business SQL
was concatenated. Applying all25 migrations individually in canonical order
fixed the harness without modifying runtime/schema. The private successful
report fanmark-local-editor-compose-LH5JH6/report.json proves actual HTTPS
loopback Auth/catalog/owner API and Chrome editor, no fulfilled API responses.
It uses all45 staging frontend selectors, an empty envDir, temporary config with
no account/routes/services, explicit remote:false D1/R2, 3 Auth and8 Master
migrations, two synthetic users and an eight-emoji release. No real user/source
data, remote D1 or provider requests were used.

The checked-in npm run test:staging-profile-editor-local also passed locally;
report fanmark-local-editor-compose-nvmT6c/report.json and log
/tmp/fanmark-editor-local-checked-in.log. It proves actual form signin/return,
exact whitespace/cold reopen, one network-layer PATCH refusal with unchanged
stored profile/draft retained, reload restoration and actual retry persistence/
draft removal, public/private reads, other-owner editor refusal, revoked-owner
signin redirect and Business foreign-key violations0. At390px no horizontal
overflow; no real-phone acceptance. Chrome blocks external origins and continues
every allowed request to the actual local Worker. Server is stopped and local
database state removed. Earlier private attempts' local state was removed too.

The application workflow now runs this composition alongside the offline
eight-case rendered regression. Both script files lint clean and workflow
isolation check passes. Cleanup additionally checks the loopback port is closed
before local-state removal. Final adapted run also passed: private report
fanmark-local-editor-compose-lDJonN/report.json and log
/tmp/fanmark-editor-local-cleanup-verified.log confirm serverStopped,
loopbackPortClosed and localDatabaseStateRemoved all true; the state directory
is absent.
Prior head a8f431d CI37075997456 is completed/both jobs success; the new script/
workflow/doc commit requires its own CI. Private remote scripts stay pinned to
the old HEAD and require repinning only after current HEAD CI/clean-tree checks.

This closes a local composed-editor evidence gap only. Latest staging deploy,
real editor/favorite browser acceptance, providers, source catalog/ops/CPU gates
remain open. Current staging is010a4d7a; no remote query/deploy/canary ran while
the D1 quota blocker remains. Live user-data and domain migration stay deferred.

## 2026-10-03 lottery audit integrity follow-up

The prior code returned200 in nine native new-application/reapplication/
cancellation × ignored/metadata-changed/deleted-audit cases. Full-schema test
setup was upgraded from a small fixture to all25 Business/4 Auth migrations,
actual credential sign-in/cookies and Worker router. The route now passes the
existing injected operation clock to the lottery handler (production default
remains current time). Each audit has a server-generated UUID; a same-batch
SQL assertion verifies its exact identity/owner/action/resource/time/metadata
and the intended entry state. A missing or changed record causes SQLite to
abort the entire D1 batch. No persistent assertion rows or new DDL are needed.
Native42/42 includes27 audit-integrity faults and safe retries, concurrent
apply/cancel, quota/perpetual limits, foreign owner/origin/client actor refusal,
claimed/stale licenses, real warmed-cookie revocation and both stores' FK checks.
Worker typecheck and changed-file ESLint pass. The dedicated suite is included
in Worker npm test via test:api-contracts-d1. These are local results; candidate
CI/deployment/remote lottery acceptance and other source writers/callers remain
open. Staging remains47b69c5/b5a07a34. No source/user rows, deployed selector/
schema, provider credential, DNS or source writer changed. Docs-only1cab106
CI37087626375 completed both jobs successfully without a redeploy.

### Lottery candidate staging acceptance

Code027a949 CI37088432269 completed both jobs successfully. Fresh full preflight
02:12:10Z retained Business ledger25, owned0, Master inventory and wake5:5.
Read-only Auth schema guard02:12:35Z required the existing four migrations, six
markers and four indexes, FK0/owned0/MFA generation unchanged; it refused any
missing schema rather than applying DDL. Guarded deployment02:13:36Z produced
Worker22a49009-e962-471d-81a1-c82a49b22d7c at100%. Static asset bytes/noindex
were checked at02:14:09Z. The actual remote API canary exercised ignored new
application audit, changed reapplication metadata and deleted cancellation
audit. All refused500 with entry/audit/event-set baselines preserved, followed
by200 safe retry/exact audit readback. The unique temporary triggers affected
only the fixture owner and were restored. Anonymous/extra actor/foreign cancel
were refused. Journalfanmark-lottery-audit-00uR5a ended verified-and-cleaned,
owned Business/Auth0/FK0 and invalidated cookies. Independent02:16:25.705Z
readback verified ledger25, unchanged Master/secrets and acknowledged wake7:7
(the canary legitimately advanced5→7; no shared wake state was reset). Current
provider starts/callbacks stay403/no-cookie, capabilities empty and anonymous
session null. Private acceptance: /tmp/fanmark-lottery-027a949-staging-acceptance.json.
Other lottery writers, full source runtime/RLS/callers, lifecycle/retention/ops,
real providers/phones and CPU/plan remain open. No real user data/source writer
or domain/DNS changed.

## 2026-10-03 transfer approval audit/effect integrity candidate

Reproduced prior200 responses for nine ignored/altered/deleted entry audits in
actual native D1, after upgrading the transfer suite to all25 Business/4 Auth
migrations and real credential sessions/router. A small Master Tier fixture
remains explicit. Added server audit UUIDs, a guarded pending-entry snapshot,
per-entry exact cancellation-audit assertions and an approval completion SQL
assertion inside the same D1 batch. The final check includes exact old/new
licenses, code/request, required configuration deletion/new inactive config,
transfer audit and outbox, so suppressed effects cannot leave a partial commit.
The existing router clock is supplied to the transfer handler only for injected
time; production uses the same default current clock. Capacity refusals still
return the existing409 when the recipient reservation total exceeds its limit.

Native37/37 checks ten entry-audit faults, three transfer-audit faults, eight
suppressed required effects, partial multi-applicant audit failure, uncaptured
native entry creation, pre-batch snapshot change without undoing its concurrent
write, no pending applicants, actual-session ownership/revocation and existing
capacity/transfer contracts. Each failed mutation compares full relevant row
snapshots including notification wake state, then retries safely. The original
real-session race can reject at preflight400 or conditional409; exactly one
reservation and the final recipient capacity are still enforced. All three
binding FK checks pass. Worker typecheck, changed-file ESLint, workflow isolation and bundle dry-run pass.
The dedicated suite was already included in Worker CI.

Docs-only3f4faac CI37089404509 finished both jobs successfully without deployment.
The current accepted runtime remains027a949/22a49009. New candidate exact-head
CI/deployment/remote fault acceptance remain pending. Account-deletion integrity,
source runtime/RLS/callers, lifecycle/retention/ops, real provider/phone and
CPU/plan acceptance remain open. No real users/providers/source writer/DNS
changed during this local slice.

### Transfer candidate staging acceptance

Code c6a4f9d CI37090152096 passes both jobs. Fresh preflight02:40:55Z retains
ledger25/owned0/Master inventory/wake7:7. Read-only Auth schema02:41:25Z verifies
existing four migrations, six markers and four indexes/FK0/MFA; no DDL runs.
Guarded deployment02:41:55Z produces71d1612f-5220-4bf1-bc7f-99cc43adbbd7 at100%.
Static JS/CSS/root/noindex/robots/sitemap match. Five real-session remote HTTP
faults pass: one of two applicant audits ignored/metadata-changed/deleted,
transfer audit ignored, old profile deletion ignored. Each500 preserves exact
approval rows and event IDs/requested wake generation. After removing the own-ID
scoped trigger,200 retries read back exact audits for both applicants/transfer,
old/new licenses, 30-day lock, config reset and outbox; repeat400 adds no rows.
The remote flow reads actual Master Tier1, beyond the native focused fixture.

Journal transfer-audit-5LT5tv ends verified-and-cleaned; three synthetic users,
fixtures/inboxes and fault trigger are removed, all trigger definitions restored,
both DB FK0 and cookies invalidated. Independent02:45:22.182Z readback verifies
Worker71d, owned0/ledger25, unchanged Master canonical3944/release7888/import/
active/history, MFA generation236 and the same three secret names. Wake advances
monotonically7→17 and is acknowledged17:17; it was not reset. Unconfigured
provider starts/callback GETs stay403/no-cookie and anonymous session is null.
Private acceptance: /tmp/fanmark-transfer-c6a4f9d-staging-acceptance.json.

The next account-deletion fixture is compatible with all25 canonical Business
migrations in isolated SQLite and FK0. This is preparation only; native Auth/
route integration and ignored/altered/deleted lottery/DELETE_ACCOUNT audit
reproduction are next. Per-license returns precede cleanup and their committed
grace transitions cannot be called part of a cross-store rollback. Full source/
RLS/callers, lifecycle/retention/ops, real providers/phones and CPU/plan stay open.
No real user data/source writer/DNS changed. Migration remains incomplete.


## 2026-10-03：退会の監査・cleanup・Auth削除をnative D1で検証

縮小Business fixtureを廃止し、全25 Business/4 Auth migrationと合成seedを実Worker router/Better Authの退会試験へ接続した。既存6ケースが通過してから、監査抑止/改変/削除とAuth user DELETEのIGNORE/ABORTを追加。修正前は4ケース失敗し、監査欠落とAuth DELETE抑止で誤った200、最後のAuth DELETEがABORTするとcredential/sessionだけ消える状態を実D1で再現した。ログは`/tmp/fanmark-account-deletion-fault-reproduction.log`。

業務cleanupに共通のuser-scope pending snapshot/取消audit guard、server UUID付きDELETE_ACCOUNT exact guard、所有行の削除/参照解除/履歴保持の終了assertionを同じbatchで追加した。Auth失敗からの再試行は既存退会監査のID・時刻・metadataを保持し、重複/不正内容を拒否する。Auth側は本人sessionと現在パスワードを再確認し、同じbatchでuser DELETE・FK cascade・全関連行不在を確定する。逐次SDK deleteUserは使わずendpoint自体も無効化し、commit後のSDK sign-outからcookieを個別に返す。

追加レビューで、事前のbilling確認後にD1顧客/契約linkが追加される2ケースも誤った200を再現した（`/tmp/fanmark-account-deletion-billing-race-reproduction.log`）。事前に確認したprofile/subscription snapshotとcustomer共有をBusiness batchで照合し、その値に一致するprojectionだけ削除する。batch途中の追加/改変も終了assertionで全cleanupをrollbackする。Stripeとの分散transactionを証明したものではない。

最終native66/66は、両監査それぞれの10種fault（計20ケース）、13 cleanup抑止、4保持行削除、5 Auth cascade抑止、Auth user IGNORE/ABORT、5 Auth identity race、2 Business race、4 billing race、2不正/重複retry audit、複数license応募の一部監査欠落と他人license保持、pending0、複数のwarmed sessionと別ユーザー保持、従来のパスワード/Stripe未設定/transfer/FK/本人/直接route閉鎖を含む。全test後にBusiness/AuthのFK0と別のAuthユーザー保持を確認した。ログ`/tmp/fanmark-account-deletion-final-native.log`。既存Auth47/47、frontend4/4、Worker型検査、focused lint、workflow isolation、staging bundle dry-runも成功。native Masterは不要な退会経路で、実provider課金・メール・ユーザーデータ移送は実施していない。

このcandidateはまだCI・配備・remote故障/rollback/retry/readbackを受け入れていない。現stagingは既存`71d1612f-5220-4bf1-bc7f-99cc43adbbd7`のまま。BusinessとAuth、Stripeおよび先に確定した個別ライセンス返却は別transactionであり、後段失敗で全工程が巻き戻るとは主張しない。全source/RLS/caller、定常lifecycle/archive/retention、運用復旧/権限/秘密、実provider・実端末、CPU/planなど全体の残件は継続する。ユーザーデータとドメインは最終工程として今回の実行対象外。


## 2026-10-03：退会候補388044bをstagingへ配備・合成受入

CI37092452003はhead `388044b057b4d0192fe98bcb1d242565e323ad25`でアプリ/Worker両jobがsuccess。03:22:19.953Zの専用account/version preflightは旧Worker71d at100%、Business ledger25/owned0、Auth owned0、保持Master・3 secret names・wake17:17を確認。03:23:03.922ZのAuth read-only guardで既存ledger4/marker6/index4/FK0/MFA generation236を確認し、DDLは適用していない。fixture Vite envで明示した全staging selectorsをbuildし、03:23:49.492ZにWorker `4a8d85dd-dfc4-424b-94ff-14354ae1fc4f`を100%配備した。静的JS/CSSのbytes/hash、noindex/robots200/sitemap404と4provider starts/callback GET403・cookieなし・signup/email閉鎖・匿名session nullを確認した。

実credential signin/session/HTTPによる6ケース（entry audit抑止/metadata改変、DELETE_ACCOUNT audit抑止、user profile DELETE抑止、Auth user DELETE IGNORE/ABORT）が通過した。いずれも503/no-storeでexact Auth user/account/session snapshotを保持。Business4ケースはcleanup snapshotを完全rollback、Auth2ケースは既に完了したBusiness cleanupと元の退会監査を保持。own UUID限定の故障を除くと200で完了し、audit UUID/actor/type/resource/request_id NULL/time/metadata、entry cancel/time/reason、grace license ownership解除、勝者history/creator/foreign role保持、他人session保持をreadback。Auth再試行で退会監査のID・時刻・metadataは同一、削除済みcookieで再実行401となり監査を追加しない。fixtureは返却済みgraceをseedしpending配送eventを省いたため、remote active返却/Stripe/async通知の受入とは区別する。

Journal `/var/folders/c4/_087tnms6n95sb58l4rg8vpw0000gn/T/fanmark-account-deletion-audit-15KPFs/canary.json`はverified-and-cleaned/flowPassed true。合成Auth7ユーザー、source Business fixtures、一時triggersは全削除、cookie無効、両store FK0、Business/Auth triggerとbaseline creatorの完全復元を確認。独立03:29:23.044Z readbackはWorker4a at100%、Business ledger25/source owned0/Auth owned0、Master canonical3944/release7888/import/active pointer/history完全一致、MFA generation236とsecret names保持を証明した。wakeは17:17のままresetしていない。anti-reuse license incarnationなど保持対象のregistryは削除していない。private acceptanceは`/tmp/fanmark-account-deletion-388044b-staging-acceptance.json`。

受入scopeは以上の退会SQL fault/retry/schema/static/provider閉鎖/baselineのみ。新規remote OAuth user/credential、実providers、現在版でのeditor/lottery/transfer再実行、実端末、全source/RLS/callers、運用・CPU/plan適合、全移行は未証明。ユーザーデータ移送とdomain/DNSは最終工程として未実行。次は全source runtime/authorization/caller/value/index gateの照合と定常lifecycle/archive/retention・復旧/秘密/最小権限・実provider acceptanceを進める。


## 2026-10-03：検索・お気に入りの部分commitを修正（local）

全25 Business migrationsで既存11ケースを確認後、event/count抑止の4ケースを追加。
3ケースは誤った200、検索は503でもdiscovery更新がcommitされることを再現した。
shared discovery-mutations.tsのtransaction内確認で4ケースのrollback/retryを修正した。
候補の初回実行はD1 numeric bindがREALとして評価され、JSONの4と4.0比較で拒否された。
SQLの増分をINTEGERへcastし、整数精度も保持する。native17/17、client12/12、
Worker typecheck/changed-file ESLint/CI isolation通過。full-schemaのfixtureへ置換し、
旧縮小fixtureを削除。CI/staging受け入れはまだ。実user/provider/DNS変更なし。
完了条件はCOMPLETION.mdの六項目で管理し、新規fault仮説を無制限に追加しない。


### 同candidateのCI guard修正

codeea6309aのアプリCI37094485854は、event bigintのJavaScript読出し禁止checkが、
SQL内のreceipt照合も一律拒否して失敗した。二つのSQLはIDをresponseへ射影せず、
verifiedの整数1だけを返す。SQL全文hashを固定した二つの確認済みassertionだけを
許可し、RETURNING IDや他のSELECTは引き続き拒否する。guard4/4、全migration-data
278/278（skip0）、changed-file lint通過。Worker CIの実行中状態をアプリ失敗で
終了済みと推定せず、既存handleを保持。次のheadで両CIを再確認する。配備は未実行。

## 2026-10-06 JST: restored extension UI and owned cleanup

Native Safari renders the exact synthetic extension owner's dashboard with S-tier
🧫 active through2026/11/13 (38 days), matching the previously applied D1 result.
This is a restored-window readback; uninterrupted Checkout-return timing remains
unobserved. UI logout shows the signed-out root. One session for that exact
synthetic owner still existed, so exact session revocation by UI alone is not
accepted; that session is included in owned cleanup.

Earlier exec handles/processes and `/tmp` journals are no longer available. Their
cause is unconfirmed. The exact synthetic address visible in Safari, applied
intent/application/effect/receipt relationships and prior committed payment proof
reconstructed ownership; the original journal bytes were not recovered.
A new private plan in `~/.codex/fanmark-migration-private` captured scoped rows,
24 Master table counts/full-content hashes, retained Auth/profile/MFA and anonymous
history before cleanup. Only those exact synthetic Business/Auth rows were
removed. A separate read-only process confirmed their absence, unchanged3/7/2
retained Auth, Master/profile/MFA/template/wake state, history4/7 with only the
owned fanmark pointer unlinked, FK0 and unchanged100% Worker b3a770b3.
No provider call, paid Checkout replay, new fixture, runtime deploy or DNS change.
[Recovered UI and cleanup evidence](evidence/staging-extension-restored-ui-cleanup-2026-10-06.json).
The human-created mail-test account and sessions remain retained.

CI37334325467 for f11abdd passed both jobs. Read-only operations at23:01 UTC had
attention[], FK0, wake17/17 and no overdue/failed queues. The proven-stopped daily
observer was restarted once; session29527 reports tail_started and stores its
journal in the persistent private directory. It watches unchanged b3a770b3 for
2026-10-06 09:00 JST, with09:04 deadline. Do not restart a silent live observer or
deploy during this observation. Natural daily acceptance remains pending.

The exact Japanese one-recipient announcement test is prepared in
[rehearsal instructions](staging-broadcast-rehearsal.md). Separate explicit send
permission is requested because the previously authorized address was for Auth
confirmation/reset mail. No broadcast send/activation has occurred. Operations
owner/retention/RPO-RTO policy remains unapproved. Earlier entries below are
historical checkpoints; their old process IDs and `/tmp` paths are not live.

## 2026-10-06 JST: profile, redirect and inactive UI

A fresh disposable credential/Free profile was seeded; the actual Worker register
API acquired S-tier 🪁 with a profile, then revoked its setup API session. This is
fixture setup, not proof of normal signup/email verification. Native Safari then
signed in and navigated dashboard -> settings -> profile edit. Display name,
Japanese biography and Website link saved, and the actual public browser rendered
them. The public browser retained a different human identity; separate cookie-free
HTTP reads independently proved anonymous access to exactly the saved content.

The actual settings UI hid the profile. Its reopened checkbox remained off,
the public page displayed the private-profile message and anonymous profile API
returned404. Republishing preserved the saved contents. URL redirect saved to
an example URL; settings reopen and anonymous API matched, and the actual public
browser navigated to that exact URL. Inactive mode saved, dashboard displayed
なにもしない, public page displayed 準備中, and anonymous API returned inactive
with no redirect/text content. No telephone-device launch or protected-password
UI is accepted by this proof. No deployment or provider call was needed.

Native UI logout changed the exact synthetic owner's current sessions1 ->0 in
read-only D1. Only its journal-owned profile/license/fanmark/access-stat/audit/Auth
rows were removed. Independent read-only verification preserved existing3/7/2,
all24 Master table digests, retained profiles/MFA/templates/wake and anonymous
history4/7 with FK0. The human mail-test account remains retained.
[Scoped UI and cleanup evidence](evidence/staging-profile-redirect-inactive-ui-2026-10-06.json).
CI37387435939 for e27eff3 succeeded in both jobs. Worker remains b3a770b3 at100%.
Daily observer29527 remains live/connected for09:00 JST; its result and broadcast
send authorization are still pending. Next functional UI work is transfer/return
and plan-capacity/deletion, followed by the existing final integration gates.
Earlier entries below are historical checkpoints.

## Native admin MFA and one approved broadcast delivery accepted (2026-10-06 JST)

A disposable staging administrator was provisioned with an existing TOTP factor
through the real API. Native Safari required a six-digit challenge after password
sign-in; password-only and wrong-code states had zero owned sessions/assurances.
The wrong code showed a rejection. A correct code opened the management dashboard,
and D1 matched one assurance to the exact user, session and factor. Native logout
revoked both. This unit does not establish new-factor enrollment UI acceptance.

After explicit human permission for one exact recipient, subject and body, native
UI created the matching Japanese draft. Only the server fixed-recipient test-send
selector was temporarily activated. One MFA-authenticated deployed API request sent
one email; Resend Delivered, the approved content and D1's minimized message-ID audit
matched. Bulk, signed webhook and frontend send selectors remained disabled. Test-send
UI, full bulk delivery, signed webhook, retry and retention remain unaccepted.

Initial version b3a770b3 was restored via rollback, but script settings still retained
the temporary selector/recipient. Canonical config was therefore redeployed and
independently checked: current100% version is0d9803af-84c8-4e2f-bd9b-dbb418b2555d;
runtime source remains0ed4213. Test-send/bulk selectors, fixed recipient and broadcast
signing secret are absent; all28 template contents match. Do not treat deployment
version rollback alone as evidence that mutable settings were restored.

Owned Auth/Business/draft/audit fixtures and plaintext test credentials were removed.
A separate read-only process preserved Auth3/7/2 and every other Auth/Business/Master
full-table hash, with FK0. MFA generation240→242 was retained, never rewound. Resend's
single sent-message history is retained. CI37398046903 at a26ce6e passed both jobs.
[Bounded acceptance](evidence/staging-admin-mfa-broadcast-delivery-2026-10-06.json).
Source/authorization reconciliation, paid deletion, provider new-signup/relay,
operations adoption and final phone/PWA/language integration remain open.

## Catalog failure no longer blocks update registration (2026-10-06 JST)

The actual main.tsx startup awaited the catalog before registering its Service
Worker. Catalog rejection or a stalled request therefore never reached explicit
registration/update checking. Codeb26055e starts registration after the root check,
before catalog loading, while retaining success-only React rendering and retry/error
without another catalog/backend fallback. The actual TSX entrypoint regression
failed3 of5 before the fix and passes5/5 afterwards; ordinary application CI now runs
it. Typecheck, targeted lint, staging build, generated PWA cache boundaries, workflow
isolation and current caller-map2/2 passed.

Current100% staging Worker is8cbe1e5f-5e55-4a82-a853-65ec96051db2. HTML, main JS,
service worker and legacy-cache cleanup script match the local build byte hashes.
Canonical vars match; broadcast selectors/recipient stay absent. /index.html's normal
307 canonical redirect was resolved by reading /, without repeating deployment.
A separate read-only credential verified unchanged full Auth/Business/Master table
hashes, retained3/7/2 and FK0. Backend source is unchanged; frontend startup changed.
[Regression and deployed artifact proof](evidence/startup-update-registration-2026-10-06.json).

Native UI is pending manual Mac unlock. Real existing-client service-worker transition,
cache retirement and final phone/PWA acceptance remain unproven. Do not invoke the old
raw-CDP staging PWA helper for GUI automation under the current CUA-only policy. Use the
known CUA surface after unlock; API/file proof does not replace browser acceptance.


## Full staging Master encrypted local recovery (2026-10-06 JST)

Read-only Master capture includes all24 application tables plus d1_migrations, 12,254 rows and98 schema objects. AES-256-GCM saved archive decryption and isolated SQLite/Miniflare-workerd restoration match every schema object, full table hash/count and FK0; tampered ciphertext is rejected before restoration. Actual app readers return3944 active emoji records and four reference masters (4/4/5/16 public rows). Separate-process read-only source readback matches all tables and unchanged Worker8cbe1e5f, with zero remote writes. Legacy Master Auth tables were checked empty; separate Auth D1 credentials and Supabase rows were not exported.

SQLite247ms/workerd93691ms are local proof timings, not production RTO. Stable repeated reads are not an atomic production snapshot. Remote full-Master recovery, scheduled/off-host encryption, operator/key custody/retention/RPO-RTO, real Auth credential backup and final combined recovery remain open. See full-master-recovery.md and evidence/full-staging-master-local-recovery-2026-10-06.json. Private archive/key remain outside Git; no completed proof runner or send command should be replayed.


## Synthetic full Auth encrypted local recovery (2026-10-06 JST)

All4 Auth migrations/9 nonempty tables are restored through an AES-GCM serialized in-memory envelope to a second local D1, with actual SDK-created bcrypt credentials/TOTP/encrypted backup codes/session/assurance and suspension/verification state. Exact schema/all columns/FK0 and unchanged source pass; actual Worker requests accept login with the original password/TOTP and backup-code login/replay refusal and deny wrong/unverified/suspended logins. Wrong archive/schema/SDK keys/tamper/occupied target refuse before writes. Native1/1, Worker typecheck, targeted lint and workflow isolation passed. New command joins normal Auth/Worker CI. Prior825c642/CI37401455459 is confirmed successful in both jobs and predates this new test.

No real credential export, Supabase read, remote write/deploy/secret/domain change occurred. In-memory JSON proof does not establish durable Auth key/archive custody, remote restore, production session revocation policy or full combined recovery. Current runtime stays8cbe1e5f. See synthetic-auth-recovery.md and evidence/synthetic-auth-local-recovery-2026-10-06.json. Mac remains locked; existing manual unlock request is pending.


### 2026-10-06: Full Master remote trigger diagnosis

Full isolated remote restore attempts failed at CREATE TRIGGER after all12254 rows
were written; no full remote acceptance was claimed. Both targets were cleaned.
A schema-only positive/negative probe identified lowercase body `begin` as the
REST failure; semicolon alone failed, uppercase BEGIN succeeded. All58 triggers
and98 schema objects matched that explicit keyword correction. Owned cleanup and
independent source data/Worker/inventory preservation passed. Added an opt-in SQL
preparation helper;12/12 native/transport regressions, focused lint and workflow
isolation passed. Pending corrected full remote restore, no runtime deployment.


### 2026-10-06: Full saved Master archive recovered into isolated real D1

Code801dc78/CI37405218853 both successful. Corrected v3 restored all25 tables/
12254 rows from unchanged saved AES-GCM bytes; all counts/hashes/FK0 and98 schema
objects matched after only six body BEGIN corrections. Actual app readers read
3944 emojis and reference4/4/5/16. Restore/target verification27161ms. Exact owned
D1 deletion succeeded; independent02:52:38.154Z readback preserved all three main
DB hashes/inventory and Worker8cbe1e5f. No existing DB writes/runtime/R2/DNS changes.
Remote full Master is accepted only within full-master-recovery.md; operational
snapshot/key custody/off-host/retention/RPO-RTO/Auth remote/combined and six-package
completion remain open. Earlier failed/semicolon attempts were cleaned, not accepted.

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

## バックアップ運用と受け入れ済み復旧の文書監査（2026-10-06 JST）

source exporter/encryption/R2 canary/importerと現行27の保存一式復旧証拠を照合。
snapshot-export-design.mdの専門credential writer未実装、d1-import.mdのremote一式未確認、
full-master-recovery.mdのcombined未完了という古い現在形の説明を修正した。
[backup-operations.md](backup-operations.md)へsource snapshotのbundle v1と一式復旧v2の区別、
one-off合成受け入れと定期collector/scheduler/off-host/retention/運用鍵/失効方針の未採用を記録。
受け入れ済み試験・historical証拠・converter gateの状態を変更していない。
今回の変更は文書だけ。新規test/remote資源/main変更/追加メール/実userdata/DNS変更は0。
既存の運用条件/外部caller/本人操作の質問は回答待ちで、重複して質問していない。

## 新規管理者MFA登録の実Safari受け入れ（2026-10-06 JST）

Worker d437を保持し、使い捨ての合成管理者1件だけを作成した。
Safariのprivate windowで実ログイン後、本人が認証アプリの設定と6桁コードの確認を完了。
実管理ダッシュボードと、Auth D1のtwoFactorEnabled=1・verified factor1件・現在generationの
同一session/factorに紐付く期限内MFA assurance1件を照合した。factor登録をAPIで代替していない。
先に用意したprivate windowが閉じられていたため、同じaccountで開き直した。

UI logout後、認証済みsession/assuranceの失効を確認し、receiptで所有を確認した
合成Auth/Business行だけを削除。開き直す前の残存sessionも同じ合成userのcascadeで削除した。
別のread-only processで所有行0、全既存Business/Auth/Master表hash保持とFK0を照合。
MFA generation242→243→244を保持し、巻き戻していない。private passwordはcleanup後に除去した。
Worker/runtime/設定/secret変更0、追加mail0、実userdata移送0、domain/DNS変更0。
[限定証拠](evidence/staging-admin-mfa-enrollment-native-2026-10-06.json)。

新規MFA登録UIのこの残件は受け入れ済み。有料退会UI、Apple/Discord新規登録・relay、
実スマホ/最終統合、外部callerと運用採用の未回答は保持する。六項目全体は未完了。
最新配備sourceは既存d437、候補cc87e8fのCI37424652271は両job成功。
今回の変更は証拠・文書だけ。旧MFA challenge/mail証拠のuiEnrollmentAccepted=falseは当時の範囲。
完了済みprivate journal/runnerを再実行せず、同じ試験を目的なく繰り返さない。

## 有料退会UI向けCheckout準備・本人操作待ち（2026-10-06 JST）

Worker d437と全既存Business/Auth/Master表hashを保持し、合成account1件を作成。
実signin/register APIで無期限Tier Cの🧴🧬🧿🛰️とprofileを1件作成し、準備sessionを失効。
別のSafari private windowで本人用とは別の合成accountに実ログインし、保有1/3・C/無期限を確認。
プラン画面のCreator変更から、実配備APIが作成したStripe sandbox Checkoutへ進んだ。
対象acct_1SFjhvJk0VCfiKUpのlivemode=falseをStripeのread-only WebMCPで確認した。

公開テストカード4242、expiry12/30、CVC123、合成名だけを入力し、情報保存はoff。
¥1,000/月の「申し込む」は未クリック。申込・実subscription/署名反映・有料退会は未受け入れ。
D1の同じuserのtest customer/checkout command各1、status=session_created、plan=freeと
subscription0をread-onlyで照合。全既存表hash/FK0とWorker versionを保持した。
この節はテスト申込前の初期checkpoint。後続のsandbox申込結果は最新unitを参照。
[準備の限定証拠](evidence/staging-paid-deletion-checkout-preparation-2026-10-06.json)。

private journalは`/Users/kanouk/.codex/fanmark-migration-private/paid-deletion-native-2026-10-06/journal.json`。
state=waiting_for_human_test_checkout_submission。所有fixture/合成session/Stripe test customerと
Checkoutは保持している。本人操作前にcleanupせず、prepare/capture runnerを再実行しない。
次は同じCheckoutの本人申込後に同じcustomer/subscription/署名receipt・Creator投影を確認し、
有料退会画面を用意して不可逆削除/解約の本人操作へ渡す。その後Tier C返却/設定削除/監査/
全Auth cascade・cookie失効とexact-owned cleanup/独立保持照合を行う。
コード/配備/設定/秘密更新/実userdata/DNS変更0。文書・証拠は未commit/未push。

## Safariのテスト決済復帰エラー修正・CI/配備待ち（2026-10-06 JST）

同じ合成account/Checkoutに公開test cardでsandbox申込を行い、Business D1でCreator/active
subscription1件を確認した。戻り先SafariはService Workerのredirect応答でページを開けず、
通常reload/二度目の申込で隠していない。元Worker d437の/index.html=307→/を独立観測し、
redirectを自動追跡していた旧HTTP smokeの穴を修正した。修正前の実Wranglerは307≠200で失敗。

両Assets configのhtml_handling=noneとroot GET/HEADの明示HTML fallbackを追加。
route/queryを保ち、API/欠落script境界は維持する。stagingだけstatic cache v2へ更新し、
既存Safariの旧HTML cacheを使い回さない。default buildのcache namespaceは変更しない。
修正後の実Assets binding19/19・outer Wrangler HTTP smoke、両typecheck・focused lint、
CIと同じ空env/合成値のstaging build・生成PWA cache境界を通過。JSは既存UQpaFrj8のまま。
[修正と限定証拠](evidence/safari-static-shell-redirect-regression-2026-10-06.json)。

現時点では新候補CI/配備/同じSafariの復旧は未受け入れ。有料退会も未実行。
private paid-deletion journalはnative_test_checkout_submitted_waiting_readback。
同じtest customer/subscription/Tier C/profile/合成sessionを保持し、再seed/再Checkoutをしない。
次はexact候補CI成功→元全表hash/設定/secret保持guard→staging配備→直接HTML/新SW照合→
同じSafariの更新・戻り先query/Creator画面確認→退会review→exact-owned cleanup/独立照合。
実ユーザーの移送、domain/DNS、本番Stripeと追加認証/告知mailは対象外。

## Safari復帰修正のstaging配備完了・Mac解除待ち（2026-10-06 JST）

候補ac0ac670405a766f0eebcc9d122d97b1ce1407c8のCI37452793228は両job成功。
Worker d71e54b5-dc6f-4b0b-b92e-bf75b698d8e4へ100%配備し、root/index/checkout成功routeの
直接200・Locationなし、root HEAD、欠落script404、公開asset6件のbytes/hashを照合した。
既存bindings/秘密設定/全Business・Auth・Master表hashは配備前後で保持し、broadcastはdisabled。

同じ合成paid fixtureのCreator/active test subscriptionに加え、Stripe管理画面の有効表示を確認。
customer.subscription.createdとinvoice.payment_succeededはapplied、checkout.session.completedは
契約どおりignored、errorなし。receipt3/dispatch3と適用ledger/購読projectionを同じcustomer/subscriptionへ
pinした。別read-only processでfixture以外の全既存表hash保持・FK0を照合した。
[配備と限定証拠](evidence/safari-static-shell-staging-deployment-2026-10-06.json)。

同じSafariの通常reloadを試す直前、CUAはMac lockedを返し操作を実行できなかった。
Mac解除をユーザーへ依頼済み。同じprivate window、合成session/paid subscription/Tier C/profileを保持する。
同じSafariの復帰・戻り先query/Creator UI、有料退会、exact-owned cleanupは未受け入れ。
再seed/再Checkout/再配備せず、解除後は現在のSafari windowから続ける。
実userdata移送・domain/DNS・本番Stripe・追加mailは実行していない。全体移行は未完了。

## 有料退会の実Safari確認・解約通知の修正（2026-10-06 JST）

Mac解除後、同じSafari private windowで通常reloadと既存Checkout成功URLの表示が成功し、
Creatorを確認した。queryはアプリの既存処理が消費した。解除中のPWA自動更新は未証明。
本人の明示許可後、専用合成アカウントの最終削除を一度だけ実行した。
Stripe test購読の即時解約と200応答、guest画面、本人Auth関連行0、業務profile/購読0、
無期限Tier Cのgrace返却・所有者NULL、退会監査1件、FK0を照合した。
graceでは設定2行を保持し、expiredで削除する仕様に一致する（即時削除を要求しない）。

実customer.subscription.deleted通知が、削除済みuser_settingsを要求して再試行になる
不具合を発見した。退会監査の厳格な一致・過去の同一customer/subscription/modeのapplied記録・
Stripe現在canceled/有効購読0を確認した場合だけ、projectionを再作成せずignored/completedとする。
監査/所有関係/fenceを同じtransactionで再確認し、通知・dispatch・fence解放の欠落はrollbackする。
既存通知をSQLで完了扱いにせず、fixed runtimeの自然dispatchで確認する。

旧コードでは追加regressionが失敗。修正後の関連Webhook79/79（購読22件を含む）、
Worker typecheckとfocused lintを通過。CI・staging修正配備・同じ解約通知の完了・
exact-owned cleanup/独立保持照合はこのcheckpointでは未受け入れ。
[実退会と修正の限定証拠](evidence/paid-deletion-cancellation-regression-2026-10-06.json)。
実ユーザー移送・DNS/domain・本番Stripe・追加mailを行っておらず、全体移行は未完了。

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
