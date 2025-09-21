import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { useFanmarkSession } from '@/hooks/useFanmarkSession';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { Edit, Trash2, Eye, Settings, Search, Plus } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FanmarkAcquisition } from '@/components/FanmarkAcquisition';
import { FanmarkSettings } from '@/components/FanmarkSettings';

interface Fanmark {
  id: string;
  emoji_combination: string;
  display_name: string;
  access_type: string;
  target_url?: string;
  text_content?: string;
  is_transferable: boolean;
  is_premium: boolean;
  status: string;
  short_id: string;
  created_at: string;
}

interface Profile {
  emoji_limit: number;
}

export const FanmarkDashboard = () => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { retrieveAndClearSessionData } = useFanmarkSession();
  const [fanmarks, setFanmarks] = useState<Fanmark[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('fanmarks');
  const [settingsFanmark, setSettingsFanmark] = useState<Fanmark | null>(null);
  const [prefilledEmoji, setPrefilledEmoji] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      fetchUserData();
      // Check for session data from pre-signup search
      const sessionEmoji = retrieveAndClearSessionData();
      if (sessionEmoji) {
        setPrefilledEmoji(sessionEmoji);
        setActiveTab('acquisition');
      }
    }
  }, [user, retrieveAndClearSessionData]);

  const fetchUserData = async () => {
    try {
      // Fetch user's fanmarks
      const { data: fanmarksData, error: fanmarksError } = await supabase
        .from('fanmarks')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (fanmarksError) throw fanmarksError;

      // Fetch user profile for limits
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('emoji_limit')
        .eq('user_id', user?.id)
        .single();

      if (profileError) throw profileError;

      setFanmarks(fanmarksData || []);
      setProfile(profileData);
    } catch (error) {
      console.error('Error fetching user data:', error);
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
      profile: { emoji: '📄', label: t('dashboard.accessTypes.profile'), variant: 'default', className: 'bg-blue-100 text-blue-800' },
      redirect: { emoji: '🔗', label: t('dashboard.accessTypes.redirect'), variant: 'default', className: 'bg-green-100 text-green-800' },
      text: { emoji: '📝', label: t('dashboard.accessTypes.text'), variant: 'default', className: 'bg-yellow-100 text-yellow-800' },
      inactive: { emoji: '😴', label: t('dashboard.accessTypes.inactive'), variant: 'outline', className: 'bg-gray-100 text-gray-800' },
    };
    
    const badge = badges[accessType as keyof typeof badges] || badges.inactive;
    
    return (
      <Badge variant={badge.variant as any} className={badge.className}>
        <span className="mr-1">{badge.emoji}</span>
        <span className="hidden sm:inline">{badge.label}</span>
      </Badge>
    );
  };

  const filteredFanmarks = fanmarks.filter(fanmark =>
    fanmark.emoji_combination.includes(searchQuery) ||
    fanmark.display_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    fanmark.short_id.includes(searchQuery)
  );

  const handleAcquisitionSuccess = () => {
    fetchUserData(); // Refresh fanmarks after successful registration
    setActiveTab('fanmarks'); // Switch back to fanmarks tab
  };

  const handleSettingsSuccess = () => {
    fetchUserData(); // Refresh data after settings update
    setSettingsFanmark(null);
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-base-100 to-base-200">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Header */}
        <header className="mb-8 sm:mb-12">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-2">
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gradient">
                {t('dashboard.title')}
              </h1>
              <p className="text-base-content/70 text-sm sm:text-base max-w-lg">
                {t('dashboard.subtitle')}
              </p>
            </div>
            <Button 
              onClick={() => setActiveTab('acquisition')}
              variant="default"
              size="lg"
              className="gap-2 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105"
            >
              <Plus className="h-5 w-5" />
              <span className="hidden sm:inline">{t('dashboard.newFanmark')}</span>
              <span className="sm:hidden">追加</span>
            </Button>
          </div>
        </header>

        {/* Stats Section */}
        <section className="mb-8 sm:mb-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
            {/* Fanmarks Usage Card */}
            <Card className="group hover:shadow-xl transition-all duration-300 bg-gradient-to-br from-primary/5 to-secondary/5 border-primary/20">
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-base-content/60">
                      {t('dashboard.yourFanmarks')}
                    </p>
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold text-primary">
                        {fanmarks.length}
                      </span>
                      <span className="text-lg text-base-content/50">
                        / {profile?.emoji_limit || 10}
                      </span>
                    </div>
                  </div>
                  <div className="text-4xl group-hover:animate-float">🎯</div>
                </div>
                
                <div className="space-y-3">
                  <div className="w-full bg-base-300 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-primary to-secondary rounded-full transition-all duration-700 ease-out"
                      style={{
                        width: `${Math.min((fanmarks.length / (profile?.emoji_limit || 10)) * 100, 100)}%`,
                      }}
                    />
                  </div>
                  
                  {fanmarks.length < (profile?.emoji_limit || 10) && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full border-primary text-primary hover:bg-primary hover:text-primary-foreground group/btn" 
                      onClick={() => setActiveTab('acquisition')}
                    >
                      <span className="group-hover/btn:animate-pulse">✨</span>
                      {t('dashboard.registerNew')}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Premium Fanmarks Card */}
            <Card className="group hover:shadow-xl transition-all duration-300 bg-gradient-to-br from-accent/5 to-warning/5 border-accent/20">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-base-content/60">
                      {t('dashboard.premiumEmojis')}
                    </p>
                    <p className="text-3xl font-bold text-accent">
                      {fanmarks.filter(f => f.is_premium).length}
                    </p>
                    <p className="text-xs text-base-content/50">プレミアム絵文字</p>
                  </div>
                  <div className="text-4xl group-hover:animate-bounce">💎</div>
                </div>
              </CardContent>
            </Card>

            {/* Active Fanmarks Card */}
            <Card className="group hover:shadow-xl transition-all duration-300 bg-gradient-to-br from-success/5 to-info/5 border-success/20">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-base-content/60">
                      {t('dashboard.active')}
                    </p>
                    <p className="text-3xl font-bold text-success">
                      {fanmarks.filter(f => f.access_type !== 'inactive').length}
                    </p>
                    <p className="text-xs text-base-content/50">設定済み</p>
                  </div>
                  <div className="text-4xl group-hover:animate-pulse">✨</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Main Content Tabs */}
        <section className="space-y-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2 h-auto p-1 bg-base-200/50 backdrop-blur-sm">
              <TabsTrigger 
                value="fanmarks" 
                className="gap-2 py-3 px-4 text-base font-medium data-[state=active]:bg-base-100 data-[state=active]:shadow-lg transition-all duration-200"
              >
                <span className="text-lg">🎯</span> 
                <span className="hidden sm:inline">{t('dashboard.myFanmarks')}</span>
                <span className="sm:hidden">マイファンマーク</span>
              </TabsTrigger>
              <TabsTrigger 
                value="acquisition" 
                className="gap-2 py-3 px-4 text-base font-medium data-[state=active]:bg-base-100 data-[state=active]:shadow-lg transition-all duration-200"
              >
                <Plus className="h-5 w-5" />
                <span className="hidden sm:inline">{t('dashboard.newAcquisition')}</span>
                <span className="sm:hidden">新規取得</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="fanmarks" className="space-y-6 mt-6">
              {/* Search and Filter */}
              <Card className="bg-base-100/80 backdrop-blur-sm border-base-300/50">
                <CardContent className="p-4 sm:p-6">
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-base-content/40 h-5 w-5" />
                    <Input
                      placeholder={t('dashboard.searchPlaceholder')}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-12 h-12 text-base bg-base-100 border-base-300 focus:border-primary transition-colors"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Fanmarks List */}
              <Card className="bg-base-100/80 backdrop-blur-sm border-base-300/50">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">🎨</span>
                      <div>
                        <h2 className="text-xl font-bold text-base-content">
                          {t('dashboard.yourFanmarks')}
                        </h2>
                        <p className="text-sm text-base-content/60 mt-1">
                          {fanmarks.length}個のファンマークを管理中
                        </p>
                      </div>
                    </div>
                    {fanmarks.length === 0 && (
                      <Badge variant="outline" className="bg-muted text-muted-foreground">
                        {t('dashboard.noFanmarks')}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-6 pb-6">
                  {filteredFanmarks.length === 0 ? (
                    <div className="text-center py-12 sm:py-16">
                      <div className="text-6xl sm:text-8xl mb-6 animate-float">🎯</div>
                      <div className="space-y-3 max-w-md mx-auto">
                        <h3 className="text-xl font-semibold text-base-content">
                          {searchQuery ? t('dashboard.noResults') : t('dashboard.noFanmarks')}
                        </h3>
                        <p className="text-base-content/60">
                          {searchQuery ? t('dashboard.noResultsDescription') : t('dashboard.noFanmarksDescription')}
                        </p>
                        {!searchQuery && (
                          <Button 
                            onClick={() => setActiveTab('acquisition')}
                            variant="default"
                            size="lg"
                            className="gap-2 mt-6 shadow-lg hover:shadow-xl transition-all duration-300"
                          >
                            <Plus className="h-5 w-5" />
                            {t('dashboard.registerFirstFanmark')}
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Desktop Table View */}
                      <div className="hidden lg:block overflow-x-auto">
                        <table className="table table-zebra w-full">
                          <thead>
                            <tr className="bg-base-200/50">
                              <th className="text-base-content/80 font-semibold">{t('dashboard.emoji')}</th>
                              <th className="text-base-content/80 font-semibold">{t('dashboard.displayName')}</th>
                              <th className="text-base-content/80 font-semibold">{t('dashboard.accessType')}</th>
                              <th className="text-base-content/80 font-semibold">{t('dashboard.shortId')}</th>
                              <th className="text-base-content/80 font-semibold">{t('dashboard.status')}</th>
                              <th className="text-base-content/80 font-semibold">{t('dashboard.actions')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredFanmarks.map((fanmark) => (
                              <tr key={fanmark.id} className="hover:bg-base-200/30 transition-colors">
                                <td>
                                  <div className="flex items-center gap-3">
                                    <span className="text-3xl">{fanmark.emoji_combination}</span>
                                    {fanmark.is_premium && (
                                      <Badge variant="secondary" className="bg-accent text-accent-foreground gap-1">
                                        💎 <span className="hidden xl:inline">Premium</span>
                                      </Badge>
                                    )}
                                  </div>
                                </td>
                                <td>
                                  <div className="space-y-1">
                                    <div className="font-semibold text-base-content">{fanmark.display_name}</div>
                                    {fanmark.access_type === 'redirect' && fanmark.target_url && (
                                      <div className="text-sm text-base-content/60 truncate max-w-xs flex items-center gap-1">
                                        🔗 {fanmark.target_url}
                                      </div>
                                    )}
                                    {fanmark.access_type === 'text' && fanmark.text_content && (
                                      <div className="text-sm text-base-content/60 truncate max-w-xs flex items-center gap-1">
                                        📝 {fanmark.text_content}
                                      </div>
                                    )}
                                  </div>
                                </td>
                                <td>{getAccessTypeBadge(fanmark.access_type)}</td>
                                <td>
                                  <code className="bg-muted text-muted-foreground font-mono text-sm px-2 py-1 rounded">
                                    {fanmark.short_id}
                                  </code>
                                </td>
                                <td>
                                  <Badge 
                                    variant={fanmark.status === 'active' ? 'default' : 'destructive'}
                                    className={fanmark.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}
                                  >
                                    {fanmark.status}
                                  </Badge>
                                </td>
                                <td>
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

                      {/* Mobile Card View */}
                      <div className="lg:hidden space-y-4">
                        {filteredFanmarks.map((fanmark) => (
                          <Card key={fanmark.id} className="bg-base-200/30 hover:bg-base-200/50 transition-colors">
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-3">
                                  <span className="text-3xl">{fanmark.emoji_combination}</span>
                                  <div>
                                    <h3 className="font-semibold text-base-content">{fanmark.display_name}</h3>
                                    <code className="text-xs text-base-content/60">{fanmark.short_id}</code>
                                  </div>
                                </div>
                                {fanmark.is_premium && (
                                  <Badge variant="secondary" className="bg-accent text-accent-foreground">💎</Badge>
                                )}
                              </div>
                              
                              <div className="flex flex-wrap gap-2 mb-4">
                                {getAccessTypeBadge(fanmark.access_type)}
                                <Badge 
                                  variant={fanmark.status === 'active' ? 'default' : 'destructive'}
                                  className={fanmark.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}
                                >
                                  {fanmark.status}
                                </Badge>
                              </div>

                              {(fanmark.target_url || fanmark.text_content) && (
                                <div className="text-sm text-base-content/60 mb-3 p-2 bg-base-300/30 rounded">
                                  {fanmark.access_type === 'redirect' && fanmark.target_url && (
                                    <div className="flex items-center gap-1">
                                      🔗 <span className="truncate">{fanmark.target_url}</span>
                                    </div>
                                  )}
                                  {fanmark.access_type === 'text' && fanmark.text_content && (
                                    <div className="flex items-center gap-1">
                                      📝 <span className="truncate">{fanmark.text_content}</span>
                                    </div>
                                  )}
                                </div>
                              )}

                              <div className="flex gap-2">
                                <Button size="sm" variant="outline" className="border-blue-200 text-blue-600 hover:bg-blue-50 flex-1">
                                  <Eye className="h-4 w-4 mr-1" />
                                  <span className="text-xs">表示</span>
                                </Button>
                                <Button size="sm" variant="outline" className="border-yellow-200 text-yellow-600 hover:bg-yellow-50 flex-1">
                                  <Edit className="h-4 w-4 mr-1" />
                                  <span className="text-xs">編集</span>
                                </Button>
                                <Button 
                                  size="sm" 
                                  variant="outline" 
                                  className="border-gray-200 text-gray-600 hover:bg-gray-50 flex-1"
                                  onClick={() => setSettingsFanmark(fanmark)}
                                >
                                  <Settings className="h-4 w-4 mr-1" />
                                  <span className="text-xs">設定</span>
                                </Button>
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

            <TabsContent value="acquisition" className="mt-6">
              <FanmarkAcquisition 
                prefilledEmoji={prefilledEmoji || undefined}
                onSuccess={handleAcquisitionSuccess}
              />
            </TabsContent>
          </Tabs>
        </section>

        {/* Value Estimation (Coming Soon) */}
        <section className="mt-8 sm:mt-12">
          <Card className="bg-gradient-to-r from-warning/10 to-info/10 border-warning/30 hover:shadow-xl transition-all duration-300">
            <CardContent className="p-6 sm:p-8">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="space-y-2">
                  <h3 className="text-xl font-bold text-base-content flex items-center gap-2">
                    💰 {t('dashboard.estimatedValue')}
                  </h3>
                  <p className="text-base-content/70 text-sm sm:text-base max-w-lg">
                    {t('dashboard.comingSoonDescription')}
                  </p>
                </div>
                <Badge variant="outline" className="bg-yellow-100 text-yellow-800 self-start sm:self-center">
                  ✨ {t('dashboard.comingSoon')}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>

      {/* Settings Dialog */}
      {settingsFanmark && (
        <FanmarkSettings
          fanmark={settingsFanmark}
          open={!!settingsFanmark}
          onOpenChange={(open) => !open && setSettingsFanmark(null)}
          onSuccess={handleSettingsSuccess}
        />
      )}
    </div>
  );
};