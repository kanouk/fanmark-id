# 本番移送中断時の照合と限定復旧

対象はPR #41の専用5 store移送。停止設定と調停ownerを保持したまま、元のrun・manifest・incarnation・private journalを使う。全体runnerは`executeInitialImportSet`へ接続済み。終了した同一端末のexecutorは、未確定書込みなし・完了済みstageの独立照合を条件に引き継げる。初回Authのatomic commitだけは、全内容一致を条件に専用復旧を用意した。新cohort V2のMasterには、同じ生存executorでatomic確定記録を照合する応答消失復旧を追加した。終了したexecutorの一般的な部分stage再実行は認めない。この手順だけで本番開始や再開を許可しない。

## まず読み取りだけで調べる

`production-import-inspection.mjs` の `inspectProductionImportJournal(path)` はネットワーク接続せず、絶対path・親0700・file0600・symlinkなし・1 hardlink・完結したJSONLと正確な順序を検査する。SQL・パスワード・画像は含めない。結果にはrun/operation IDが含まれるため、運用証拠はGit外へ保存する。

`inspectProductionImportAttempt({ journalPath, coordinator })` は、既存のread-only gatewayへ接続した `createProductionImportCoordinator` を渡す。新しい `claim()` は不要。owner・manifest hash・全5 incarnationは元の実行票と一致させる。gatewayの配備版・閉鎖状態の確認は既存transportの手順で行い、任意URLへbearerを送らない。

| classification | 意味と処置 |
| --- | --- |
| `remote-acknowledged-local-pending` | 遠隔の完了記録は存在する。下記の条件を満たす場合だけlocal ACKを補修できる。 |
| `remote-dispatched-unresolved` | R2 PUTのdispatch記録があるが完了不明。画像の存在だけでACKにせず、再送しない。 |
| `remote-pending-unresolved` | 遠隔intentがある。D1の保存済み/未保存をこれだけで判定しない。 |
| `remote-not-observed-unresolved` | 遠隔に対応記録が見つからない。失敗の証明ではないため再送しない。 |
| `local-no-pending-lock-retained` | local pendingはないがlockがある。intent保存前の停止もあり得るため、完了済みとは呼ばない。 |
| `local-no-pending-operation` | localにはpendingがない。遠隔全件一致やデータ一致を意味しない。 |

`inspectProductionImportSet({ journalPaths, coordinator })` の `journalPaths` は `auth,master,business,avatars,covers` をそれぞれ元の1 fileへ固定する。全ACKのUUID/hash/storeを遠隔記録へ照合し、遠隔総数・pendingと、読取り前後のlocal/remote状態を確認する。追加journalに分散した履歴がある場合は不一致として止まり、file結合や欠落補完はしない。`journalsReconciled=true` でもデータの全件照合、凍結継続、stage完了、再開許可は証明しない。観測後の変更を防ぐ新しいlockは取得しない。

## 遠隔ACK確定後のlocal記録だけを補修する

`recoverAcknowledgedProductionImport({ journalPath, coordinator })` は次の条件を全て検査する。

1. 遠隔ACKとlocal intentのrun/manifest/incarnation・UUID/hash/storeが一致する。
2. 遠隔の停止ownerが同じrunで、active0・pendingなし。
3. private lockのhost hashが現在のhostに一致し、記録されたPIDが終了している。PIDの再利用で別processが存在する場合も拒否する。
4. 専用 `.recovery.lock` を排他的に取得した後、local file/inode/hashと遠隔状態をもう一度照合する。

成功すると、照合証拠のhash付きlocal ACKを追記してfsyncし、元のoperation lockを削除する。providerへの書込みと遠隔journal変更は0件。失敗・途中終了なら専用lockを残し、自動再試行しない。旧形式の空lock、別host、まだ動いているprocess、不正権限や途切れた行は補修しない。PID確認はsignal 0のみで、processを終了させない。

補修後は5 storeの記録を再照合し、各storeの独立データcheckerで状態を調べる。初回stageを先頭から実行し直さない。部分stageを安全に継続する手順や、未知commitを解決する手順は別途必要。

## 検証範囲

native local D1/DOと実子processを使い、遠隔ACK後のlocal記録消失、元process生存、別host、旧空lock、途切れたjournal、権限不正、symlink、5 store履歴欠落を確認する。R2の実local PUT後の応答消失は未解決のまま保持する。本番データでの復旧・全storeの再開・ドメイン切替は未実施。


## 全体executorを取得した後の停止

`inspect()`と操作別照合は現在の`executorId`も返す。executorは自動失効しない。既存のlocal ACK補修はexecutorを解除せず、補修成功だけで別processが書き込みを再開できるとは扱わない。正常なstage境界でrunnerが`yieldExecution`を完了した場合にだけ、新しい実行者が取得できる。取得後は旧形式の実行者なしwriteへ戻れない。

