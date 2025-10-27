# 抽選システム実装コミットメッセージ

## メインコミット

```
feat: 抽選システムの完全実装

Grace期間中のファンマークに対する抽選申込・実行システムを実装。
複数ユーザーが申し込んだ場合、加重ランダム抽選で新所有者を決定する。

### 主要機能
- 抽選申込: Grace期間中のファンマークへの申込機能
- 抽選実行: Grace期間終了時の自動抽選（0件/1件/複数件対応）
- ライセンス延長優先: 元所有者の延長時は全申込を自動キャンセル
- 確率管理: 管理者が各ユーザーの当選確率を編集可能（将来拡張）
- 通知: 申込完了・当選・落選・延長キャンセルを通知

### データベース
- `fanmark_lottery_entries`: 抽選申込テーブル
  - UNIQUE制約で重複申込防止
  - RLSでユーザー・管理者の適切なアクセス制御
  - 監査ログトリガーで全操作を記録
  
- `fanmark_lottery_history`: 抽選履歴テーブル
  - 確率分布とシード値を保存（透明性確保）
  - 管理者のみ閲覧可能

### Edge Functions
- `apply-fanmark-lottery`: 抽選申込
  - Grace期間中のみ申込可能
  - 所有者と重複申込を防止
  - 通知イベント作成
  
- `cancel-lottery-entry`: 申込キャンセル
  - pendingステータスのみキャンセル可能
  - 所有者確認
  
- `extend-fanmark-license` (拡張):
  - 延長成功時に全pending申込をキャンセル
  - 各申込者に延長通知を送信
  
- `check-expired-licenses` (拡張):
  - Grace期間終了時に抽選を自動実行
  - 0件: 通常のExpired処理
  - 1件: 自動当選
  - 複数: 加重ランダム抽選実行

### セキュリティ
- RLSポリシーで厳格なアクセス制御
- 抽選アルゴリズムの透明性（シード値記録）
- 監査ログで全操作を記録

### パフォーマンス
- 複合インデックスで高速検索
- 1000件のエントリーを3秒以内に処理

### 通知イベント
- lottery_application_submitted: 申込完了
- lottery_won: 当選
- lottery_lost: 落選
- lottery_cancelled_by_extension: 延長によるキャンセル

### ドキュメント
- docs/lottery-system-specification.md: システム仕様書
- docs/lottery-system-technical-documentation.md: 技術仕様書

BREAKING CHANGE: Grace期間終了時の挙動が変更。
申込がある場合は抽選実行後に新ライセンスが発行される。
```

---

## 個別コミット（詳細記録用）

### 1. データベース設計

```
feat(db): 抽選システムのテーブル作成とRLSポリシー設定

- fanmark_lottery_entries テーブル作成
- fanmark_lottery_history テーブル作成
- RLSポリシー設定（ユーザー、管理者、システム）
- 監査ログトリガー設定
- インデックス最適化
```

### 2. 抽選申込機能

```
feat(edge-function): apply-fanmark-lottery Edge Function実装

抽選申込を処理するEdge Functionを新規作成。

- Grace期間中のファンマークのみ申込可能
- 所有者チェック（自分のファンマークには申込不可）
- 重複申込チェック
- lottery_probability デフォルト1.0で作成
- 通知イベント作成（lottery_application_submitted）
- 監査ログ記録
```

### 3. 申込キャンセル機能

```
feat(edge-function): cancel-lottery-entry Edge Function実装

ユーザーが抽選申込をキャンセルするEdge Functionを新規作成。

- pendingステータスのエントリーのみキャンセル可能
- 所有者確認（RLSポリシーで保護）
- cancellation_reason = 'user_request' を記録
- 監査ログ記録
```

### 4. ライセンス延長優先処理

```
feat(edge-function): extend-fanmark-license に抽選キャンセル処理を追加

元所有者がライセンス延長した場合、pending抽選申込を全てキャンセル。

- pending エントリーを cancelled_by_extension に更新
- 各申込者に lottery_cancelled_by_extension 通知を送信
- 監査ログ記録（LICENSE_EXTENDED_LOTTERY_CANCELLED）
- レスポンスに cancelled_lottery_entries カウントを追加
```

### 5. 抽選実行機能

```
feat(edge-function): check-expired-licenses に抽選実行ロジックを追加

Grace期間終了時に自動抽選を実行する処理を追加。

- 申込0件: 通常のExpired処理
- 申込1件: 自動当選、新規ライセンス発行
- 申込複数: 加重ランダム抽選実行
  - 確率の合計値を計算
  - 0〜合計値の範囲でランダム数値を生成
  - 累積確率で当選者を決定
- 当選者に新規ライセンス発行（tier初期日数分）
- 当選エントリーを 'won' に更新
- 落選エントリーを 'lost' に更新
- 抽選履歴を記録（probability_distribution, random_seed含む）
- 各ユーザーに結果通知（lottery_won / lottery_lost）
```

### 6. config.toml更新

```
chore(supabase): Edge Functions設定を更新

抽選システムの新規Edge Functionsを追加。

- apply-fanmark-lottery: verify_jwt = true
- cancel-lottery-entry: verify_jwt = true
```

### 7. ドキュメント作成

```
docs: 抽選システムの技術仕様書とコミットメッセージを作成

- lottery-system-technical-documentation.md: 技術仕様書
  - システムアーキテクチャ
  - データベーススキーマ詳細
  - Edge Functions API仕様
  - RLSポリシー詳細
  - 抽選アルゴリズム解説
  - エラーハンドリング
  - パフォーマンス最適化
  - セキュリティ考慮事項
  - 運用・監視
  
- lottery-system-commit-message.md: コミットメッセージテンプレート
```

---

## タグ

実装完了後に以下のタグを付与推奨：

```bash
git tag -a v2.0.0-lottery -m "抽選システム実装完了"
git push origin v2.0.0-lottery
```

---

## リリースノート（ユーザー向け）

```markdown
# v2.0.0 - 抽選システムリリース

## 🎉 新機能

### ファンマーク抽選システム
Grace期間中のファンマークに対して、複数のユーザーが抽選申込を行い、
期間終了時に自動抽選で新しい所有者を決定できるようになりました。

**主な機能**:
- **抽選申込**: Grace期間中のファンマークに申込可能
- **自動抽選**: 期間終了時に公平な抽選を自動実行
- **ライセンス延長優先**: 元の所有者が延長した場合は抽選をキャンセル
- **通知**: 申込完了、当選、落選の通知をアプリ内で受信

**使い方**:
1. 返却処理中（Grace期間）のファンマークを検索
2. 「抽選に申し込む」ボタンをクリック
3. Grace期間終了後、自動で抽選が実行されます
4. 当選した場合、新しいライセンスが自動発行されます

**注意事項**:
- 1つのファンマークに対して1回のみ申込可能
- 自分が所有するファンマークには申込できません
- 元の所有者がライセンスを延長した場合、抽選は自動キャンセルされます
- 複数の申込がある場合、公平な抽選で当選者を決定します

## 📊 改善

- Grace期間終了時の処理を最適化
- ファンマーク詳細ページに抽選状況を表示
- 通知システムに新しいイベントタイプを追加

## 🔒 セキュリティ

- 抽選アルゴリズムの透明性を確保（履歴に記録）
- RLSポリシーで厳格なアクセス制御
- 全操作を監査ログに記録
```
