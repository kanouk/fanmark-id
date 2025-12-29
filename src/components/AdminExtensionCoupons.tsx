import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Plus, RefreshCw, ToggleLeft, ToggleRight, Trash2, Eye } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useExtensionCouponAdmin, ExtensionCouponRow, ExtensionCouponUsageRow, CreateCouponValues } from '@/hooks/useExtensionCouponAdmin';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';

interface TierOption {
  tier_level: number;
  display_name: string;
  emoji_count_min: number | null;
  emoji_count_max: number | null;
  is_active?: boolean;
}

const DEFAULT_TIER_OPTIONS: TierOption[] = [
  { tier_level: 1, display_name: 'C', emoji_count_min: 4, emoji_count_max: 5 },
  { tier_level: 2, display_name: 'B', emoji_count_min: 3, emoji_count_max: 3 },
  { tier_level: 3, display_name: 'A', emoji_count_min: 2, emoji_count_max: 5 },
  { tier_level: 4, display_name: 'S', emoji_count_min: 1, emoji_count_max: 1 },
];

const MONTHS_OPTIONS = [
  { value: 1, label: '1ヶ月' },
  { value: 2, label: '2ヶ月' },
  { value: 3, label: '3ヶ月' },
  { value: 6, label: '6ヶ月' },
];

