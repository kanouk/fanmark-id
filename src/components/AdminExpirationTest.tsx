import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from '@/hooks/useTranslation';
import { Clock, PlayCircle } from 'lucide-react';

export const AdminExpirationTest = () => {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const [lastRunAt, setLastRunAt] = useState<Date | null>(null);

  const runExpirationCheck = async () => {
    setIsRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('check-expired-licenses', {
        body: { manual_trigger: true }
      });

      if (error) {
        throw error;
      }

      setLastResult(data);
      setLastRunAt(new Date());
      toast({
        title: '失効処理完了',
        description: `${data.licenses_to_grace || 0}件が失効処理中に、${data.licenses_to_expired || 0}件が失効になりました`,
      });
    } catch (error: any) {
      console.error('Error running expiration check:', error);
      toast({
        title: 'エラーが発生しました',
        description: error.message || '失効処理の実行に失敗しました',
        variant: 'destructive',
      });
    } finally {
      setIsRunning(false);
    }
  };

  const processedCount = lastResult?.processed ?? lastResult?.details?.found?.total ?? 0;
  const activeToGrace = lastResult?.details?.active_to_grace ?? lastResult?.licenses_to_grace ?? 0;
  const graceToExpired = lastResult?.details?.grace_to_expired ?? lastResult?.licenses_to_expired ?? 0;
  const elapsedSeconds = lastResult?.elapsed_ms ? Math.round(lastResult.elapsed_ms / 1000) : null;
  const errorCount = Array.isArray(lastResult?.errors)
    ? lastResult.errors.length
    : lastResult?.errors
      ? 1
      : 0;

  const summaryItems = [
    {
      label: '処理対象件数',
      value: `${processedCount} 件`,
    },
    {
      label: 'Active → Grace',
      value: `${activeToGrace} 件`,
    },
    {
      label: 'Grace → 失効',
      value: `${graceToExpired} 件`,
    },
    {
      label: '実行時間',
      value: elapsedSeconds !== null ? `${elapsedSeconds} 秒` : '未取得',
    },
    {
      label: 'エラー件数',
      value: `${errorCount} 件`,
      tone: errorCount > 0 ? 'text-destructive font-semibold' : 'text-muted-foreground',
    },
  ];

  const formattedLastRunAt = lastRunAt
    ? new Intl.DateTimeFormat('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(lastRunAt)
    : '未実行';

  return (
    <div className="space-y-6">
      <section className="space-y-5 rounded-2xl border border-border/60 bg-background/80 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
              <Clock className="h-3.5 w-3.5" /> 最終実行ステータス
            </span>
            <div>
              <p className="text-sm font-medium text-muted-foreground">最終実行日時</p>
              <p className="text-lg font-semibold text-foreground">{formattedLastRunAt}</p>
            </div>
          </div>
          {elapsedSeconds !== null && (
            <div className="rounded-full border border-primary/20 bg-primary/5 px-4 py-2 text-xs font-medium text-primary">
              実行時間 {elapsedSeconds} 秒 / 処理 {processedCount} 件
            </div>
          )}
        </div>

        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {summaryItems.map((item) => (
            <div key={item.label} className="rounded-xl border border-border/40 bg-card/70 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {item.label}
              </dt>
              <dd className={`mt-2 text-base font-semibold text-foreground ${item.tone ?? ''}`}>
                {item.value}
              </dd>
            </div>
          ))}
        </dl>

        {lastResult?.errors && Array.isArray(lastResult.errors) && lastResult.errors.length > 0 && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <p className="font-semibold">エラー詳細</p>
            <ul className="mt-2 space-y-1">
              {lastResult.errors.map((err: any, index: number) => (
                <li key={`${err.id ?? index}-${err.type ?? 'error'}`}>
                  {err.type ?? 'unknown'}: {err.error ?? '詳細情報がありません'}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-2xl border border-primary/40 bg-primary/5 p-5">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-foreground">失効バッチを手動実行</h3>
          <p className="text-sm text-muted-foreground">
            定期ジョブと同じ失効フロー（Active → Grace → 失効）を即時で走らせます。実行結果は上部のサマリーに反映されます。
          </p>
        </div>
        <Button
          onClick={runExpirationCheck}
          disabled={isRunning}
          className="w-full sm:w-auto"
        >
          <PlayCircle className="mr-2 h-4 w-4" />
          {isRunning ? '処理中...' : '失効バッチを実行'}
        </Button>
      </section>
    </div>
  );
};