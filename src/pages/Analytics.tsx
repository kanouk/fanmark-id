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
import { BarChart3, TrendingUp, Users, Lock, ArrowUpRight, ArrowDownRight, Repeat, Trophy } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { cn } from '@/lib/utils';

type Period = '7d' | '30d' | '90d';

interface DailyStats {
  fanmark_id: string;
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
  access_type_profile: number;
  access_type_redirect: number;
  access_type_text: number;
  access_type_inactive: number;
}

interface Fanmark {
  id: string;
  short_id: string;
  user_input_fanmark: string;
  fanmark_name?: string;
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
const RANKING_COLORS = ['#65C3C8', '#F472B6', '#FBBF24', '#A78BFA', '#34D399', '#FB923C', '#60A5FA', '#F87171', '#A3E635', '#94A3B8'];

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
      // Get fanmarks with license_id
      const { data: licensesData, error: licensesError } = await supabase
        .from('fanmark_licenses')
        .select(`
          id,
          fanmark_id,
          fanmarks (
            id,
            short_id,
            user_input_fanmark
          )
        `)
        .eq('user_id', user!.id)
        .in('status', ['active', 'grace']);

      if (licensesError) throw licensesError;

      const licensesWithFanmarks = (licensesData || [])
        .map((license) => ({
          licenseId: license.id,
          fanmark: license.fanmarks as unknown as { id: string; short_id: string; user_input_fanmark: string } | null,
        }))
        .filter((item): item is { licenseId: string; fanmark: { id: string; short_id: string; user_input_fanmark: string } } => item.fanmark !== null);

      if (licensesWithFanmarks.length === 0) return [];

      // Get fanmark names from basic_configs using license_id
      const licenseIds = licensesWithFanmarks.map((item) => item.licenseId);
      const { data: configsData } = await supabase
        .from('fanmark_basic_configs')
        .select('license_id, fanmark_name')
        .in('license_id', licenseIds);

      const configsMap = new Map<string, string>();
      (configsData || []).forEach((config) => {
        if (config.fanmark_name) {
          configsMap.set(config.license_id, config.fanmark_name);
        }
      });

      return licensesWithFanmarks.map((item) => ({
        id: item.fanmark.id,
        short_id: item.fanmark.short_id,
        user_input_fanmark: item.fanmark.user_input_fanmark,
        fanmark_name: configsMap.get(item.licenseId) || null,
      })) as Fanmark[];
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
        accessTypeBreakdown: [],
        fanmarkRanking: [],
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

    // Access type breakdown
    const accessTypeProfile = analyticsData.reduce((sum, d) => sum + (d.access_type_profile || 0), 0);
    const accessTypeRedirect = analyticsData.reduce((sum, d) => sum + (d.access_type_redirect || 0), 0);
    const accessTypeText = analyticsData.reduce((sum, d) => sum + (d.access_type_text || 0), 0);
    const accessTypeInactive = analyticsData.reduce((sum, d) => sum + (d.access_type_inactive || 0), 0);
    const totalAccessType = accessTypeProfile + accessTypeRedirect + accessTypeText + accessTypeInactive;

    // Fanmark ranking (aggregate by fanmark_id)
    const fanmarkAccessMap = new Map<string, number>();
    analyticsData.forEach((d) => {
      if (d.fanmark_id) {
        const current = fanmarkAccessMap.get(d.fanmark_id) || 0;
        fanmarkAccessMap.set(d.fanmark_id, current + (d.access_count || 0));
      }
    });

