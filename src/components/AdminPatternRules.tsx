import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/useToast';

interface AvailabilityRule {
  id: string;
  rule_type: string;
  priority: number;
  rule_config: any;
  is_available: boolean;
  price_usd: number | null;
  description: string;
}

export function AdminPatternRules() {
  const [rules, setRules] = useState<AvailabilityRule[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchRules();
  }, []);

  const fetchRules = async () => {
    try {
      const { data, error } = await supabase
        .from('fanmark_availability_rules')
        .select('*')
        .order('priority', { ascending: true });

      if (error) throw error;
      setRules(data || []);
    } catch (error) {
      console.error('Error fetching rules:', error);
      toast({
        title: "エラー",
        description: "ルールの取得に失敗しました",
      });
    } finally {
      setLoading(false);
    }
  };

  const updateRuleAvailability = async (ruleId: string, isAvailable: boolean) => {
    try {
      const { error } = await supabase
        .from('fanmark_availability_rules')
        .update({ is_available: isAvailable })
        .eq('id', ruleId);

      if (error) throw error;

      setRules(rules.map(rule => 
        rule.id === ruleId ? { ...rule, is_available: isAvailable } : rule
      ));

      toast({
        title: "更新完了",
        description: `ルールが${isAvailable ? '有効' : '無効'}になりました`,
      });
    } catch (error) {
      console.error('Error updating rule:', error);
      toast({
        title: "エラー",
        description: "ルールの更新に失敗しました",
      });
    }
  };

  const updatePrefixPrice = async (ruleId: string, emoji: string, price: number) => {
    try {
      const rule = rules.find(r => r.id === ruleId);
      if (!rule) return;

      const config = { ...rule.rule_config };
      if (!config.prefixes) config.prefixes = {};
      config.prefixes[emoji] = price;

      const { error } = await supabase
        .from('fanmark_availability_rules')
        .update({ rule_config: config })
        .eq('id', ruleId);

      if (error) throw error;

      setRules(rules.map(r => 
        r.id === ruleId ? { ...r, rule_config: config } : r
      ));

      toast({
        title: "更新完了",
        description: `${emoji}の価格が$${price}に設定されました`,
      });
    } catch (error) {
      console.error('Error updating prefix price:', error);
      toast({
        title: "エラー",
        description: "価格の更新に失敗しました",
      });
    }
  };

  const getRuleTypeLabel = (type: string) => {
    switch (type) {
      case 'specific_pattern': return '特定パターン';
      case 'duplicate_pattern': return '重複パターン';
      case 'prefix_pattern': return 'プレフィックスパターン';
      case 'count_based': return '文字数ベース';
      default: return type;
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center p-8">読み込み中...</div>;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">パターンルール管理</h2>
      
      {rules.map((rule) => (
        <Card key={rule.id}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Badge variant="outline">優先度 {rule.priority}</Badge>
                {getRuleTypeLabel(rule.rule_type)}
              </CardTitle>
              <Switch
                checked={rule.is_available}
                onCheckedChange={(checked) => updateRuleAvailability(rule.id, checked)}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{rule.description}</p>
            
            {rule.rule_type === 'prefix_pattern' && (
              <div className="space-y-3">
                <h4 className="font-medium">プレフィックス価格設定:</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {['🎄', '🏢', '💎'].map((emoji) => (
                    <div key={emoji} className="flex items-center gap-2">
                      <span className="text-xl">{emoji}</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={rule.rule_config?.prefixes?.[emoji] || ''}
                        onChange={(e) => {
                          const price = parseFloat(e.target.value) || 0;
                          updatePrefixPrice(rule.id, emoji, price);
                        }}
                        placeholder="価格 (USD)"
                        className="w-32"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {rule.rule_type === 'specific_pattern' && (
              <div className="space-y-2">
                <h4 className="font-medium">基本価格: ${rule.price_usd}</h4>
                <div className="flex flex-wrap gap-2">
                  {rule.rule_config?.patterns?.map((pattern: string, index: number) => (
                    <Badge key={index} variant="secondary">{pattern}</Badge>
                  ))}
                </div>
              </div>
            )}

            {rule.rule_type === 'duplicate_pattern' && (
              <div className="space-y-2">
                <h4 className="font-medium">基本価格: ${rule.price_usd}</h4>
                <p className="text-sm">連続する同一絵文字に適用されます</p>
              </div>
            )}

            {rule.rule_type === 'count_based' && (
              <div className="space-y-2">
                <h4 className="font-medium">文字数別価格:</h4>
                <div className="grid grid-cols-5 gap-2 text-sm">
                  {Object.entries(rule.rule_config?.pricing || {}).map(([count, price]) => (
                    <div key={count} className="text-center">
                      <div className="font-medium">{count}文字</div>
                      <div className="text-muted-foreground">${String(price)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}