# 本番容量の集計と合成の一式復旧検証

2026-10-13にSupabaseの本番projectを照合し、READ ONLY / REPEATABLE READとManagement APIの
read_only指定で、40表の正確な件数、Auth/Storageの集計、DB物理容量、Storage metadataの
サイズと最大値、Cron設定を確認した。個別user/identity/object行、メール、資格情報、画像本体は
exportしていない。詳細集計はGit外で保持し、[公開証拠](evidence/source-volume-census-2026-10-13.json)は
hashと観測範囲だけを記録する。最初のpg_stat_user_tables行数は推定値で、別COUNTに置き換えた。
Storage容量は申告metadataであり、本体size/hashの照合は最後の#38に残す。

Cloudflareの同じaccountのWorkers Paid / 現在のプラン表示を読み取りで確認した。
プラン/課金/DNS/source設定を変更していない。DB物理容量をD1の論理容量や保存JSON容量へ
そのまま換算せず、代表量の合成復旧で実際の保存fileを測る。

## 固定された合成material

`recovery-capacity-fixture.mjs`は`source-counts-2026-10-13`の1種類だけを扱う。
新しい所有sourceに15 fake user/18 fake account、avatar69/cover40の109 objectを作る。
画像合計13,285,729 bytes、最大1,196,603 bytesは集計に合わせる。すべてrandom bytes、
Standard、image/png metadataの合成fileで、実画像の表示品質や元の個別サイズ分布を証明しない。
個人のメール・credential・画像key/contentは使わず、provider API/実メール/課金を呼ばない。
元のnormal SDK actorに加えて新規作成し、保存/復旧後のsession/challenge失効と再loginを確認する。

MasterはV4の許可済み非ユーザー全25表/20,152行を別のfixture-only AES keyで再暗号化した。
[固定pins](evidence/master-recovery-v4-capacity-fixture-2026-10-13.json)のfile size/hash・schema/全rowsHashを
検証してから使用する。運用鍵を新しいfixture keyや一時Workerへコピーしない。
旧12,254行へ縮めてこのprofileを通すことは拒否する。

## 検証入口と保護

`test-application-recovery-set-worker.mjs`のnative2件は、小さいMasterの既存caseと、この109 objectの
caseを実行する。個別classを保持しないpinned local emulatorに限り、明示的Standardで作った
所有fixtureの空classだけを補うadapterを使う。unknown classの本体validatorは変更しない。
このadapterはremote runnerでは設定しない。local成功をCloudflareのmemory/CPU保証にしない。

一時private proof Workerのinitial Master body上限は16 MiB、restore bodyは64 MiB。
V4 Master file約10.5 MBと画像を含む全file約34.6 MBを扱うためで、通常アプリのupload上限は変更しない。
認証/nonce/全resource identityの確認、body実量の上限、hash/AAD検証、phaseの再実行拒否を保持する。
復旧後は全store hash、FK0、catalog3,944、参照Master、旧cookie拒否/new SDK loginを確認する。

削除はsource/target両方の109 objectについて、作成時のkey/size/SHA-256/metadata/classを
すべて照合した後に始める。他のcontrol fileや1 byte変わった画像があれば、どのbucketも削除しない。
物理DB/bucket/Worker/DOの削除はrunnerが作成receipt/name/ID/時刻を照合して行う。
保持DB12 + 所有6を想定したoperational ceiling18は、provider quotaを変更しない。

## 実Cloudflareでの実行

latest candidateのCI両job成功とcleanなtracked treeを先に確認し、Git外の0700 fixture directory
（archive.json/key.binとも0600）を指定する。Master keyは合成fixtureのものを使う。

```sh
node --experimental-strip-types scripts/migration/run-application-recovery-set.mjs \
  <exact-tested-head> <successful-ci-run> <private-master-fixture-directory> \
  --master-evidence master-recovery-v4-capacity-fixture-2026-10-13.json \
  --capacity-profile source-counts-2026-10-13
```

ACK不明はphase statusと同じjournalで調査し、新しいwriteを自動再送しない。再開には同じhead/CI/
Master pins/profileを保持して`--resume <journal-directory>`を加える。既存main、本人Auth、
旧store/namespace、実Supabase user/Auth/Storageとdomain/DNSは変更しない。

[local限定の証拠](evidence/representative-recovery-capacity-local-2026-10-13.json)は、同時保存/復旧/後片付け、実アプリから復旧avatar/coverのGET200と全bytes/hash一致まで成功。最初のlocal失敗はemulatorの空class、次の失敗は
旧empty-bucket cleanupの前提で、記録を保持する。実Cloudflareの同じmaterialはまだ未受け入れ。
この1回のsource sizing検証を全store同時最大量・1000 object・本番RTOへ拡張しない。

## 実Cloudflareの失敗と限定修正（2026-10-13）

bb6cf42/CI38330262202は両job成功。専用6D1/5R2/1Worker/2DOで全Masterの取り込みと
15 Auth user/18 account/109 imageの収集は成功した。復旧はMaster/Business/Authまで照合し、
avatar工程でnative exceededMemoryによる終了を実行記録のscriptVersion/開始時刻/1失敗と照合した。
[失敗の証拠](evidence/representative-recovery-capacity-remote-failure-2026-10-13.json)。
復旧の再送0、失敗記録をoperator観測として保持する。資源はcleanup未完了のまま保留。

