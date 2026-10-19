# 本番移送中断時の照合と限定復旧

対象はPR #41の専用5 store移送。停止設定と調停ownerを保持したまま、元のrun・manifest・incarnation・private journalを使う。全体runnerは`executeInitialImportSet`へ接続済みだが、部分stageの修復・停止したexecutorの引継ぎは未完了。この手順だけで本番開始や再開を許可しない。

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

runnerはyield/completeを送る前に同じprivate journal directoryへ`initial-set-<executorId>.json`を0600で作成・fsyncする。最終応答不明では、別read-only clientでDOの`state.readbackSha256`と保存reportの`report.readback.readbackSha256`を照合する。この一致は元の比較結果を遠隔が受理した証拠であり、一般writeの開始やsource再開を認めるものではない。file欠落/改変、hash不一致、未確定operationがある場合は保留する。削除・再送・executor強制解除のコマンドは提供しない。
