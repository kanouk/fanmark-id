# Aレコードを保持するWorker Route方式の候補

2026-10-19の専用hostによる実検証を受けた改訂候補。本番hostの切替は未実施。
本番開始前に方式をこの票へ固定し、既存のG0〜G5条件をすべて満たす。Custom Domain方式と
当日に混在・切替しない。source停止や移送を省略できる案ではない。

## 解決する残件

従来のCustom Domain案は、解除後に旧Aの再作成が必要になる可能性があり、apexの既存NS2件と
共存したままAPIで復元できるかが未検証だった。Worker Routeは既存proxied Aを保持し、
特定hostのHTTP処理だけをWorkerへ割り当てる。逆操作もそのRoute1件の解除となる。
DNSのNS/MX/TXT/旧authを変更せず、既存Universal SSLの配信を維持する。

Cloudflareは[既存originの前に置く用途としてRoutesを説明](https://developers.cloudflare.com/workers/configuration/routing/routes/)している。
この候補では既存Aを保持するが、新アプリはoriginへfetchせずWorker内で応答する。
例外時にoriginへ流す`passThroughOnException`を追加しない。Workersの利用枠・fail-openの
設定、route競合と公開応答の実確認も当日の条件へ含める。

## 実検証の範囲

同じzoneの専用1hostへ、原本と同じIP/TTL/proxyの一時Aを作成し、backend・秘密値・
外部fetchを持たない専用WorkerをRouteへ接続した。APIでAのID/全属性・他17レコードが
不変であること、外部HTTPSでnonce付き503/no-store・証明書の通常検証成功、HTTPから
同じpath/queryのHTTPSへの307、API POSTの503を確認した。Route解除後も同じAが残った。

所有するRoute/A/Workerだけを削除し、別processで元DNS17件・7 Workerの全settings、
route0・Custom Domains不変を照合した。[限定証拠](evidence/isolated-route-reversal-tls-2026-10-19.json)。
初回はDNS作成の成功応答後に一覧の件数検査で止まり、原応答は保存していなかったため原因は
不明。GETで所有Aを確認し、同じjournalを続けた。作成の再送・別operationへの回避はない。

これは実本番appのログイン/画像/通知や別回線の受け入れ、apex NS共存下のA再作成、
Custom Domain解除の実証ではない。旧Aを保持する方式の準備根拠としてのみ使う。

## 固定する3つの操作票

| 順序 | 固定pattern | Worker | DNS |
| --- | --- | --- | --- |
| 1 | `fanmark.id/*` | `fanmark-app-production` | 元AをID/全属性ごと保持 |
| 2 | `www.fanmark.id/*` | `fanmark-alias-production` | 元AをID/全属性ごと保持 |
| 3 | `admin.fanmark.id/*` | `fanmark-alias-production` | 元AをID/全属性ごと保持 |

apexだけを先に接続し、`receipt_only`のままG4到達・Webhook登録/鍵一致・必要な受信保存を
確認する。その後にwww/adminを1件ずつ接続する。aliasはデータを持たない専用実装を使い、
旧認証URLやAPI POSTを無条件転送しない。新しいCustom Domainは作成しない。

## 当日の実行と逆操作

1. DNS全原本を再取得し、3つのAのID/IP/TTL/proxy/属性、他14レコードを照合する。
   zoneの全RouteとCustom Domainsを取得し、完全一致/広域wildcard/無効化routeなどの
   競合を0にする。WAF/redirect/TLSも保存する。旧Aへ書込みを行わない。
2. G3の独立全件照合・source停止/外部効果・受信境界と、閉鎖appの配備/全bindingを確認。
   使用枠の超過時に旧originへ通過しない設定/契約を確認する。
3. 固定runの排他intentへpattern/script・元inventory・時刻をfsyncし、固定zoneの
   `POST /workers/routes`へ1回送る。CLI deployにroute変更を任せない。
4. 応答不明はPOSTを再送せず、全Route GETでpattern/script/原本との差分から所有候補を
   特定する。所有を確定できない場合は閉鎖を維持する。
5. 全DNS原本の不変、実Route ID、配備100%、外部TLS・HTTP/no-store、旧PWA/保護URL、
   実施者だけの確認経路を照合する。G5の業務再開は別の判断点。
6. G5前に中止する場合は、新側閉鎖と業務未開始を確認。必要な受信を回収する。
   GETで当該runが追加したexact ID/pattern/scriptを確認し、その1件だけDELETEする。
   応答不明ではDELETEを再送せずGETで確認する。全Aを更新・削除・再作成しない。
7. 元Route集合、DNS全17件と証明書、旧公開経路への到達を独立照合する。その後、
   受信記録・外部効果・source権限/関数/Cronの復元を旧側の票で確認する。

新側で業務write/dispatcher/外部副作用が始まった場合は、このRoute解除だけで旧側へ
戻さず前進復旧とする。準備のlocal/専用host結果を当日の許可証として使わない。

Webhook登録driverのG4票は`routingMode`を明示する。`worker-route`ではapexのCustom Domain0・
zone Routeが固定apex→appの1件だけであることを要求する。alias接続前の段階に限定する。
`custom-domain`は従来の厳格なdomain/zone照合とRoute0を要求する。方式の不一致や追加Routeを
成功として扱わない。
