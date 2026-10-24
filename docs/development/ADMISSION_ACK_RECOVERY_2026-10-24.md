# 開始応答の喪失からの安全な復帰（#71、2026-10-24）

## 保存ログと分かった限界

14:12 JSTの保存開始から18:07 JSTまでのEventsは235件、errors 0。event keyを持つ調停警告は17:43:19の1件で、`leave`はstatus 200、往復1,005ms、内部handler 0msだった。これは過去の長時間待ち・503の原因を特定した証拠ではない。

同期間のDO adaptive集計は798 requests・errors 0・success/NRTだった。GraphQL introspectionで`max.wallTime`の単位はmicrosecondsと確認し、取得された最大値は420.316ms。従来の「単位未確認」の原本は変更しない。集計はsampling/遅延を含み、個別警告との同一要求の対応や、全要求の無障害証明には使わない。配送/起動/出力gateの永続化待ちは現行ログだけでは分離できない。

## 再現して直した経路

`withRecoveryWriter`は`enter`の応答を失うと、開始票が永続化されていても業務を始めず`RecoveryWriterDrainError`を返す。HTTP wrapperはそれを503にする。安全側ではあるが、保存済みの自身の票を確認する手段がなかった。障害注入したnative Workerで、この拒否を修正前の失敗テストとして保存した。

変更後は、実際の一時的なenter失敗に限り100ms後、新しいstubで1回だけ読取り専用の`/admission`を呼ぶ。開始要求を再送しない。現在の呼出し自身のID・scope・kind・runtime revisionが一致する完全な票、activeが1以上で1,000件以下の完全走査件数と一致し、scope/fenceが整合している場合に限り、永続化済み開始の証明を返す。callerは`admitted=true`と自分のadmissionIdも検証し、まだ一度も始めていない業務を1回だけ実行する。

- 読取りはscope/active/ticket/fenceを書き換えない。既存の保存key/value・namespace・schemaを維持する。
- 他ID、旧boolean票、kind/revision違い、欠落・破損、counter/fence不整合、証明なし/異なるIDの200応答、確認自体の通信失敗では業務を始めない。未確認の票は保持する。
- 明示的overloadやpermanent refusalでは読取りを増やさない。enterと業務の再送はしない。leaveは従来どおり完了した自身の票だけ有限再試行する。
- 元の開始が保存済みなら、途中でfenceをclaimされてもその票を数え続ける。遅れて元のACKを受け取る場合と同じく、実行中の業務とleaveが終わるまでdrainedにならない。
- 新callerが旧DO版へ到達して`/admission`が404となる場合も拒否し、従来の動作へ安全に戻る。未知のHTTP endpointを公開しない。
- 成功した復帰は固定event/kindだけを保存する。ID・Cookie・URL/query・検索語・任意例外文字列は記録しない。200の不正bodyも失敗ログへ含める。

## 検証と残課題

修正前の回帰テストは、開始を保存した後でACKだけを失わせ、`recovery_writer_unavailable`で失敗した。修正後はnative writer33件/import22件が成功。実Workerの`/api/auth/get-session`でも同じ障害注入で200/nullへ復帰し、enter1回・proof1回・業務1回を照合した。未保存のenterは票を作り直さず拒否する。scope/ID/provenance不一致・legacy・不正証明・確認失敗・fenceとの並行実行を検査し、元の保存状態とdrain拒否を保持した。

この修正は、過去の障害時のenterが実際に保存されていたことや、基盤の通信断の原因を証明しない。既存24票の終了、自然backupの再成功、Cloudflare内部の長時間待ちの原因は#71で継続する。既存票の削除・fence強制解除・backup再送・本番業務POSTはしない。配備・CI・公開確認の結果は運用状態とGit外journalへ記録する。

原本: `~/.codex/private/fanmark-saved-log-investigation-2026-10-24-0906/`。保存ログの読取り・introspection・失敗/成功テスト・操作intent/receiptを保持する。

## 本番反映と照合

2026-10-24 18:32 JST、source `9c64d3d37cc69432018a52419a265bdeb7612b91` / [source CI40081781321](https://github.com/kanouk/fanmark-id/actions/runs/40081781321)全6 job成功を固定し、active100% `6dbce711-91ac-45d1-989a-fd26b8e9fd89`へ反映した。18秘密設定名・全保存先/runtime・他3 Worker・3 routes/4 crons・保存ログ設定を独立確認。正規buildの全378資産が配備前とbyte同一で、公開377 SHA一致と既存robots追記のbyte同一を確認した。通常の8経路は期待どおり200/401/API no-store、ブラウザも検索UI・確認エラーなしを照合した。

単発の参考値はmaintenance137→123ms、get-session105→79ms、root688→733ms。前後とも正常であり、これを因果的な速度改善とは扱わない。障害時の効果はnative故障注入で確認し、本番での自然なACK喪失から復帰した記録とは区別する。フロントエンド/PWAのbyteを変えず、通常の通信回数も維持する。最終文書HEAD・merge/main CIは[PR76](https://github.com/kanouk/fanmark-id/pull/76)とGit外journalで別に照合する。
