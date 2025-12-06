# ファンマークアナリティクス機能 仕様書 v1.0

## 1. 概要

### 1.1 目的
ファンマーク所有者が自分のファンマークへのアクセス状況を分析できる機能を提供する。

### 1.2 対象プラン
- **利用可能**: `business`, `enterprise`, `admin`
- **プレビュー表示（アップグレード誘導）**: `free`, `creator`, `max`

### 1.3 主要機能
- アクセス数の記録と表示
- リファラー（流入元）分析
- デバイス別統計
- 日次トレンドグラフ
- ファンマーク別フィルタリング

---

## 2. データベース設計

### 2.1 `fanmark_access_logs` テーブル（生ログ）

```sql
CREATE TABLE public.fanmark_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fanmark_id uuid REFERENCES fanmarks(id) ON DELETE CASCADE NOT NULL,
  license_id uuid REFERENCES fanmark_licenses(id) ON DELETE SET NULL,
  accessed_at timestamptz DEFAULT now() NOT NULL,
  referrer text,
  referrer_domain text,
  referrer_category text, -- 'direct', 'search', 'social', 'other'
  user_agent text,
  device_type text, -- 'mobile', 'tablet', 'desktop'
  browser text,
  os text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  visitor_hash text -- プライバシー考慮のハッシュ化された訪問者ID
);

-- インデックス
CREATE INDEX idx_access_logs_fanmark_id ON fanmark_access_logs(fanmark_id);
CREATE INDEX idx_access_logs_accessed_at ON fanmark_access_logs(accessed_at);
CREATE INDEX idx_access_logs_fanmark_date ON fanmark_access_logs(fanmark_id, accessed_at);
```

### 2.2 `fanmark_access_daily_stats` テーブル（日次集計）

```sql
CREATE TABLE public.fanmark_access_daily_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fanmark_id uuid REFERENCES fanmarks(id) ON DELETE CASCADE NOT NULL,
  license_id uuid REFERENCES fanmark_licenses(id) ON DELETE SET NULL,
  stat_date date NOT NULL,
  access_count integer DEFAULT 0,
  unique_visitors integer DEFAULT 0,
  -- リファラー別
  referrer_direct integer DEFAULT 0,
  referrer_search integer DEFAULT 0,
  referrer_social integer DEFAULT 0,
  referrer_other integer DEFAULT 0,
  -- デバイス別
  device_mobile integer DEFAULT 0,
  device_tablet integer DEFAULT 0,
  device_desktop integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(fanmark_id, stat_date)
);

-- インデックス
CREATE INDEX idx_daily_stats_fanmark_date ON fanmark_access_daily_stats(fanmark_id, stat_date);
```

### 2.3 RLSポリシー

```sql
-- fanmark_access_logs
ALTER TABLE fanmark_access_logs ENABLE ROW LEVEL SECURITY;

-- 所有者のみ閲覧可能
CREATE POLICY "Owners can view their fanmark access logs"
  ON fanmark_access_logs FOR SELECT
  USING (
    fanmark_id IN (
      SELECT fl.fanmark_id FROM fanmark_licenses fl
      WHERE fl.user_id = auth.uid()
    )
  );

-- Edge Function (service_role) のみ挿入可能
CREATE POLICY "Service role can insert access logs"
  ON fanmark_access_logs FOR INSERT
  WITH CHECK (true);

-- fanmark_access_daily_stats
ALTER TABLE fanmark_access_daily_stats ENABLE ROW LEVEL SECURITY;

-- 所有者のみ閲覧可能
CREATE POLICY "Owners can view their fanmark daily stats"
  ON fanmark_access_daily_stats FOR SELECT
  USING (
    fanmark_id IN (
      SELECT fl.fanmark_id FROM fanmark_licenses fl
      WHERE fl.user_id = auth.uid()
    )
  );
```

---

## 3. Edge Function設計

### 3.1 `record-fanmark-access`

