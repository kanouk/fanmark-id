import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useTranslation } from '@/hooks/useTranslation';
import { UserProfileForm } from '@/components/UserProfileForm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { User, Settings, Gift, LogOut, ArrowLeft, Info } from 'lucide-react';

const Profile = () => {
  const { user, signOut } = useAuth();
  const { profile, loading, updateProfile } = useProfile();
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) {
      navigate('/auth');
    }
  }, [user, navigate]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-base-200 to-base-300 flex items-center justify-center">
        <span className="loading loading-spinner loading-lg text-primary"></span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-base-200 to-base-300 p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => navigate('/')} className="btn btn-ghost flex items-center space-x-2">
            <ArrowLeft className="w-4 h-4" />
            <span>{t('common.back')}</span>
          </Button>
          <Button variant="outline" onClick={handleSignOut} className="btn btn-outline flex items-center space-x-2">
            <LogOut className="w-4 h-4" />
            <span>{t('auth.logout')}</span>
          </Button>
        </div>

        {/* Profile Header Card */}
        <Card className="bg-gradient-to-r from-primary/10 to-secondary/10">
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="avatar">
                <div className="relative w-16 h-16 rounded-full bg-primary/20 overflow-hidden">
                  {profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt="Avatar" className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    <User className="w-8 h-8 text-primary absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
                  )}
                </div>
              </div>
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <h1 className="text-2xl font-bold text-primary">
                    {profile?.display_name || t('profile.welcome')}
                  </h1>
                  <Badge variant="secondary" className="flex items-center space-x-1">
                    <User className="w-3 h-3" />
                    <span>{profile?.subscription_status === 'premium' ? 'プラス' : 'フリー'}</span>
                  </Badge>
                </div>
                <p className="text-base-content/70">@{profile?.username}</p>
                {profile?.bio && (
                  <p className="text-sm text-base-content/70 mt-1">{profile.bio}</p>
                )}
              </div>
            </div>
            
            {/* Invitation Info */}
            {profile?.invited_by_code && (
              <div className="mt-4 p-3 bg-success/10 rounded-lg border border-success/20">
                <div className="flex items-center space-x-2">
                  <Gift className="w-4 h-4 text-success" />
                  <span className="text-sm text-success">
                    {t('profile.invitedBy')}: {profile.invited_by_code}
                  </span>
                </div>
                {profile.invitation_perks && Object.keys(profile.invitation_perks).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Object.entries(profile.invitation_perks).map(([key, value]) => (
                      <Badge key={key} variant="outline" className="text-xs">
                        {key}: {String(value)}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Profile Management Tabs */}
        <Tabs defaultValue="edit" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="edit" className="flex items-center space-x-2">
              <Settings className="w-4 h-4" />
              <span>{t('profile.editProfile')}</span>
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center space-x-2">
              <Info className="w-4 h-4" />
              <span>アカウント情報</span>
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="edit" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <User className="w-5 h-5" />
                  <span>{t('profile.editProfile')}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <UserProfileForm 
                  profile={profile} 
                  onUpdate={updateProfile}
                />
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="settings" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Info className="w-5 h-5" />
                  <span>アカウント情報</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-base-content/70">{t('profile.email')}</label>
                    <div className="p-3 bg-base-200 rounded-lg border border-base-300">
                      <p className="text-sm text-base-content">{user?.email}</p>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-base-content/70">{t('profile.memberSince')}</label>
                    <div className="p-3 bg-base-200 rounded-lg border border-base-300">
                      <p className="text-sm text-base-content">
                        {profile?.created_at 
                          ? new Date(profile.created_at).toLocaleDateString()
                          : 'N/A'
                        }
                      </p>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-base-content/70">プラン</label>
                    <div className="p-3 bg-base-200 rounded-lg border border-base-300">
                      <Badge variant="secondary">
                        {profile?.subscription_status === 'premium' ? 'プラス' : 'フリー'}
                      </Badge>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-base-content/70">{t('profile.publicProfile')}</label>
                    <div className="p-3 bg-base-200 rounded-lg border border-base-300">
                      <Badge variant={profile?.is_public_profile ? "default" : "secondary"}>
                        {profile?.is_public_profile ? t('common.enabled') : t('common.disabled')}
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Profile;