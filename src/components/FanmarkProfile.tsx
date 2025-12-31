import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  ExternalLink,
  User,
  Home,
  Lock,
  Share2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { getPublicEmojiProfile, type PublicEmojiProfile } from '@/hooks/useEmojiProfile';
import { SimpleHeader } from '@/components/layout/SimpleHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { segmentEmojiSequence } from '@/lib/emojiConversion';
import { createFanmarkBadgeStyle } from '@/lib/fanmarkBadge';
import {
  FiInstagram,
  FiGithub,
  FiYoutube,
  FiGlobe,
  FiFacebook
} from 'react-icons/fi';
import {
  SiTiktok,
  SiLine,
  SiTwitch,
  SiDiscord,
  SiX,
  SiBluesky,
  SiSnapchat,
  SiThreads,
  SiBereal
} from 'react-icons/si';

interface FanmarkData {
  id: string;
  user_input_fanmark: string;
  fanmark?: string;
  fanmark_name: string;
  access_type: 'profile' | 'redirect' | 'text' | 'inactive';
  target_url?: string;
  text_content?: string;
  status: string;
  license_id?: string;
  short_id?: string;
}

const socialPlatforms = [
  { key: 'instagram', label: 'Instagram', icon: FiInstagram },
  { key: 'tiktok', label: 'TikTok', icon: SiTiktok },
  { key: 'x', label: 'X (Twitter)', icon: SiX },
  { key: 'youtube', label: 'YouTube', icon: FiYoutube },
  { key: 'bereal', label: 'BeReal', icon: SiBereal },
  { key: 'line', label: 'LINE', icon: SiLine },
  { key: 'threads', label: 'Threads', icon: SiThreads },
  { key: 'bluesky', label: 'Bluesky', icon: SiBluesky },
  { key: 'github', label: 'GitHub', icon: FiGithub },
  { key: 'discord', label: 'Discord', icon: SiDiscord },
  { key: 'snapchat', label: 'Snapchat', icon: SiSnapchat },
  { key: 'twitch', label: 'Twitch', icon: SiTwitch },
  { key: 'facebook', label: 'Facebook', icon: FiFacebook },
  { key: 'website', label: 'Website', icon: FiGlobe },
];

interface FanmarkProfileProps {
  fanmark: FanmarkData;
}

