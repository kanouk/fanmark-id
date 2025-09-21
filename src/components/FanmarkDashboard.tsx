import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useTranslation } from '@/hooks/useTranslation';
import { Plus, Search, Eye, Edit, Settings, Trash2, ExternalLink, Sparkles } from 'lucide-react';
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
  
  const [fanmarks, setFanmarks] = useState<Fanmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
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
    const badges = {
      profile: { emoji: '📄', label: t('dashboard.accessTypes.profile'), className: 'bg-blue-100 text-blue-800' },
      redirect: { emoji: '🔗', label: t('dashboard.accessTypes.redirect'), className: 'bg-green-100 text-green-800' },
      text: { emoji: '📝', label: t('dashboard.accessTypes.text'), className: 'bg-yellow-100 text-yellow-800' },
      inactive: { emoji: '😴', label: t('dashboard.accessTypes.inactive'), className: 'bg-gray-100 text-gray-800' },
    };

    const config = badges[accessType as keyof typeof badges] || badges.inactive;
    return (
      <Badge variant="outline" className={config.className}>
        <span className="mr-1">{config.emoji}</span>
        {config.label}
      </Badge>
    );
  };

  const filteredFanmarks = fanmarks.filter(fanmark =>
    fanmark.emoji_combination.includes(searchQuery) ||
    fanmark.display_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    fanmark.short_id.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/50">
      <div className="container mx-auto px-4 py-8 space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-3">
            <span className="text-4xl">🎨</span>
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground">
            {profile?.display_name || profile?.username || 'User'}
          </h1>
          </div>
          <p className="text-muted-foreground text-sm sm:text-base max-w-lg mx-auto">
            {t('dashboard.subtitle')}
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="relative overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">
                    {t('dashboard.stats.totalFanmarks')}
                  </p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-primary">{fanmarks.length}</span>
                    <span className="text-lg text-muted-foreground/80">
                      / ∞
                    </span>
                  </div>
                </div>
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-2xl">🎯</span>
                </div>
              </div>
              <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden mt-4">
                <div 
                  className="bg-primary h-2.5 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min((fanmarks.length / 10) * 100, 100)}%` }}
                />
              </div>
            </CardContent>
          </Card>

          {/* Additional stats cards... */}
        </div>

        {/* Main Content */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 h-auto p-1 bg-muted/20 backdrop-blur-sm">
            <TabsTrigger 
              value="my-fanmarks"
              className="gap-2 py-3 px-4 text-base font-medium data-[state=active]:bg-background data-[state=active]:shadow-lg transition-all duration-200"
            >
              <span className="text-xl">🎨</span>
              {t('dashboard.tabs.myFanmarks')}
            </TabsTrigger>
            <TabsTrigger 
              value="acquisition"
              className="gap-2 py-3 px-4 text-base font-medium data-[state=active]:bg-background data-[state=active]:shadow-lg transition-all duration-200"
            >
              <Plus className="h-5 w-5" />
              {t('dashboard.tabs.getFanmarks')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="my-fanmarks" className="space-y-6">
            {/* Search */}
            <Card className="bg-card/80 backdrop-blur-sm border">
              <CardContent className="p-4 sm:p-6">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-muted-foreground h-5 w-5" />
                  <Input
                    placeholder={t('dashboard.searchPlaceholder')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-12 h-12 text-base"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Fanmarks List */}
            <Card className="bg-card/80 backdrop-blur-sm border">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🎨</span>
                    <div>
                      <h2 className="text-xl font-bold text-foreground">
                        {t('dashboard.yourFanmarks')}
                      </h2>
                      <p className="text-sm text-muted-foreground mt-1">
                        {t('dashboard.manageFanmarks')}
                      </p>
                    </div>
                  </div>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button
                        size="lg"
                        className="gap-2 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105"
                      >
                        <Plus className="h-5 w-5" />
                        {t('dashboard.addFanmark')}
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                      <FanmarkSearchWithRegistration onSignupPrompt={handleSignupPrompt} />
                    </DialogContent>
                  </Dialog>
                </CardTitle>
              </CardHeader>

              <CardContent className="space-y-4">
                {filteredFanmarks.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="space-y-4">
                      <span className="text-6xl">🎨</span>
                      <h3 className="text-xl font-semibold text-foreground">
                        {searchQuery ? t('dashboard.noSearchResults') : t('dashboard.noFanmarksYet')}
                      </h3>
                      <p className="text-muted-foreground max-w-md mx-auto">
                        {searchQuery ? t('dashboard.tryDifferentSearch') : t('dashboard.getStarted')}
                      </p>
                      {!searchQuery && (
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              size="lg"
                              className="gap-2 mt-6 shadow-lg hover:shadow-xl transition-all duration-300"
                            >
                              <Sparkles className="h-5 w-5" />
                              {t('dashboard.createFirstFanmark')}
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                            <FanmarkSearchWithRegistration onSignupPrompt={handleSignupPrompt} />
                          </DialogContent>
                        </Dialog>
                      )}
                    </div>
                    <Badge variant="outline" className="bg-muted text-muted-foreground mt-8">
                      {t('dashboard.noFanmarks')}
                    </Badge>
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
                              <tr key={fanmark.id} className="hover:bg-muted/30 transition-colors border-b">
                                <td className="p-3">
                                  <div className="flex items-center gap-2">
                                    <span className="text-2xl">{fanmark.emoji_combination}</span>
                                    {fanmark.is_premium && (
                                      <Badge variant="secondary" className="bg-accent text-accent-foreground gap-1">
                                        💎 <span className="hidden xl:inline">Premium</span>
                                      </Badge>
                                    )}
                                  </div>
                                </td>
                                <td className="p-3">
                                  <div>
                                    <div className="font-semibold text-foreground">{fanmark.display_name}</div>
                                    {fanmark.access_type === 'redirect' && fanmark.redirect_url && (
                                      <div className="text-sm text-muted-foreground truncate max-w-xs flex items-center gap-1">
                                        <ExternalLink className="h-3 w-3" />
                                        {fanmark.redirect_url}
                                      </div>
                                    )}
                                    {fanmark.access_type === 'text' && fanmark.profile_text && (
                                      <div className="text-sm text-muted-foreground truncate max-w-xs flex items-center gap-1">
                                        📝 {fanmark.profile_text}
                                      </div>
                                    )}
                                  </div>
                                </td>
                                <td className="p-3">
                                  {getAccessTypeBadge(fanmark.access_type)}
                                </td>
                                <td className="p-3">
                                  <code className="bg-muted text-muted-foreground font-mono text-sm px-2 py-1 rounded">
                                    {fanmark.short_id}
                                  </code>
                                </td>
                                <td className="p-3">
                                  <Badge 
                                    variant={fanmark.status === 'active' ? 'default' : 'destructive'}
                                    className={fanmark.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}
                                  >
                                    {fanmark.status === 'active' ? '✅ Active' : '💤 Inactive'}
                                  </Badge>
                                </td>
                                <td className="p-3">
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
                        <Card key={fanmark.id} className="bg-card/30 hover:bg-card/50 transition-colors">
                          <CardContent className="p-4">
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
                                  <Badge variant="secondary" className="bg-accent text-accent-foreground">💎</Badge>
                                )}
                              </div>
                              
                              <div className="flex items-center justify-between">
                                {getAccessTypeBadge(fanmark.access_type)}
                                <Badge 
                                  variant={fanmark.status === 'active' ? 'default' : 'destructive'}
                                  className={fanmark.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}
                                >
                                  {fanmark.status === 'active' ? '✅ Active' : '💤 Inactive'}
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
                                      <span>📝</span>
                                      <span className="line-clamp-2">{fanmark.profile_text}</span>
                                    </div>
                                  )}
                                </div>
                              )}

                              <div className="flex gap-2">
                                <Button size="sm" variant="outline" className="border-blue-200 text-blue-600 hover:bg-blue-50 flex-1">
                                  <Eye className="h-4 w-4 mr-1" />
                                  {t('dashboard.view')}
                                </Button>
                                <Button size="sm" variant="outline" className="border-yellow-200 text-yellow-600 hover:bg-yellow-50 flex-1">
                                  <Edit className="h-4 w-4 mr-1" />
                                  {t('dashboard.edit')}
                                </Button>
                                <Button 
                                  size="sm" 
                                  variant="outline" 
                                  className="border-gray-200 text-gray-600 hover:bg-gray-50 flex-1"
                                  onClick={() => setSettingsFanmark(fanmark)}
                                >
                                  <Settings className="h-4 w-4 mr-1" />
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
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div className="bg-gradient-to-r from-primary/10 to-secondary/10 p-6 sm:p-8">
                  <h3 className="text-xl font-bold text-foreground flex items-center gap-2">
                    <Sparkles className="h-6 w-6" />
                    {t('dashboard.getFanmarksTitle')}
                  </h3>
                  <p className="text-muted-foreground text-sm sm:text-base max-w-lg mt-2">
                    {t('dashboard.getFanmarksDescription')}
                  </p>
                </div>
                <div className="p-6 sm:p-8">
                  <FanmarkAcquisition />
                </div>
                <Badge variant="outline" className="bg-yellow-100 text-yellow-800 self-start sm:self-center m-6">
                  ✨ {t('dashboard.comingSoon')}
                </Badge>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Settings Dialog */}
        <FanmarkSettings 
          fanmark={settingsFanmark!} 
          open={!!settingsFanmark}
          onOpenChange={(open) => !open && setSettingsFanmark(null)}
          onSuccess={fetchFanmarks}
        />
      </div>
    </div>
  );
};