    const fanmarkRanking = Array.from(fanmarkAccessMap.entries())
      .map(([fanmarkId, accessCount]) => {
        const fanmarkInfo = fanmarks.find((f) => f.id === fanmarkId);
        const emoji = fanmarkInfo?.user_input_fanmark || '';
        const fanmarkName = fanmarkInfo?.fanmark_name || '';
        const displayName = fanmarkName ? `${emoji} (${fanmarkName})` : emoji;
        return {
          fanmarkId,
          emoji,
          fanmarkName,
          name: displayName, // For chart tooltip
          shortId: fanmarkInfo?.short_id || '',
          value: accessCount,
          percentage: totalAccess > 0 ? Math.round((accessCount / totalAccess) * 100) : 0,
        };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

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

    const accessTypeBreakdown = [
      { name: t('analytics.accessTypeProfile'), value: accessTypeProfile, percentage: totalAccessType > 0 ? Math.round((accessTypeProfile / totalAccessType) * 100) : 0 },
      { name: t('analytics.accessTypeRedirect'), value: accessTypeRedirect, percentage: totalAccessType > 0 ? Math.round((accessTypeRedirect / totalAccessType) * 100) : 0 },
      { name: t('analytics.accessTypeText'), value: accessTypeText, percentage: totalAccessType > 0 ? Math.round((accessTypeText / totalAccessType) * 100) : 0 },
      { name: t('analytics.accessTypeInactive'), value: accessTypeInactive, percentage: totalAccessType > 0 ? Math.round((accessTypeInactive / totalAccessType) * 100) : 0 },
    ].filter((item) => item.value > 0);

    // Aggregate daily stats by date (sum across all fanmarks)
    const dailyStatsMap = new Map<string, { access_count: number; unique_visitors: number }>();
    analyticsData.forEach((d) => {
      const existing = dailyStatsMap.get(d.stat_date) || { access_count: 0, unique_visitors: 0 };
      dailyStatsMap.set(d.stat_date, {
        access_count: existing.access_count + (d.access_count || 0),
        unique_visitors: existing.unique_visitors + (d.unique_visitors || 0),
      });
    });

    const dailyStats = Array.from(dailyStatsMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, stats]) => ({
        date: format(new Date(date), 'MM/dd'),
        access_count: stats.access_count,
        unique_visitors: stats.unique_visitors,
      }));

    return {
      totalAccess,
      uniqueVisitors,
      referrerBreakdown,
      deviceBreakdown,
      accessTypeBreakdown,
      fanmarkRanking,
      dailyStats,
      accessChange: 0, // Would need previous period data
      visitorChange: 0,
    };
  }, [analyticsData, fanmarks, t]);

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
                  {fanmark.user_input_fanmark}{fanmark.fanmark_name ? ` (${fanmark.fanmark_name})` : ''}
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

        {/* Fanmark Ranking - only show when viewing all fanmarks */}
        {!selectedFanmarkId && aggregatedStats.fanmarkRanking.length > 0 && (
          <Card className="rounded-3xl border border-primary/20 bg-white shadow-[0_20px_45px_rgba(101,195,200,0.15)] mb-6">
            <CardHeader className="px-6 pt-6 pb-4">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <Trophy className="h-5 w-5 text-primary" />
                {t('analytics.fanmarkRanking')}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              {isLoading ? (
                <Skeleton className="h-48 w-full rounded-2xl" />
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie
                        data={aggregatedStats.fanmarkRanking}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={90}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {aggregatedStats.fanmarkRanking.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={RANKING_COLORS[index % RANKING_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number, _name: string, props: any) => [
                          `${value.toLocaleString()} (${props.payload.percentage}%)`,
                          props.payload.name,
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-col gap-2 max-h-[280px] overflow-y-auto">
                    {aggregatedStats.fanmarkRanking.map((item, index) => (
                      <div
                        key={item.fanmarkId}
                        className="flex items-center justify-between p-3 rounded-xl bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer"
                        onClick={() => setSelectedFanmarkId(item.fanmarkId)}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold text-white shrink-0" style={{ backgroundColor: RANKING_COLORS[index % RANKING_COLORS.length] }}>
                            {index + 1}
                          </div>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-base shrink-0">{item.emoji}</span>
                            {item.fanmarkName && (
                              <span className="text-sm text-muted-foreground truncate">({item.fanmarkName})</span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0 ml-2">
                          <span className="text-sm font-bold text-foreground">{item.value.toLocaleString()}</span>
                          <span className="text-xs text-muted-foreground ml-1">({item.percentage}%)</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Access Type Breakdown */}
        <Card className="rounded-3xl border border-primary/20 bg-white shadow-[0_20px_45px_rgba(101,195,200,0.15)] mb-6">
          <CardHeader className="px-6 pt-6 pb-4">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Repeat className="h-5 w-5 text-primary" />
              {t('analytics.accessTypeBreakdown')}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            {isLoading ? (
              <Skeleton className="h-48 w-full rounded-2xl" />
            ) : aggregatedStats.accessTypeBreakdown.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground rounded-2xl bg-primary/5">
                {t('analytics.noAccessTypeData')}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={aggregatedStats.accessTypeBreakdown}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {aggregatedStats.accessTypeBreakdown.map((_, index) => (
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
                <div className="flex flex-col justify-center gap-3">
                  {aggregatedStats.accessTypeBreakdown.map((item, index) => (
                    <div key={item.name} className="flex items-center justify-between p-3 rounded-xl bg-primary/5">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                        />
                        <span className="text-sm font-medium text-foreground">{item.name}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-bold text-foreground">{item.value.toLocaleString()}</span>
                        <span className="text-xs text-muted-foreground ml-1">({item.percentage}%)</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
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
