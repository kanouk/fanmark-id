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
      profile: { emoji: '📄', label: t('dashboard.accessTypes.profile'), className: 'bg-blue-100 text-blue-800' },
      redirect: { emoji: '🔗', label: t('dashboard.accessTypes.redirect'), className: 'bg-green-100 text-green-800' },
      text: { emoji: '📝', label: t('dashboard.accessTypes.text'), className: 'bg-yellow-100 text-yellow-800' },
      inactive: { emoji: '😴', label: t('dashboard.accessTypes.inactive'), className: 'bg-gray-100 text-gray-800' },
    };
    
    const badge = badges[accessType as keyof typeof badges] || badges.inactive;
    
    return (
      <Badge className={badge.className}>
        {badge.emoji} {badge.label}
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

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">
            {t('dashboard.title')}
          </h1>
          <p className="text-gray-600 mt-1">{t('dashboard.subtitle')}</p>
        </div>
        <Button 
          onClick={() => setActiveTab('acquisition')}
          className="bg-gradient-to-r from-pink-400 to-purple-400 hover:from-pink-500 hover:to-purple-500 gap-2"
        >
          <Plus className="h-4 w-4" />
          {t('dashboard.newFanmark')}
        </Button>
      </div>

      {/* Stats Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">{t('dashboard.yourFanmarks')}</p>
                <p className="text-3xl font-bold text-primary">
                  {fanmarks.length} / {profile?.emoji_limit || 10}
                </p>
              </div>
              <div className="text-4xl">🎯</div>
            </div>
            <div className="mt-4">
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-pink-400 to-purple-400 h-2 rounded-full transition-all"
                  style={{
                    width: `${Math.min((fanmarks.length / (profile?.emoji_limit || 10)) * 100, 100)}%`,
                  }}
                ></div>
              </div>
              {fanmarks.length < (profile?.emoji_limit || 10) && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-3 w-full" 
                  onClick={() => setActiveTab('acquisition')}
                >
                  {t('dashboard.registerNew')} ✨
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">{t('dashboard.premiumEmojis')}</p>
                <p className="text-3xl font-bold text-yellow-600">
                  {fanmarks.filter(f => f.is_premium).length}
                </p>
              </div>
              <div className="text-4xl">💎</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">{t('dashboard.active')}</p>
                <p className="text-3xl font-bold text-green-600">
                  {fanmarks.filter(f => f.access_type !== 'inactive').length}
                </p>
              </div>
              <div className="text-4xl">✨</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="fanmarks" className="gap-2">
            <span>🎯</span> {t('dashboard.myFanmarks')}
          </TabsTrigger>
          <TabsTrigger value="acquisition" className="gap-2">
            <Plus className="h-4 w-4" />
            {t('dashboard.newAcquisition')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="fanmarks" className="space-y-6">
          {/* Search and Filter */}
          <Card>
            <CardContent className="p-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  placeholder={t('dashboard.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </CardContent>
          </Card>

          {/* Fanmarks Table */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span>🎨 {t('dashboard.yourFanmarks')}</span>
                {fanmarks.length === 0 && (
                  <Badge variant="outline">{t('dashboard.noFanmarks')}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {filteredFanmarks.length === 0 ? (
                <div className="text-center py-8">
                  <div className="text-6xl mb-4">🎯</div>
                  <p className="text-lg text-gray-600 mb-2">
                    {searchQuery ? t('dashboard.noResults') : t('dashboard.noFanmarks')}
                  </p>
                  <p className="text-gray-500 mb-4">
                    {searchQuery ? t('dashboard.noResultsDescription') : t('dashboard.noFanmarksDescription')}
                  </p>
                  {!searchQuery && (
                    <Button 
                      onClick={() => setActiveTab('acquisition')}
                      className="bg-gradient-to-r from-pink-400 to-purple-400 hover:from-pink-500 hover:to-purple-500 gap-2"
                    >
                      <Plus className="h-4 w-4" />
                      {t('dashboard.registerFirstFanmark')}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table w-full">
                    <thead>
                      <tr>
                        <th>{t('dashboard.emoji')}</th>
                        <th>{t('dashboard.displayName')}</th>
                        <th>{t('dashboard.accessType')}</th>
                        <th>{t('dashboard.shortId')}</th>
                        <th>{t('dashboard.status')}</th>
                        <th>{t('dashboard.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredFanmarks.map((fanmark, index) => (
                        <tr key={fanmark.id} className={index % 2 === 0 ? 'bg-base-100' : 'bg-base-200'}>
                          <td>
                            <div className="flex items-center gap-2">
                              <span className="text-2xl">{fanmark.emoji_combination}</span>
                              {fanmark.is_premium && (
                                <Badge className="bg-yellow-100 text-yellow-800">💎 Premium</Badge>
                              )}
                            </div>
                          </td>
                          <td>
                            <div className="font-medium">{fanmark.display_name}</div>
                            {fanmark.access_type === 'redirect' && fanmark.target_url && (
                              <div className="text-sm text-gray-500 truncate max-w-xs">
                                → {fanmark.target_url}
                              </div>
                            )}
                            {fanmark.access_type === 'text' && fanmark.text_content && (
                              <div className="text-sm text-gray-500 truncate max-w-xs">
                                📝 {fanmark.text_content}
                              </div>
                            )}
                          </td>
                          <td>{getAccessTypeBadge(fanmark.access_type)}</td>
                          <td>
                            <code className="bg-gray-100 px-2 py-1 rounded text-sm">
                              {fanmark.short_id}
                            </code>
                          </td>
                          <td>
                            <Badge 
                              className={fanmark.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}
                            >
                              {fanmark.status}
                            </Badge>
                          </td>
                          <td>
                            <div className="flex gap-2">
                              <Button size="sm" variant="ghost" className="btn-square">
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button size="sm" variant="ghost" className="btn-square">
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button size="sm" variant="ghost" className="btn-square">
                                <Settings className="h-4 w-4" />
                              </Button>
                              <Button 
                                size="sm" 
                                variant="ghost" 
                                className="btn-square text-red-500 hover:text-red-700"
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
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="acquisition">
          <FanmarkAcquisition 
            prefilledEmoji={prefilledEmoji || undefined}
            onSuccess={handleAcquisitionSuccess}
          />
        </TabsContent>
      </Tabs>

      {/* Value Estimation (Coming Soon) */}
      <Card className="mt-6">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">💰 {t('dashboard.estimatedValue')}</h3>
              <p className="text-gray-600">{t('dashboard.comingSoonDescription')}</p>
            </div>
            <Badge className="bg-purple-100 text-purple-800">{t('dashboard.comingSoon')}</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};