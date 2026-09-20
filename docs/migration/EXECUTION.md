# Cloudflare移行の実行・再開手順

親イシュー: [#28](https://github.com/kanouk/fanmark-id/issues/28)。親の移行仕様・受け入れ条件を正とする。#26と#27の試作はこの移行へ一括マージしない。

## 役割と使用枠

Astraが設計確定、作業分解、差分レビュー、検証結果の確認を行い、GPT-5.6 Luna（max）が範囲を区切った実装を担当する。設計不明点、認可/課金/ID/原子性に関わる変更はAstraが判断する。

通常Codex枠の残り20%がユーザー指定の下限。各実装単位の開始前とレビュー後に最新残量を取得する。22%以下では新規投入を停止し、実行中の作業を保存して引き継ぐ。残量取得に失敗した場合は新しい大きな作業を開始しない。他タスクの消費・表示遅延により20%を厳密に保証する仕組みではない。

使用量APIにはLunaに関連するgpt-reserve表示があるが、通常枠と独立して消費される条件は未確認。通常枠を使わない前提で作業量を決めない。DeepSeekなどの追加モデルは、この環境で実行可能と確認できた場合に限定した作業で評価する。利用できないモデルを使用済みと記録しない。

## 段階

- [0A: CIと環境境界を分離する](https://github.com/kanouk/fanmark-id/issues/29)
- [0B: 本番棚卸しと移行対応表を確定する](https://github.com/kanouk/fanmark-id/issues/30)
- [0C: Workers・D1上で認証と競合制御を検証する](https://github.com/kanouk/fanmark-id/issues/31)
- [0D: 現行Stripe Webhookの重複適用を防ぐ](https://github.com/kanouk/fanmark-id/issues/32)
- [1: Worker API契約とフロント配信を導入する](https://github.com/kanouk/fanmark-id/issues/33)
- [2A: D1・認証・R2・ジョブを実装する](https://github.com/kanouk/fanmark-id/issues/34)
- [2B: 再実行可能なデータ移行・照合を実装する](https://github.com/kanouk/fanmark-id/issues/35)
- [2C: 絵文字マスターの更新経路を移植する](https://github.com/kanouk/fanmark-id/issues/36)
- [3: 統合試験と切り替え・復旧をリハーサルする](https://github.com/kanouk/fanmark-id/issues/37)
- [4: 本番切り替えと監視・旧基盤終了を実施する](https://github.com/kanouk/fanmark-id/issues/38)

## 作業を渡すとき

対象ファイル、入力/出力、権限、保持するID/制約、変更範囲、依存、検証コマンドと期待結果を指定する。実装者の完了報告だけで段階を閉じず、Astraが差分と検証の証拠を確認する。ローカル実装、staging適用、本番適用、運用確認を分けて記録する。

## 今回の開始状態

- origin/mainから隔離したworktreeで開始。ヒーロー試作側のcheckoutは変更しない。
- #29のCI分離はPR #39でmainへ反映済み（b307dd4）。ローカル型検査・ビルド・workflow否定検査は成功。GitHub workflowはdisabled_manuallyのまま。#30のオフライン棚卸しと#31の初期local proofはPR #40でmainへ反映済み（e5a553c）。棚卸しは構文解析テストと再現性検査まで完了。全体の本番対応表・設定照合は未完了。
- #31は合成ユーザーの認証3テスト、D1同時操作/再試行/rollbackの8テストがlocal runtimeで成功。実OAuth、管理者MFA、既存hash、remote CPU/負荷、実業務全体の受け入れは未完了。
- 本番のread-only観測は [live-observations.md](live-observations.md) を参照。
- 本番データ更新、DNS変更、Cloudflare本番配備、課金操作は未実施。

## 再開時の確認

1. 最新の使用枠とGit状態、親/子イシュー、PRの状態を読む。保存時の残量を現在値と扱わない。
2. 未コミット作業を確認し、作業ツリーと実装者の担当範囲を復元する。
3. 前回の成功した検証と未確認条件を区別し、変更/失敗/未解決の理由がある範囲を検証する。
4. 次の未完了の実装単位を指定して再開する。本番切り替えは確認・監視・復旧までの余裕を確保してから開始する。
