import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from '@/hooks/useTranslation';
import { Clock, PlayCircle } from 'lucide-react';

export const AdminExpirationTest = () => {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);

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

  return (
    <Card className="rounded-2xl border border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          失効処理テスト
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground">
          <p>ファンマの失効処理を手動で実行します。</p>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>返却日+1日を過ぎたアクティブライセンス → 失効処理中（grace）</li>
            <li>失効処理中開始から24時間経過 → 失効（expired）</li>
          </ul>
        </div>
        
        <Button
          onClick={runExpirationCheck}
          disabled={isRunning}
          className="w-full"
        >
          <PlayCircle className="h-4 w-4 mr-2" />
          {isRunning ? '処理中...' : '失効処理を実行'}
        </Button>

        {lastResult && (
          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <h4 className="font-medium">実行結果:</h4>
            <div className="text-sm space-y-1">
              <p>失効処理中に移行: {lastResult.licenses_to_grace || 0}件</p>
              <p>失効に移行: {lastResult.licenses_to_expired || 0}件</p>
              {lastResult.grace_period_hours && (
                <p>グレース期間: {lastResult.grace_period_hours}時間</p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};