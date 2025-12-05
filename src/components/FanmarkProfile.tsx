import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, ExternalLink, User, Home, Lock } from 'lucide-react';
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
  FiGlobe
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
}

const socialPlatforms = [
  { key: 'instagram', label: 'Instagram', icon: FiInstagram },
  { key: 'tiktok', label: 'TikTok', icon: SiTiktok },
  { key: 'x', label: 'X (Twitter)', icon: SiX },
  { key: 'youtube', label: 'YouTube', icon: FiYoutube },
  { key: 'bereal', label: 'BeReal', icon: SiBereal },
  { key: 'line', label: 'LINE', icon: SiLine },
  { key: 'threads', label: 'Threads', icon: SiThreads },
  { key: 'bluesky', label: 'BlueSky', icon: SiBluesky },
  { key: 'github', label: 'GitHub', icon: FiGithub },
  { key: 'discord', label: 'Discord', icon: SiDiscord },
  { key: 'snapchat', label: 'Snapchat', icon: SiSnapchat },
  { key: 'twitch', label: 'Twitch', icon: SiTwitch },
  { key: 'website', label: 'ウェブサイト', icon: FiGlobe },
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
    const raw = fanmark?.fanmark ?? fanmark?.user_input_fanmark ?? '';
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : '✨';
  }, [fanmark?.fanmark, fanmark?.user_input_fanmark]);

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
      <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          {t('common.loading')}
        </div>
      </div>
    );
  }

  // If profile is null after loading, show appropriate fallback
  if (!emojiProfile) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/40 flex flex-col">
        <SimpleHeader className="sticky top-0 z-50 border-border/40 bg-background/80 backdrop-blur-xl" />

        <main className="container mx-auto flex-1 px-4 py-10 md:py-16 flex items-center justify-center">
          <Card className="w-full max-w-lg overflow-hidden rounded-3xl border border-primary/20 bg-background/95 backdrop-blur shadow-[0_25px_60px_rgba(101,195,200,0.18)]">
            <CardContent className="p-8 md:p-10 text-center space-y-6">
              {/* ファンマバッジ */}
              <div
                className="mx-auto inline-flex items-center justify-center bg-gradient-to-br from-primary/15 via-accent/10 to-blue-100 text-primary shadow-[0_20px_45px_rgba(101,195,200,0.25)]"
                style={{
                  fontSize: badgeStyle.fontSize,
                  lineHeight: badgeStyle.lineHeight,
                  height: badgeStyle.height,
                  borderRadius: '24px',
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
              <div className="space-y-3">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
                  <Lock className="h-6 w-6" />
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
                className="rounded-full px-6 gap-2 shadow-md hover:shadow-lg transition-all"
              >
                <Home className="h-4 w-4" />
                {t('common.goToHome')}
              </Button>
            </CardContent>
          </Card>
        </main>

        <SiteFooter className="border-border/40 bg-background/80 backdrop-blur" />
      </div>
    );
  }

  const displayName = emojiProfile?.display_name || fanmark.fanmark_name || 'Anonymous';
  const bio = emojiProfile?.bio || '';
  const coverImage = emojiProfile?.theme_settings?.cover_image_url;
  const coverImagePosition = typeof emojiProfile?.theme_settings?.cover_image_position === 'number'
    ? emojiProfile?.theme_settings?.cover_image_position
    : 50;
  const profileImage = emojiProfile?.theme_settings?.profile_image_url;
  const socialLinks = emojiProfile?.social_links as Record<string, string> || {};
  const fanmarkValue = fanmark.fanmark || fanmark.user_input_fanmark || '';

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 flex flex-col">
      <SimpleHeader className="sticky top-0 z-50 border-border/40 bg-background/80 backdrop-blur-xl" />

      <div className="container mx-auto px-4 py-8 flex-1">
        <div className="max-w-4xl mx-auto space-y-10">
          {/* Profile Preview Section - Matching Edit Page Layout */}
          <Card className="overflow-hidden bg-gradient-to-br from-background/90 to-background/70 border border-primary/20 shadow-xl backdrop-blur-sm">
            <CardContent className="p-0">
              {/* Cover Image */}
              <div className="relative h-48 bg-gradient-to-r from-primary/20 via-accent/20 to-primary/10">
                {coverImage ? (
                  <div className="absolute inset-0 overflow-hidden rounded-none">
                    <img
                      src={coverImage}
                      alt="Cover"
                      className="h-full w-full object-cover"
                      style={{ objectPosition: `50% ${coverImagePosition}%` }}
                    />
                  </div>
                ) : null}
                {!coverImage && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center text-primary/60">
                      <div className="text-6xl mb-2">✨</div>
                      <p className="text-sm font-medium">カバー画像</p>
                    </div>
                  </div>
                )}

                {/* Profile Image Overlay */}
                <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-1/2">
                  <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-background shadow-lg bg-background">
                    {profileImage ? (
                      <img
                        src={profileImage}
                        alt={displayName}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 via-accent/20 to-primary/10">
                        <User className="h-8 w-8 text-primary" />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Profile Content */}
              <div className="px-8 pt-20 md:pt-24 pb-8">
                <div className="text-center mb-8 space-y-4">
                  <h1 className="text-3xl font-bold tracking-tight text-foreground">
                    {displayName}
                  </h1>
                  {fanmarkValue && (
                    <div className="flex justify-center">
                      <span className="inline-flex items-center px-3 py-1 text-2xl md:text-3xl font-semibold text-primary tracking-[0.4em] leading-none">
                        {fanmarkValue}
                      </span>
                    </div>
                  )}
                  {bio && (
                    <p className="text-base text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                      {bio}
                    </p>
                  )}
                </div>

                {/* Social Links */}
                {Object.keys(socialLinks).length > 0 && (
                  <div className="space-y-4">
                    <h2 className="text-lg font-semibold text-foreground text-center mb-6">
                      ソーシャルリンク
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {Object.entries(socialLinks).map(([platform, url]) => {
                        const platformConfig = socialPlatforms.find(p => p.key === platform);
                        if (!platformConfig || !url) return null;

                        const Icon = platformConfig.icon;

                         return (
                           <button
                             key={platform}
                             onClick={() => window.open(url, '_blank')}
                             className="group flex items-center gap-4 p-4 rounded-2xl bg-background/50 border border-primary/20 hover:border-primary/40 hover:bg-background/70 hover:shadow-[0_10px_30px_rgba(101,195,200,0.2)] transition-all duration-300 hover:scale-[1.02]"
                           >
                             <div className="p-3 rounded-full bg-gradient-to-br from-primary/20 via-accent/20 to-primary/10 text-primary flex items-center justify-center shadow-lg group-hover:shadow-xl transition-shadow">
                               <Icon className="h-5 w-5" />
                             </div>
                             <div className="flex-1 text-left">
                               <span className="font-medium text-foreground">{platformConfig.label}</span>
                               <p className="text-sm text-muted-foreground truncate">{url}</p>
                             </div>
                             <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                           </button>
                         );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* No Content State */}
          {!bio && Object.keys(socialLinks).length === 0 && (
            <Card className="bg-background/90 border border-primary/20 shadow-xl backdrop-blur-sm">
              <CardContent className="p-12 text-center">
                <div className="space-y-6">
                  <div className="mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-primary/20 via-accent/20 to-primary/10 flex items-center justify-center shadow-lg">
                    <User className="h-10 w-10 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-foreground mb-3">プロフィールを作成中</h3>
                    <p className="text-base text-muted-foreground max-w-md mx-auto leading-relaxed">
                      まもなく素敵なプロフィールが公開されます。しばらくお待ちください。
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

        </div>
      </div>

      {/* Footer */}
      <SiteFooter />
    </div>
  );
};
