import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useTranslation } from '@/hooks/useTranslation';
import { AppHeader } from '@/components/layout/AppHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { BarChart3, TrendingUp, Users, Lock, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { cn } from '@/lib/utils';

type Period = '7d' | '30d' | '90d';

interface DailyStats {
  stat_date: string;
  access_count: number;
  unique_visitors: number;
  referrer_direct: number;
  referrer_search: number;
  referrer_social: number;
  referrer_other: number;
  device_mobile: number;
  device_tablet: number;
  device_desktop: number;
}

interface Fanmark {
  id: string;
  short_id: string;
  user_input_fanmark: string;
}

const COLORS = {
  primary: 'hsl(var(--primary))',
  accent: 'hsl(var(--accent))',
  muted: 'hsl(var(--muted))',
  chart1: 'hsl(var(--chart-1))',
  chart2: 'hsl(var(--chart-2))',
  chart3: 'hsl(var(--chart-3))',
  chart4: 'hsl(var(--chart-4))',
};

const PIE_COLORS = ['#65C3C8', '#F472B6', '#FBBF24', '#94A3B8'];

const Analytics = () => {
  const { user, loading: authLoading } = useAuth();
  const { profile } = useProfile();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [selectedFanmarkId, setSelectedFanmarkId] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('7d');

  const canAccessAnalytics = useMemo(() => {
    const planType = profile?.plan_type;
    return planType === 'creator' || planType === 'business' || planType === 'enterprise' || planType === 'admin';
  }, [profile?.plan_type]);

  // Fetch user's fanmarks
  const { data: fanmarks = [], isLoading: fanmarksLoading } = useQuery({
    queryKey: ['user-fanmarks-for-analytics', user?.id],
    enabled: !!user && canAccessAnalytics,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fanmark_licenses')
        .select(`
          fanmark_id,
          fanmarks (
            id,
            short_id,
            user_input_fanmark
          )
        `)
        .eq('user_id', user!.id)
        .in('status', ['active', 'grace']);

      if (error) throw error;

      return (data || [])
        .map((license) => license.fanmarks as unknown as Fanmark)
        .filter((f): f is Fanmark => f !== null);
    },
  });

  // Handle URL parameter for fanmark selection
  useEffect(() => {
    const fanmarkShortId = searchParams.get('fanmark');
    if (fanmarkShortId && fanmarks.length > 0) {
      const found = fanmarks.find((f) => f.short_id === fanmarkShortId);
      if (found) {
        setSelectedFanmarkId(found.id);
      }
    }
  }, [searchParams, fanmarks]);

  // Calculate date range
  const dateRange = useMemo(() => {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    const endDate = new Date();
    const startDate = subDays(endDate, days);
    return { startDate, endDate, days };
  }, [period]);

  // Fetch analytics data
  const { data: analyticsData, isLoading: analyticsLoading } = useQuery({
    queryKey: ['fanmark-analytics', selectedFanmarkId, period, user?.id],
    enabled: !!user && canAccessAnalytics,
    queryFn: async () => {
      let query = supabase
        .from('fanmark_access_daily_stats')
        .select('*')
        .gte('stat_date', format(dateRange.startDate, 'yyyy-MM-dd'))
        .lte('stat_date', format(dateRange.endDate, 'yyyy-MM-dd'))
        .order('stat_date', { ascending: true });

      if (selectedFanmarkId) {
        query = query.eq('fanmark_id', selectedFanmarkId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as DailyStats[];
    },
  });

  // Calculate aggregated stats
  const aggregatedStats = useMemo(() => {
    if (!analyticsData || analyticsData.length === 0) {
      return {
        totalAccess: 0,
        uniqueVisitors: 0,
        referrerBreakdown: [],
        deviceBreakdown: [],
        dailyStats: [],
        accessChange: 0,
        visitorChange: 0,
      };
    }

    const totalAccess = analyticsData.reduce((sum, d) => sum + (d.access_count || 0), 0);
    const uniqueVisitors = analyticsData.reduce((sum, d) => sum + (d.unique_visitors || 0), 0);

    const referrerDirect = analyticsData.reduce((sum, d) => sum + (d.referrer_direct || 0), 0);
    const referrerSearch = analyticsData.reduce((sum, d) => sum + (d.referrer_search || 0), 0);
    const referrerSocial = analyticsData.reduce((sum, d) => sum + (d.referrer_social || 0), 0);
    const referrerOther = analyticsData.reduce((sum, d) => sum + (d.referrer_other || 0), 0);
    const totalReferrer = referrerDirect + referrerSearch + referrerSocial + referrerOther;

    const deviceMobile = analyticsData.reduce((sum, d) => sum + (d.device_mobile || 0), 0);
    const deviceTablet = analyticsData.reduce((sum, d) => sum + (d.device_tablet || 0), 0);
    const deviceDesktop = analyticsData.reduce((sum, d) => sum + (d.device_desktop || 0), 0);
    const totalDevice = deviceMobile + deviceTablet + deviceDesktop;

    const referrerBreakdown = [
      { name: t('analytics.referrerDirect'), value: referrerDirect, percentage: totalReferrer > 0 ? Math.round((referrerDirect / totalReferrer) * 100) : 0 },
      { name: t('analytics.referrerSearch'), value: referrerSearch, percentage: totalReferrer > 0 ? Math.round((referrerSearch / totalReferrer) * 100) : 0 },
      { name: t('analytics.referrerSocial'), value: referrerSocial, percentage: totalReferrer > 0 ? Math.round((referrerSocial / totalReferrer) * 100) : 0 },
      { name: t('analytics.referrerOther'), value: referrerOther, percentage: totalReferrer > 0 ? Math.round((referrerOther / totalReferrer) * 100) : 0 },
    ].filter((item) => item.value > 0);

    const deviceBreakdown = [
      { name: t('analytics.deviceMobile'), value: deviceMobile, percentage: totalDevice > 0 ? Math.round((deviceMobile / totalDevice) * 100) : 0 },
      { name: t('analytics.deviceTablet'), value: deviceTablet, percentage: totalDevice > 0 ? Math.round((deviceTablet / totalDevice) * 100) : 0 },
      { name: t('analytics.deviceDesktop'), value: deviceDesktop, percentage: totalDevice > 0 ? Math.round((deviceDesktop / totalDevice) * 100) : 0 },
    ].filter((item) => item.value > 0);

    const dailyStats = analyticsData.map((d) => ({
      date: format(new Date(d.stat_date), 'MM/dd'),
      access_count: d.access_count || 0,
      unique_visitors: d.unique_visitors || 0,
    }));

    return {
      totalAccess,
      uniqueVisitors,
      referrerBreakdown,
      deviceBreakdown,
      dailyStats,
      accessChange: 0, // Would need previous period data
      visitorChange: 0,
    };
  }, [analyticsData, t]);

  // Upgrade prompt for non-business users
  if (!authLoading && user && !canAccessAnalytics) {
    return (
      <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
        <AppHeader className="border-border/30 bg-white/80" />
        <main className="flex-1 container mx-auto px-4 py-12 sm:px-6 lg:px-8">
          {/* Page Header */}
          <div className="space-y-3 text-center mb-8">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              {t('analytics.pageTitle')}
            </h1>
            <p className="mx-auto max-w-2xl text-sm sm:text-base text-muted-foreground">
              {t('analytics.pageSubtitle')}
            </p>
          </div>

          <div className="relative">
            {/* Blurred preview */}
            <div className="opacity-30 blur-sm pointer-events-none">
              <div className="grid gap-6 md:grid-cols-2 mb-6">
                <Card className="rounded-3xl border border-primary/20 bg-white shadow-[0_20px_45px_rgba(101,195,200,0.15)]">
                  <CardContent className="p-6">
                    <div className="h-24 bg-primary/5 rounded-2xl" />
                  </CardContent>
                </Card>
                <Card className="rounded-3xl border border-primary/20 bg-white shadow-[0_20px_45px_rgba(101,195,200,0.15)]">
                  <CardContent className="p-6">
                    <div className="h-24 bg-primary/5 rounded-2xl" />
                  </CardContent>
                </Card>
              </div>
              <Card className="rounded-3xl border border-primary/20 bg-white shadow-[0_20px_45px_rgba(101,195,200,0.15)] mb-6">
                <CardContent className="p-6">
                  <div className="h-64 bg-primary/5 rounded-2xl" />
                </CardContent>
              </Card>
              <div className="grid gap-6 md:grid-cols-2">
                <Card className="rounded-3xl border border-primary/20 bg-white shadow-[0_20px_45px_rgba(101,195,200,0.15)]">
                  <CardContent className="p-6">
                    <div className="h-48 bg-primary/5 rounded-2xl" />
                  </CardContent>
                </Card>
                <Card className="rounded-3xl border border-primary/20 bg-white shadow-[0_20px_45px_rgba(101,195,200,0.15)]">
                  <CardContent className="p-6">
                    <div className="h-48 bg-primary/5 rounded-2xl" />
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Upgrade overlay */}
            <div className="absolute inset-0 flex items-center justify-center">
              <Card className="max-w-md w-full rounded-3xl border border-primary/20 bg-white/95 shadow-[0_28px_70px_rgba(101,195,200,0.25)] backdrop-blur-md">
                <CardContent className="p-8 text-center space-y-6">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 shadow-lg">
                    <Lock className="h-8 w-8 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-foreground mb-2">
                      {t('analytics.businessRequired')}
                    </h2>
                    <p className="text-sm text-muted-foreground mb-4">
                      {t('analytics.upgradePrompt')}
                    </p>
                    <ul className="text-left text-sm text-muted-foreground space-y-2.5 mb-6">
                      <li className="flex items-center gap-2.5">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">✓</span>
                        {t('analytics.feature1')}
                      </li>
                      <li className="flex items-center gap-2.5">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">✓</span>
                        {t('analytics.feature2')}
                      </li>
                      <li className="flex items-center gap-2.5">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">✓</span>
                        {t('analytics.feature3')}
                      </li>
                      <li className="flex items-center gap-2.5">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">✓</span>
                        {t('analytics.feature4')}
                      </li>
                    </ul>
                  </div>
                  <Button
                    onClick={() => navigate('/plans')}
                    className="rounded-full px-8 shadow-lg transition-all duration-300 hover:shadow-xl hover:-translate-y-0.5"
                  >
                    {t('analytics.upgradeCta')}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </main>
        <SiteFooter className="border-primary/20 bg-white/80 backdrop-blur" />
      </div>
    );
  }

  const isLoading = authLoading || fanmarksLoading || analyticsLoading;

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <AppHeader className="border-border/30 bg-white/80" />
      <main className="flex-1 container mx-auto px-4 py-12 sm:px-6 lg:px-8">
        {/* Page Header */}
        <div className="space-y-3 text-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            {t('analytics.pageTitle')}
          </h1>
          <p className="mx-auto max-w-2xl text-sm sm:text-base text-muted-foreground">
            {t('analytics.pageSubtitle')}
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          <Select
            value={selectedFanmarkId || 'all'}
            onValueChange={(value) => setSelectedFanmarkId(value === 'all' ? null : value)}
          >
            <SelectTrigger className="w-[200px] rounded-2xl border-primary/20 bg-white">
              <SelectValue placeholder={t('analytics.selectFanmark')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('analytics.allFanmarks')}</SelectItem>
              {fanmarks.map((fanmark) => (
                <SelectItem key={fanmark.id} value={fanmark.id}>
                  {fanmark.user_input_fanmark} ({fanmark.short_id})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex gap-2">
            {(['7d', '30d', '90d'] as Period[]).map((p) => (
              <Button
                key={p}
                variant={period === p ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPeriod(p)}
                className={cn(
                  "rounded-full px-4",
                  period !== p && "border-primary/20 bg-white text-muted-foreground hover:bg-primary/5"
                )}
              >
                {t(`analytics.period${p === '7d' ? '7days' : p === '30d' ? '30days' : '90days'}`)}
              </Button>
            ))}
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-6 md:grid-cols-2 mb-6">
          <Card className="rounded-3xl border border-primary/20 bg-white shadow-[0_20px_45px_rgba(101,195,200,0.15)]">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">{t('analytics.totalAccess')}</p>
                  {isLoading ? (
                    <Skeleton className="h-10 w-24" />
                  ) : (
                    <p className="text-3xl font-bold text-foreground">
                      {aggregatedStats.totalAccess.toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                  <TrendingUp className="h-6 w-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-3xl border border-primary/20 bg-white shadow-[0_20px_45px_rgba(101,195,200,0.15)]">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">{t('analytics.uniqueVisitors')}</p>
                  {isLoading ? (
                    <Skeleton className="h-10 w-24" />
                  ) : (
                    <p className="text-3xl font-bold text-foreground">
                      {aggregatedStats.uniqueVisitors.toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10">
                  <Users className="h-6 w-6 text-accent" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Daily Trend Chart */}
        <Card className="rounded-3xl border border-primary/20 bg-white shadow-[0_20px_45px_rgba(101,195,200,0.15)] mb-6">
          <CardHeader className="px-6 pt-6 pb-4">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              {t('analytics.dailyTrend')}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            {isLoading ? (
              <Skeleton className="h-64 w-full rounded-2xl" />
            ) : aggregatedStats.dailyStats.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground rounded-2xl bg-primary/5">
                {t('analytics.noData')}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={aggregatedStats.dailyStats}>
                  <defs>
                    <linearGradient id="colorAccess" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-primary/10" />
                  <XAxis dataKey="date" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'white',
                      border: '1px solid hsl(var(--primary) / 0.2)',
                      borderRadius: '1rem',
                      boxShadow: '0 10px 30px rgba(101,195,200,0.15)',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="access_count"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorAccess)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Breakdown Charts */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Referrer Breakdown */}
          <Card className="rounded-3xl border border-primary/20 bg-white shadow-[0_20px_45px_rgba(101,195,200,0.15)]">
            <CardHeader className="px-6 pt-6 pb-4">
              <CardTitle className="text-lg font-semibold">{t('analytics.referrerBreakdown')}</CardTitle>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              {isLoading ? (
                <Skeleton className="h-48 w-full rounded-2xl" />
              ) : aggregatedStats.referrerBreakdown.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-muted-foreground rounded-2xl bg-primary/5">
                  {t('analytics.noData')}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={aggregatedStats.referrerBreakdown}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {aggregatedStats.referrerBreakdown.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Legend
                      formatter={(value, entry: any) => (
                        <span className="text-sm text-foreground">
                          {value} ({entry.payload.percentage}%)
                        </span>
                      )}
                    />
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Device Breakdown */}
          <Card className="rounded-3xl border border-primary/20 bg-white shadow-[0_20px_45px_rgba(101,195,200,0.15)]">
            <CardHeader className="px-6 pt-6 pb-4">
              <CardTitle className="text-lg font-semibold">{t('analytics.deviceBreakdown')}</CardTitle>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              {isLoading ? (
                <Skeleton className="h-48 w-full rounded-2xl" />
              ) : aggregatedStats.deviceBreakdown.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-muted-foreground rounded-2xl bg-primary/5">
                  {t('analytics.noData')}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={aggregatedStats.deviceBreakdown}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {aggregatedStats.deviceBreakdown.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Legend
                      formatter={(value, entry: any) => (
                        <span className="text-sm text-foreground">
                          {value} ({entry.payload.percentage}%)
                        </span>
                      )}
                    />
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
      <SiteFooter className="border-primary/20 bg-white/80 backdrop-blur" />
    </div>
  );
};

export default Analytics;
