import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, ExternalLink, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { getPublicEmojiProfile, type PublicEmojiProfile } from '@/hooks/useEmojiProfile';
import { LanguageToggle } from '@/components/LanguageToggle';
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
  SiX
} from 'react-icons/si';

interface FanmarkData {
  id: string;
  emoji_combination: string;
  fanmark_name: string;
  access_type: 'profile' | 'redirect' | 'text' | 'inactive';
  target_url?: string;
  text_content?: string;
  status: string;
}

const socialPlatforms = [
  { key: 'instagram', label: 'Instagram', icon: FiInstagram },
  { key: 'tiktok', label: 'TikTok', icon: SiTiktok },
  { key: 'x', label: 'X', icon: SiX },
  { key: 'github', label: 'GitHub', icon: FiGithub },
  { key: 'youtube', label: 'YouTube', icon: FiYoutube },
  { key: 'line', label: 'LINE', icon: SiLine },
  { key: 'twitch', label: 'Twitch', icon: SiTwitch },
  { key: 'discord', label: 'Discord', icon: SiDiscord },
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

      if (fanmark.id && fanmark.access_type === 'profile') {
        try {
          console.log('🚀 Attempting to load profile for ID:', fanmark.id);
          const startTime = Date.now();
          const profile = await getPublicEmojiProfile(fanmark.id);
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
      } else {
        console.log('❌ Conditions not met - ID:', fanmark.id, 'Access type:', fanmark.access_type);
      }
      setLoading(false);
      console.log('🏁 Profile loading completed');
    };

    loadProfile();
  }, [fanmark.id, fanmark.access_type]);


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

  const displayName = emojiProfile?.display_name || fanmark.fanmark_name || 'Anonymous';
  const bio = emojiProfile?.bio || '';
  const coverImage = emojiProfile?.theme_settings?.cover_image_url;
  const profileImage = emojiProfile?.theme_settings?.profile_image_url;
  const socialLinks = emojiProfile?.social_links as Record<string, string> || {};

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 flex flex-col">
      {/* Header Navigation */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto flex items-center justify-between px-4 py-4 md:px-6">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="group flex items-center gap-2 text-lg font-semibold text-foreground transition-transform hover:translate-y-[-1px]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-2xl transition-all group-hover:scale-105">
              ✨
            </span>
            <span className="text-gradient text-2xl">fanmark.id</span>
          </button>

          <LanguageToggle />
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 flex-1">
        <div className="max-w-4xl mx-auto space-y-10">
          {/* Profile Preview Section - Matching Edit Page Layout */}
          <Card className="overflow-hidden bg-gradient-to-br from-background/90 to-background/70 border border-primary/20 shadow-xl backdrop-blur-sm">
            <CardContent className="p-0">
              {/* Cover Image */}
              <div
                className="relative h-48 bg-gradient-to-r from-primary/20 via-accent/20 to-primary/10"
                style={coverImage ? {
                  backgroundImage: `url(${coverImage})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                } : {}}
              >
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
              <div className="px-8 pt-16 pb-8">
                 <div className="text-center mb-8">
                   <h1 className="text-3xl font-bold tracking-tight text-foreground mb-4">
                     {displayName} {fanmark.emoji_combination}
                   </h1>
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