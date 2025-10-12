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

interface PriceUpdate {
  id: string;
  price_yen: number;
  original_price: number;
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
  const [prices, setPrices] = useState<ExtensionPrice[]>([]);
  const [editedPrices, setEditedPrices] = useState<Record<string, number>>({});

  const fetchPrices = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("fanmark_tier_extension_prices")
        .select("*")
        .order("tier_level", { ascending: true })
        .order("months", { ascending: true });

      if (error) throw error;

      setPrices(data || []);

      // Initialize edited prices with current values
      const initial: Record<string, number> = {};
      (data || []).forEach(price => {
        initial[price.id] = price.price_yen;
      });
      setEditedPrices(initial);
    } catch (error) {
      console.error("Error fetching extension prices:", error);
      toast({
        title: "エラー",
        description: "料金データの取得に失敗しました",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPrices();
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
        .from("fanmark_tier_extension_prices")
        .update({ price_yen: newPrice })
        .eq("id", id);

      if (error) throw error;

      toast({
        title: "更新完了",
        description: "料金を更新しました",
      });

      await fetchPrices();
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
        .from("fanmark_tier_extension_prices")
        .update({ is_active: !currentActive })
        .eq("id", id);

      if (error) throw error;

      toast({
        title: "更新完了",
        description: `料金プランを${!currentActive ? "有効" : "無効"}にしました`,
      });

      await fetchPrices();
    } catch (error) {
      console.error("Error toggling active status:", error);
      toast({
        title: "エラー",
        description: "ステータスの更新に失敗しました",
        variant: "destructive",
      });
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  // Group prices by tier level
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
                            value={editedPrice || 0}
                            onChange={(e) => handlePriceChange(priceData.id, e.target.value)}
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
