import React, { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Settings, AlertTriangle } from "lucide-react";

export const AdminSettings = () => {
  const { settings, loading, refetch } = useSystemSettings();
  const { toast } = useToast();
  const [updating, setUpdating] = useState(false);
  const [expiring, setExpiring] = useState(false);

  // Grace period state
  const [gracePeriodDays, setGracePeriodDays] = useState(settings.grace_period_days);

  useEffect(() => {
    setGracePeriodDays(settings.grace_period_days);
  }, [settings]);

  const updateSystemSetting = async (key: string, value: string | number) => {
    setUpdating(true);
    try {
      const { error } = await supabase
        .from('system_settings')
        .update({ setting_value: value.toString() })
        .eq('setting_key', key);

      if (error) throw error;

      toast({
        title: '設定更新完了',
        description: `${key} を ${value} に更新しました`,
      });

      await refetch();
    } catch (error) {
      console.error('Error updating system setting:', error);
      toast({
        title: 'エラー',
        description: '設定の更新に失敗しました',
        variant: 'destructive',
      });
    } finally {
      setUpdating(false);
    }
  };

  const manualExpireGraceLicenses = async () => {
    setExpiring(true);
    try {
      const { data, error } = await supabase.functions.invoke('manual-expire-grace-licenses');

      if (error) throw error;

      toast({
        title: '実行完了',
        description: `${data.successCount} 件のライセンスを失効しました`,
      });

      console.log('Manual expiration results:', data);
    } catch (error) {
      console.error('Error expiring grace licenses:', error);
      toast({
        title: 'エラー',
        description: '期限切れライセンスの失効に失敗しました',
        variant: 'destructive',
      });
    } finally {
      setExpiring(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-border/60 shadow-sm">
        <div className="space-y-4 p-6">
          <div className="space-y-2">
            <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
              <Settings className="h-5 w-5" />
              ファンマーク返却設定
            </h2>
            <p className="text-sm text-muted-foreground">
              ライセンス失効後にファンマークが返却されるまでの猶予期間を管理します。
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="grace-period">返却猶予期間 (日)</Label>
            <div className="flex gap-2">
              <Input
                id="grace-period"
                type="number"
                value={gracePeriodDays}
                onChange={(e) => setGracePeriodDays(parseInt(e.target.value, 10) || 0)}
                min="1"
                max="365"
              />
              <Button
                onClick={() => updateSystemSetting('grace_period_days', gracePeriodDays)}
                disabled={updating || gracePeriodDays === settings.grace_period_days}
                size="sm"
              >
                {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : '更新'}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              ライセンス期限切れ後に適用される自動返却タイミングを調整できます。
            </p>
          </div>
        </div>
      </Card>

      <Card className="border-destructive/20 bg-destructive/5">
        <div className="space-y-4 p-6">
          <div className="space-y-2">
            <h2 className="flex items-center gap-2 text-xl font-semibold text-destructive">
              <AlertTriangle className="h-5 w-5" />
              期限切れグレースライセンス手動失効
            </h2>
            <p className="text-sm text-muted-foreground">
              cron が正常に動作していない場合に、期限切れのグレース期間ライセンスを手動で失効させます。
            </p>
          </div>
          <Button
            onClick={manualExpireGraceLicenses}
            disabled={expiring}
            variant="destructive"
            size="sm"
          >
            {expiring ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                処理中...
              </>
            ) : (
              '期限切れライセンスを失効'
            )}
          </Button>
        </div>
      </Card>

      <div className="rounded-2xl border border-dashed border-border/50 bg-muted/10 p-5 text-sm text-muted-foreground">
        招待制モード（現在: {settings.invitation_mode ? '有効' : '無効'}）と最大絵文字文字数（{settings.max_emoji_characters} 文字）の編集 UI は未実装です。必要に応じて設定テーブルを直接更新してください。
      </div>
    </div>
  );
};