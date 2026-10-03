# ユーザーデータ・ドメイン移行前の完了判定

2026-10-03 JST。親Issue #28と#30–#37の現行本文、現在の実装・受け入れ記録を
照合した残件表。作業時間やテスト件数を進捗率に換算しない。
stagingの機能別受け入れは進んでいるが、以下の全条件はまだ成立していない。

## 今回の到達点

Workersのアプリ/API、分離D1、R2、認証、定常ジョブ、非ユーザー系マスター、
合成データによる移送・統合・復旧を検証し、実ユーザーデータ移送と公開ドメイン
切替に進める状態を作る。実ユーザーのexport/import、既存認証情報・Storageの
実移送、DNS変更、Supabase本番writerの停止・旧基盤終了は今回実行しない。
実ユーザーでしか証明できない行同一性・既存provider主体との対応は、最後の
データ工程の条件として明示する。合成検証の合格から推定して完了にしない。

## 完了までに閉じる六つの作業

| 作業 | 現在の証拠と不足 | 今回の完了条件 | 対応Issue |
| --- | --- | --- | --- |
| 1. 移行元・移行先・呼び出し元の照合 | 40表、58関数、37登録trigger、77policyのcatalogと211箇所のfrontend対応表はある。分類reportは全体照合未完了のまま。sequence keyの3候補indexなどに未解決の意味差がある。 | 各object/actionについて、source定義hash、権限、実行経路、targetまたは不使用の根拠、契約差、対応する検証を結び付ける。未実装の現行経路・未説明の差を残さない。実データでしか判断できない事項はデータ工程へ明示的に移す。 | #30, #33, #34 |
| 2. アプリと認証・業務処理の仕上げ | 多くのsession/権限/競合/失敗時rollbackは受け入れ済み。直近の退会はcode388044b、CI37092452003、Worker4a8d85dd、native66とremote6が受け入れ済み。検索記録・お気に入りのevent/count抑止による不整合は、全25 Business migrationで再現し、local17ケースで修正を確認。CI・配備受け入れは未完了。 | 現行画面の必須操作、管理者MFA、登録/password setup/reset、ライセンス取得・返却・移管・抽選・上限・クーポンを統合構成で確認する。現在修正中の既知不具合を解消し、必要な新経路をstagingで確認する。 | #31, #33, #34 |
| 3. 実サービスとのテスト接続 | Stripe、Resend、4 OAuth providerの実接続は未受け入れ。stagingのsecretは3名称のみで、signup/email/providerは閉じている。閉じていることの確認は接続成功の証拠ではない。 | Stripe sandboxのCheckout/Portal/変更/延長/署名Webhook・重複/逆順/再試行、テスト宛先の認証メール、4 providerの開始/callback/初回設定を確認する。Apple relayも含む。必要なprovider資格情報・テスト設定・テスト送信の許可が必要。本番課金・本番宛先送信は行わない。 | #31, #32, #34, #37 |
| 4. ジョブ・運用・復旧 | 通知DOの起動/排出/停止・復旧、期限処理の合成一回実行、archive smoke、Time Travel/R2 replayの個別証拠はある。定常運用、archive/retention、CPU/plan適合、秘密管理/最小権限を含む運用全体は未受け入れ。 | 起動条件/周期/再開/監視、保存期間、担当と権限、秘密の保管・交換、停止時間/復旧時間目標を確定し、合成障害から復旧を実測する。測定で有料planが必要なら設定前に明示する。 | #30, #34, #37 |
| 5. 移送器の合成データ受け入れ | resumable D1/R2 importer、件数/ID/hash/sequence/credential変換の個別検証がある。source schema converterのdeployableはfalse。実ユーザーデータは読み出して移送しない。 | 最終schemaと運用構成で合成snapshotの中断・再開・照合・復旧を通し、未説明差分0と所要時間を記録する。個別の旧schema検証から最終構成の成立を推定しない。 | #35, #37 |
| 6. 最終統合と引き渡し | desktop・390px viewportのeditor/favorites、API/static/PWA/noindexなどの個別証拠がある。実スマホ・対応言語・旧PWAからの更新を含む最終通し確認は未完了。PR #41はdraft。 | 同じ最終candidateで主要利用フロー、provider、ジョブ、PC/スマホ、言語、旧client更新、障害/復旧を一巡する。実行結果と残すデータ/DNS工程の手順を更新し、PRの最終差分・CIをレビュー可能にする。 | #33, #37 |

## 進行方法

- この六項目を管理単位にする。個別の新テストを追加しただけでは項目を完了にしない。
- 既に受け入れた機能は、その契約や依存箇所が変わった場合、既知不具合がある場合、
  または最終統合で必要な場合に再確認する。全機能のremote fault検証を各commitで
  一律にやり直すことは完了条件に追加しない。
- 個別の障害検証は、移行要件・実際の不具合・未確認の契約に結び付ける。
  新しい仮説を無制限に追加して終了条件を動かさない。
- provider設定待ちの間は、設定に依存しない上記作業を進める。ただし設定待ちの
  項目を完了にせず、全体完了の見通しをコード作業だけで約束しない。
- 六項目の未完了・待ち理由・証拠を更新する。次のチェックポイントでは完了した
  項目と具体的に残る項目を示す。実ユーザーデータ/DNSの未実行は、今回の範囲内で
  必要なコード/infra/接続/統合の未完了を隠す理由にしない。

## 現在の直近作業

1. 全schemaで再現した検索・お気に入りのevent/count不整合を修正する。
2. 修正を既存のCI・staging受け入れにつなぎ、上記1の対応表へ反映する。
3. 上記1と4の未照合を、object/運用条件ごとに閉じる。必要な外部設定は3で
   一括して扱い、コード確認の途中で同じ依頼を繰り返さない。

現在の実行・配備の詳細は[HANDOFF](HANDOFF.md)と[EXECUTION](EXECUTION.md)、
関数/RLS/callerの照合は[source runtime](source-runtime-review.md)、
[source authorization](source-authorization-review.md)、
[object map](object-map.md)、[frontend callsites](frontend-callsite-map.md)を参照する。
