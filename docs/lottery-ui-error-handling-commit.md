# コミットメッセージ: 抽選UI エラーハンドリング改善

## メインコミット

```
fix(lottery): ensure UI updates after lottery operations regardless of success/failure

問題:
- 抽選申し込み/キャンセル操作でエラーが発生した場合、UI状態が更新されず、
  ユーザーが再度同じボタンを押せてしまう問題があった
- 特に重複申し込みエラーの場合、データベース上は申込済みだが、
  UIには「申込済み」バッジが表示されない状態になっていた
- ユーザーが誤って複数回ボタンをクリックし、混乱する原因となっていた

根本原因:
- refetch() または handleQueryChange(query) が try ブロック内で呼ばれているため、
  Edge Function からエラーが返された場合に実行されない
- エラー時にデータベース状態とUI状態の不整合が発生

解決策:
- try...catch...finally 構造を使用し、finally ブロックで UI 状態更新を実行
- これにより、成功/失敗に関わらず必ず UI 状態が最新化される
- データベースの真の状態が常に UI に反映されることを保証

影響範囲:
- src/pages/FanmarkDetailsPage.tsx
  - 抽選申し込みボタン (191-198行目): refetch() を finally ブロックへ移動
  - キャンセルボタン (211-219行目): refetch() を finally ブロックへ移動
- src/components/FanmarkAcquisition.tsx
  - 抽選申し込みボタン (607-618行目): handleQueryChange() を finally ブロックへ移動
  - キャンセルボタン (632-643行目): handleQueryChange() を finally ブロックへ移動

技術的詳細:
FanmarkDetailsPage.tsx:
  - refetch() を finally ブロックへ移動
  - エラー発生時でも useFanmarkDetails から最新データを取得
  - has_user_lottery_entry の値に基づいてボタン/バッジを切り替え

FanmarkAcquisition.tsx:
  - handleQueryChange(query) を finally ブロックへ移動
  - エラー発生時でも検索を再実行して最新状態を取得
  - 検索結果の has_user_lottery_entry が正しく更新される

実装パターン:
  // Before
  try {
    await applyToLottery(fanmarkId);
    await refetch();  // ← エラー時に実行されない
  } catch (error) {
    console.error('Failed:', error);
  }

  // After
  try {
    await applyToLottery(fanmarkId);
  } catch (error) {
    console.error('Failed:', error);
  } finally {
    await refetch();  // ← 必ず実行される
  }

ユーザーへの影響:
改善前:
  - 正常系: ボタン → バッジ (正常動作)
  - エラー系: エラートースト表示 → ボタン残る → 混乱
  - ユーザーが何度もボタンをクリックしてしまう

改善後:
  - 正常系: ボタン → バッジ (変わらず)
  - エラー系: エラートースト表示 → 最新状態表示 → 明確
  - 重複申込エラー時でも「申込済み」バッジが即座に表示される
  - ユーザーの混乱を防ぎ、より直感的な体験を提供

エラーシナリオ例:
1. 重複申込:
   - エラー: "既にこのファンマの抽選に申し込んでいます"
   - UI更新: ボタン → 「申込済」バッジ + キャンセルボタン

2. Grace期間終了:
   - エラー: "抽選の申し込みに失敗しました"
   - UI更新: ボタン/バッジ非表示（期間終了のため）

3. 既にキャンセル済み:
   - エラー: "抽選のキャンセルに失敗しました"
   - UI更新: バッジ非表示 → 「申し込む」ボタン表示

セキュリティ:
- RLS ポリシーにより、ユーザーは自分の申込状態のみ取得可能
- エラーメッセージは適切にフィルタリングされ、技術的詳細は露出しない

パフォーマンス:
- エラー時でも追加のネットワークコストは最小限
- refetch() は軽量な RPC 呼び出し（1件のファンマーク情報のみ）
- ユーザー体験の向上が優先される

テスト:
- 重複申込エラー時の UI 更新を確認
- Grace期間終了後の申込エラーを確認
- 既にキャンセル済みのエントリーのキャンセル試行を確認
- 正常系の動作が変わらないことを確認

ドキュメント:
- 新規作成: docs/lottery-ui-error-handling.md
  - エラーハンドリング仕様の詳細
  - 技術的実装詳細
  - テストシナリオ
- 更新: docs/lottery-system-specification.md
  - 2.2.4 エラーハンドリングとUI状態同期 セクション追加

関連:
- docs/lottery-ui-error-handling.md: 詳細な技術仕様
- docs/lottery-system-specification.md: 抽選システム全体仕様
- src/hooks/useLotteryEntry.tsx: 既存のエラーメッセージ翻訳機能
```

---

## 個別コミット（必要に応じて分割する場合）

### コミット1: FanmarkDetailsPage エラーハンドリング改善
```
fix(lottery): ensure UI update in FanmarkDetailsPage after lottery errors

- Move refetch() from try block to finally block in lottery apply button
- Move refetch() from try block to finally block in lottery cancel button
- Ensures UI state updates even when Edge Function returns errors
- Fixes duplicate entry error UI state issue
```