export const FanmarkProfile = ({ fanmark }: FanmarkProfileProps) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [emojiProfile, setEmojiProfile] = useState<PublicEmojiProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProfile = async () => {
      console.log('🔍 Loading fanmark profile...');
      console.log('📋 Fanmark data:', fanmark);
      console.log('🆔 Fanmark ID:', fanmark.id);
      console.log('🎯 Access type:', fanmark.access_type);

      if (fanmark.access_type !== 'profile') {
        console.log('⚠️ Fanmark access type is not profile. Skipping profile load.');
        setLoading(false);
        return;
      }

      if (!fanmark.license_id) {
        console.warn('⚠️ FanmarkProfile invoked without license_id. Profile data cannot be resolved.');
        setEmojiProfile(null);
        setLoading(false);
        return;
      }

      if (fanmark.id && fanmark.license_id) {
        try {
          console.log('🚀 Attempting to load profile for license_id:', fanmark.license_id);
          const startTime = Date.now();
          const profile = await getPublicEmojiProfile(fanmark.license_id);
          const loadTime = Date.now() - startTime;

          console.log('✅ Profile loaded successfully in', loadTime, 'ms');
          console.log('📊 Profile data:', {
            license_id: profile?.license_id,
            display_name: profile?.display_name,
            bio: profile?.bio,
            social_links: profile?.social_links,
            theme_settings: profile?.theme_settings,
            updated_at: profile?.updated_at
          });

          setEmojiProfile(profile);

          if (profile) {
            console.log('🎉 Profile set successfully');
          } else {
            console.log('⚠️ No profile data returned from function');
          }
        } catch (error) {
          console.error('❌ Error loading public profile:', error);
          console.error('🔧 Error details:', {
            name: error?.name,
            message: error?.message,
            stack: error?.stack
          });
        }
      }
      setLoading(false);
      console.log('🏁 Profile loading completed');
    };

    loadProfile();
  }, [fanmark.id, fanmark.access_type, fanmark.license_id]);

  // All hooks must be called before any early returns
  const licenseMissing = fanmark.access_type === 'profile' && !fanmark.license_id;

  const displayFanmark = useMemo(() => {
    const raw = fanmark?.fanmark ?? '';
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : '✨';
  }, [fanmark?.fanmark]);

  const badgeStyle = useMemo(
    () => createFanmarkBadgeStyle(displayFanmark),
    [displayFanmark]
  );

  const segmentedFanmark = useMemo(
    () => segmentEmojiSequence(displayFanmark),
    [displayFanmark]
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background flex items-center justify-center relative overflow-hidden">
        {/* Decorative floating elements */}
        <div className="absolute top-20 left-10 w-72 h-72 bg-primary/10 rounded-full blur-3xl animate-pulse-slow" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-accent/10 rounded-full blur-3xl animate-pulse-slow" />
        
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <div className="relative">
            <div className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
            <div className="relative p-4 rounded-full bg-primary/10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          </div>
          <span className="text-sm font-medium">{t('common.loading')}</span>
        </div>
      </div>
    );
  }

  // If profile is null after loading, show appropriate fallback
  if (!emojiProfile) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background flex flex-col relative overflow-hidden">
        {/* Decorative floating elements */}
        <div className="absolute top-20 left-10 w-72 h-72 bg-primary/8 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-accent/8 rounded-full blur-3xl" />
        
        <SimpleHeader className="sticky top-0 z-50 border-border/40 bg-background/80 backdrop-blur-xl" />

        <main className="container mx-auto flex-1 px-4 py-10 md:py-16 flex items-center justify-center relative z-10">
          <Card className="w-full max-w-lg overflow-hidden rounded-3xl border border-primary/15 bg-background/95 backdrop-blur-xl shadow-[0_25px_60px_rgba(101,195,200,0.12)] card-pop">
            <CardContent className="p-8 md:p-10 text-center space-y-8">
              {/* ファンマバッジ */}
              <div
                className="mx-auto inline-flex items-center justify-center bg-gradient-to-br from-primary/15 via-accent/8 to-primary/10 text-primary shadow-[0_16px_40px_rgba(101,195,200,0.18)] rounded-2xl"
                style={{
                  fontSize: badgeStyle.fontSize,
                  lineHeight: badgeStyle.lineHeight,
                  height: badgeStyle.height,
                  padding: '0 1.5rem',
                }}
              >
                <div className="flex items-center justify-center gap-2 leading-none">
                  {segmentedFanmark.map((segment, index) => (
                    <span key={`${segment}-${index}`} className="inline-flex min-w-[2rem] justify-center">
                      {segment}
                    </span>
                  ))}
                </div>
              </div>

              {/* アイコンとタイトル */}
              <div className="space-y-4">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground shadow-inner">
                  <Lock className="h-7 w-7" />
                </div>
                <h1 className="text-xl font-semibold text-foreground">
                  {licenseMissing ? t('profile.cannotDisplay') : t('profile.privateProfile')}
                </h1>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
                  {licenseMissing
                    ? t('profile.noActiveLicense')
                    : t('profile.privateDescription')}
                </p>
              </div>

              {/* ボタン */}
              <Button
                onClick={() => navigate('/')}
                className="rounded-full px-8 h-12 gap-2 shadow-lg hover:shadow-xl transition-all btn-pop"
              >
                <Home className="h-4 w-4" />
                {t('common.goToHome')}
              </Button>
            </CardContent>
          </Card>
        </main>

        <SiteFooter className="border-border/40 bg-background/80 backdrop-blur relative z-10" />
      </div>
    );
  }

  const displayName = (emojiProfile?.display_name || '').trim();
  const bio = emojiProfile?.bio || '';
  const coverImage = emojiProfile?.theme_settings?.cover_image_url;
  const coverImagePosition = typeof emojiProfile?.theme_settings?.cover_image_position === 'number'
    ? emojiProfile?.theme_settings?.cover_image_position
    : 50;
  const profileImage = emojiProfile?.theme_settings?.profile_image_url;
  const socialLinks = emojiProfile?.social_links as Record<string, string> || {};
  const fanmarkValue = fanmark.fanmark || '';
  const hasSocialLinks = Object.keys(socialLinks).length > 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/20 to-background flex flex-col relative overflow-hidden">
      {/* Decorative floating elements */}
      <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-gradient-to-br from-primary/8 to-transparent rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute top-1/3 right-0 w-[400px] h-[400px] bg-gradient-to-bl from-accent/8 to-transparent rounded-full blur-3xl translate-x-1/2" />
      <div className="absolute bottom-0 left-1/3 w-[600px] h-[400px] bg-gradient-to-t from-primary/5 to-transparent rounded-full blur-3xl translate-y-1/2" />
      
      <SimpleHeader className="sticky top-0 z-50 border-border/40 bg-background/80 backdrop-blur-xl" />

      <main className="container mx-auto px-4 py-8 md:py-12 flex-1 relative z-10">
        <div className="max-w-2xl mx-auto space-y-8">
          {/* Main Profile Card */}
          <Card className="overflow-hidden rounded-3xl border border-primary/15 bg-background/90 backdrop-blur-xl shadow-[0_30px_60px_rgba(101,195,200,0.12)] card-pop">
            <CardContent className="p-0">
              {/* Cover Image */}
              <div className="relative h-48 md:h-56 bg-gradient-to-br from-primary/20 via-accent/15 to-primary/10">
                {coverImage ? (
                  <div className="absolute inset-0 overflow-hidden">
                    <img
                      src={coverImage}
                      alt="Cover"
                      className="w-full h-full object-cover"
                      style={{ objectPosition: `50% ${coverImagePosition}%` }}
                    />
                  </div>
                ) : (
                  /* Default decorative pattern when no cover */
                  <div className="absolute inset-0">
                    <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-primary/20 rounded-full blur-2xl animate-float" />
                    <div className="absolute bottom-1/4 right-1/4 w-24 h-24 bg-accent/25 rounded-full blur-2xl animate-float" style={{ animationDelay: '1s' }} />
                    <div className="absolute top-1/2 right-1/3 w-20 h-20 bg-primary/15 rounded-full blur-xl animate-float" style={{ animationDelay: '2s' }} />
                  </div>
                )}
                
                {/* Gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/20 to-transparent" />
                
                {/* Fanmark Badge */}
                <div className="absolute top-4 left-4">
                  <span className="inline-flex items-center px-4 py-2 text-xl md:text-2xl font-semibold text-primary tracking-[0.3em] leading-none rounded-2xl bg-background/90 backdrop-blur-md shadow-lg border border-primary/10">
                    {fanmarkValue}
                  </span>
                </div>

                {/* Profile Image */}
                <div className="absolute -bottom-14 left-1/2 transform -translate-x-1/2">
                  <div className="relative group">
                    <div className="absolute -inset-1 bg-gradient-to-br from-primary/50 via-accent/30 to-primary/50 rounded-full blur-sm opacity-60 group-hover:opacity-80 transition-opacity" />
                    <div className="relative w-28 h-28 rounded-full overflow-hidden border-4 border-background shadow-xl bg-background">
                      {profileImage ? (
                        <img
                          src={profileImage}
                          alt={displayName || fanmarkValue || 'Profile'}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 via-accent/15 to-primary/10">
                          <User className="h-10 w-10 text-primary/60" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Profile Content */}
              <div className="px-6 md:px-8 pt-20 pb-8">
                <div className="text-center space-y-4">
                  {/* Display Name */}
                  <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
                    {displayName || t('profile.defaultTitle', { fanmark: fanmarkValue })}
                  </h1>
                  
                  {/* Bio */}
                  {bio && (
                    <p className="text-base text-muted-foreground max-w-lg mx-auto leading-relaxed pt-2 whitespace-pre-line">
                      {bio}
                    </p>
                  )}
                </div>

                {/* Social Links */}
                <div className="mt-10 space-y-6">
                  {/* Section header */}
                  <div className="flex items-center gap-4">
                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
                    <div className="flex items-center gap-3 px-4 py-2 rounded-full bg-primary/5 border border-primary/10">
                      <Share2 className="h-5 w-5 text-primary" />
                      <span className="text-sm font-semibold text-foreground">{t('emojiProfile.socialLinks')}</span>
                    </div>
                    <div className="flex-1 h-px bg-gradient-to-l from-transparent via-primary/30 to-transparent" />
                  </div>

                  {/* Social Links Grid or Empty State */}
                  {hasSocialLinks ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {socialPlatforms.map((platformConfig) => {
                        const url = socialLinks[platformConfig.key];
                        if (!url) return null;

                        const Icon = platformConfig.icon;

                        return (
                          <button
                            key={platformConfig.key}
                            onClick={() => window.open(url, '_blank')}
                            className="group flex items-center gap-4 p-4 rounded-2xl bg-background/60 border border-border/60 hover:border-primary/30 hover:bg-background/80 hover:shadow-[0_8px_24px_rgba(101,195,200,0.12)] transition-all duration-300 hover:scale-[1.02]"
                          >
                            <span className="p-2.5 rounded-xl bg-primary/10 group-hover:bg-primary/15 transition-colors">
                              <Icon className="h-5 w-5 text-primary" />
                            </span>
                            <div className="flex-1 text-left min-w-0">
                              <span className="font-medium text-foreground block">{platformConfig.label}</span>
                              <p className="text-sm text-muted-foreground truncate">{url.replace(/^https?:\/\//, '')}</p>
                            </div>
                            <ExternalLink className="h-4 w-4 text-muted-foreground/60 group-hover:text-primary transition-colors flex-shrink-0" />
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-6">
                      <p className="text-sm text-muted-foreground">{t('profile.noSocialLinks')}</p>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

        </div>
      </main>

      <SiteFooter className="relative z-10" />
    </div>
  );
};
