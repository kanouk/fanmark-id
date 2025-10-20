# Supabase Cron Jobs セットアップガイド

## 概要
このプロジェクトでは、以下の2つの定期実行ジョブを使用しています：

1. **check-expired-licenses**: ライセンス期限切れ検知（毎日 JST 0:00）
2. **process-notification-events**: 通知イベント処理（毎分）

## セットアップ方法

### Supabase Dashboard（推奨方法）

1. [Supabase Dashboard](https://app.supabase.com/project/ppqgtbjykitqtiaisyji/database/cron-jobs) にアクセス
2. **Database** > **Cron Jobs** へ移動
3. **Create a new cron job** をクリック

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

**注意**: 
- `verify_jwt = false` が設定されているため、Authorization ヘッダーは不要です
- Edge Functionは既にデプロイされている必要があります
- プロジェクトURLは `https://ppqgtbjykitqtiaisyji.supabase.co` です

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
1. **Cronジョブの確認（Dashboard経由）**
   ```sql
   SELECT * FROM cron.job ORDER BY jobid DESC;
   ```

2. **Edge Functionの状態確認**
   - Dashboard → Edge Functions でデプロイ状態を確認
   - 手動でテスト実行してエラーがないか確認

3. **pg_cron拡張機能の確認**
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'pg_cron';
   ```

### 二重実行を防ぐ
既存の SQL ベースのジョブを削除：
```sql
-- 古いジョブを削除
SELECT cron.unschedule('check-expired-licenses-daily');
SELECT cron.unschedule('process-notification-events-every-minute');
```

### ログにエラーが出る
- Dashboard → Edge Functions → 該当Function → Logs でエラー内容を確認
- または SQL Editor で実行履歴を確認：
  ```sql
  SELECT * FROM cron.job_run_details 
  WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'ジョブ名')
  ORDER BY start_time DESC 
  LIMIT 10;
  ```

---

## 参考リンク

- [Supabase Cron Jobs Documentation](https://supabase.com/docs/guides/database/extensions/pg_cron)
- [Supabase CLI Functions Reference](https://supabase.com/docs/reference/cli/supabase-functions)
- [pg_cron Extension](https://github.com/citusdata/pg_cron)
- [Project Dashboard](https://app.supabase.com/project/ppqgtbjykitqtiaisyji)
