# 起動時の設定確認エラーへの対策（2026-10-24 / PR72）

公開本番で「サービス設定を確認できませんでした」を再現した。設定確認がclientの5秒制限に間に合わず、調停RPCの遅延・失敗も観測した。確認を省略せず、公開設定GETを読み取り経路へ移し、一時的な通信失敗を1回だけ再試行する。静的資産・公開Masterの従来の待ち方を保持する。

現在の公開確認は成功したが、配備直後の長い調停待ちと管理APIの遅延を完全解消したとは判断しない。[運用調査 #71](https://github.com/kanouk/fanmark-id/issues/71)と実機・自然回線の評価は継続する。

## 実装と安全性

- `GET /api/system/maintenance` と `GET /api/auth/capabilities` はSELECT/PRAGMAだけを行う固定経路として既存のread admissionを使う。scope・census・fenceの確認は維持する。session更新・OAuth callback・非GETはwriter記録を保持する。
- SQLite DOは既存のkey/valueを同期KVと`transactionSync`で扱う。1要求ごとの二重の入力待ちを除き、永続化のoutput gateは保持する。既存namespace・票・復旧状態を移送/初期化しない。
- 設定GETの内部inspectは各2秒・最大2回。通信失敗/内部5xxだけ新しいstubで再照合し、scope/形式不整合・fenceは拒否する。静的資産・SW・公開Masterにはこの短い期限を適用しない。3秒の静的確認後にもSWを配信できるnative回帰を追加した。
- 公開maintenance GETはnetwork/timeoutと待機指示のない502/503/504だけ、250ms後に1回再試行する。確認中はgateを閉じたままとし、各回5秒・合計最大約10.25秒。Retry-After付き応答・権限拒否・schema不正・設定変更PATCHは再試行しない。
- 読取りの内部通信失敗には固定60秒の待機指示を付けず、clientの1回の再試行を許す。fence/設定不整合とwriterのACK不明には従来の60秒指示を保持する。
- 調停の遅延logは固定operation・経過ms・status・内部実装markerだけ。検索語・URL・cookie・ticket ID・秘密値を含めず、内部markerは公開APIへ転送しない。

## 公開比較

Apple M1 / Chrome155、1280pxと390px、CPU・回線制限なし。表示の指標は検索欄の出現を約150msごとに観測した時間で、LCP・INP・実利用者p75ではない。確認前に公開SWを取得しており、frontendの初回cacheとサーバーのcold状態を同一視しない。

| 指標 | 改修前 | 最終版 |
| --- | --- | --- |
| トップの起動 | 6回中1回完了、設定エラー4回・rootの調停503が1回 | 12回中12回完了、JS例外0・横はみ出し0 |
| 検索欄の出現 | 完了した1回は23.009秒 | 中央値0.4925秒、範囲0.227〜1.457秒 |
| root応答の中央値（各4回） | 910.5ms | 53.0ms |
| maintenance応答の中央値（各4回） | 1849.0ms | 152.5ms |
| capabilities応答の中央値（各4回） | 2180.5ms | 779.5ms |
| 初期JS gzip（Node22.6.0 / level6） | 333,187B | 333,313B（126B増） |

少数sample・稼働確認後の値であり、上の時間差だけから改修による一般的な改善率を計算しない。管理sessionは4回中3回401（377/1,245/8,476ms）、1回20秒で未完了。後続の別照合はadmin/profile/owned/notificationsがすべて401/no-store、本文はerrorだけだった。遅い試行を除外して全APIの安定性を認定しない。

既存PWAは同じ保存profileで旧`index-C55A1AXa.js`から`index-DLxZm23a.js`へ通常起動で更新した。catalogのchecksumと3,944件、localStorageのmarkerを保持し、APIをSW cacheに入れず、旧entryをcacheから整理した。browser内で一度だけ503を返した検証では、待機指示なしは自動復帰628ms・エラー画面の一時表示0。Retry-After付きは操作を開かず、手動再試行で154ms。これらは失敗注入からUIまでの検証値で、自然回線の実障害率ではない。

## 途中の失敗を保持

最初の対策`e33236e`では12回中5回しか完了せず、後の12回が成功しても受け入れを確定しなかった。設定の自動再試行・調停診断・読取り期限を追加した`e543a48`も、有効化直後のHTTP検査に失敗した。短い期限を静的資産へ適用したPWA確認が完了せず、最終`4d1e883`で期限を設定APIだけへ限定した。失敗した検査・部分結果・stderr・先行版の測定をGit外に保存し、正常sampleへ置き換えない。

有効化のCLI成功後に管理APIが旧versionを返した観測も保持した。activationを再送せず、独立GETで新version100%と設定を照合した。最終版のSW取得は502msで200/SHA-256一致だった。

## 検証・配備

- 型・Lint 0、client243件、現行契約150件、native writer24件/import22件が成功。旧async KVとの互換、32 writer/32 inspect、ACK喪失、再試行中のfence、静的配信待ちを検証。
- [ソースCI](https://github.com/kanouk/fanmark-id/actions/runs/39996796830)全6 job成功。実local Auth/MFA/D1/R2・ブラウザ・PWA・統合復旧と通常build/dry-runの検査範囲を維持。
- runtime source `4d1e883aa7f2fc68cb4d8e36076adc20572fcb98`、active100% `7595c567-11c0-4c32-be62-34c219128b55`。[PR72](https://github.com/kanouk/fanmark-id/pull/72)の最終文書CI・main CIはPRのchecksとmergeを参照。frontendは`bcddd7616b113760c94c98ce94802e4cfc6325c5`のbuildと同一入力を照合。
- 旧hashを保持した280資産。279fileの公開本文のSHA-256が一致し、robots.txtは元本文とCloudflare追記を別に照合した。秘密設定18件・D1/R2/DO・runtime・4 Cron・3 Route・他3 Workerを保持した。
- productionの業務POST、Jev推論、決済、メール、票削除、fence解放、backup再実行は行っていない。診断用の認証・期限付きread-only Worker2個とnonce経路は削除・元inventoryへの復帰を独立確認した。

## 残作業

02:28 JSTの認証付きread-only照会はowner=null、active14、完全走査14（scheduled9/HTTP5）。旧runtimeに属する票で、個別の終了結果は未確定。active数だけを公開読取り失敗の原因とせず、時刻やruntimeだけで票を削除しない。日次backupのdrainと自然保存・monitorは[#71](https://github.com/kanouk/fanmark-id/issues/71)で継続する。実端末・自然回線・ログイン後の性能は[#53](https://github.com/kanouk/fanmark-id/issues/53)で継続する。

最終公開照合: 2026-10-24 02:54 JST。[全観測の集計](metrics/2026-10-24-startup-recovery.json)、[現行配備状態](../operations/current-state.md)。原本はGit外の`fanmark-startup-recovery-2026-10-24`に保存する。
