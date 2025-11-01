# 抽選システム: UI エラーハンドリング仕様

**作成日**: 2025年10月30日  
**バージョン**: 1.0  
**関連**: `lottery-system-specification.md`

---

## 1. 概要

### 1.1 目的
抽選申込・キャンセル操作において、Edge Functionからエラーが返された場合でも、UI状態を確実に最新化し、ユーザーの混乱を防ぐためのエラーハンドリング仕様。

### 1.2 背景
**問題**: 抽選申込後、重複申込などのエラーが発生した場合、UI状態が更新されず、ユーザーが再度同じボタンを押せてしまう問題が発生していた。

**原因**: `refetch()` または `handleQueryChange(query)` が `try` ブロック内で呼ばれているため、エラー発生時に実行されない。

**影響**:
- データベース上は申込済みだが、UIには「申込済み」バッジが表示されない
- ユーザーが誤って複数回ボタンを押してしまう
- エラーメッセージは表示されるが、画面が最新状態にならない

---

## 2. 解決方針

### 2.1 基本戦略
`try...catch...finally` 構造を使用し、**`finally` ブロックでUI状態の更新を保証する**。

### 2.2 実装パターン

#### パターン1: `FanmarkDetailsPage.tsx`
```typescript
onClick={async () => {
  try {
    await applyToLottery(details.fanmark_id, {
      emoji: details.normalized_emoji,
      onSettled: async () => {
        try {
          await refetch();
        } catch (error) {
          console.error('Failed to refresh fanmark details after apply:', error);
        }
      },
    });
  } catch (error) {
    console.error('Failed to apply to lottery:', error);
    // エラーは useLotteryEntry 内でトースト表示される
  }
}}
```

#### パターン2: `FanmarkAcquisition.tsx`
```typescript
onClick={async () => {
  if (searchResult?.id) {
    try {
      await applyToLottery(searchResult.id, {
        emoji: searchResult.fanmark ?? searchResult.user_input_fanmark,
        optimisticUpdate: (status, payload) => {
          if (status === 'applied') {
            setSearchResult(prev => prev ? {
              ...prev,
              has_user_lottery_entry: true,
              user_lottery_entry_id: payload?.entry_id ?? prev.user_lottery_entry_id,
            } : prev);
          }
        },
        onSettled: async () => {
          if (query) {
            handleQueryChange(query);
          }
        },
      });
    } catch (error) {
      console.error('Failed to apply to lottery:', error);
    }
  }
}}
```

### 2.3 `finally` ブロックを使用する理由

**`finally` ブロックの特性**:
- 成功時・エラー時・例外発生時を問わず**必ず実行される**
- `return` や `throw` があっても実行される
- UI状態の同期を保証するのに最適

**代替案との比較**:
| 手法 | 成功時 | エラー時 | 評価 |
|------|--------|----------|------|
| `try` 内に配置 | ✅ 実行 | ❌ 実行されない | **NG**: エラー時に同期が取れない |
| `catch` 内に配置 | ❌ 実行されない | ✅ 実行 | **NG**: 成功時に同期が取れない |
| `finally` に配置 | ✅ 実行 | ✅ 実行 | **✅ OK**: 常に同期が取れる |

---

### 2.4 グローバルローディングオーバーレイ

抽選申込／キャンセル中のローディング体験を統一するため、`LotteryActionOverlayProvider` をアプリ全体に追加し、`useLotteryEntry` から自動で表示・非表示を制御する。

- Provider: `src/providers/LotteryActionOverlayProvider.tsx`
- 利用方法: `useLotteryEntry` に `onSettled`（非同期処理完了までローディングを維持）や `optimisticUpdate`（ローカルUIの暫定更新）を渡す
- 表示保証: 最低500msの表示を保証し、操作直後に瞬間的に消えないように制御しつつ、`onSettled` が解決するまでクローズしない
- 既存コンポーネントはローカル状態や `LotteryActionLoading` の直接描画を行わず、フックの呼び出しのみで完結させる

> ⚠️ Provider をラップしていないテスト環境で `useLotteryEntry` を実行するとエラーになるため、テストでは Provider のモックを追加すること。

## 3. 技術的実装詳細

### 3.1 影響を受けるコンポーネント

#### 3.1.1 `src/pages/FanmarkDetailsPage.tsx`

**対象箇所**:
- 抽選申し込み/キャンセルボタンの撤去（2025-02 更新）
- 抽選人数表示の配置見直し（所有履歴セクション内へ移動）

**変更内容**:
- `/f/{short_id}` は閲覧専用ページとして扱い、抽選操作 UI を削除。申し込み導線はダッシュボード側に集約した。
- 抽選申込者数は所有履歴カード内に小さく表示し、公開情報としてのスタイリングに揃えた。
- ヘッダーのアクションはアイコン化し、「ファンマページを開く」「同じファンマを検索」の 2 つだけを提供。検索アイコンはログイン中はダッシュボード検索、未ログイン時はトップページへ遷移し、対象ファンマをプレフィルする。

