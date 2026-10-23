# 起動確認の長時間待ち（2026-10-24）

PR72の確認後、03:22 JSTの再読取りでrootは23.413秒後に200、maintenanceは4.202秒後に503となった。直前の12回起動成功だけでは解消を判断できなかった。現在の調停応答を各2秒で打ち切る実装では、正常な遅い応答も拒否する。

## 変更

- 起動用の内部read admissionから2秒の期限を除く。現在のfence・scope・保存形式を照合した後だけhandlerを実行する。実際の通信失敗に対する新しいstubでの1回再照合は維持する。
- maintenance公開GETは各30秒まで待つ。一時的な失敗だけ250ms後に1回再試行する。PATCHは5秒・再送なしを維持する。
- Reactの起動待機が5秒を超えた場合、公開shellに4言語の確認中案内を表示する。確認前にroute・個人情報・操作を開かない。
- backendの長時間待ちや未完了writer票の原因をこの変更で解消したとは判断しない。調査と自然日次backupのdrain確認は#71に残す。

## 検証と配備

client244件・現行契約150件・型/Lint警告0・native writer24/import22件が成功。遅いmaintenanceを3秒待った後の200、fence拒否、ACK喪失、書込み追跡を検証した。clientでは6秒の正常応答を1回で受け取り、PATCHは5秒で停止して再送しないことを確認した。

実localブラウザの追加検証は4言語それぞれで6秒の応答待ち・5秒後の案内・確認前の操作0・取得後の復帰を確認する。通常回帰の初回試行では、画面遷移中の要素を待つ既存testがnullを直接参照して停止した。待機式をnull安全にして再検証した。失敗原本は保持する。

本番配備・公開読戻し・既存PWA更新・PR/main CIの結果は受け入れ後に追記する。現在の配備状態は[運用記録](../operations/current-state.md)を参照。

## 初回配備で残った失敗と公開ファイルの分離

ソース`edae935aba02d71290d2cd4e55b1f267262a6f8d`を`8f145105-130f-41f5-9325-43e99c36cdbe`へ配備した。直後の公開3経路×3回は200だったが、続く管理sessionは53.427秒後503、profileは90秒未完了、初回ブラウザはnavigation timeout、旧PWAも65秒内に更新/起動できなかった。全失敗を保持し、復旧成功とはしない。

同時間帯のWorker logは、maintenanceのwall 2,897ms/CPU 8msに対しinspect 2,832ms、所有一覧のwall 16,783ms/CPU 26msに対しenter 13,742ms/leave 3,040msを記録した。低CPUでも調停の通信待ちが長い。待ちの原因がtransportか永続化かは未確定。[Cloudflareの北米接続障害](https://www.cloudflarestatus.com/incidents/sufgcbe8rrwt)も報告されているが、本件との因果は証明していない。

公開HTML・JS/CSS・SWまで調停に依存すると、停止中に修正版のPWAを届ける経路も止まる。これら固定ファイルだけを明示allowlistで分離する。handlerの全体停止/HTTPS/owner受付は維持し、動的OGP・APIと全業務データのfenceは保持する。未知のpathや書込みを例外へ入れない。frontendは初回配備とbyte同一で、追加の保存先・秘密設定・migration・ticket整理は行わない。

追加修正のCIで、閉鎖本番の所有者限定受付にもfence照合が必要な境界を既存testが検知した。通常公開の固定ファイルにだけ例外を適用し、所有者限定受付は元のread admissionを維持するよう修正した。検査を削除/緩和せず、失敗したCIも保持する。

## 最終候補の本番照合

- runtime source `ba88563d88007c82236f0829a28b318a96e6e7f8`、active100% `e79e7c07-2d12-48b7-8c73-170923e17919`。[source CI](https://github.com/kanouk/fanmark-id/actions/runs/40008492396)全6 job成功。frontendは`edae935aba02d71290d2cd4e55b1f267262a6f8d`のbuildとbyte同一、entryは`/assets/index-mSHAO0-b.js`。
- 直前候補のHTML・SW・entry JSは3件とも60秒で未完了。分離後の同じ3件は706/640/983msで200・全SHA一致。時間帯が異なる少数観測で、ページ全体の改善倍率とはしない。
- 公開3経路×3回は200、APIはno-store。設定応答は2.557〜12.323秒。未認証の管理/個人4経路は401/no-store/error本文だけ。ただし最大32.973秒を含む。
- 公開トップはPC/390pxを交互に12回、12回とも検索UIを表示し、横はみ出し・例外・非GET0。表示完了は中央値7.859秒、範囲3.235〜28.800秒。1回はmaintenance28.617秒、get-session503だった。匿名トップの表示確認であり、12回の認証成功・私有画面の受け入れとはしない。
- ブラウザ内でmaintenance GETをRetry-After付き503にしても、既存PWAが通常起動でDLx→mSHAへ更新し、操作gateは閉じたままだった。API非cache、3,944件のsnapshot/checksum・storage保持、旧entry cacheの整理を確認。
- 新版PWAで設定応答を6秒保留し、5秒後の案内・取得前の操作拒否・復帰を確認。実API待ちを含む復帰は11.030秒。単発503の自動復帰3.974秒、待機指示付きは自動再送せず手動6.604秒。ブラウザ内の故障注入と実応答を組み合わせた検査で、通常利用のINPとはしない。
- 旧hash込み329資産。328本文がSHA一致、robotsはCloudflare追記をsourceと別に照合。初期JSはNode22.6のgzip既定level6で333,313→333,606B（+293B）。変更前と同じ圧縮条件を正規値とする。
- 型/Lint 0・client244・現行契約150・実local通常回帰と4言語6秒待機、native writer24/import22・core116と通常CIの検査範囲を維持。秘密設定18件・D1/R2/DO・runtime・4 Cron/3 Route・他3 Workerは保持。業務POST・有料Jev推論・決済/メール・未完了票の手動削除はしていない。

[全観測JSON](metrics/2026-10-24-startup-long-waits.json)、[公開資産manifest](../operations/deployed-assets-2026-10-24-startup-long-waits.json)。最終文書HEAD/取り込み後のCIは[PR73](https://github.com/kanouk/fanmark-id/pull/73)を参照。

内部調停の長時間待ちと認証503の原因は未解消で、全APIの安定性・本人の実アカウントでの受入・実端末/自然回線の性能・自然日次backupのdrain成功は認定しない。未完了票の最新再集計もしていない。#71/#53を開いたまま継続する。
