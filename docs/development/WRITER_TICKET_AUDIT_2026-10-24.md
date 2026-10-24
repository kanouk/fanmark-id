# #71の個別writer票の読取り監査

従来の`/inspect`は件数と種類・版の周辺集計だけで、個別票を手元の実行記録と照合できなかった。18:53 JSTの24票は11:05 JSTと同じ集計だったが、同じ票集合や処理終了の証明ではない。

## 読取り専用の追加

既存DOのbinding内に`POST /audit`を追加する。入力はUUIDと現行scopeだけ。scope・fence・counterと完全走査が一致する1,000票以下のsnapshotに限り、個別ID・開始時刻・種類・runtime revision・旧形式の有無を返す。旧boolean票の時刻・版はnullのままで推測しない。破損・不一致・上限超過は拒否する。

`transactionSync`の中で一度だけsnapshotを読み、scope/active/ticket/fenceを保存・削除しない。通常inspectの集計と公開HTTP APIは同じ契約を保つ。新binding・namespace・schema・秘密値をアプリへ追加せず、frontendとPWAも変更しない。通常要求で個別監査を呼ばない。

個別票の結果は、明示した期限・認証・完全一致GET経路だけを持つ短命のoperatorからGit外0700/0600領域へ取得する。個別IDを公開log・Issue・Gitへ書かない。operatorは監査だけを行い、票を終了させる入口を持たない。終了後にoperatorと経路を削除して元のinventoryを照合する。

## 検査と終了判定

追加前のnative試験は未実装の404で失敗。追加後は未初期化、旧票、帰属付き票、fence中、上限1,000票と超過、不正scope/key/metadata、counter不一致を検査し、全保存keyが不変であることを照合する。実行中callbackは監査後もactiveに残り、そのcallbackが終了してleaveした後だけdrainedになる。

監査の追加だけで既存24票を終了済みと認定しない。個別票と同じ呼出しの業務未開始または全業務終了を裏付ける原本を探す。時刻・runtime・件数の一致だけでは足りない。証拠不足なら票を保持し、自然日次backupを成功と認定しない。既存slot・手動capture・通知を再送せず、fence強制解除や台帳初期化を行わない。外部サポートへは送信しない。

配備・個別照合・自然backupの実際の結果は#71とGit外journalへ日時付きで記録する。今回の操作原本は`~/.codex/private/fanmark-writer-ticket-audit-2026-10-24-1413/`。

## 本番で確認した範囲

source `960657ddbece020ba2ed7ce44d65d3dc4aa01137` / [CI40102012849](https://github.com/kanouk/fanmark-id/actions/runs/40102012849)全6 job成功後、23:27 JSTにactive100% `cb205dc2-9aa7-4487-bb33-278bb7eea8f0`へ反映した。18秘密設定名・全保存先/runtime・他3 Worker・3 routes/4 crons・保存ログ設定を保持。native writer37/import22・型/Lint0/client244/契約154が成功し、CIの実local認証/MFA・保存・PWA/復旧も通過した。frontend378資産は前版と全byte同一で、公開377 SHA一致と既存robots追記のbyte一致、8経路200/401/API no-store、検索UIを確認した。

23:28 JSTの監査3回はIDを含む24票の全snapshotが一致した。scheduled16/HTTP8、legacy0、ownerなし。開始時刻はUTC23日12:31:12〜19:14:06。7件の既知の調査operationの最上位metadata/text（1 file 8MiB以下）829 fileへ個別IDを照合したが一致は0だった。9既存Live file・440イベントの時刻近傍も調べたが、票IDに結び付いた全業務終了の証明は得られなかった。これは全保存先に記録がないという網羅的な証明ではない。票を削除せず、operatorと経路を削除して元inventoryへ復帰した。

UTC24のreceiptは23:30 JSTの再読取りでもfailed/drain_pending24・fenceReleased=true、archiveのobjectKeyなし。最新成功のUTC23暗号化archiveは33,319,145 bytesの全量hash一致で、source/schema/key IDも現行と一致したが、終了から約38.4時間経過しRPO目標24時間を超過した。保存の再実行・復旧・通知送信は行っていない。

配備前6時間のevent付き警告は11件（新版6db10件・既報671が1件）で、すべて200/handler0ms、最大は終了RPCの7,057ms。09:55 UTC以降のDO adaptive取得集計は672 requests/errors0/NRT・取得最大513.939ms。sampling・集計・要求対応付けの限界があり、往復待ちを配送/起動/永続化へ分解した根本原因の証明とはしない。#71の終了確認・自然backup回復・基盤原因は未解決のまま維持する。
