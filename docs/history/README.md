# 過去の仕様・移行記録

現行の入口は[文書案内](../README.md)、本番作業は[運用入口](../operations/README.md)。

| 保存記録 | 読む目的 |
| --- | --- |
| [旧README](README-legacy.md) | 当初の仕様とSupabase運用の背景 |
| [整理前のPRODUCT](PRODUCT-2026-10-21.md) | 旧認証・当時のbackup受け入れと内部フローの原文 |
| [旧TECH](TECH-2026-10-21.md) | 2026-10-21整理前の技術説明・移行testの詳細 |
| [旧ARCHITECTURE](ARCHITECTURE-2026-10-21.md) | 旧画面/SQL/RLSの対応とstaging実証 |
| [移行作業履歴](../migration/HANDOFF.md) | 判断・失敗・復旧の時系列 |
| [V3移行票](../migration/RESUME-2026-10-20-V3.md) | 2026-10-20の移送と公開受け入れ |
| [空本文の横断点検](../migration/empty-body-audit-2026-10-21.md) | 全件既読修正後の操作点検 |
| [旧リファクタリング計画](REFACTORING_PLAN-2026-06-12.md) | Supabase Edge Functions前提の2026-06-12計画。現行は[REFACTORING_PLAN](../REFACTORING_PLAN.md) |

`docs/migration/`には現在のAPI契約と過去の操作票が混在する。関数名・実装契約は参照できるが、
「現在」「未切替」「PR41未マージ」「stagingのみ」といった当時の状態を現行本番へ当てはめない。
実稼働の最終確認状態と手順を優先し、一回限りの移行・鍵作成・callback登録・MFA再登録は再実行しない。
原文の時系列や失敗記録を消して完了扱いに変更しない。

整理前の原文はcommit `e3aedcd12f18c0451d64fd72d2d6eaf91bb34d06`で取得できる。
保存copyでは移動に伴う相対リンクとMarkdownの行末表記を整えた。業務要件・失敗や実証の記録は削除していない。
