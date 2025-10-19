import React, { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface ExtensionPrice {
  id: string;
  tier_level: number;
  months: number;
  price_yen: number;
  is_active: boolean;
}

interface FanmarkTier {
  id: string;
  tier_level: number;
  initial_license_days: number;
  is_active: boolean;
  description: string | null;
}

const TIER_NAMES = {
  1: "Tier 1（標準）",
  2: "Tier 2（プレミアム）",
  3: "Tier 3（レア）",
};

const MONTH_OPTIONS = [1, 2, 3, 6];

export const AdminTierExtensionPrices = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [tierUpdatingId, setTierUpdatingId] = useState<string | null>(null);
  const [prices, setPrices] = useState<ExtensionPrice[]>([]);
  const [tiers, setTiers] = useState<FanmarkTier[]>([]);
  const [editedPrices, setEditedPrices] = useState<Record<string, number>>({});
  const [tierEdits, setTierEdits] = useState<Record<string, number>>({});

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [
        { data: priceData, error: priceError },
        { data: tierData, error: tierError },
      ] = await Promise.all([
        supabase
          .from("fanmark_tier_extension_prices" as any)
          .select("*")
          .order("tier_level", { ascending: true })
          .order("months", { ascending: true }),
        supabase
          .from("fanmark_tiers" as any)
          .select("id, tier_level, initial_license_days, is_active, description")
          .order("tier_level", { ascending: true }),
      ]);

      if (priceError) throw priceError;
      if (tierError) throw tierError;

      const typedPrices = (priceData || []) as unknown as ExtensionPrice[];
      setPrices(typedPrices);
      const initialPrices: Record<string, number> = {};
      typedPrices.forEach(price => {
        initialPrices[price.id] = price.price_yen;
      });
      setEditedPrices(initialPrices);

      const typedTiers = (tierData || []) as unknown as FanmarkTier[];
      setTiers(typedTiers);
      const initialTierDays: Record<string, number> = {};
      typedTiers.forEach(tier => {
        initialTierDays[tier.id] = tier.initial_license_days;
      });
      setTierEdits(initialTierDays);
    } catch (error) {
      console.error("Error fetching tier settings:", error);
      toast({
        title: "エラー",
        description: "ティア設定の取得に失敗しました",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const handlePriceChange = (id: string, value: string) => {
    const numValue = parseInt(value, 10);
    if (!isNaN(numValue) && numValue >= 0) {
      setEditedPrices(prev => ({ ...prev, [id]: numValue }));
    }
  };

  const handleUpdatePrice = async (id: string) => {
    const newPrice = editedPrices[id];
    if (newPrice === undefined) return;

    setUpdating(true);
    try {
      const { error } = await supabase
        .from("fanmark_tier_extension_prices" as any)
        .update({ price_yen: newPrice })
        .eq("id", id);

      if (error) throw error;

      toast({
        title: "更新完了",
        description: "料金を更新しました",
      });

      setPrices(prev =>
        prev.map(price =>
          price.id === id ? { ...price, price_yen: newPrice } : price
        )
      );
    } catch (error) {
      console.error("Error updating price:", error);
      toast({
        title: "エラー",
        description: "料金の更新に失敗しました",
        variant: "destructive",
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    setUpdating(true);
    try {
      const { error } = await supabase
        .from("fanmark_tier_extension_prices" as any)
        .update({ is_active: !currentActive })
        .eq("id", id);

      if (error) throw error;

      toast({
        title: "更新完了",
        description: `料金プランを${!currentActive ? "有効" : "無効"}にしました`,
      });

      setPrices(prev =>
        prev.map(price =>
          price.id === id ? { ...price, is_active: !currentActive } : price
        )
      );
    } catch (error) {
      console.error("Error toggling extension price status:", error);
      toast({
        title: "エラー",
        description: "ステータスの更新に失敗しました",
        variant: "destructive",
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleTierDaysChange = (id: string, value: string) => {
    const numValue = parseInt(value, 10);
    if (!isNaN(numValue) && numValue >= 0) {
      setTierEdits(prev => ({ ...prev, [id]: numValue }));
    }
  };

  const handleUpdateTierDays = async (id: string) => {
    const newDays = tierEdits[id];
    if (newDays === undefined) return;

    const targetTier = tiers.find(tier => tier.id === id);
    if (!targetTier || targetTier.initial_license_days === newDays) {
      return;
    }

    setTierUpdatingId(id);
    try {
      const { error } = await supabase
        .from("fanmark_tiers" as any)
        .update({ initial_license_days: newDays })
        .eq("id", id);

      if (error) throw error;

      toast({
        title: "更新完了",
        description: "初回付与日数を更新しました",
      });

      setTiers(prev =>
        prev.map(tier =>
          tier.id === id ? { ...tier, initial_license_days: newDays } : tier
        )
      );
    } catch (error) {
      console.error("Error updating tier initial days:", error);
      toast({
        title: "エラー",
        description: "ティア設定の更新に失敗しました",
        variant: "destructive",
      });
    } finally {
      setTierUpdatingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const pricesByTier = prices.reduce((acc, price) => {
    if (!acc[price.tier_level]) {
      acc[price.tier_level] = [];
    }
    acc[price.tier_level].push(price);
    return acc;
  }, {} as Record<number, ExtensionPrice[]>);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-primary/10 bg-primary/5 p-4">
        <p className="text-sm text-muted-foreground">
          ファンマークのTierごとに、ライセンス延長期間（1/2/3/6ヶ月）の料金を設定できます。
          料金を変更すると、ユーザーの延長ダイアログに即座に反映されます。
        </p>
      </div>

      <div className="space-y-4 rounded-2xl border border-border/60 bg-card/70 p-6 shadow-sm">
        <div className="space-y-1 border-b border-border/40 pb-3">
          <h3 className="text-lg font-semibold text-foreground">Tier基本設定</h3>
          <p className="text-xs text-muted-foreground">
            無料取得後に付与される利用可能日数を調整できます。変更は新規取得時のライセンス期限に反映されます。
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {tiers.map(tier => {
            const editedDays = tierEdits[tier.id];
            const isDirty = editedDays !== tier.initial_license_days;
            const isInvalid = editedDays === undefined || editedDays < 1;
            const isUpdatingThisTier = tierUpdatingId === tier.id;

            return (
              <div
                key={tier.id}
                className="space-y-3 rounded-xl border border-border/60 bg-background p-4 shadow-sm"
              >
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold text-foreground">
                    {TIER_NAMES[tier.tier_level as keyof typeof TIER_NAMES] ?? `Tier ${tier.tier_level}`}
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    {tier.description ?? "ティアの説明は設定されていません"}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">初回付与日数</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      value={editedDays ?? tier.initial_license_days}
                      onChange={(event) => handleTierDaysChange(tier.id, event.target.value)}
                      disabled={Boolean(tierUpdatingId)}
                      className="h-9 text-sm"
                    />
                    <span className="text-xs text-muted-foreground">日</span>
                  </div>

                  <Button
                    onClick={() => handleUpdateTierDays(tier.id)}
                    disabled={Boolean(tierUpdatingId) || isInvalid || !isDirty}
                    size="sm"
                    className="w-full gap-1.5"
                  >
                    {isUpdatingThisTier ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    更新
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-6">
        {[1, 2, 3].map(tierLevel => {
          const tierPrices = pricesByTier[tierLevel] || [];

          return (
            <div
              key={tierLevel}
              className="space-y-4 rounded-2xl border border-border/60 bg-card/70 p-6 shadow-sm"
            >
              <div className="space-y-1 border-b border-border/40 pb-3">
                <h3 className="text-lg font-semibold text-foreground">
                  {TIER_NAMES[tierLevel as keyof typeof TIER_NAMES]}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {tierLevel === 1 && "標準的な絵文字のファンマーク"}
                  {tierLevel === 2 && "やや希少な絵文字のファンマーク"}
                  {tierLevel === 3 && "非常に希少な絵文字のファンマーク"}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {MONTH_OPTIONS.map(months => {
                  const priceData = tierPrices.find(p => p.months === months);
                  if (!priceData) return null;

                  const editedPrice = editedPrices[priceData.id];
                  const originalPrice = priceData.price_yen;
                  const isDirty = editedPrice !== originalPrice;
                  const isInvalid = editedPrice === undefined || editedPrice < 0;

                  return (
                    <div
                      key={priceData.id}
                      className={cn(
                        "space-y-3 rounded-xl border p-4 transition-colors",
                        priceData.is_active
                          ? "border-border bg-background"
                          : "border-border/40 bg-muted/30 opacity-60"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-semibold">
                          {months}ヶ月延長
                        </Label>
                        <button
                          onClick={() => handleToggleActive(priceData.id, priceData.is_active)}
                          disabled={updating}
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[0.65rem] font-medium transition-colors",
                            priceData.is_active
                              ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                          )}
                        >
                          {priceData.is_active ? "有効" : "無効"}
                        </button>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            value={editedPrice ?? priceData.price_yen}
                            onChange={(event) => handlePriceChange(priceData.id, event.target.value)}
                            min={0}
                            disabled={updating}
                            className="h-9 text-sm"
                          />
                          <span className="text-xs text-muted-foreground">円</span>
                        </div>

                        <Button
                          onClick={() => handleUpdatePrice(priceData.id)}
                          disabled={updating || isInvalid || !isDirty}
                          size="sm"
                          className="w-full gap-1.5"
                        >
                          {updating ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          更新
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