runnerはyield/completeを送る前に同じprivate journal directoryへ`initial-set-<executorId>.json`を0600で作成・fsyncする。最終応答不明では、別read-only clientでDOの`state.readbackSha256`と保存reportの`report.readback.readbackSha256`を照合する。この一致は元の比較結果を遠隔が受理した証拠であり、一般writeの開始やsource再開を認めるものではない。file欠落/改変、hash不一致、未確定operationがある場合は保留する。未確定operationの削除・再送・無条件のexecutor解除は提供しない。


## 終了済みexecutorをstage境界で引き継ぐ

runnerは遠隔実行権を取得する前に、5 journalと同じ0700 directoryへ
`.initial-import-execution.lock` を0600・排他的作成し、file/directoryをfsyncする。
run・manifest/source証拠hash・executor UUID・PID・端末hashを固定する。
正常なyield/complete応答後にだけ自分のlockを取り除く。取得応答消失やprocess終了なら保持する。

`recoverInitialImportExecution({ prepared, coordinator, journalPaths, sourceEvidencePath,
readDatabases, readBuckets, resumeAfter })` には同じ入力から再作成したpreparedと
独立したcoordinator client、read-onlyの3 D1/2 R2接続を渡す。resumeAfterは完全に
終わっている `auth/master/business/receipts/storage` のいずれかを明示する。

1. 同一端末の元PIDが終了したことをsignal 0で確認する。PID再利用で別processが存在する場合も拒否する。
2. ローカル5 journalの全ACK・lockなしを遠隔台帳へ照合する。pendingは0、一般writerも0、移行停止ownerは同じrunを要求する。
3. source証拠と入力fileのhashを確認し、完了済みprefixを各storeのcheckerで全件再照合する。受信streamもprefixに含む場合は全内容を検査する。
4. 前後の遠隔状態・元lockの内容/inodeを照合し、復旧reportをGit外0600 fileへfsyncする。
5. サーバーで元executor UUIDとACK件数を比較して実行権だけを解除する。pendingが入った場合、件数が変わった場合、別実行者なら拒否する。移行停止・全operation記録は残す。使用済みexecutor UUIDは再取得できない。
6. 独立した読戻しの成功後、ローカルの実行lockと復旧lockを取り除く。

復旧後はpreparedと書込接続を再作成し、同じrun/manifest/journalへ新しいclientでclaimし、
確認したresumeAfterから一括runnerを呼ぶ。runnerは完了prefixを再検査し、次stageの
初期状態検査を実施する。復旧関数自体のprovider書込みは0件。

途中失敗は `.initial-import-execution.lock.recovery` とreportを保持する。
遠隔解除の応答不明時に解除要求を再送しない。元lockがない旧形式の実行、取得直後で
完了stageがないケース、partial stage、pending provider操作、complete済みのlock掃除は
この自動復旧の対象外。確認済みprefixの後に部分書込みがあれば、次stageの初期検査で
止まる。この復旧成功だけで全移送の再開可能性や本番移行準備完了を主張しない。


## 初回Auth保存の応答だけが失われた場合

`recoverInitialAuthImportExecution` は `recoverInitialImportExecution` と同じ入力に
`resumeAfter: 'auth'` を指定する。終了済み同一端末・同一PIDのexecutorと操作lockがあり、
最初のAuth操作だけがpending、遠隔ACKが0、他4 journalに操作がない場合に限定する。

元の暗号化済みAuth projectionから、通常importと同じguard付きatomic batchを再構築し、
SQLと値のSHA-256を元intentへ照合する。固定read-only接続でAuthの全行・資格情報・MFA・
schema・FK・空であるべきsession等を再検査する。未保存、部分一致、内容やbatchの相違は
復旧せず、元lockと復旧lockを保持する。SQLや資格情報は復旧reportへ保存しない。

照合前後の全5 journal、遠隔状態、入力証拠が一致したら、Git外へ証拠をfsyncする。
`recover-auth` は同じexecutor・operation UUID・batch hash・Auth・ACK0を原子的に確認し、
ACKと証拠hashだけを追加する。D1/R2への書込みは行わない。この段階ではexecutorを保持し、
既存のlocal ACK補修と再照合が成功してから実行権だけを返す。移行の停止設定は保持する。
新しいexecutorで `resumeAfter: 'auth'` から再開する場合も、Authを全件再検査する。

復旧操作の応答も失われた場合は再送せず、元のexecutor/操作lock、復旧lockとreportを保持する。
別clientの `inspectOperation` でACKの有無を確認する。残存復旧lockの自動掃除は提供しない。
この専用経路をMaster/Business/画像の途中保存や、空のAuthへの再送に流用しない。
本番での実証、source停止の確認、本番ログイン、全移行の準備完了を意味しない。

## 部分stage・未確定commitを残したまま移送を中止する