**エンドポイント**: `POST /functions/v1/record-fanmark-access`

**リクエストボディ**:
```typescript
{
  fanmark_id: string;
  short_id: string;
  referrer?: string;
  user_agent?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}
```

**処理フロー**:
1. リクエスト検証
2. User-Agent解析（デバイスタイプ、ブラウザ、OS）
3. リファラードメイン抽出とカテゴリ分類
   - `google.com`, `bing.com`, `yahoo.co.jp` → `search`
   - `twitter.com`, `x.com`, `instagram.com`, `facebook.com`, `tiktok.com`, `line.me` → `social`
   - 空またはなし → `direct`
   - その他 → `other`
4. 訪問者ハッシュ生成（User-Agent + 日付 + fanmark_id をハッシュ化、IPは使用しない）
5. レート制限チェック（同一visitor_hashからの連続アクセスを制限：5分間隔）
6. `fanmark_access_logs` に挿入
7. `fanmark_access_daily_stats` を UPSERT（当日分を更新）

**レスポンス**:
```typescript
{
  success: boolean;
  recorded: boolean; // レート制限でスキップされた場合はfalse
}
```

---

## 4. フロントエンド設計

### 4.1 アクセス記録の組み込み

**対象ファイル**: `src/components/FanmarkAccessByShortId.tsx`

**変更箇所**: `loadFanmark` 関数内、ファンマークデータ取得成功後

```typescript
// アクセスログ記録（非同期、fire-and-forget）
const recordAccess = async () => {
  try {
    await supabase.functions.invoke('record-fanmark-access', {
      body: {
        fanmark_id: fanmarkData.id,
        short_id: shortId,
        referrer: document.referrer || null,
        user_agent: navigator.userAgent,
        utm_source: new URLSearchParams(window.location.search).get('utm_source'),
        utm_medium: new URLSearchParams(window.location.search).get('utm_medium'),
        utm_campaign: new URLSearchParams(window.location.search).get('utm_campaign'),
      },
    });
  } catch (error) {
    console.warn('Failed to record access:', error);
  }
};
recordAccess(); // awaitしない
```

### 4.2 ナビゲーション更新

**対象ファイル**: `src/components/layout/AppHeader.tsx`

**追加位置**: ユーザーメニュー内、お気に入りの下

```tsx
<DropdownMenuItem
  onSelect={() => navigate('/analytics')}
  className="cursor-pointer"
  disabled={pathname === '/analytics'}
>
  <BarChart3 className="mr-2 h-4 w-4" />
  {t('navigation.analytics')}
</DropdownMenuItem>
```

### 4.3 ルーティング更新

**対象ファイル**: `src/App.tsx`

```tsx
<Route 
  path="/analytics" 
  element={
    <ProtectedRoute>
      <Analytics />
    </ProtectedRoute>
  } 
/>
```

### 4.4 アナリティクスページ

**新規ファイル**: `src/pages/Analytics.tsx`

#### 4.4.1 ビジネスプラン以上の場合

**レイアウト構成**:

```
┌──────────────────────────────────────────────────────────────┐
│ AppHeader                                                     │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  📊 アナリティクス                                            │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ [ファンマーク選択 ▼]  [7日間 ▼] [30日間] [90日間]       │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌──────────────────────┐ ┌──────────────────────┐          │
│  │ 📈 総アクセス数        │ │ 👥 ユニーク訪問者     │          │
│  │    1,234              │ │    567                │          │
│  │   +12% vs 前期間      │ │   +8% vs 前期間       │          │
│  └──────────────────────┘ └──────────────────────┘          │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ 日別アクセス推移                                         │ │
│  │ (AreaChart - recharts)                                   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─────────────────────────┐ ┌─────────────────────────┐    │
│  │ 流入元内訳 (PieChart)    │ │ デバイス別 (PieChart)   │    │
│  └─────────────────────────┘ └─────────────────────────┘    │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ SiteFooter                                                   │
└──────────────────────────────────────────────────────────────┘
```

