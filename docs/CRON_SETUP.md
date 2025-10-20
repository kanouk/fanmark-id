# Supabase Cron Jobs セットアップガイド

## 概要
このプロジェクトでは、以下の2つの定期実行ジョブを使用しています：

1. **check-expired-licenses**: ライセンス期限切れ検知（毎日 JST 0:00）
2. **process-notification-events**: 通知イベント処理（毎分）

## セットアップ方法

### 方法1: Supabase CLI（推奨）

#### 前提条件
```bash
# CLI バージョン確認
supabase --version  # v1.50 以上推奨

# プロジェクトへのログイン
supabase login
supabase link --project-ref ppqgtbjykitqtiaisyji
```

#### スケジュール設定
```bash
# ライセンス期限チェック（毎日 15:00 UTC = JST 0:00）
supabase functions schedule check-expired-licenses "0 15 * * *"

# 通知イベント処理（毎分）
supabase functions schedule process-notification-events "* * * * *"
```

#### 確認
```bash
# スケジュール一覧
supabase functions list-schedules

# 実行ログ確認
supabase functions logs check-expired-licenses --limit 50
supabase functions logs process-notification-events --limit 50
```

---

### 方法2: Supabase Dashboard（代替手段）

1. [Supabase Dashboard](https://app.supabase.com/project/ppqgtbjykitqtiaisyji) にアクセス
2. **Database** > **Cron Jobs** へ移動
3. **New Cron Job** をクリック

#### ジョブ1: check-expired-licenses-daily
- **Name**: `check-expired-licenses-daily`
- **Schedule**: `0 15 * * *`
- **Command**:
  ```sql
  SELECT net.http_post(
    url := 'https://ppqgtbjykitqtiaisyji.supabase.co/functions/v1/check-expired-licenses',
    headers := jsonb_build_object(
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('scheduled', true)
  );
  ```

#### ジョブ2: process-notification-events-every-minute
- **Name**: `process-notification-events-every-minute`
- **Schedule**: `* * * * *`
- **Command**:
  ```sql
  SELECT net.http_post(
    url := 'https://ppqgtbjykitqtiaisyji.supabase.co/functions/v1/process-notification-events',
    headers := jsonb_build_object(
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('timestamp', now()::text)
  );
  ```

**注意**: `verify_jwt = false` が設定されているため、Authorization ヘッダーは不要です。

---

## セキュリティ上の注意事項

### ⚠️ JWT トークンの取り扱い

**重要**: 過去のマイグレーションファイルに JWT トークンがハードコードされていました。以下の対応を推奨します：

1. **Anon Key のローテーション**
   - [Project Settings > API](https://app.supabase.com/project/ppqgtbjykitqtiaisyji/settings/api) へアクセス
   - "Reset anon key" をクリック（既存の公開アプリに影響あり）

2. **Service Role Key の確認**
   - 漏洩していないか確認
   - 必要に応じてローテーション

3. **Git 履歴のクリーンアップ**（任意）
   - 機密情報を含むコミットを履歴から削除
   - `git filter-repo` や BFG Repo-Cleaner を使用

---

## トラブルシューティング

### ジョブが実行されない
1. **スケジュール確認**
   ```bash
   supabase functions list-schedules
   ```

2. **Edge Function の状態確認**
   ```bash
   supabase functions list
   ```

3. **pg_cron ジョブ確認（Dashboard経由）**
   ```sql
   SELECT * FROM cron.job ORDER BY jobid DESC;
   ```

### 二重実行を防ぐ
既存の SQL ベースのジョブを削除：
```sql
-- 古いジョブを削除
SELECT cron.unschedule('check-expired-licenses-daily');
SELECT cron.unschedule('process-notification-events-every-minute');
```

### ログにエラーが出る
```bash
# 詳細ログを確認
supabase functions logs <function-name> --limit 100

# エラーフィルタリング
supabase functions logs <function-name> | grep -i error
```

---

## 環境別設定

### 開発環境
```bash
# ローカル実行（スケジュールなし）
supabase functions serve
```

### ステージング環境
```bash
# ステージング用のスケジュール（より頻繁に実行）
supabase functions schedule check-expired-licenses "0 * * * *"  # 毎時
supabase functions schedule process-notification-events "*/5 * * * *"  # 5分ごと
```

### 本番環境
```bash
# 本番用のスケジュール（推奨設定）
supabase functions schedule check-expired-licenses "0 15 * * *"  # 毎日 JST 0:00
supabase functions schedule process-notification-events "* * * * *"  # 毎分
```

---

## 参考リンク

- [Supabase Cron Jobs Documentation](https://supabase.com/docs/guides/database/extensions/pg_cron)
- [Supabase CLI Functions Reference](https://supabase.com/docs/reference/cli/supabase-functions)
- [pg_cron Extension](https://github.com/citusdata/pg_cron)
- [Project Dashboard](https://app.supabase.com/project/ppqgtbjykitqtiaisyji)