---

#### 3.1.2 `src/components/FanmarkAcquisition.tsx`

**対象箇所**:
- 抽選申し込みボタン（607-618行目）
- キャンセルボタン（632-643行目）

**変更内容**:
```typescript
try {
  await applyToLottery(searchResult.id, {
    emoji: searchResult.fanmark ?? searchResult.user_input_fanmark,
    optimisticUpdate: (status, payload) => {
      if (status === 'applied') {
        setSearchResult(prev => prev ? {
          ...prev,
          has_user_lottery_entry: true,
          user_lottery_entry_id: payload?.entry_id ?? prev.user_lottery_entry_id,
        } : prev);
      }
    },
    onSettled: async () => {
      if (query) {
        handleQueryChange(query);
      }
    },
  });
} catch (error) {
  console.error('Failed to apply to lottery:', error);
}

try {
  await cancelLotteryEntry(searchResult.user_lottery_entry_id, {
    emoji: searchResult.fanmark ?? searchResult.user_input_fanmark,
    optimisticUpdate: (status) => {
      if (status === 'cancelled') {
        setSearchResult(prev => prev ? {
          ...prev,
          has_user_lottery_entry: false,
          user_lottery_entry_id: null,
        } : prev);
      }
    },
    onSettled: async () => {
      if (query) {
        handleQueryChange(query);
      }
    },
  });
} catch (error) {
  console.error('Failed to cancel lottery entry:', error);
}
```

**`handleQueryChange()` の役割**:
- ファンマーク検索を再実行
- Supabaseから最新の検索結果を取得
- `has_user_lottery_entry` などの状態を更新
- UI表示が自動的に切り替わる

---

### 3.2 エラーフロー

#### 3.2.1 正常系（申し込み成功）
```
1. ユーザーがボタンをクリック
2. applyToLottery() 実行
3. Edge Function で申込処理成功
4. useLotteryEntry 内でトースト表示 "抽選に申し込みました"
5. finally ブロックで refetch() 実行
6. 最新データ取得: has_user_lottery_entry = true
7. UI更新: ボタン → バッジ + キャンセルボタン
```

#### 3.2.2 エラー系（重複申込）
```
1. ユーザーがボタンをクリック（UI状態が古い）
2. applyToLottery() 実行
3. Edge Function でエラー: "You have already applied for this fanmark"
4. catch ブロックでエラーログ出力
5. useLotteryEntry 内でエラートースト表示 "既にこのファンマの抽選に申し込んでいます"
6. finally ブロックで refetch() 実行 ← ここが重要！
7. 最新データ取得: has_user_lottery_entry = true
8. UI更新: ボタン → バッジ + キャンセルボタン ← 正しい状態に同期
```

**重要なポイント**:
- エラーが発生しても `refetch()` は実行される
- データベースの真の状態が取得される
- UIがデータベース状態と同期する
- ユーザーは最新の状態を見ることができる

---

## 4. Edge Function のエラーレスポンス

### 4.1 `apply-fanmark-lottery`

**重複申込エラー**:
```json
{
  "error": "You have already applied for this fanmark"
}
```

**その他のエラー**:
```json
{
  "error": "Grace period has ended"
}
```

### 4.2 フロントエンドでのエラー検出

`src/hooks/useLotteryEntry.tsx` でエラーメッセージを判定:

```typescript
catch (err: any) {
  console.error('[useLotteryEntry] Error applying to lottery:', err);
  
  let errorMessage = t('lottery.applyError');
  
  // 重複申込エラーを検出
  if (err?.message) {
    const msg = err.message.toLowerCase();
    if (msg.includes('already applied') || msg.includes('duplicate')) {
      errorMessage = t('lottery.alreadyAppliedError'); // "既にこのファンマの抽選に申し込んでいます"
    } else {
      errorMessage = err.message;
    }
  }
  
  setError(errorMessage);
  toast({
    title: t('lottery.applyError'),
    description: errorMessage,
    variant: "destructive"
  });
  
  throw err; // エラーを再スロー
}
```

**翻訳キー**:
- `lottery.alreadyAppliedError` (ja): "既にこのファンマの抽選に申し込んでいます"
- `lottery.alreadyAppliedError` (en): "You have already applied for this fanmark"

---

## 5. UI状態の同期保証

### 5.1 データフロー

```
[Supabase Database]
  ↓ (RPC: get_fanmark_details_by_short_id)
[useFanmarkDetails Hook]
  ↓ (details.has_user_lottery_entry)
[FanmarkDetailsPage Component]
  ↓ (条件分岐)
[Button または Badge]
```

### 5.2 条件分岐ロジック

