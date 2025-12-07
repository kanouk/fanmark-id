import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, ExternalLink, User, ArrowLeft, Edit, Share2, Eye } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { getOwnerEmojiProfile, type EmojiProfile } from '@/hooks/useEmojiProfile';
import { LanguageToggle } from '@/components/LanguageToggle';
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

export default function FanmarkProfilePreview() {
  const { fanmarkId } = useParams<{ fanmarkId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const [cachedFanmark, setCachedFanmark] = useState<{ user_input_fanmark: string; fanmark: string; emoji_ids: string[]; display_name: string | null; short_id?: string } | null>(null);
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
            display_name: data.display_name,
            short_id: data.short_id
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

        // Set fanmark data from RPC response if not cached
        if (record.fanmark || record.user_input_fanmark) {
          setCachedFanmark(prev => prev || {
            user_input_fanmark: record.user_input_fanmark || '',
            fanmark: record.fanmark || record.user_input_fanmark || '',
            emoji_ids: [],
            display_name: record.display_name || null,
            short_id: record.short_id
          });
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

  const displayName = (profile?.display_name || cachedFanmark?.display_name || '').trim();
  const bio = profile?.bio || '';
  const coverImage = profile?.theme_settings?.cover_image_url;
  const coverImagePosition = typeof profile?.theme_settings?.cover_image_position === 'number'
    ? profile?.theme_settings?.cover_image_position
    : 50;
  const profileImage = profile?.theme_settings?.profile_image_url;
  const socialLinks = profile?.social_links as Record<string, string> || {};
  const fanmarkValue = cachedFanmark?.fanmark || cachedFanmark?.user_input_fanmark || '';
  const hasSocialLinks = Object.keys(socialLinks).length > 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/20 to-background flex flex-col relative overflow-hidden">
      {/* Decorative floating elements */}
      <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-gradient-to-br from-primary/8 to-transparent rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute top-1/3 right-0 w-[400px] h-[400px] bg-gradient-to-bl from-accent/8 to-transparent rounded-full blur-3xl translate-x-1/2" />
      <div className="absolute bottom-0 left-1/3 w-[600px] h-[400px] bg-gradient-to-t from-primary/5 to-transparent rounded-full blur-3xl translate-y-1/2" />

      {/* Top Navigation */}
      <div className="sticky top-0 z-50 bg-background/80 backdrop-blur-sm border-b border-border/40">
        <div className="container mx-auto px-4 py-4 flex items-center">
          <div className="w-24 flex items-center">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleClose}
              className="h-10 w-10 rounded-full border border-primary/20 bg-background/90 text-foreground hover:bg-primary/10"
              aria-label={t('common.back')}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </div>
          <h1 className="flex-1 text-xl font-bold tracking-tight text-foreground text-center flex items-center justify-center gap-2">
            <Eye className="h-5 w-5" />
            {t('emojiProfile.profilePreview')}
          </h1>
          <div className="w-24 flex items-center justify-end">
            <LanguageToggle />
          </div>
        </div>
      </div>

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

          {/* Spacer for fixed bottom bar */}
          <div className="h-24" />
        </div>
      </main>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t border-border/40 p-6 z-50">
        <div className="flex justify-center gap-4">
          <Button
            variant="outline"
            onClick={handleEditProfile}
            className="px-6 h-10 text-sm rounded-2xl border-primary/20 hover:border-primary/40 hover:bg-primary/5"
          >
            <Edit className="h-5 w-5 mr-2" />
            {t('emojiProfile.backToEdit')}
          </Button>
        </div>
      </div>
    </div>
  );
}
