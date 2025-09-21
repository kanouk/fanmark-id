import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useTranslation } from '@/hooks/useTranslation';
import { Search, Eye, Edit, Settings, Trash2, ExternalLink } from 'lucide-react';
import { FiTarget, FiLayers, FiCompass, FiStar, FiCheckCircle, FiMoon, FiFileText, FiUser, FiLink } from 'react-icons/fi';
import { FanmarkAcquisition } from './FanmarkAcquisition';
import { FanmarkSettings } from './FanmarkSettings';
import { FanmarkSearchWithRegistration } from './FanmarkSearchWithRegistration';
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
}

interface Profile {
  id: string;
  username: string;
  display_name: string;
  bio: string;
}

export const FanmarkDashboard = () => {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { toast } = useToast();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fanmarkLimit = 10; // Default limit

  const [fanmarks, setFanmarks] = useState<Fanmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('my-fanmarks');
  const [settingsFanmark, setSettingsFanmark] = useState<Fanmark | null>(null);

  useEffect(() => {
    if (user) {
      fetchFanmarks();
    }
  }, [user]);

  const fetchFanmarks = async () => {
    try {
      const { data, error } = await supabase
        .from('fanmarks')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setFanmarks((data || []) as any);
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
  };

  const getAccessTypeBadge = (accessType: string) => {
    let icon = <FiLayers className="h-3.5 w-3.5" />;
    let className = 'border-gray-200 bg-gray-100 text-gray-700';
    let label = t('dashboard.accessTypes.inactive');

    if (accessType === 'profile') {
      icon = <FiUser className="h-3.5 w-3.5" />;
      className = 'border-blue-200 bg-blue-100/80 text-blue-800';
      label = t('dashboard.accessTypes.profile');
    } else if (accessType === 'redirect') {
      icon = <FiLink className="h-3.5 w-3.5" />;
      className = 'border-green-200 bg-green-100/80 text-green-800';
      label = t('dashboard.accessTypes.redirect');
    } else if (accessType === 'text') {
      icon = <FiFileText className="h-3.5 w-3.5" />;
      className = 'border-yellow-200 bg-yellow-100/80 text-yellow-800';
      label = t('dashboard.accessTypes.text');
    }

    return (
      <Badge variant="outline" className={`${className} flex items-center gap-2`}>
        {icon}
        {label}
      </Badge>
    );
  };

  const filteredFanmarks = fanmarks;

  const handleSignupPrompt = () => {
    navigate('/auth');
  };

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

              <CardContent className="space-y-4 px-6 pb-6">
                {filteredFanmarks.length === 0 ? (
                  <div className="py-14 text-center">
                    <div className="space-y-4">
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
                          <FanmarkSearchWithRegistration onSignupPrompt={handleSignupPrompt} />
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                ) : (
                    <div className="space-y-4">
                    {/* Desktop Table View */}
                    <div className="hidden lg:block">
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="bg-muted/50">
                              <th className="text-muted-foreground font-semibold text-left p-3">{t('dashboard.emoji')}</th>
                              <th className="text-muted-foreground font-semibold text-left p-3">{t('dashboard.displayName')}</th>
                              <th className="text-muted-foreground font-semibold text-left p-3">{t('dashboard.accessType')}</th>
                              <th className="text-muted-foreground font-semibold text-left p-3">{t('dashboard.shortId')}</th>
                              <th className="text-muted-foreground font-semibold text-left p-3">{t('dashboard.status')}</th>
                              <th className="text-muted-foreground font-semibold text-left p-3">{t('dashboard.actions')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredFanmarks.map((fanmark) => (
                              <tr key={fanmark.id} className="border-b transition-colors hover:bg-muted/30">
                                <td className="px-4 py-4">
                                  <div className="flex items-center gap-2">
                                    <span className="text-2xl">{fanmark.emoji_combination}</span>
                                    {fanmark.is_premium && (
                                      <Badge variant="secondary" className="gap-1 border border-primary/30 bg-primary/10 text-primary">
                                        <FiStar className="h-3 w-3" /> <span className="hidden xl:inline">{t('dashboard.premiumLabel')}</span>
                                      </Badge>
                                    )}
                                  </div>
                                </td>
                                <td className="px-4 py-4">
                                  <div>
                                    <div className="font-semibold text-foreground">{fanmark.display_name}</div>
                                    {fanmark.access_type === 'redirect' && fanmark.redirect_url && (
                                      <div className="text-sm text-muted-foreground truncate max-w-xs flex items-center gap-1">
                                        <ExternalLink className="h-3 w-3" />
                                        {fanmark.redirect_url}
                                      </div>
                                    )}
                                    {fanmark.access_type === 'text' && fanmark.profile_text && (
                                      <div className="flex max-w-xs items-center gap-1 truncate text-sm text-muted-foreground">
                                        <FiFileText className="h-3 w-3" /> {fanmark.profile_text}
                                      </div>
                                    )}
                                  </div>
                                </td>
                                <td className="px-4 py-4">
                                  {getAccessTypeBadge(fanmark.access_type)}
                                </td>
                                <td className="px-4 py-4">
                                  <code className="bg-muted text-muted-foreground font-mono text-sm px-2 py-1 rounded">
                                    {fanmark.short_id}
                                  </code>
                                </td>
                                <td className="px-4 py-4">
                                  <Badge 
                                    variant="outline"
                                    className={`${fanmark.status === 'active' ? 'border-green-200 bg-green-100/70 text-green-800' : 'border-red-200 bg-red-100/70 text-red-800'} flex items-center gap-2`}
                                  >
                                    {fanmark.status === 'active' ? (
                                      <>
                                        <FiCheckCircle className="h-4 w-4" />
                                        {t('dashboard.statusActive')}
                                      </>
                                    ) : (
                                      <>
                                        <FiMoon className="h-4 w-4" />
                                        {t('dashboard.statusInactive')}
                                      </>
                                    )}
                                  </Badge>
                                </td>
                                <td className="px-4 py-4">
                                  <div className="flex gap-1">
                                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 hover:bg-blue-100">
                                      <Eye className="h-4 w-4" />
                                    </Button>
                                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 hover:bg-yellow-100">
                                      <Edit className="h-4 w-4" />
                                    </Button>
                                    <Button 
                                      size="sm" 
                                      variant="ghost" 
                                      className="h-8 w-8 p-0 hover:bg-secondary"
                                      onClick={() => setSettingsFanmark(fanmark)}
                                    >
                                      <Settings className="h-4 w-4" />
                                    </Button>
                                    <Button 
                                      size="sm" 
                                      variant="ghost" 
                                      className="h-8 w-8 p-0 hover:bg-red-100"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Mobile Card View */}
                    <div className="lg:hidden space-y-4">
                      {filteredFanmarks.map((fanmark) => (
                        <Card key={fanmark.id} className="rounded-3xl border border-primary/10 bg-background/80 transition-colors hover:border-primary/20">
                          <CardContent className="p-5">
                            <div className="space-y-3">
                              <div className="flex items-start justify-between">
                                <div className="flex items-center gap-3">
                                  <span className="text-2xl">{fanmark.emoji_combination}</span>
                                  <div>
                                    <h3 className="font-semibold text-foreground">{fanmark.display_name}</h3>
                                    <code className="text-xs text-muted-foreground">{fanmark.short_id}</code>
                                  </div>
                                </div>
                                {fanmark.is_premium && (
                                  <Badge variant="secondary" className="border border-primary/30 bg-primary/10 text-primary">
                                    <FiStar className="h-3 w-3" />
                                  </Badge>
                                )}
                              </div>
                              
                              <div className="flex items-center justify-between">
                                {getAccessTypeBadge(fanmark.access_type)}
                                <Badge 
                                  variant="outline"
                                  className={`${fanmark.status === 'active' ? 'border-green-200 bg-green-100/70 text-green-800' : 'border-red-200 bg-red-100/70 text-red-800'} flex items-center gap-2`}
                                >
                                  {fanmark.status === 'active' ? (
                                    <>
                                      <FiCheckCircle className="h-4 w-4" />
                                      {t('dashboard.statusActive')}
                                    </>
                                  ) : (
                                    <>
                                      <FiMoon className="h-4 w-4" />
                                      {t('dashboard.statusInactive')}
                                    </>
                                  )}
                                </Badge>
                              </div>

                              {(fanmark.redirect_url || fanmark.profile_text) && (
                                <div className="text-sm text-muted-foreground mb-3 p-2 bg-muted/30 rounded">
                                  {fanmark.access_type === 'redirect' && fanmark.redirect_url && (
                                    <div className="flex items-center gap-1">
                                      <ExternalLink className="h-3 w-3" />
                                      <span className="truncate">{fanmark.redirect_url}</span>
                                    </div>
                                  )}
                                  {fanmark.access_type === 'text' && fanmark.profile_text && (
                                    <div className="flex items-start gap-1">
                                      <FiFileText className="mt-0.5 h-3 w-3" />
                                      <span className="line-clamp-2">{fanmark.profile_text}</span>
                                    </div>
                                  )}
                                </div>
                              )}

                              <div className="flex gap-2">
                                <Button size="sm" variant="outline" className="flex-1 border-blue-200 text-blue-600 hover:bg-blue-50">
                                  <Eye className="mr-1 h-4 w-4" />
                                  {t('dashboard.view')}
                                </Button>
                                <Button size="sm" variant="outline" className="flex-1 border-yellow-200 text-yellow-600 hover:bg-yellow-50">
                                  <Edit className="mr-1 h-4 w-4" />
                                  {t('dashboard.edit')}
                                </Button>
                                <Button 
                                  size="sm" 
                                  variant="outline" 
                                  className="flex-1 border-gray-200 text-gray-600 hover:bg-gray-50"
                                  onClick={() => setSettingsFanmark(fanmark)}
                                >
                                  <Settings className="mr-1 h-4 w-4" />
                                  {t('dashboard.settings')}
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
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
                <FanmarkAcquisition />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Settings Dialog */}
        <FanmarkSettings 
          fanmark={settingsFanmark} 
          open={!!settingsFanmark}
          onOpenChange={(open) => !open && setSettingsFanmark(null)}
          onSuccess={fetchFanmarks}
        />
      </div>
    </section>
  );
};