export const AdminExtensionCoupons = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { coupons, loading, error, refresh, createCoupon, toggleActive, deleteCoupon, fetchUsages } = useExtensionCouponAdmin();
  
  const [tierOptions, setTierOptions] = useState<TierOption[]>([]);
  const [tiersLoading, setTiersLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [usageDialogOpen, setUsageDialogOpen] = useState(false);
  const [selectedCouponForUsage, setSelectedCouponForUsage] = useState<ExtensionCouponRow | null>(null);
  const [usages, setUsages] = useState<ExtensionCouponUsageRow[]>([]);
  const [loadingUsages, setLoadingUsages] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const fetchTiers = async () => {
      setTiersLoading(true);
      try {
        const { data, error: tierError } = await supabase
          .from('fanmark_tiers')
          .select('tier_level, display_name, emoji_count_min, emoji_count_max, is_active')
          .order('tier_level', { ascending: true });

        if (tierError) throw tierError;

        const activeTiers = (data || []).filter((tier) => tier.is_active !== false);
        if (isMounted) {
          setTierOptions(activeTiers.length > 0 ? activeTiers : DEFAULT_TIER_OPTIONS);
        }
      } catch (err) {
        console.error('Failed to fetch fanmark tiers:', err);
        if (isMounted) {
          setTierOptions(DEFAULT_TIER_OPTIONS);
        }
      } finally {
        if (isMounted) {
          setTiersLoading(false);
        }
      }
    };

    fetchTiers();

    return () => {
      isMounted = false;
    };
  }, []);

  const sortedCoupons = useMemo(
    () =>
      [...coupons].sort((a, b) => {
        if (a.is_active === b.is_active) return a.created_at > b.created_at ? -1 : 1;
        return a.is_active ? -1 : 1;
      }),
    [coupons]
  );

  const tierLabelMap = useMemo(() => {
    const resolved = tierOptions.length > 0 ? tierOptions : DEFAULT_TIER_OPTIONS;
    return new Map(resolved.map((tier) => [tier.tier_level, tier.display_name]));
  }, [tierOptions]);

  const tierOptionLabels = useMemo(() => {
    const resolved = tierOptions.length > 0 ? tierOptions : DEFAULT_TIER_OPTIONS;
    return resolved.map((tier) => ({
      level: tier.tier_level,
      label: formatTierOptionLabel(tier),
    }));
  }, [tierOptions]);

  const handleCreate = async (values: CreateCouponValues) => {
    setSubmitting(true);
    const result = await createCoupon(values);
    setSubmitting(false);
    if (result.success) {
      toast({ title: t('admin.extensionCoupon.createSuccess'), description: `コード: ${result.code}` });
      setCreateOpen(false);
    } else {
      toast({ title: t('admin.extensionCoupon.createError'), description: result.error?.message, variant: 'destructive' });
    }
  };

  const handleToggleActive = async (id: string, active: boolean) => {
    const result = await toggleActive(id, active);
    toast({
      title: result.success ? t('admin.extensionCoupon.toggleSuccess') : t('admin.extensionCoupon.toggleError'),
      variant: result.success ? 'default' : 'destructive',
    });
  };

  const handleDelete = async (id: string) => {
    const result = await deleteCoupon(id);
    toast({
      title: result.success ? t('admin.extensionCoupon.deleteSuccess') : t('admin.extensionCoupon.deleteError'),
      variant: result.success ? 'default' : 'destructive',
    });
  };

  const handleViewUsages = async (coupon: ExtensionCouponRow) => {
    setSelectedCouponForUsage(coupon);
    setUsageDialogOpen(true);
    setLoadingUsages(true);
    const result = await fetchUsages(coupon.id);
    setLoadingUsages(false);
    if (result.success) {
      setUsages(result.data || []);
    } else {
      toast({ title: '使用履歴の取得に失敗しました', variant: 'destructive' });
    }
  };

  const formatTierLevels = (tiers: number[] | null) => {
    if (!tiers || tiers.length === 0) return '全ティア';
    return tiers
      .map((tier) => tierLabelMap.get(tier) || `T${tier}`)
      .join(', ');
  };

  return (
    <div className="space-y-6">
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="space-y-3 p-6 pb-4 sm:flex sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <div>
            <CardTitle>{t('admin.extensionCoupon.title')}</CardTitle>
            <CardDescription>{t('admin.extensionCoupon.description')}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-2 rounded-full border-primary/20" onClick={() => refresh()}>
              <RefreshCw className="h-4 w-4" />
              {t('common.reload')}
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Plus className="h-4 w-4" />
                  {t('admin.extensionCoupon.createButton')}
                </Button>
              </DialogTrigger>
              <CreateCouponDialog
                loading={submitting}
                tierOptions={tierOptionLabels}
                tiersLoading={tiersLoading}
                onSubmit={handleCreate}
                onClose={() => setCreateOpen(false)}
              />
            </Dialog>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-6 pt-0">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              読み込み中...
            </div>
          ) : error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-6 text-center text-sm text-destructive">
              データの読み込みに失敗しました
            </div>
          ) : sortedCoupons.length === 0 ? (
            <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-6 text-center text-sm text-muted-foreground">
              延長クーポンがありません
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-primary/15">
              <Table>
                <TableHeader className="bg-muted/60">
                  <TableRow>
                    <TableHead className="w-[140px]">コード</TableHead>
                    <TableHead>延長月数</TableHead>
                    <TableHead>対象ティア</TableHead>
                    <TableHead>ステータス</TableHead>
                    <TableHead>使用状況</TableHead>
                    <TableHead>有効期限</TableHead>
                    <TableHead className="w-[150px] text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedCoupons.map((coupon) => (
                    <TableRow key={coupon.id} className="text-sm">
                      <TableCell className="font-mono text-sm font-semibold">{coupon.code}</TableCell>
                      <TableCell>{coupon.months}ヶ月</TableCell>
                      <TableCell className="text-xs">{formatTierLevels(coupon.allowed_tier_levels)}</TableCell>
                      <TableCell>
                        <Badge variant={coupon.is_active ? 'default' : 'secondary'} className="rounded-full px-2 py-0.5">
                          {coupon.is_active ? '有効' : '無効'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {coupon.used_count} / {coupon.max_uses}
                      </TableCell>
                      <TableCell>
                        {coupon.expires_at ? format(new Date(coupon.expires_at), 'yyyy/MM/dd HH:mm') : '無期限'}
                      </TableCell>
                      <TableCell className="flex items-center justify-end gap-2">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleViewUsages(coupon)}
                          title="使用履歴を確認"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleToggleActive(coupon.id, !coupon.is_active)}
                          title={coupon.is_active ? '無効化' : '有効化'}
                        >
                          {coupon.is_active ? <ToggleRight className="h-4 w-4 text-primary" /> : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>クーポンを削除しますか？</AlertDialogTitle>
                              <AlertDialogDescription>
                                コード「{coupon.code}」を削除します。使用履歴も一緒に削除されます。
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(coupon.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                削除
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Usage History Dialog */}
      <Dialog open={usageDialogOpen} onOpenChange={setUsageDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>使用履歴: {selectedCouponForUsage?.code}</DialogTitle>
            <DialogDescription>
              このクーポンの使用履歴を表示しています
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto">
            {loadingUsages ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                読み込み中...
              </div>
            ) : usages.length === 0 ? (
              <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-6 text-center text-sm text-muted-foreground">
                まだ使用されていません
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ファンマーク</TableHead>
                    <TableHead>ユーザー</TableHead>
                    <TableHead>使用日時</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usages.map((usage) => (
                    <TableRow key={usage.id}>
                      <TableCell className="text-lg">{usage.fanmark_emoji || '-'}</TableCell>
                      <TableCell>{usage.user_display_name || usage.user_id.slice(0, 8)}</TableCell>
                      <TableCell>{format(new Date(usage.used_at), 'yyyy/MM/dd HH:mm')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

interface CreateCouponDialogProps {
  loading: boolean;
  tierOptions: { level: number; label: string }[];
  tiersLoading: boolean;
  onSubmit: (values: CreateCouponValues) => Promise<void>;
  onClose: () => void;
}

const CreateCouponDialog = ({ loading, tierOptions, tiersLoading, onSubmit, onClose }: CreateCouponDialogProps) => {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [months, setMonths] = useState<number>(1);
  const [selectedTiers, setSelectedTiers] = useState<number[]>([]);
  const [maxUses, setMaxUses] = useState('1');
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleTierChange = (tier: number, checked: boolean) => {
    if (checked) {
      setSelectedTiers([...selectedTiers, tier]);
    } else {
      setSelectedTiers(selectedTiers.filter(t => t !== tier));
    }
  };

  const handleSubmit = async () => {
    setError(null);
    if (Number.isNaN(Number(maxUses)) || Number(maxUses) <= 0) {
      setError('使用回数は1以上の数値を入力してください');
      return;
    }

    await onSubmit({
      code: code.trim() || undefined,
      months,
      allowedTierLevels: selectedTiers.length > 0 ? selectedTiers.sort((a, b) => a - b) : undefined,
      maxUses: Number(maxUses),
      expiresAt: expiresAt || undefined,
    });
  };

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{t('admin.extensionCoupon.dialog.createTitle')}</DialogTitle>
        <DialogDescription>{t('admin.extensionCoupon.dialog.createDescription')}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="coupon-code">クーポンコード（空欄で自動生成）</Label>
          <Input
            id="coupon-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="例: SPRING2025"
            maxLength={20}
          />
        </div>
        
        <div className="space-y-2">
          <Label>延長月数</Label>
          <Select value={String(months)} onValueChange={(v) => setMonths(Number(v))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>対象ティア（未選択で全ティア）</Label>
          <div className="flex flex-wrap gap-4">
            {(tierOptions.length > 0 ? tierOptions : DEFAULT_TIER_OPTIONS.map((tier) => ({
              level: tier.tier_level,
              label: formatTierOptionLabel(tier),
            }))).map((tier) => (
              <div key={tier.level} className="flex items-center space-x-2">
                <Checkbox
                  id={`tier-${tier.level}`}
                  checked={selectedTiers.includes(tier.level)}
                  onCheckedChange={(checked) => handleTierChange(tier.level, !!checked)}
                  disabled={tiersLoading}
                />
                <label htmlFor={`tier-${tier.level}`} className="text-sm">{tier.label}</label>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="max-uses">使用回数上限</Label>
          <Input
            id="max-uses"
            type="number"
            min={1}
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="expires-at">有効期限（空欄で無期限）</Label>
          <Input
            id="expires-at"
            type="datetime-local"
            value={expiresAt ? toLocalInputValue(expiresAt) : ''}
            onChange={(e) => setExpiresAt(e.target.value ? new Date(e.target.value).toISOString() : '')}
          />
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
      </div>
      <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onClose} disabled={loading} className="rounded-full">
          {t('common.cancel')}
        </Button>
        <Button onClick={handleSubmit} disabled={loading} className="rounded-full">
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          作成
        </Button>
      </DialogFooter>
    </DialogContent>
  );
};

function toLocalInputValue(isoString: string) {
  try {
    const date = new Date(isoString);
    const tzOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
  } catch {
    return '';
  }
}

function formatTierOptionLabel(tier: TierOption) {
  if (tier.display_name === 'A') {
    return 'Tier A (連続絵文字 2-5)';
  }
  const range = formatEmojiRange(tier.emoji_count_min, tier.emoji_count_max);
  return range ? `Tier ${tier.display_name} (${range})` : `Tier ${tier.display_name}`;
}

function formatEmojiRange(min: number | null, max: number | null) {
  if (min !== null && max !== null && min === max) {
    return `${min}絵文字`;
  }
  if (min !== null && max !== null) {
    return `${min}-${max}絵文字`;
  }
  if (min !== null) {
    return `${min}絵文字以上`;
  }
  if (max !== null) {
    return `${max}絵文字以下`;
  }
  return '';
}
