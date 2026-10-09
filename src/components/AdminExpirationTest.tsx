import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Clock, PlayCircle } from 'lucide-react';
import {
  getLifecycleRunBackend,
  LifecycleRunApiError,
  runLicenseExpiryInWorker,
  type LifecycleRunResult,
} from '@/lib/lifecycle-run-api';

type LegacyExpirationResult = {
  cloudflareLifecycleRun?: LifecycleRunResult;
  processed?: number;
  details?: {
    found?: { total?: number };
    active_to_grace?: number;
    grace_to_expired?: number;
  };
  licenses_to_grace?: number;
  licenses_to_expired?: number;
  elapsed_ms?: number;
  errors?: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function displayError(value: unknown, index: number): { key: number; message: string } {
  const error = record(value);
  const type = typeof error.type === 'string' ? error.type : 'unknown';
  const detail = typeof error.error === 'string' ? error.error : '詳細情報がありません';
  return { key: index, message: `${type}: ${detail}` };
}

export const AdminExpirationTest = () => {
  const { toast } = useToast();
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState<LegacyExpirationResult | null>(null);
  const [lastRunAt, setLastRunAt] = useState<Date | null>(null);

  const runExpirationCheck = async () => {
    setIsRunning(true);
    try {
      if (getLifecycleRunBackend() === 'worker') {
        const result = await runLicenseExpiryInWorker();
        setLastResult({ cloudflareLifecycleRun: result });
        setLastRunAt(new Date());
        const processed = result.activeToGrace.processed + result.graceFinalization.processed;
        const conflicts = result.activeToGrace.conflicts + result.graceFinalization.conflicts;
        toast({
          title: result.status === 'completed'
            ? conflicts > 0 ? '失効処理完了（競合あり）' : '失効処理完了'
            : '失効処理は継続中',
          description: result.status === 'completed'
            ? `${processed}件を処理しました。競合 ${conflicts} 件。`
            : `${processed}件を処理しました。ページ上限に達したため、同じ処理を再実行して続きを進めてください。`,
        });
        return;
      }

      const { data, error } = await supabase.functions.invoke('check-expired-licenses', {
        body: { manual_trigger: true }
      });

      if (error) {
        throw error;
      }

      const result = data as LegacyExpirationResult | null;
      setLastResult(result);
      setLastRunAt(new Date());
      toast({
        title: '失効処理完了',
        description: `${result?.licenses_to_grace || 0}件が失効処理中に、${result?.licenses_to_expired || 0}件が失効になりました`,
      });
    } catch (error: unknown) {
      console.error('Error running expiration check:', error);
      const message = error instanceof Error ? error.message : '失効処理の実行に失敗しました';
      const description = error instanceof LifecycleRunApiError && error.kind === 'http' && error.status === 503
        ? 'Cloudflare側の手動実行は現在無効か、実行できない状態です。Supabaseには切り替えず、設定とWorkerの状態を確認してください。'
        : message;
      toast({
        title: 'エラーが発生しました',
        description,
        variant: 'destructive',
      });
    } finally {
      setIsRunning(false);
    }
  };

  const cloudflareResult = lastResult?.cloudflareLifecycleRun;
  const processedCount = cloudflareResult
    ? cloudflareResult.activeToGrace.processed + cloudflareResult.graceFinalization.processed
    : lastResult?.processed ?? lastResult?.details?.found?.total ?? 0;
  const activeToGrace = cloudflareResult
    ? cloudflareResult.activeToGrace.processed
    : lastResult?.details?.active_to_grace ?? lastResult?.licenses_to_grace ?? 0;
  const graceToExpired = cloudflareResult
    ? cloudflareResult.graceFinalization.processed
    : lastResult?.details?.grace_to_expired ?? lastResult?.licenses_to_expired ?? 0;
  const elapsedSeconds = cloudflareResult
    ? Math.round(cloudflareResult.elapsedMs / 1000)
    : lastResult?.elapsed_ms ? Math.round(lastResult.elapsed_ms / 1000) : null;
  const errorCount = cloudflareResult
    ? cloudflareResult.activeToGrace.conflicts + cloudflareResult.graceFinalization.conflicts
      : Array.isArray(lastResult?.errors)
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

        {Array.isArray(lastResult?.errors) && lastResult.errors.length > 0 && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <p className="font-semibold">エラー詳細</p>
            <ul className="mt-2 space-y-1">
              {lastResult.errors.map((error, index) => {
                const item = displayError(error, index);
                return <li key={item.key}>{item.message}</li>;
              })}
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