```typescript
{!details.has_user_lottery_entry ? (
  // 申込前: ボタン表示
  <Button onClick={async () => { /* 申込処理 */ }}>
    {t('lottery.applyButton')}
  </Button>
) : (
  // 申込済: バッジ + キャンセルボタン
  <div className="flex items-center gap-2">
    <Badge>{t('lottery.appliedBadge')}</Badge>
    <Button onClick={async () => { /* キャンセル処理 */ }}>
      {t('lottery.cancelButton')}
    </Button>
  </div>
)}
```

**同期のキーポイント**:
- `has_user_lottery_entry` の値がUIを決定する唯一の真実
- `refetch()` は常に最新の `has_user_lottery_entry` を取得
- `finally` ブロックにより、エラー時でも必ず最新化される

---

## 6. パフォーマンス考慮

### 6.1 ネットワークコスト
- **正常系**: 申込 API → refetch API (2回のリクエスト)
- **エラー系**: 申込 API（エラー） → refetch API (2回のリクエスト)

**影響評価**:
- エラー時でもネットワークコストは変わらない
- `refetch()` は軽量なRPC呼び出し（1件のファンマーク情報のみ）
- ユーザー体験の向上が優先される

### 6.2 ユーザー体験
| シナリオ | 旧実装 | 新実装 |
|---------|--------|--------|
| 正常系 | ボタン → バッジ | ボタン → バッジ（同じ） |
| 重複エラー | エラートースト表示 → ボタン残る → 混乱 | エラートースト表示 → バッジ表示 → 明確 |
| その他エラー | エラートースト表示 → ボタン残る → 混乱 | エラートースト表示 → 最新状態表示 → 明確 |

---

## 7. セキュリティ考慮

### 7.1 RLS（Row Level Security）
- `refetch()` は認証されたユーザーのみ実行可能
- RLSポリシーにより、ユーザーは自分の申込状態のみ取得可能
- 他ユーザーの申込状態は取得できない

### 7.2 エラーメッセージ
- ユーザーに技術的詳細を露出しない
- Edge Functionのエラーメッセージを適切にフィルタリング
- システムエラーは一般的なメッセージに変換

---

## 8. テストシナリオ

### 8.1 抽選申し込み

#### テスト1: 正常系（初回申し込み成功）
**前提条件**:
- Grace期間中のファンマークが存在
- ユーザーは未申込

**手順**:
1. ファンマーク詳細ページを開く
2. 「抽選に申し込む」ボタンをクリック

**期待結果**:
- ✅ グローバルローディングオーバーレイが表示される（最小表示時間を満たす）
- ✅ トースト表示: "抽選に申し込みました"
- ✅ ボタンが消える
- ✅ 「申込済」バッジが表示される
- ✅ 「キャンセル」ボタンが表示される

---

#### テスト2: エラー系（重複申込）
**前提条件**:
- Grace期間中のファンマークが存在
- ユーザーは既に申込済み
- 何らかの理由でUIが古い状態（ボタンが表示されている）

**手順**:
1. ファンマーク詳細ページを開く（古いキャッシュ）
2. 「抽選に申し込む」ボタンをクリック

**期待結果**:
- ✅ エラートースト表示: "既にこのファンマの抽選に申し込んでいます"
- ✅ ボタンが消える（`finally` で `refetch()` が実行される）
- ✅ 「申込済」バッジが表示される
- ✅ 「キャンセル」ボタンが表示される
- ✅ UI状態がデータベース状態と同期する
- ✅ グローバルローディングオーバーレイが表示された後、自動的に閉じる

---

#### テスト3: エラー系（Grace期間終了）
**前提条件**:
- Grace期間が終了したファンマーク
- ユーザーがページを開いたまま期間が終了

**手順**:
1. Grace期間中にページを開く
2. 期間終了を待つ
3. 「抽選に申し込む」ボタンをクリック

**期待結果**:
- ✅ エラートースト表示: "抽選の申し込みに失敗しました"
- ✅ `refetch()` により最新状態を取得
- ✅ ボタンとバッジが消える（Grace期間終了のため）
- ✅ 適切なメッセージが表示される
- ✅ グローバルローディングオーバーレイが表示された後、自動的に閉じる

---

### 8.2 抽選キャンセル

#### テスト4: 正常系（キャンセル成功）
**前提条件**:
- ユーザーが抽選申込済み

**手順**:
1. ファンマーク詳細ページを開く
2. 「キャンセル」ボタンをクリック

**期待結果**:
- ✅ グローバルローディングオーバーレイが表示される（最小表示時間を満たす）
- ✅ トースト表示: "抽選をキャンセルしました"
- ✅ 「申込済」バッジが消える
- ✅ 「キャンセル」ボタンが消える
- ✅ 「抽選に申し込む」ボタンが表示される