#### 4.4.2 ビジネスプラン未満の場合

- 背景: ダミーデータを含むダッシュボード（opacity: 0.3, blur: 4px）
- オーバーレイカード: 中央配置、白背景、rounded-3xl、shadow-lg
- 機能リスト: チェックマーク付きで利点を明示
- CTAボタン: プライマリカラー、`/plan-selection` へ遷移

### 4.5 ドリルダウン導線

#### 4.5.1 ファンマーク設定ページからの導線

**対象ファイル**: `src/components/FanmarkSettings.tsx`

```tsx
{canAccessAnalytics && (
  <Button
    variant="outline"
    size="sm"
    onClick={() => navigate(`/analytics?fanmark=${fanmark.short_id}`)}
    className="gap-2"
  >
    <BarChart3 className="h-4 w-4" />
    {t('fanmarkSettings.viewStats')}
  </Button>
)}
```

#### 4.5.2 ダッシュボードカードからの導線

**対象ファイル**: `src/components/FanmarkDashboard.tsx`

ドロップダウンメニューとモバイルカードにアイコンボタン追加。

### 4.6 URLパラメータによるファンマーク選択

`/analytics?fanmark={shortId}` でアクセス時、該当ファンマークを自動選択。

---

## 5. データ取得フック

### 5.1 `useFanmarkAnalytics.ts`

```typescript
interface AnalyticsData {
  totalAccess: number;
  uniqueVisitors: number;
  dailyStats: {
    date: string;
    access_count: number;
    unique_visitors: number;
  }[];
  referrerBreakdown: {
    category: string;
    count: number;
    percentage: number;
  }[];
  deviceBreakdown: {
    type: string;
    count: number;
    percentage: number;
  }[];
  periodComparison: {
    accessChange: number;
    visitorChange: number;
  };
}

export const useFanmarkAnalytics = (
  fanmarkId: string | null,
  period: '7d' | '30d' | '90d'
) => {
  // ...実装
};
```

---

## 6. 翻訳キー

日本語・英語・韓国語・インドネシア語の4言語に対応。

---

## 7. データ保持ポリシー

### 7.1 生ログの保持期間
- **保持期間**: 90日
- **削除処理**: Cron Job（毎日実行）

### 7.2 日次集計の保持期間
- **保持期間**: 無期限

---

## 8. 実装スケジュール

| フェーズ | 内容 | 見積もり |
|---------|------|----------|
| Phase 1 | DBマイグレーション | 0.5日 |
| Phase 2 | Edge Function `record-fanmark-access` | 1日 |
| Phase 3 | `FanmarkAccessByShortId.tsx` にアクセス記録組み込み | 0.5日 |
| Phase 4 | `AppHeader.tsx` にメニュー追加 | 0.25日 |
| Phase 5 | `Analytics.tsx` ページ作成 | 1.5日 |
| Phase 6 | ドリルダウン導線追加 | 0.5日 |
| Phase 7 | 翻訳ファイル更新（4言語） | 0.25日 |
| Phase 8 | ルーティング追加 | 0.25日 |
| Phase 9 | Cron Job（ログクリーンアップ） | 0.25日 |

---

## 9. セキュリティ考慮事項

### 9.1 プライバシー
- IPアドレスは保存しない
- visitor_hashはUser-Agent + 日付 + fanmark_idをハッシュ化
- 個人を特定できる情報は記録しない

### 9.2 RLS
- 所有者のみが自分のファンマークのログ/統計を閲覧可能
- Edge Function（service_role）のみがログを挿入可能

### 9.3 レート制限
- 同一訪問者からの連続アクセスは5分間隔で制限

---

## 10. コミットメッセージ規則

各フェーズ完了時のコミットメッセージ:

```
feat(analytics): Phase X - [内容]

- 詳細1
- 詳細2
```
