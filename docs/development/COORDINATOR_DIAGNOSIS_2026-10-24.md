# 調停遅延・認証503の調査（2026-10-24）

## 分かったことと未解決の境界

#71の内部通信障害の根本原因は、まだ特定できていない。保存ログが無効だった時間帯の例外本文は取得できず、今回の変更前から同じe79版の応答が正常化していた。この変更による速度改善・認証503の発生解消とは扱わない。

一方、認証確認が503や通信失敗になった時、`AuthProvider.refreshSession`のcatchが`applyBetterAuthSession(null)`を呼び、確認済みの匿名sessionと同じ状態にしていたことはコードで特定した。これにより匿名トップを表示したり、保護URLをログイン画面へ移したりし得た。今回は確認失敗をreadiness errorとして保持し、再試行中は公開shell、確認成功後にだけ元のURLの画面を開く。Cookieの失効やパスワード設定の推測を行わない。古い確認結果が新しい確認やサインアウトを上書きすることも防ぐ。

## 修正前の現在値

11:02 JSTの独立照合でappはe79版100%、backup/monitor/alias、18秘密設定名・3 routes・4 cronsを保持。匿名のroot、maintenance、get-session、所有一覧を3巡し、12応答は期待どおり200/401。maintenanceは85〜141ms、get-sessionは76〜193ms、所有一覧は61〜275ms。これは前夜の失敗記録を取り消すものではない。

対象namespaceの時間帯別adaptive集計は、23日18・19時UTCに例外・disconnect・internal errorがあり、20時〜24日01時UTCの取得行はsuccessのみ。Liveの短い検査でもDO 22件は例外なし、wall最大11ms。集計はsamplingの影響を含み、全要求の無障害証明ではない。集計wallTimeの単位は未確認のため換算していない。

11:05 JSTの期限・認証付きread-only operatorではownerなし、active=24、完全走査24、legacy=0、scheduled16/HTTP8。個別票の処理結果は不明なまま。自然09:05の日次slotは`failed`、`failure.stage=drain`、`reason=drain_pending`、activeWriters=24、`fenceReleased=true`。保存前に止まっており、当日のarchive成功とは認定しない。同slotの再実行、票削除、台帳初期化、fence強制解除はしていない。

一時operatorの最初の読取りはroute反映前の空応答でJSON解釈に失敗し、cleanupを確認した。次の独立operationでは404を2回保存した後に200で照合。両operationのWorker/routeを削除し、元inventoryへ戻ったことを独立確認した。

## 診断と再試行の変更

- 調停の例外は固定カテゴリと`retryable`/`remote`/`overloaded`の真偽だけを記録。任意の例外本文・URL/query・Cookie・ticket ID・scope・検索語・秘密値は出力しない。
- DO内部handlerの経過msを内部headerだけへ付加し、遅延/失敗時のcaller logに含める。RPC全体との差には配送・起動・output gateの永続化待ち等が含まれる。単独でnetwork/storageを断定しない。通常のoutput gateを維持し、保存前の成功応答を返さない。
- Cloudflareがoverloadと明示した例外はread admissionや完了済みleaveでも再試行しない。通常の一時的なread/leaveは従来の有限回・fresh stubを維持。enterと業務処理は再送しない。失敗したleaveの票は残してbackupを拒否する。
- 既存のnamespace・schema・保存key/value・ticket・fenceとimport quarantineを保持。保存ログ・価格設定・権限・sampling設定は変更しない。短時間Liveだけを使用する。

例外の種類やfresh stubは[公式の例外処理](https://developers.cloudflare.com/durable-objects/best-practices/error-handling/)、配備/Live接続によるinstance更新と旧新版の共存は[既知の制約](https://developers.cloudflare.com/durable-objects/platform/known-issues/)も参照した。これらは障害原因を証明する資料ではない。

## 検証と配信

固定Node 22.6.0で型検査、Lint警告0、client244件・契約150件、native writer27件・import22件・core116件が成功。実local Worker/分割D1/R2とブラウザで認証503のgate・URL/Cookie保持・同じ所有者への復帰、通常ログイン/MFA/取得/保存/アカウント切替、4言語/16表示幅を検証した。CLIの最初のcore起動はcwd指定を誤り失敗し、正しいWorker directoryで116件成功。CI・実配備は完了後に記録する。内部遅延の原因と既存24票の終了確認、自然backupの再成功は#71に残す。認証確認失敗の扱いを直したことと、503自体の完全復旧は区別する。

詳細原本: `~/.codex/private/fanmark-coordinator-root-cause-2026-10-24/`。秘密・実データ・receiptの原本はGitへ保存しない。
