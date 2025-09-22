import { useState, useEffect, useCallback, useMemo, type CSSProperties, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useTranslation } from '@/hooks/useTranslation';
import { Search, Eye, Edit, Settings, Trash2, ExternalLink, Copy, Undo2, GripVertical } from 'lucide-react';
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FiTarget, FiLayers, FiCompass, FiStar, FiCheckCircle, FiMoon, FiFileText, FiUser, FiLink } from 'react-icons/fi';
import { FanmarkAcquisition } from './FanmarkAcquisition';
import { supabase } from '@/integrations/supabase/client';

interface Fanmark {
  id: string;
  emoji_combination: string;
  display_name: string | null;
  short_id: string;
  access_type: string;
  redirect_url: string | null;
  profile_text: string | null;
  is_premium: boolean;
  is_transferable: boolean;
  status: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  normalized_emoji: string;
  display_order: number | null;
}

interface Profile {
  id: string;
  username: string;
  display_name: string;
  bio: string;
}

interface DashboardLocationState {
  prefillFanmark?: string;
}

type TranslationFn = (key: string, vars?: Record<string, string | number>) => string;

export const FanmarkDashboard = () => {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { toast } = useToast();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const fanmarkLimit = 10; // Default limit

  const [fanmarks, setFanmarks] = useState<Fanmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('my-fanmarks');
  const [prefilledEmoji, setPrefilledEmoji] = useState<string | undefined>();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.matchMedia('(min-width: 1024px)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    const listener = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    setIsDesktop(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    }

    mediaQuery.addListener(listener);
    return () => {
      mediaQuery.removeListener(listener);
    };
  }, []);

  const handleOpenSettings = (fanmarkId: string) => {
    navigate(`/fanmarks/${fanmarkId}/settings`);
  };

  useEffect(() => {
    const state = (location.state as DashboardLocationState | null)?.prefillFanmark;
    let nextPrefill = state;

    if (!nextPrefill) {
      try {
        const stored = localStorage.getItem('fanmark.prefill');
        if (stored) {
          nextPrefill = stored;
          localStorage.removeItem('fanmark.prefill');
        }
      } catch (error) {
        console.warn('Failed to access localStorage for fanmark prefill:', error);
      }
    }

    if (nextPrefill) {
      setPrefilledEmoji(nextPrefill);
      setActiveTab('acquisition');
      if (state) {
        navigate(location.pathname, { replace: true });
      }
    }
  }, [location, navigate]);

  const fetchFanmarks = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from<Fanmark>('fanmarks')
        .select('*')
        .eq('user_id', user?.id)
        .order('display_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false });

      if (error) throw error;
      const normalizedFanmarks = (data ?? []).map((fanmark, index) => ({
        ...fanmark,
        display_order: fanmark.display_order ?? index,
      }));

      setFanmarks(normalizedFanmarks);
    } catch (error) {
      console.error('Error fetching fanmarks:', error);
      toast({
        title: t('dashboard.errorLoadingData'),
        description: t('dashboard.failedToLoadFanmarks'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [t, toast, user?.id]);

  useEffect(() => {
    if (!user) return;
    fetchFanmarks();
  }, [fetchFanmarks, user]);

  const getAccessTypeBadge = (accessType: string) => {
    let icon = <FiLayers className="h-3.5 w-3.5" />;
    let className = 'border-gray-200/60 bg-gray-50 text-gray-600 shadow-sm';
    let label = t('dashboard.accessTypes.inactive');

    if (accessType === 'profile') {
      icon = <FiUser className="h-3.5 w-3.5" />;
      className = 'border-sky-200/60 bg-sky-50 text-sky-600 shadow-sm';
      label = t('dashboard.accessTypes.profile');
    } else if (accessType === 'redirect') {
      icon = <FiLink className="h-3.5 w-3.5" />;
      className = 'border-emerald-200/60 bg-emerald-50 text-emerald-600 shadow-sm';
      label = t('dashboard.accessTypes.redirect');
    } else if (accessType === 'text') {
      icon = <FiFileText className="h-3.5 w-3.5" />;
      className = 'border-amber-200/60 bg-amber-50 text-amber-600 shadow-sm';
      label = t('dashboard.accessTypes.text');
    }

    return (
      <Badge className={`${className} inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide`}>
        {icon}
        <span>{label}</span>
      </Badge>
    );
  };

  const filteredFanmarks = fanmarks;
  const fanmarkIds = useMemo(() => filteredFanmarks.map((fanmark) => fanmark.id), [filteredFanmarks]);

  const handleRequireAuth = (emoji: string) => {
    try {
      localStorage.setItem('fanmark.prefill', emoji);
    } catch (error) {
      console.warn('Failed to persist fanmark prefill before auth redirect:', error);
    }
    navigate('/auth', { state: { prefillFanmark: emoji } });
  };

  const persistFanmarkOrder = useCallback(async (orderedFanmarks: Fanmark[]) => {
    if (!user) return;
    try {
      await supabase
        .from('fanmarks')
        .upsert(
          orderedFanmarks.map((fanmark, index) => ({
            id: fanmark.id,
            display_order: index,
          }))
        );
    } catch (error) {
      console.error('Error updating fanmark order:', error);
      toast({
        title: t('dashboard.reorderErrorTitle'),
        description: t('dashboard.reorderErrorDescription'),
        variant: 'destructive',
      });
      fetchFanmarks();
    }
  }, [fetchFanmarks, t, toast, user]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    setFanmarks((prevFanmarks) => {
      const oldIndex = prevFanmarks.findIndex((fanmark) => fanmark.id === active.id);
      const newIndex = prevFanmarks.findIndex((fanmark) => fanmark.id === over.id);

      if (oldIndex === -1 || newIndex === -1) {
        return prevFanmarks;
      }

      const reordered = arrayMove(prevFanmarks, oldIndex, newIndex).map((fanmark, index) => ({
        ...fanmark,
        display_order: index,
      }));

      void persistFanmarkOrder(reordered);
      return reordered;
    });
  }, [persistFanmarkOrder]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
      </div>
    );
  }

  return (
    <section className="w-full bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <div className="container mx-auto px-4 py-12 space-y-10">
        <div className="space-y-3 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            {t('dashboard.title')}
          </h1>
          <p className="mx-auto max-w-2xl text-sm sm:text-base text-muted-foreground">
            {t('dashboard.subtitle')}
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="relative overflow-hidden rounded-3xl border border-primary/25 bg-background/85 shadow-[0_15px_40px_rgba(101,195,200,0.16)] backdrop-blur">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">
                    {t('dashboard.stats.totalFanmarks')}
                  </p>
                  <div className="flex items-baseline gap-3">
                    <span className="text-3xl font-bold text-primary">{fanmarks.length}</span>
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t('dashboard.stats.limitLabel')}: {fanmarkLimit}
                    </span>
                  </div>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <FiTarget className="h-6 w-6" />
                </div>
              </div>
              <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden mt-4">
                <div 
                  className="bg-primary h-2.5 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min((fanmarks.length / fanmarkLimit) * 100, 100)}%` }}
                />
              </div>
            </CardContent>
          </Card>

          {/* Additional stats cards... */}
        </div>

        {/* Main Content */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
          <TabsList className="grid w-full grid-cols-2 gap-2 rounded-full border border-primary/20 bg-background/70 p-2 backdrop-blur">
            <TabsTrigger 
              value="my-fanmarks"
              className="gap-2 rounded-full py-3 px-4 text-base font-medium transition-all duration-200 data-[state=active]:bg-primary/15 data-[state=active]:text-foreground data-[state=active]:shadow-lg"
            >
              <FiLayers className="h-5 w-5" />
              {t('dashboard.tabs.myFanmarks')}
            </TabsTrigger>
            <TabsTrigger 
              value="acquisition"
              className="gap-2 rounded-full py-3 px-4 text-base font-medium transition-all duration-200 data-[state=active]:bg-primary/15 data-[state=active]:text-foreground data-[state=active]:shadow-lg"
            >
              <FiCompass className="h-5 w-5" />
              {t('dashboard.tabs.getFanma')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="my-fanmarks" className="space-y-6">
            {/* Fanmarks List */}
            <Card className="rounded-3xl border border-primary/15 bg-background/90 shadow-[0_20px_45px_rgba(101,195,200,0.14)] backdrop-blur">
              <CardHeader className="px-6 pt-6 pb-2">
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <FiLayers className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-foreground">
                        {t('dashboard.yourFanmarks')}
                      </h2>
                      <p className="text-sm text-muted-foreground mt-1">
                        {t('dashboard.manageFanmarks')}
                      </p>
                    </div>
                  </div>
                </CardTitle>
              </CardHeader>

              <CardContent className="space-y-8 px-6 pb-6">
                {filteredFanmarks.length === 0 ? (
                  <div className="py-14 text-center">
                    <div className="space-y-6">
                      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <FiLayers className="h-8 w-8" />
                      </div>
                      <h3 className="text-xl font-semibold text-foreground">
                        {t('dashboard.noFanmarksYet')}
                      </h3>
                      <p className="mx-auto max-w-md text-muted-foreground">
                        {t('dashboard.getStarted')}
                      </p>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            size="lg"
                            className="mt-6 gap-2 rounded-full bg-primary text-primary-foreground shadow-lg transition-all duration-300 hover:shadow-xl hover:scale-105"
                          >
                            <FiStar className="h-5 w-5" />
                            {t('dashboard.createFirstFanma')}
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                          <FanmarkAcquisition
                            prefilledEmoji={prefilledEmoji}
                            fanmarkLimit={fanmarkLimit}
                            currentCount={fanmarks.length}
                            onObtain={() => {
                              setPrefilledEmoji(undefined);
                              fetchFanmarks();
                              setActiveTab('my-fanmarks');
                            }}
                            onRequireAuth={handleRequireAuth}
                          />
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                ) : (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <div className="space-y-6">
                      {isDesktop ? (
                        <SortableContext items={fanmarkIds} strategy={verticalListSortingStrategy}>
                          <div className="overflow-x-auto">
                            <table className="w-full">
                              <thead>
                                <tr className="bg-muted/50">
                                  <th className="w-12 p-3 text-left text-muted-foreground font-semibold"></th>
                                  <th className="text-muted-foreground font-semibold text-left p-3">{t('dashboard.fanmark')}</th>
                                  <th className="text-muted-foreground font-semibold text-left p-3">{t('dashboard.displayName')}</th>
                                  <th className="text-muted-foreground font-semibold text-left p-3">{t('dashboard.accessType')}</th>
                                  <th className="text-muted-foreground font-semibold text-left p-3">{t('dashboard.status')}</th>
                                  <th className="text-left p-3 text-muted-foreground font-semibold"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {filteredFanmarks.map((fanmark) => (
                                  <SortableFanmarkTableRow
                                    key={fanmark.id}
                                    fanmark={fanmark}
                                    t={t}
                                    getAccessTypeBadge={getAccessTypeBadge}
                                    onOpenSettings={handleOpenSettings}
                                  />
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </SortableContext>
                      ) : (
                        <SortableContext items={fanmarkIds} strategy={verticalListSortingStrategy}>
                          <div className="space-y-4">
                            {filteredFanmarks.map((fanmark) => (
                              <SortableFanmarkCard
                                key={fanmark.id}
                                fanmark={fanmark}
                                t={t}
                                getAccessTypeBadge={getAccessTypeBadge}
                                onOpenSettings={handleOpenSettings}
                              />
                            ))}
                          </div>
                        </SortableContext>
                      )}
                    </div>
                  </DndContext>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="acquisition" className="space-y-6">
            <Card className="overflow-hidden rounded-3xl border border-primary/20 bg-background/90 shadow-[0_20px_45px_rgba(101,195,200,0.14)] backdrop-blur">
              <CardContent className="space-y-6 p-6 sm:p-8">
                <div className="space-y-3 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <FiCompass className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground">
                    {t('dashboard.getFanmaTitle')}
                  </h3>
                  <p className="mx-auto max-w-xl text-sm text-muted-foreground">
                    {t('dashboard.getFanmaDescription')}
                  </p>
                </div>
                <FanmarkAcquisition
                  prefilledEmoji={prefilledEmoji}
                  fanmarkLimit={fanmarkLimit}
                  currentCount={fanmarks.length}
                  onObtain={() => {
                    setPrefilledEmoji(undefined);
                    fetchFanmarks();
                    setActiveTab('my-fanmarks');
                  }}
                  onRequireAuth={handleRequireAuth}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

      </div>
    </section>
  );
};

interface SortableFanmarkTableRowProps {
  fanmark: Fanmark;
  t: TranslationFn;
  getAccessTypeBadge: (accessType: string) => ReactNode;
  onOpenSettings: (fanmarkId: string) => void;
}

const SortableFanmarkTableRow = ({ fanmark, t, getAccessTypeBadge, onOpenSettings }: SortableFanmarkTableRowProps) => {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: fanmark.id,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`border-b transition-colors ${isDragging ? 'bg-primary/10 shadow-lg' : 'hover:bg-muted/30'}`}
    >
      <td className="w-12 px-3 py-4 align-middle">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-transparent text-muted-foreground transition hover:border-primary/30 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 cursor-grab active:cursor-grabbing"
          aria-label={t('dashboard.reorderHandleLabel')}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </td>
      <td className="px-4 py-4">
        <div className="flex items-center gap-3">
          <span className="text-4xl tracking-[0.25em] leading-none">{fanmark.emoji_combination}</span>
          {fanmark.is_premium && (
            <Badge variant="secondary" className="gap-1 border border-primary/30 bg-primary/10 text-primary">
              <FiStar className="h-3 w-3" /> <span className="hidden xl:inline">{t('dashboard.premiumLabel')}</span>
            </Badge>
          )}
        </div>
        <div className="mt-2 text-xs font-medium tracking-wide text-muted-foreground/70">
          {fanmark.short_id}
        </div>
      </td>
      <td className="px-4 py-4">
        <div>
          <div className="font-semibold text-foreground">{fanmark.display_name}</div>
          {fanmark.access_type === 'redirect' && fanmark.redirect_url && (
            <div className="mt-1 flex max-w-xs items-center gap-1 truncate text-sm text-muted-foreground">
              <ExternalLink className="h-3 w-3" />
              {fanmark.redirect_url}
            </div>
          )}
          {fanmark.access_type === 'text' && fanmark.profile_text && (
            <div className="mt-1 flex max-w-xs items-center gap-1 truncate text-sm text-muted-foreground">
              <FiFileText className="h-3 w-3" /> {fanmark.profile_text}
            </div>
          )}
        </div>
      </td>
      <td className="px-4 py-4 align-middle">{getAccessTypeBadge(fanmark.access_type)}</td>
      <td className="px-4 py-4 align-middle">
        <Badge
          className={`${fanmark.status === 'active' ? 'border-emerald-200/60 bg-emerald-50 text-emerald-600' : 'border-rose-200/60 bg-rose-50 text-rose-600'} inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide shadow-sm`}
        >
          {fanmark.status === 'active' ? (
            <>
              <FiCheckCircle className="h-3.5 w-3.5" />
              <span>{t('dashboard.statusActive')}</span>
            </>
          ) : (
            <>
              <FiMoon className="h-3.5 w-3.5" />
              <span>{t('dashboard.statusInactive')}</span>
            </>
          )}
        </Badge>
      </td>
      <td className="px-4 py-4 align-middle">
        <div className="flex items-center gap-1.5">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 hover:bg-secondary"
                  aria-label={t('dashboard.actionsReturn')}
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('dashboard.actionsReturn')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 hover:bg-secondary"
                  aria-label={t('dashboard.actionsCopyLink')}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('dashboard.actionsCopyLink')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 hover:bg-secondary"
                  onClick={() => onOpenSettings(fanmark.id)}
                  aria-label={t('dashboard.actionsSettings')}
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('dashboard.actionsSettings')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </td>
    </tr>
  );
};

interface SortableFanmarkCardProps {
  fanmark: Fanmark;
  t: TranslationFn;
  getAccessTypeBadge: (accessType: string) => ReactNode;
  onOpenSettings: (fanmarkId: string) => void;
}

const SortableFanmarkCard = ({ fanmark, t, getAccessTypeBadge, onOpenSettings }: SortableFanmarkCardProps) => {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: fanmark.id,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={`rounded-3xl border border-primary/10 bg-background/80 transition-colors ${isDragging ? 'border-primary/40 bg-primary/5 shadow-lg' : 'hover:border-primary/20'}`}
    >
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              className="mt-1 flex h-9 w-9 items-center justify-center rounded-full border border-transparent text-muted-foreground transition hover:border-primary/30 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 cursor-grab active:cursor-grabbing"
              aria-label={t('dashboard.reorderHandleLabel')}
            >
              <GripVertical className="h-4 w-4" />
            </button>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <span className="text-4xl tracking-[0.2em] leading-none">{fanmark.emoji_combination}</span>
                {fanmark.is_premium && (
                  <Badge variant="secondary" className="border border-primary/30 bg-primary/10 text-primary">
                    <FiStar className="h-3 w-3" />
                  </Badge>
                )}
              </div>
              <div className="space-y-1">
                <h3 className="font-semibold text-foreground">{fanmark.display_name}</h3>
                <div className="text-xs font-medium tracking-wide text-muted-foreground/70">{fanmark.short_id}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          {getAccessTypeBadge(fanmark.access_type)}
          <Badge
            className={`${fanmark.status === 'active' ? 'border-emerald-200/60 bg-emerald-50 text-emerald-600' : 'border-rose-200/60 bg-rose-50 text-rose-600'} inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide shadow-sm`}
          >
            {fanmark.status === 'active' ? (
              <>
                <FiCheckCircle className="h-3.5 w-3.5" />
                <span>{t('dashboard.statusActive')}</span>
              </>
            ) : (
              <>
                <FiMoon className="h-3.5 w-3.5" />
                <span>{t('dashboard.statusInactive')}</span>
              </>
            )}
          </Badge>
        </div>

        {(fanmark.redirect_url || fanmark.profile_text) && (
          <div className="rounded bg-muted/30 p-3 text-sm text-muted-foreground">
            {fanmark.access_type === 'redirect' && fanmark.redirect_url && (
              <div className="flex items-center gap-1">
                <ExternalLink className="h-3 w-3" />
                <span className="truncate">{fanmark.redirect_url}</span>
              </div>
            )}
            {fanmark.access_type === 'text' && fanmark.profile_text && (
              <div className="mt-1 flex items-start gap-1">
                <FiFileText className="mt-0.5 h-3 w-3" />
                <span className="line-clamp-2">{fanmark.profile_text}</span>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9 w-9 p-0 hover:bg-secondary"
                  aria-label={t('dashboard.actionsReturn')}
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('dashboard.actionsReturn')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9 w-9 p-0 hover:bg-secondary"
                  aria-label={t('dashboard.actionsCopyLink')}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('dashboard.actionsCopyLink')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9 w-9 p-0 hover:bg-secondary"
                  onClick={() => onOpenSettings(fanmark.id)}
                  aria-label={t('dashboard.actionsSettings')}
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('dashboard.actionsSettings')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </CardContent>
    </Card>
  );
};