---

#### テスト5: エラー系（既にキャンセル済み）
**前提条件**:
- ユーザーが抽選申込済み
- 別のタブで既にキャンセル済み
- 現在のタブのUIが古い状態

**手順**:
1. ファンマーク詳細ページを開く（古いキャッシュ）
2. 「キャンセル」ボタンをクリック

**期待結果**:
- ✅ エラートースト表示: "抽選のキャンセルに失敗しました"
- ✅ `refetch()` により最新状態を取得
- ✅ 「申込済」バッジが消える
- ✅ 「キャンセル」ボタンが消える
- ✅ 「抽選に申し込む」ボタンが表示される
- ✅ UI状態がデータベース状態と同期する
- ✅ グローバルローディングオーバーレイが表示された後、自動的に閉じる

---

### 8.3 ファンマーク検索画面

#### テスト6: 検索結果での申し込み
**対象**: `FanmarkAcquisition.tsx`

**手順**:
1. ファンマーク検索画面を開く
2. Grace期間中のファンマークを検索
3. 「抽選に申し込む」ボタンをクリック

**期待結果**:
- ✅ グローバルローディングオーバーレイが表示される（最小表示時間を満たす）
- ✅ トースト表示: "抽選に申し込みました"
- ✅ 検索が自動的に再実行される（`handleQueryChange(query)`）
- ✅ ボタンが「申込済」バッジに変わる
- ✅ 「キャンセル」ボタンが表示される

---

#### テスト7: 検索結果での重複申込
**前提条件**:
- ユーザーが既に申込済み
- 検索結果のキャッシュが古い

**手順**:
1. ファンマーク検索画面を開く
2. 申込済みのファンマークを検索（古い結果が表示）
3. 「抽選に申し込む」ボタンをクリック

**期待結果**:
- ✅ エラートースト表示: "既にこのファンマの抽選に申し込んでいます"
- ✅ `handleQueryChange(query)` により検索が再実行される
- ✅ ボタンが「申込済」バッジに変わる
- ✅ 「キャンセル」ボタンが表示される
- ✅ UI状態がデータベース状態と同期する
- ✅ グローバルローディングオーバーレイが表示された後、自動的に閉じる

---

## 9. 将来の改善案

### 9.1 楽観的UI更新
現在の実装は「悲観的」なアプローチ（APIレスポンス後にUI更新）。

**楽観的アプローチ**:
```typescript
onClick={async () => {
  // 即座にUIを更新（楽観的）
  setOptimisticState({ has_user_lottery_entry: true });
  
  try {
    await applyToLottery(details.fanmark_id);
  } catch (error) {
    // エラー時にロールバック
    setOptimisticState({ has_user_lottery_entry: false });
  } finally {
    // 最終的に真の状態を取得
    await refetch();
  }
}}
```

**メリット**:
- より高速なユーザー体験
- ネットワーク遅延を感じにくい

**デメリット**:
- 実装が複雑
- エラー時のロールバックが必要

### 9.2 リアルタイム同期
Supabase Realtime を使用して、抽選申込状態を自動同期。

**実装例**:
```typescript
useEffect(() => {
  const subscription = supabase
    .channel('lottery_entries')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'fanmark_lottery_entries',
      filter: `fanmark_id=eq.${details.fanmark_id}`
    }, (payload) => {
      // リアルタイムで状態更新
      refetch();
    })
    .subscribe();
  
  return () => subscription.unsubscribe();
}, [details.fanmark_id]);
```

**メリット**:
- 複数タブ・デバイス間で自動同期
- ユーザーの手動更新不要

**デメリット**:
- リアルタイム接続のコスト
- 実装が複雑

---

## 10. まとめ

### 10.1 実装のポイント
✅ `finally` ブロックで UI 状態更新を保証  
✅ エラー時でもデータベース状態と同期  
✅ ユーザーの混乱を防ぐ  
✅ 2つの画面で一貫した動作  

### 10.2 ユーザーへの影響
- **改善前**: エラー時にボタンが残り、何度もクリックしてしまう
- **改善後**: エラー時でも正しい状態が表示され、混乱がない

### 10.3 技術的価値
- エラーハンドリングのベストプラクティス
- UI状態とデータベース状態の同期保証
- 堅牢なフロントエンド実装の実現

---

## 11. 関連ドキュメント

- `docs/lottery-system-specification.md`: 抽選システム全体仕様
- `docs/lottery-system-technical-documentation.md`: 技術実装詳細
- `src/hooks/useLotteryEntry.tsx`: 抽選申込フック
- `src/hooks/useFanmarkDetails.tsx`: ファンマーク詳細取得フック
- `src/pages/FanmarkDetailsPage.tsx`: ファンマーク詳細ページ
- `src/components/FanmarkAcquisition.tsx`: ファンマーク検索・取得画面
