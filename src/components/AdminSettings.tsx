import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { Loader2 } from "lucide-react";

export const AdminSettings = () => {
  const { settings, loading, refetch } = useSystemSettings();
  const { toast } = useToast();
  const [updating, setUpdating] = useState(false);
  const [gracePeriodDays, setGracePeriodDays] = useState(settings?.grace_period_days || 7);

  React.useEffect(() => {
    if (settings) {
      setGracePeriodDays(settings.grace_period_days);
    }
  }, [settings]);

  const handleUpdateGracePeriod = async () => {
    setUpdating(true);
    try {
      const { error } = await supabase
        .from('system_settings')
        .update({ setting_value: gracePeriodDays.toString() })
        .eq('setting_key', 'grace_period_days');

      if (error) throw error;

      toast({
        title: "設定を更新しました",
        description: `クールダウン期間を${gracePeriodDays}日に設定しました。`,
      });

      refetch();
    } catch (error) {
      console.error('Error updating grace period:', error);
      toast({
        title: "エラー",
        description: "設定の更新に失敗しました。",
        variant: "destructive",
      });
    } finally {
      setUpdating(false);
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
      <Card>
        <CardHeader>
          <CardTitle>ファンマーク返却設定</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="gracePeriod">
              クールダウン期間（日数）
            </Label>
            <div className="flex items-center space-x-2">
              <Input
                id="gracePeriod"
                type="number"
                min="1"
                max="30"
                value={gracePeriodDays}
                onChange={(e) => setGracePeriodDays(parseInt(e.target.value))}
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">日</span>
            </div>
            <p className="text-sm text-muted-foreground">
              ファンマーク返却後、再取得できるまでの期間を設定します。
            </p>
          </div>
          
          <Button 
            onClick={handleUpdateGracePeriod}
            disabled={updating || gracePeriodDays === settings?.grace_period_days}
          >
            {updating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            設定を保存
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>その他のシステム設定</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>招待モード</Label>
              <p className="text-sm text-muted-foreground">
                {settings?.invitation_mode ? '招待制' : '一般開放'}
              </p>
            </div>
            <div>
              <Label>ファンマーク制限</Label>
              <p className="text-sm text-muted-foreground">
                {settings?.max_fanmarks_per_user}個まで
              </p>
            </div>
            <div>
              <Label>プレミアム価格</Label>
              <p className="text-sm text-muted-foreground">
                ¥{settings?.premium_pricing}
              </p>
            </div>
            <div>
              <Label>絵文字文字数制限</Label>
              <p className="text-sm text-muted-foreground">
                {settings?.max_emoji_characters}文字
              </p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-4">
            これらの設定は今後のアップデートで編集可能になる予定です。
          </p>
        </CardContent>
      </Card>
    </div>
  );
};