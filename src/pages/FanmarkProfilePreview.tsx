import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, ExternalLink, User, X, Edit } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { getOwnerEmojiProfile, type EmojiProfile } from '@/hooks/useEmojiProfile';
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
  SiX,
  SiBluesky,
  SiSnapchat,
  SiThreads,
  SiBereal
} from 'react-icons/si';

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

export default function FanmarkProfilePreview() {
  const { fanmarkId } = useParams<{ fanmarkId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const [cachedFanmark, setCachedFanmark] = useState<{ user_input_fanmark: string; fanmark: string; emoji_ids: string[]; display_name: string | null } | null>(null);
  const [cameFromEdit, setCameFromEdit] = useState(false);
  const [profile, setProfile] = useState<EmojiProfile | null>(null);
  const [licenseId, setLicenseId] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load cached fanmark data from localStorage
    try {
      const cached = localStorage.getItem('fanmark_settings_cache');
      if (cached) {
        const data = JSON.parse(cached);
        // Check if data is less than 5 minutes old and matches current fanmarkId
        if (data.fanmarkId === fanmarkId && Date.now() - data.timestamp < 5 * 60 * 1000) {
          setCachedFanmark({
            user_input_fanmark: data.user_input_fanmark,
            fanmark: data.fanmark || data.user_input_fanmark,
            emoji_ids: Array.isArray(data.emoji_ids) ? data.emoji_ids : [],
            display_name: data.display_name
          });
        }
      }
    } catch (error) {
      console.error('Error loading cached fanmark data:', error);
    }
  }, [fanmarkId]);

  useEffect(() => {
    const state = (location.state as { from?: string } | null)?.from;
    setCameFromEdit(state === 'profile-edit');
  }, [location.state]);

  // Resolve active license linked to the fanmark
  useEffect(() => {
    const resolveLicense = async () => {
      if (!fanmarkId) {
        setLicenseId(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const { data, error } = await supabase.rpc('get_fanmark_complete_data', {
          fanmark_id_param: fanmarkId
        });

        if (error) throw error;

        const record = Array.isArray(data) ? data[0] : data;

        if (!record?.license_id) {
          console.warn('No active license found for fanmark preview. Profile data will be unavailable.');
          setLicenseId(null);
          setProfile(null);
          setLoading(false);
          return;
        }

        setLicenseId(record.license_id);
      } catch (error) {
        console.error('Error resolving fanmark license for preview:', error);
        setLicenseId(null);
        setProfile(null);
        setLoading(false);
      }
    };

    resolveLicense();
  }, [fanmarkId]);

  // Load owner profile once license is resolved (preview ignores public flag)
  useEffect(() => {
    const loadOwnerProfile = async () => {
      if (!licenseId) {
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const ownerProfile = await getOwnerEmojiProfile(licenseId);
        setProfile(ownerProfile);
      } catch (error) {
        console.error('Error loading owner profile for preview:', error);
        setProfile(null);
      } finally {
        setLoading(false);
      }
    };

    // Avoid firing until license resolution completed (licenseId undefined)
    if (licenseId !== undefined) {
      loadOwnerProfile();
    }
  }, [licenseId]);

  const navigateBackToSettings = () => {
    navigate(`/fanmarks/${fanmarkId}/settings`);
  };

  const navigateBackToEdit = () => {
    navigate(`/fanmarks/${fanmarkId}/profile/edit`);
  };

  const handleClose = () => {
    if (cameFromEdit) {
      navigateBackToEdit();
      return;
    }

    navigateBackToSettings();
  };

  const handleEditProfile = () => {
    navigateBackToEdit();
  };

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

  const displayName = profile?.display_name || cachedFanmark?.display_name || 'マイプロフィール';
  const bio = profile?.bio || '';
  const coverImage = profile?.theme_settings?.cover_image_url;
  const coverImagePosition = typeof profile?.theme_settings?.cover_image_position === 'number'
    ? profile?.theme_settings?.cover_image_position
    : 50;
  const profileImage = profile?.theme_settings?.profile_image_url;
  const socialLinks = profile?.social_links as Record<string, string> || {};

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 flex flex-col">
      {/* Header with Close and Edit buttons */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto flex items-center justify-between px-4 py-4 md:px-6">
          <div className="flex items-center gap-2">
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
            <div className="ml-4 px-3 py-1 bg-primary/10 text-primary text-sm font-medium rounded-full">
              プレビュー
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleEditProfile}
              className="gap-2"
            >
              <Edit className="h-4 w-4" />
{t('emojiProfile.backToEdit')}
            </Button>
            <LanguageToggle />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClose}
              className="rounded-full h-10 w-10 p-0 hover:bg-primary/10"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 flex-1">
        <div className="max-w-4xl mx-auto space-y-10">
          {/* Profile Preview Section - Matching Edit Page Layout */}
          <Card className="overflow-hidden bg-gradient-to-br from-background/90 to-background/70 border border-primary/20 shadow-xl backdrop-blur-sm">
            <CardContent className="p-0">
              {/* Cover Image */}
              <div className="relative h-48 bg-gradient-to-r from-primary/20 via-accent/20 to-primary/10">
                {coverImage ? (
                  <div className="absolute inset-0 overflow-hidden">
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
                 <div className="text-center mb-8">
                   <h1 className="text-3xl font-bold tracking-tight text-foreground mb-4">
                     {displayName} {cachedFanmark?.fanmark || cachedFanmark?.user_input_fanmark}
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
}