`quarantineProductionImportExecution` はMaster/Business/画像の部分保存を成功へ補修せず、
そのrunを恒久的に中止する入口。新資源を閉鎖したまま旧sourceへ復帰するための一工程で、
sourceの停止解除やDNS復元を実行するものではない。stage途中から同じtargetへ再開する
手順とは区別する。中止後は同じtarget世代を再利用しない。

1. 当日の移行用gateway以外の設定変更担当・writerを止める。公開/Auth/Cron/dispatcherは
   一度も開始していないことを実配備履歴と業務台帳で確認する。判断不明なら前進復旧へ回す。
2. 同じ端末の一括executorを正常終了または終了確認する。関数は元の実行lockのPIDを
   signal 0で確認し、生存中・別端末・PID再利用を拒否する。processをkillしない。
3. 元の5 journal・run/manifest/source証拠hash・全incarnationを使う独立clientで実行する。
   部分stageのACKとpending/dispatchは全件照合し、元file/inode/hash、遠隔owner・active0・
   executor UUIDと全stateが前後で一致することを要求する。データの全件一致は要求せず、
   pendingを未解決のまま記録する。
4. 同じ0700 directoryへ排他lockとproofを0600/fsync保存する。専用`quarantine` CASは
   owner・executor・元state hashを照合し、proof hashを別keyへ一度保存する。
   元state、pending、ACK、dispatch、executor、停止fenceは一切消さない。
5. 別のinspectでproof hashと元state保持を確認する。以後claim/acquire/begin/acknowledge/
   dispatch/complete/既存復旧とfence解除は全て拒否され、inspect/operationだけが残る。
   quarantine応答が消えた場合は再送せず、元proof hashを独立inspectへ照合する。
6. 一時gatewayの所有versionを照合して閉鎖し、新側をRECOVERY_WRITE_FREEZE等で閉じる。
   先に送信済みのD1管理API要求を取り消す機能ではない。後からその要求が保存を終えても
   新側は公開せず、元journalと内容を保持する。
7. [旧側の復帰票](source-stop-and-resume.md)で新側の受信を回収・旧側の全内容/外部効果を
   照合し、DNS・source入口・権限/Cronの復元を別工程として実行する。

成功・失敗・応答不明ともquarantineのlock/proofと元executor lockを保持する。成功reportは
`unknownOutcomesResolved=false`・`sourceReopened=false`であり、これだけで旧側を再開しない。
native local DO18件、独立processと実local D1/R2を使う関連20件で部分データ・未確定ACK・
lock保持と再送拒否を検証した。本番適用・旧source復帰の実証はまだない。

## V2の同一executor内の応答消失

詳細は [再準備票](RETRY-PREPARATION-2026-10-20.md) を参照する。Masterの元DMLと同じtransactionに保存したimmutable確定記録が、run/operation/hash/target/incarnation/statement件数・各変更件数まで一致した場合だけ元のjournalへACKする。local/remote pending・停止owner・active0・生存executorを前後に照合する。元SQLは再送しない。記録がないことを未実行の証明にしない。2026-10-20にquarantineした旧cohort/runにはこの記録がなく、対象外である。

遠隔ACKだけの応答消失は同じjournalが独立GETで完全一致を確認してlocal ACKを追記する。local fsync失敗はlockを残して停止する。別processからの補修条件は従来どおり。

## R2 dispatch前の要求を永久に無効化する限定復旧

`cancelUndispatchedProductionR2` は、終了済みの同一端末executor、全5 journal、元の
run/manifest/source証拠、incarnation、停止owner、active0を照合する。対象はavatars/covers
の単一pendingだけとし、同じoperation UUIDのACKとdispatchがどちらも存在しない場合に限る。
画像が見つからないことだけを未実行の証明にはしない。

排他的に保存した証拠hashと元state hashを `cancel-undispatched-r2` に一度だけ渡す。
DOはdispatchと同じtransactionで、executor/state/pendingを照合し、永久tombstoneを保存して
からpendingを解除する。dispatchが先なら取消しを拒否する。取消しが先なら元のUUIDの
begin/dispatch/acknowledgeを永久に拒否し、遅着した元PUTもR2へ進めない。ACK件数、executor、
停止fence、元intentと失敗sidecarを保持する。D1の未確定保存やquarantine済みrunは対象外。

別inspectでtombstoneと証拠hashを確認した後だけ、local journalへ
`cancelled-before-dispatch` を追記し、終了済みprocessの操作lockを解除する。
取消し応答が消えた場合は再送せず、保存済みproofとtombstoneを独立照合して
`recoverCancelledProductionR2Import` でlocal記録を補修する。全journal検査は取消し行も
遠隔tombstoneと照合し、ACKへ数えない。元UUIDは再利用しない。

その後の実行権回収・prefix全件照合と新executorによるstage境界からの再開は別工程で行う。
これは画像の保存成功を意味しない。閉鎖・source停止を保ったまま、新しいUUIDによる画像
送信を可能にする限定操作である。実Cloudflareの証拠は当日の操作記録で別途確認する。
