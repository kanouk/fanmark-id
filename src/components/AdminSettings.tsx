import React, { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Settings, Wrench } from "lucide-react";

export const AdminSettings = () => {
  const { settings, loading, refetch } = useSystemSettings();
  const { toast } = useToast();
  const [updating, setUpdating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Grace period state
  const [gracePeriodDays, setGracePeriodDays] = useState(settings.grace_period_days);
  const [maintenanceMode, setMaintenanceMode] = useState(settings.maintenance_mode);
  const [maintenanceMessage, setMaintenanceMessage] = useState(settings.maintenance_message);
  const [maintenanceEndTime, setMaintenanceEndTime] = useState("");

  const formatLocalDateTime = (value: string | null) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (num: number) => String(num).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  useEffect(() => {
    setGracePeriodDays(settings.grace_period_days);
    setMaintenanceMode(settings.maintenance_mode);
    setMaintenanceMessage(settings.maintenance_message);
    setMaintenanceEndTime(formatLocalDateTime(settings.maintenance_end_time));
  }, [settings]);

  const updateSystemSetting = async (key: string, value: string | number | boolean) => {
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

  const handleSaveMaintenanceDetails = async () => {
    const endTimeValue = maintenanceEndTime
      ? new Date(maintenanceEndTime).toISOString()
      : "";

    await updateSystemSetting("maintenance_message", maintenanceMessage.trim());
    await updateSystemSetting("maintenance_end_time", endTimeValue);
  };

  const handleToggleMaintenance = (checked: boolean) => {
    if (checked) {
      setConfirmOpen(true);
      return;
    }

    if (!checked && maintenanceMode) {
      updateSystemSetting("maintenance_mode", false);
      setMaintenanceMode(false);
    }
  };

  const confirmEnableMaintenance = async () => {
    await updateSystemSetting("maintenance_mode", true);
    setMaintenanceMode(true);
    setConfirmOpen(false);
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

      <Card className="border-border/60 shadow-sm">
        <div className="space-y-6 p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
                <Wrench className="h-5 w-5" />
                メンテナンスモード
              </h2>
              <p className="text-sm text-muted-foreground">
                メンテナンス中は一般ユーザーに専用ページを表示します。管理者は通常どおり閲覧できます。
              </p>
            </div>
            <Badge variant={maintenanceMode ? "destructive" : "secondary"}>
              {maintenanceMode ? "有効" : "無効"}
            </Badge>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">メンテナンスモード切り替え</p>
              <p className="text-xs text-muted-foreground">
                有効化すると通常画面の表示が停止されます。
              </p>
            </div>
            <Switch
              checked={maintenanceMode}
              onCheckedChange={handleToggleMaintenance}
              disabled={updating}
            />
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="maintenance-message">メンテナンスメッセージ</Label>
              <Textarea
                id="maintenance-message"
                value={maintenanceMessage}
                onChange={(e) => setMaintenanceMessage(e.target.value)}
                placeholder="ご不便をおかけしますが、しばらくお待ちください。"
                rows={4}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maintenance-end-time">予定終了時刻</Label>
              <Input
                id="maintenance-end-time"
                type="datetime-local"
                value={maintenanceEndTime}
                onChange={(e) => setMaintenanceEndTime(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                未設定の場合は「未定」と表示されます。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={handleSaveMaintenanceDetails}
                disabled={updating}
                size="sm"
              >
                {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : "保存"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open("/maintenance", "_blank", "noreferrer")}
              >
                プレビュー
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <div className="rounded-2xl border border-dashed border-border/50 bg-muted/10 p-5 text-sm text-muted-foreground">
        招待制モード（現在: {settings.invitation_mode ? '有効' : '無効'}）と最大絵文字文字数（{settings.max_emoji_characters} 文字）の編集 UI は未実装です。必要に応じて設定テーブルを直接更新してください。
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">
              メンテナンスモードを有効にしますか？
            </AlertDialogTitle>
            <AlertDialogDescription>
              有効化すると、一般ユーザーにはメンテナンスページのみが表示されます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={confirmEnableMaintenance}>
              有効にする
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
