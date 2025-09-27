import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Settings, Users, DollarSign } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface EnterpriseUserSetting {
  id: string;
  user_id: string;
  custom_fanmarks_limit: number | null;
  custom_pricing: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface UserWithSettings {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  plan_type: 'free' | 'creator' | 'business' | 'enterprise' | 'admin' | 'max';
  enterprise_settings?: EnterpriseUserSetting;
}

export const AdminSettings = () => {
  const { settings, loading, refetch } = useSystemSettings();
  const { toast } = useToast();
  const [updating, setUpdating] = useState(false);

  // Grace period state
  const [gracePeriodDays, setGracePeriodDays] = useState(settings.grace_period_days);

  // Plan settings states
  const [businessLimit, setBusinessLimit] = useState(settings.business_fanmarks_limit);
  const [businessPricing, setBusinessPricing] = useState(settings.business_pricing);
  const [enterpriseLimit, setEnterpriseLimit] = useState(settings.enterprise_fanmarks_limit);
  const [enterprisePricing, setEnterprisePricing] = useState(settings.enterprise_pricing);

  // Enterprise users management
  const [enterpriseUsers, setEnterpriseUsers] = useState<UserWithSettings[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  useEffect(() => {
    setGracePeriodDays(settings.grace_period_days);
    setBusinessLimit(settings.business_fanmarks_limit);
    setBusinessPricing(settings.business_pricing);
    setEnterpriseLimit(settings.enterprise_fanmarks_limit);
    setEnterprisePricing(settings.enterprise_pricing);
  }, [settings]);

  useEffect(() => {
    fetchEnterpriseUsers();
  }, []);

  const fetchEnterpriseUsers = async () => {
    setLoadingUsers(true);
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select(`
          *,
          enterprise_user_settings (*)
        `)
        .in('plan_type', ['enterprise', 'admin']);

      if (error) throw error;
      setEnterpriseUsers(data || []);
    } catch (error) {
      console.error('Error fetching enterprise users:', error);
      toast({
        title: 'エラー',
        description: 'Enterprise ユーザーの取得に失敗しました',
        variant: 'destructive',
      });
    } finally {
      setLoadingUsers(false);
    }
  };

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

  const updateEnterpriseUserSettings = async (userId: string, customLimit?: number, customPricing?: number, notes?: string) => {
    setUpdating(true);
    try {
      const { error } = await supabase
        .from('enterprise_user_settings')
        .upsert({
          user_id: userId,
          custom_fanmarks_limit: customLimit || null,
          custom_pricing: customPricing || null,
          notes: notes || null,
        });

      if (error) throw error;

      toast({
        title: 'Enterprise 設定更新完了',
        description: 'ユーザーの個別設定を更新しました',
      });

      await fetchEnterpriseUsers();
    } catch (error) {
      console.error('Error updating enterprise user settings:', error);
      toast({
        title: 'エラー',
        description: 'Enterprise 設定の更新に失敗しました',
        variant: 'destructive',
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
      <Tabs defaultValue="plans" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="plans">プラン設定</TabsTrigger>
          <TabsTrigger value="enterprise">Enterprise 管理</TabsTrigger>
          <TabsTrigger value="system">システム設定</TabsTrigger>
        </TabsList>

        <TabsContent value="plans" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                プラン別設定
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="business-limit">Business プラン上限</Label>
                  <div className="flex gap-2">
                    <Input
                      id="business-limit"
                      type="number"
                      value={businessLimit}
                      onChange={(e) => setBusinessLimit(parseInt(e.target.value) || 0)}
                      min="1"
                    />
                    <Button
                      onClick={() => updateSystemSetting('business_fanmarks_limit', businessLimit)}
                      disabled={updating || businessLimit === settings.business_fanmarks_limit}
                      size="sm"
                    >
                      更新
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="business-pricing">Business プラン料金 (円)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="business-pricing"
                      type="number"
                      value={businessPricing}
                      onChange={(e) => setBusinessPricing(parseInt(e.target.value) || 0)}
                      min="0"
                    />
                    <Button
                      onClick={() => updateSystemSetting('business_pricing', businessPricing)}
                      disabled={updating || businessPricing === settings.business_pricing}
                      size="sm"
                    >
                      更新
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="enterprise-limit">Enterprise プラン デフォルト上限</Label>
                  <div className="flex gap-2">
                    <Input
                      id="enterprise-limit"
                      type="number"
                      value={enterpriseLimit}
                      onChange={(e) => setEnterpriseLimit(parseInt(e.target.value) || 0)}
                      min="1"
                    />
                    <Button
                      onClick={() => updateSystemSetting('enterprise_fanmarks_limit', enterpriseLimit)}
                      disabled={updating || enterpriseLimit === settings.enterprise_fanmarks_limit}
                      size="sm"
                    >
                      更新
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="enterprise-pricing">Enterprise プラン デフォルト料金 (円)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="enterprise-pricing"
                      type="number"
                      value={enterprisePricing}
                      onChange={(e) => setEnterprisePricing(parseInt(e.target.value) || 0)}
                      min="0"
                    />
                    <Button
                      onClick={() => updateSystemSetting('enterprise_pricing', enterprisePricing)}
                      disabled={updating || enterprisePricing === settings.enterprise_pricing}
                      size="sm"
                    >
                      更新
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="enterprise" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Enterprise ユーザー管理
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingUsers ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : (
                <div className="space-y-4">
                  {enterpriseUsers.length === 0 ? (
                    <p className="text-muted-foreground">Enterprise ユーザーはいません</p>
                  ) : (
                    enterpriseUsers.map((user) => (
                      <EnterpriseUserCard
                        key={user.id}
                        user={user}
                        onUpdate={updateEnterpriseUserSettings}
                        updating={updating}
                      />
                    ))
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="system" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                ファンマーク返却設定
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="grace-period">返却猶予期間 (日)</Label>
                <div className="flex gap-2">
                  <Input
                    id="grace-period"
                    type="number"
                    value={gracePeriodDays}
                    onChange={(e) => setGracePeriodDays(parseInt(e.target.value) || 0)}
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
                  ライセンス期限切れ後、ファンマークが自動返却されるまでの猶予期間を設定します。
                </p>
              </div>

              <div className="space-y-4 rounded-lg border p-4">
                <h4 className="font-medium">その他のシステム設定</h4>
                <div className="grid gap-4 text-sm">
                  <div className="flex justify-between">
                    <span>招待制モード:</span>
                    <span>{settings.invitation_mode ? '有効' : '無効'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Free プラン上限:</span>
                    <span>{settings.max_fanmarks_per_user} ファンマーク</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Creator プラン上限:</span>
                    <span>{settings.creator_fanmarks_limit} ファンマーク</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Creator プラン料金:</span>
                    <span>¥{settings.premium_pricing}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>最大絵文字文字数:</span>
                    <span>{settings.max_emoji_characters} 文字</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  これらの設定は今後のアップデートで編集可能になる予定です。
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

interface EnterpriseUserCardProps {
  user: UserWithSettings;
  onUpdate: (userId: string, customLimit?: number, customPricing?: number, notes?: string) => void;
  updating: boolean;
}

const EnterpriseUserCard = ({ user, onUpdate, updating }: EnterpriseUserCardProps) => {
  const [customLimit, setCustomLimit] = useState(user.enterprise_settings?.custom_fanmarks_limit || '');
  const [customPricing, setCustomPricing] = useState(user.enterprise_settings?.custom_pricing || '');
  const [notes, setNotes] = useState(user.enterprise_settings?.notes || '');

  const handleSave = () => {
    onUpdate(
      user.user_id,
      customLimit ? parseInt(customLimit.toString()) : undefined,
      customPricing ? parseInt(customPricing.toString()) : undefined,
      notes || undefined
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          {user.display_name || user.username} 
          <span className="ml-2 text-sm font-normal text-muted-foreground">({user.plan_type})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`limit-${user.id}`}>カスタム上限数</Label>
            <Input
              id={`limit-${user.id}`}
              type="number"
              value={customLimit}
              onChange={(e) => setCustomLimit(e.target.value)}
              placeholder="デフォルトを使用"
              min="1"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`pricing-${user.id}`}>カスタム料金 (円)</Label>
            <Input
              id={`pricing-${user.id}`}
              type="number"
              value={customPricing}
              onChange={(e) => setCustomPricing(e.target.value)}
              placeholder="デフォルトを使用"
              min="0"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`notes-${user.id}`}>備考</Label>
          <Textarea
            id={`notes-${user.id}`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="管理用のメモ..."
            rows={2}
          />
        </div>
        <Button onClick={handleSave} disabled={updating} size="sm">
          {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存'}
        </Button>
      </CardContent>
    </Card>
  );
};