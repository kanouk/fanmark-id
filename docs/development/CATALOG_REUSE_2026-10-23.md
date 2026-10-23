# 版付き絵文字カタログの再利用

Issue #53。比較元mainは`e5a9d256490ef3de9acd4bb9899910d10df21b1c`。

## 方針

公開の全件検証済みcatalogだけをIndexedDBへ保存する。API origin当たり1 snapshotを単一transactionで置換し、版・選択方法・件数・全項目の形式・重複・payloadのSHA-256を再検証する。
SHA-256は保存データの破損検出であり、同じoriginの悪意あるscriptに対する署名認証ではない。
キャッシュがなければ従来の全ページ取得。再利用候補があれば既存APIの`limit=1`で選択したready版を照合し、同じ版・件数・先頭項目なら再利用する。
版が変わった場合は確認した新しい版にpinして全件を取得する。版の途中混在や部分snapshotは使わない。

読取り拒否・破損・blockは通常の全件取得へ戻る。保存は入力可能になるまでの待ちに含めず、quotaやabort時もネットワーク取得済みのcatalogを使える。
IndexedDB操作は750msで打切り、transaction完了でだけ保存成功とする。失敗した置換では以前のsnapshotが残るが、毎回の版確認を通るまで利用しない。
版確認の通信失敗・非ready・不正応答は従来の必要時だけの待機/再試行へ進み、古い版で代替しない。
トップ表示・PWA更新確認、入力保持・取消、認証/所有者/MFA、4言語、個人query、SW API非cacheとOG先読み除外は維持する。

## 検証と比較方法

単体で同版再利用・版変更・pinned選択の分離・破損・重複・件数不一致・origin相違・通信/保存失敗を検証する。
実local Worker/Master D1/Chrome/IndexedDBでready版を変更し、全ページのpinと次回再利用、破損修復・拒否/block/quota/abort、通常入力・保存等を確認する。旧版のimmutability/activation audit/generation guardは保持する。

今回は`slow-network-audit.mjs ... --catalog-action`で同条件の前後を取り直す。
表示直後に直接入力の絵文字を確定し、catalogによる変換後に入力として受理されるまでの時刻と待ち時間を記録する。
後続のavailability POSTはブラウザ内で503にして停止し、検索記録や取得等の業務書込みを行わない。この値は検索結果取得の完了時間ではない。
LCPは最初の操作までの値なので、従来の操作なし5秒後まで観測したLCPとは混ぜない。転送量は受理後・SW制御・5秒以上の観測が揃ってから記録する。
集計器は全ページの完了または単一metadata照合＋実際の入力受理を検証し、異なる計測modeを混ぜない。
通信本文の完了と入力受理は別の指標。Chrome155・390×844px・ページCPU4倍減速、1.6Mbps/150msと400kbps/400msの各初回/PWA再訪を前後3組ずつ直列測定する。
CDPのページ/SW制限は単一物理回線を完全には再現しない。実端末・自然回線・利用者p75ではない。

受け入れ後に計測値・配備・CIと公開確認を追記する。生記録はGit外の`~/.codex/private/fanmark-catalog-cache-2026-10-23/`へ保存する。