### コミット2: FanmarkAcquisition エラーハンドリング改善
```
fix(lottery): ensure UI update in FanmarkAcquisition after lottery errors

- Move handleQueryChange() from try block to finally block in lottery apply button
- Move handleQueryChange() from try block to finally block in lottery cancel button
- Ensures search results refresh even when Edge Function returns errors
- Consistent error handling across all lottery UI components
```

### コミット3: ドキュメント追加
```
docs(lottery): add error handling specification and update system spec

- Add new document: docs/lottery-ui-error-handling.md
  - Comprehensive error handling specification
  - Technical implementation details
  - Test scenarios
- Update docs/lottery-system-specification.md
  - Add section 2.2.4: Error Handling and UI State Synchronization
  - Add error scenario table
  - Add code examples
```

---

## タグ推奨

```
v2.1.0-lottery-ui-fix
```

---

## リリースノート（ユーザー向け）

### Version 2.1.0 - 抽選UI エラーハンドリング改善

**リリース日**: 2025年10月30日

#### 🐛 バグ修正

**抽選申し込み時のUI更新問題を修正**

以前のバージョンでは、抽選申し込み時にエラーが発生した場合（例：既に申し込み済み）、画面が最新の状態に更新されず、ユーザーが混乱する問題がありました。

**改善内容**:
- エラーが発生した場合でも、画面が常に最新の状態に更新されるようになりました
- 重複申し込みエラーが発生した場合、即座に「申込済み」バッジが表示されます
- ユーザーが誤って複数回ボタンをクリックすることを防ぎます

**影響範囲**:
- ファンマーク詳細ページの抽選申し込みボタン
- ファンマーク詳細ページの抽選キャンセルボタン
- ファンマーク検索ページの抽選申し込みボタン
- ファンマーク検索ページの抽選キャンセルボタン

**ユーザー体験の改善**:
- より直感的で明確な操作フィードバック
- エラー時でも正しい状態が表示されることによる混乱の防止
- スムーズな抽選申し込み体験

#### 📚 ドキュメント

- エラーハンドリング仕様書を追加
- 抽選システム仕様書にエラーハンドリングセクションを追加

---

## Git コマンド例

```bash
# ステージング
git add src/pages/FanmarkDetailsPage.tsx
git add src/components/FanmarkAcquisition.tsx
git add docs/lottery-ui-error-handling.md
git add docs/lottery-system-specification.md

# コミット
git commit -m "fix(lottery): ensure UI updates after lottery operations regardless of success/failure

問題:
- 抽選申し込み/キャンセル操作でエラーが発生した場合、UI状態が更新されず、
  ユーザーが再度同じボタンを押せてしまう問題があった

解決策:
- try...catch...finally 構造を使用し、finally ブロックで UI 状態更新を実行
- これにより、成功/失敗に関わらず必ず UI 状態が最新化される

影響範囲:
- src/pages/FanmarkDetailsPage.tsx: refetch() を finally ブロックへ移動
- src/components/FanmarkAcquisition.tsx: handleQueryChange() を finally ブロックへ移動

ドキュメント:
- 新規作成: docs/lottery-ui-error-handling.md
- 更新: docs/lottery-system-specification.md"

# タグ付け
git tag -a v2.1.0-lottery-ui-fix -m "抽選UI エラーハンドリング改善"

# プッシュ
git push origin main
git push origin v2.1.0-lottery-ui-fix
```

---

## プルリクエスト テンプレート

```markdown
## 概要
抽選申し込み/キャンセル時のエラー発生時に、UI状態が更新されない問題を修正しました。

## 問題
- Edge Function からエラーが返された場合、UI状態が更新されず、ユーザーが再度同じボタンを押せてしまう
- 重複申し込みエラーの場合、データベース上は申込済みだが、UIには「申込済み」バッジが表示されない

## 解決方法
- `try...catch...finally` 構造を使用
- `finally` ブロックで UI 状態更新を保証（成功・失敗に関わらず実行）

## 変更内容
- [x] `FanmarkDetailsPage.tsx`: 抽選申し込み/キャンセルボタンのエラーハンドリング改善
- [x] `FanmarkAcquisition.tsx`: 抽選申し込み/キャンセルボタンのエラーハンドリング改善
- [x] `docs/lottery-ui-error-handling.md`: 新規ドキュメント作成
- [x] `docs/lottery-system-specification.md`: エラーハンドリングセクション追加

## テスト
- [x] 重複申込エラー時の UI 更新を確認
- [x] Grace期間終了後の申込エラーを確認
- [x] 既にキャンセル済みのエントリーのキャンセル試行を確認
- [x] 正常系の動作が変わらないことを確認

## スクリーンショット
（必要に応じて追加）

## 関連ドキュメント
- [抽選UIエラーハンドリング仕様](./docs/lottery-ui-error-handling.md)
- [抽選システム仕様書](./docs/lottery-system-specification.md)

## レビューポイント
- `finally` ブロックの配置が適切か
- エラーハンドリングのパターンが一貫しているか
- ドキュメントが十分に詳細か
```
