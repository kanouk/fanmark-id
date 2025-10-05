import React, { ChangeEvent, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { useToast } from "@/components/ui/use-toast";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type PlanField = {
  id: string;
  label: string;
  value: number;
  original: number;
  min: number;
  settingKey: string;
  setValue: (value: number) => void;
};

type PlanSection = {
  key: string;
  title: string;
  description?: string;
  fields: PlanField[];
};

export const AdminPlanSettings = () => {
  const { settings, loading, refetch } = useSystemSettings();
  const { toast } = useToast();
  const [updating, setUpdating] = useState(false);

  const [freeLimit, setFreeLimit] = useState(settings.max_fanmarks_per_user);
  const [creatorLimit, setCreatorLimit] = useState(settings.creator_fanmarks_limit);
  const [creatorPricing, setCreatorPricing] = useState(settings.premium_pricing);
  const [businessLimit, setBusinessLimit] = useState(settings.business_fanmarks_limit);
  const [businessPricing, setBusinessPricing] = useState(settings.business_pricing);
  const [enterpriseLimit, setEnterpriseLimit] = useState(settings.enterprise_fanmarks_limit);
  const [enterprisePricing, setEnterprisePricing] = useState(settings.enterprise_pricing);

  useEffect(() => {
    setFreeLimit(settings.max_fanmarks_per_user);
    setCreatorLimit(settings.creator_fanmarks_limit);
    setCreatorPricing(settings.premium_pricing);
    setBusinessLimit(settings.business_fanmarks_limit);
    setBusinessPricing(settings.business_pricing);
    setEnterpriseLimit(settings.enterprise_fanmarks_limit);
    setEnterprisePricing(settings.enterprise_pricing);
  }, [settings]);

  const updateSystemSetting = async (key: string, value: number) => {
    setUpdating(true);
    try {
      const { error } = await supabase
        .from("system_settings")
        .update({ setting_value: value.toString() })
        .eq("setting_key", key);

      if (error) throw error;

      toast({
        title: "設定更新完了",
        description: `${key} を ${value} に更新しました`,
      });

      await refetch();
    } catch (error) {
      console.error("Error updating system setting:", error);
      toast({
        title: "エラー",
        description: "設定の更新に失敗しました",
        variant: "destructive",
      });
    } finally {
      setUpdating(false);
    }
  };

  const sections: PlanSection[] = [
    {
      key: "free",
      title: "Free",
      description: "無料枠のデフォルト上限",
      fields: [
        {
          id: "free-limit",
          label: "上限ファンマーク数",
          value: freeLimit,
          original: settings.max_fanmarks_per_user,
          min: 1,
          settingKey: "max_fanmarks_per_user",
          setValue: setFreeLimit,
        },
      ],
    },
    {
      key: "creator",
      title: "Creator",
      description: "個人クリエイター向けの標準値",
      fields: [
        {
          id: "creator-limit",
          label: "上限ファンマーク数",
          value: creatorLimit,
          original: settings.creator_fanmarks_limit,
          min: 1,
          settingKey: "creator_fanmarks_limit",
          setValue: setCreatorLimit,
        },
        {
          id: "creator-pricing",
          label: "月額料金 (円)",
          value: creatorPricing,
          original: settings.premium_pricing,
          min: 0,
          settingKey: "premium_pricing",
          setValue: setCreatorPricing,
        },
      ],
    },
    {
      key: "business",
      title: "Business",
      description: "チーム・法人向けの設定",
      fields: [
        {
          id: "business-limit",
          label: "上限ファンマーク数",
          value: businessLimit,
          original: settings.business_fanmarks_limit,
          min: 1,
          settingKey: "business_fanmarks_limit",
          setValue: setBusinessLimit,
        },
        {
          id: "business-pricing",
          label: "月額料金 (円)",
          value: businessPricing,
          original: settings.business_pricing,
          min: 0,
          settingKey: "business_pricing",
          setValue: setBusinessPricing,
        },
      ],
    },
    {
      key: "enterprise",
      title: "Enterprise",
      description: "大規模顧客向けのデフォルト値",
      fields: [
        {
          id: "enterprise-limit",
          label: "デフォルト上限ファンマーク数",
          value: enterpriseLimit,
          original: settings.enterprise_fanmarks_limit,
          min: 1,
          settingKey: "enterprise_fanmarks_limit",
          setValue: setEnterpriseLimit,
        },
        {
          id: "enterprise-pricing",
          label: "デフォルト料金 (円)",
          value: enterprisePricing,
          original: settings.enterprise_pricing,
          min: 0,
          settingKey: "enterprise_pricing",
          setValue: setEnterprisePricing,
        },
      ],
    },
  ];

  const handleInputChange = (setter: (value: number) => void) => (event: ChangeEvent<HTMLInputElement>) => {
    setter(parseInt(event.target.value, 10) || 0);
  };

  const renderField = (field: PlanField) => {
    const isInvalid = Number.isNaN(field.value) || field.value < field.min;
    const isDirty = field.value !== field.original;

    return (
      <div key={field.id} className="space-y-2">
        <Label htmlFor={field.id}>{field.label}</Label>
        <div className="flex gap-2">
          <Input
            id={field.id}
            type="number"
            value={field.value}
            min={field.min}
            onChange={handleInputChange(field.setValue)}
          />
          <Button
            onClick={() => updateSystemSetting(field.settingKey, field.value)}
            disabled={updating || isInvalid || !isDirty}
            size="sm"
          >
            更新
          </Button>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        {sections.map((section) => (
          <div
            key={section.key}
            className="space-y-4 rounded-2xl border border-border/60 bg-card/70 p-6 shadow-sm"
          >
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-foreground">{section.title} プラン</h3>
              {section.description && (
                <p className="text-xs text-muted-foreground">{section.description}</p>
              )}
            </div>
            <div className="space-y-4">
              {section.fields.map(renderField)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};