検証wrapperが保持する追加の全snapshotを、復旧後に必要なcredential比較・2画像のkey/size/hash・
capture IDだけへ縮め、shared restoreの呼出前に解放する。shared保存形式/validator/上限は変更しない。
画像の途中commit後は、terminal failureが確認できた所有targetのexact subsetだけをcleanup対象にできる。
sourceは完全件数、すべての対象は元manifestのkey/metadata/class/size/hashで照合し、改変/外部objectでは
全bucket削除を拒否する。localの2件は成功したが、修正後のremote成功は未確認。

このprofileのBusiness件数は通常の合成fixtureに14 profileを加えたもの。本番の全Business表の
行数分布・最大容量や停止時間を代表するものではない。実行結果を本番RTO保証にしない。

## wrapper修正だけでは不足・共有復旧の保持を限定（2026-10-13）

3632cec/CI38331658551は両job成功。新しい所有環境・同じMaster/件数/容量のremote復旧は
avatarのverifiedまで進んだが、その後native exceededMemoryで終了した。全体成功ではない。
[2回目の失敗](evidence/representative-recovery-capacity-wrapper-repair-failure-2026-10-13.json)。
各回のnative終了をversion/開始時刻/1失敗で確認し、operator観測のfailureを保持した。
最初はCI済みcleanup版の専用Workerで、2回目は同じjournalのresumeによるcleanupだけで、
全所有画像の照合後に6D1/5R2/1Worker/2DOを削除した。復旧POSTの再送は0。

共有restoreは、最初に全snapshotのauth/schema/hash/相互関係と全targetを検証し、
比較用のwanted hashesを固定する。各store復旧が完了したら、その呼出内で復号した完了storeだけを
解放する修正を加える。入力archiveを変更せず、最終の全store recapture/hashとAuth/Businessの
相互関係、fence、復旧後のsession失効は維持する。容量/形式/件数を縮めて成功にしない。
共有修正はtypecheck、関連17件、全Master入りlocal復旧・画像配信・SDK login・cleanupまで成功。
[local限定証拠](evidence/representative-recovery-capacity-shared-release-local-2026-10-13.json)。
CI/実Cloudflare成功は別に確認する。通常mainの再配備と実ユーザー/DNS変更は0。

## 大きなHTTP本体の保持を避ける候補（2026-10-13）

a4541dc/CI38333543500は両job成功。最初のcaseはbusiness_recovery_restore_failedを返し、
終了/cleanup/inventory一致まで確認した。同じcode/件数/容量の新しい所有環境を1回確認し、
Businessはverified、avatar工程でnative exceededMemoryによる終了をversion/時刻/1失敗で確認した。
業務D1失敗の原因は未確定。両記録を保持し、復旧POST再送0、全所有資源はcleanup済み。
[共有修正後の失敗](evidence/representative-recovery-capacity-shared-release-failures-2026-10-13.json)。

新候補は、このprofileだけMacで保存/検証した**同じ暗号化file**を所有CONTROLの固定
`restore-input.json`へCLIでuploadし、CLIで独立downloadして元fileと全bytesを比較する。
GETはetag/sizeだけ返し、restore POSTはそのopaque etagのみ・body最大1 KiBとする。
未確認upload ACKでは再PUTせず、同じjournalで存在/bytes/etagを調べる。
Workerは条件付きR2 getと上限64 MiB、AES/AAD/全part hash・schema/SDK・source capture ID/
元part hash・相互関係を確認してからclaim/target writeへ進む。file pathをclientに選ばせない。
cleanupもそのfileのsource provenanceを確認し、不一致なら全bucketの削除を拒否する。
Mac fileを保存せずsource側のcopyだけで済ませたとはしない。

従来のfull HTTP bodyとCONTROLのfull copyを同時に保持/比較する点もmemory圧迫の候補であり、
通信を変えても実Cloudflare成功は未確認。shared format/容量/復旧dataを縮めず、hash/fence/
全最終recaptureとsession失効を維持する。通常defaultの小さいfixture入口は従来通り。

[新方式のlocal限定証拠](evidence/representative-recovery-capacity-r2-transport-local-2026-10-13.json)：native2件と全Master復旧/画像配信/SDK/cleanupは成功。実CLIのupload/download全bytes一致・CI・実Cloudflare成功は未確認。

## 全plaintextの同時保持を避ける共有候補（2026-10-13）

393c4c1の[実file転送](evidence/representative-recovery-capacity-r2-transport-failure-2026-10-13.json)は
CLI upload/download全bytes一致まで成功したが、画像工程のnative memory超過は残った。
全5caseの失敗を保持し、全一時資源を削除/元構成と本人Authの独立照合まで受け入れた。
大きいHTTP bodyの回避だけで原因解消・復旧成功としない。

新共有候補は、入力のmutable container/byte配列を所有copyで固定し、immutable ciphertext文字列は
共有して余分な全archive複製を作らない。全part/相互関係を初めに検証し、session失効方針の
wanted hashesを確定して全plaintextを解放する。全targetの事前確認は維持し、各storeだけを
再度open/restoreする。最終は全store recapture、全hash、Auth/Business相互関係とfenceを確認する。
入力がMaster verified後に変更されても、固定したcipher/配列で後続storeを復旧するtestを追加した。
source fileを変更せず、wrong key/part mixing・先行不一致の全target write拒否・exact resumeを維持する。

型check・関連17件と全Master/同じ件数容量のlocal復旧・画像配信/SDK/cleanupは成功。
[local限定証拠](evidence/representative-recovery-capacity-one-store-local-2026-10-13.json)。
CI/実Cloudflareは別の未完了条件。native memory上限や全最大量、本番RTOの保証にしない。
