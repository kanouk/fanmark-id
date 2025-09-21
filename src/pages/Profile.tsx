import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useTranslation } from '@/hooks/useTranslation';
import { UserProfileForm } from '@/components/UserProfileForm';
import { Navigation } from '@/components/Navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { User, Settings, Gift, Info } from 'lucide-react';
import { MdOutlineMail } from 'react-icons/md';
import { RiCalendarCheckLine } from 'react-icons/ri';
import { HiOutlineSparkles } from 'react-icons/hi2';
import { FiEye } from 'react-icons/fi';

const Profile = () => {
  const { user } = useAuth();
  const { profile, loading, updateProfile } = useProfile();
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) {
      navigate('/auth');
    }
  }, [user, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <Navigation />
      <main className="flex-1">
        <section className="container mx-auto px-4 py-12">
          <div className="space-y-10">
            <div className="space-y-2 text-center">
              <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                {t('profile.pageTitle')}
              </h1>
              <p className="text-sm text-muted-foreground sm:text-base">
                {t('profile.pageSubtitle')}
              </p>
            </div>

            <Card className="rounded-3xl border border-primary/20 bg-background/90 shadow-[0_20px_45px_rgba(101,195,200,0.14)] backdrop-blur">
              <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:gap-8">
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full border border-primary/20 bg-primary/10">
                  {profile?.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt={profile?.display_name || 'Avatar'}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <User className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 text-primary" />
                  )}
                </div>
                <div className="space-y-2 text-center sm:text-left">
                  <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-center">
                    <h2 className="text-2xl font-semibold text-foreground">
                      {profile?.display_name || t('profile.welcome')}
                    </h2>
                    <Badge className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                      {profile?.subscription_status === 'premium' ? t('profile.planPremium') : t('profile.planFree')}
                    </Badge>
                  </div>
                  {profile?.username && (
                    <p className="text-sm text-muted-foreground">@{profile.username}</p>
                  )}
                  {profile?.bio && (
                    <p className="text-sm text-muted-foreground">{profile.bio}</p>
                  )}
                </div>
              </CardContent>
              {profile?.invited_by_code && (
                <CardContent className="border-t border-primary/10 bg-primary/5 p-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2 text-sm text-primary">
                      <Gift className="h-4 w-4" />
                      <span>
                        {t('profile.invitedBy')}: {profile.invited_by_code}
                      </span>
                    </div>
                    {profile.invitation_perks && Object.keys(profile.invitation_perks).length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(profile.invitation_perks).map(([key, value]) => (
                          <Badge key={key} variant="outline" className="rounded-full border-primary/30 text-xs text-primary">
                            {key}: {String(value)}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>

            <Tabs defaultValue="edit" className="space-y-6">
              <TabsList className="grid w-full grid-cols-2 gap-2 rounded-full border border-primary/20 bg-background/70 p-2 backdrop-blur">
                <TabsTrigger
                  value="edit"
                  className="gap-2 rounded-full py-3 px-4 text-base font-medium transition-all duration-200 data-[state=active]:bg-primary/15 data-[state=active]:text-foreground data-[state=active]:shadow-lg"
                >
                  <Settings className="h-4 w-4" />
                  {t('profile.editProfile')}
                </TabsTrigger>
                <TabsTrigger
                  value="settings"
                  className="gap-2 rounded-full py-3 px-4 text-base font-medium transition-all duration-200 data-[state=active]:bg-primary/15 data-[state=active]:text-foreground data-[state=active]:shadow-lg"
                >
                  <Info className="h-4 w-4" />
                  {t('profile.accountInfo')}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="edit" className="space-y-6">
                <Card className="rounded-3xl border border-primary/15 bg-background/90 shadow-[0_18px_40px_rgba(101,195,200,0.12)]">
                  <CardHeader className="flex flex-col gap-2 px-6 pt-6 pb-4">
                    <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                      <User className="h-5 w-5 text-primary" />
                      {t('profile.editProfile')}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">{t('profile.editProfileDescription')}</p>
                  </CardHeader>
                  <CardContent className="px-6 pb-6 pt-6">
                    <UserProfileForm profile={profile} onUpdate={updateProfile} />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="settings" className="space-y-6">
                <Card className="rounded-3xl border border-primary/15 bg-background/90 shadow-[0_18px_40px_rgba(101,195,200,0.12)]">
                  <CardHeader className="flex flex-col gap-2 px-6 pt-6 pb-4">
                    <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                      <Info className="h-5 w-5 text-primary" />
                      {t('profile.accountInfo')}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">{t('profile.accountInfoDescription')}</p>
                  </CardHeader>
                  <CardContent className="space-y-4 p-6">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          <MdOutlineMail className="h-4 w-4" />
                          {t('profile.email')}
                        </p>
                        <div className="rounded-2xl border border-primary/10 bg-background/80 px-4 py-3 text-sm text-foreground">
                          {user?.email}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          <RiCalendarCheckLine className="h-4 w-4" />
                          {t('profile.memberSince')}
                        </p>
                        <div className="rounded-2xl border border-primary/10 bg-background/80 px-4 py-3 text-sm text-foreground">
                          {profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : 'N/A'}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          <HiOutlineSparkles className="h-4 w-4" />
                          {t('profile.planLabel')}
                        </p>
                        <div className="flex items-center gap-2 rounded-2xl border border-primary/10 bg-background/80 px-4 py-3 text-sm text-foreground">
                          <Badge className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
                            {profile?.subscription_status === 'premium' ? t('profile.planPremium') : t('profile.planFree')}
                          </Badge>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          <FiEye className="h-4 w-4" />
                          {t('profile.publicProfile')}
                        </p>
                        <div className="rounded-2xl border border-primary/10 bg-background/80 px-4 py-3 text-sm text-foreground">
                          {profile?.is_public_profile ? t('common.enabled') : t('common.disabled')}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </section>
      </main>
      <footer className="border-t border-border/40 bg-background/80 backdrop-blur">
        <div className="container mx-auto px-4 py-10 text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-2xl font-bold text-primary">
            <span className="text-3xl">✨</span> <span className="text-gradient">fanmark.id</span>
          </div>
          <p className="text-sm text-muted-foreground">{t('sections.footer')}</p>
        </div>
      </footer>
    </div>
  );
};

export default Profile;
