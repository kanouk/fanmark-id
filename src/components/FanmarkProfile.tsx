import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { getPublicEmojiProfile, type PublicEmojiProfile } from '@/hooks/useEmojiProfile';
import { 
  FiInstagram, 
  FiTwitter, 
  FiGithub, 
  FiYoutube,
  FiGlobe
} from 'react-icons/fi';
import { 
  SiTiktok, 
  SiLine, 
  SiTwitch, 
  SiDiscord 
} from 'react-icons/si';

interface FanmarkData {
  emoji_combination: string;
  display_name: string;
  access_type: 'profile' | 'redirect' | 'text' | 'inactive';
  target_url?: string;
  text_content?: string;
  status: string;
  id?: string; // Add fanmark id for potential profile loading
}

const socialPlatforms = [
  { key: 'instagram', label: 'Instagram', icon: FiInstagram, color: 'bg-gradient-to-r from-purple-500 to-pink-500' },
  { key: 'tiktok', label: 'TikTok', icon: SiTiktok, color: 'bg-black' },
  { key: 'x', label: 'X', icon: FiTwitter, color: 'bg-black' },
  { key: 'github', label: 'GitHub', icon: FiGithub, color: 'bg-gray-800' },
  { key: 'youtube', label: 'YouTube', icon: FiYoutube, color: 'bg-red-600' },
  { key: 'line', label: 'LINE', icon: SiLine, color: 'bg-green-500' },
  { key: 'twitch', label: 'Twitch', icon: SiTwitch, color: 'bg-purple-600' },
  { key: 'discord', label: 'Discord', icon: SiDiscord, color: 'bg-indigo-600' },
  { key: 'website', label: 'Website', icon: FiGlobe, color: 'bg-primary' },
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
      if (fanmark.id && fanmark.access_type === 'profile') {
        try {
          const profile = await getPublicEmojiProfile(fanmark.id);
          setEmojiProfile(profile);
        } catch (error) {
          console.error('Error loading public profile:', error);
        }
      }
      setLoading(false);
    };

    loadProfile();
  }, [fanmark.id, fanmark.access_type]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-muted to-accent/5 flex items-center justify-center">
        <Card className="w-96">
          <CardContent className="p-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-muted-foreground">{t('common.loading')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const displayName = emojiProfile?.display_name || fanmark.display_name || 'Anonymous';
  const bio = emojiProfile?.bio || '';
  const coverImage = emojiProfile?.theme_settings?.cover_image_url;
  const profileImage = emojiProfile?.theme_settings?.profile_image_url;
  const socialLinks = emojiProfile?.social_links as Record<string, string> || {};

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted to-accent/5">
      {/* Cover Image Background */}
      {coverImage && (
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-20"
          style={{ backgroundImage: `url(${coverImage})` }}
        />
      )}
      
      <div className="relative z-10">
        <div className="container mx-auto px-4 py-12 max-w-lg">
          {/* Profile Header */}
          <div className="text-center mb-8">
            {/* Profile Image */}
            <div className="mb-6">
              {profileImage ? (
                <img
                  src={profileImage}
                  alt={displayName}
                  className="w-32 h-32 rounded-full mx-auto object-cover border-4 border-background shadow-lg"
                />
              ) : (
                <div className="w-32 h-32 rounded-full mx-auto bg-primary/10 border-4 border-background shadow-lg flex items-center justify-center">
                  <span className="text-4xl font-bold text-primary">
                    {displayName.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
            </div>

            {/* Name and Bio */}
            <h1 className="text-2xl font-bold mb-3 text-foreground">{displayName}</h1>
            {bio && (
              <p className="text-muted-foreground text-sm leading-relaxed max-w-sm mx-auto mb-6">
                {bio}
              </p>
            )}
          </div>

          {/* Social Links */}
          {Object.keys(socialLinks).length > 0 && (
            <div className="space-y-3 mb-12">
              {Object.entries(socialLinks).map(([platform, url]) => {
                const platformConfig = socialPlatforms.find(p => p.key === platform);
                if (!platformConfig || !url) return null;
                
                const Icon = platformConfig.icon;
                
                return (
                  <Card key={platform} className="overflow-hidden transition-all duration-200 hover:scale-[1.02] card-pop">
                    <CardContent className="p-0">
                      <button
                        onClick={() => window.open(url, '_blank')}
                        className="w-full p-4 flex items-center justify-between text-left hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <div className={`p-3 rounded-full ${platformConfig.color} text-white flex items-center justify-center`}>
                            <Icon className="h-5 w-5" />
                          </div>
                          <span className="font-medium text-foreground">{platformConfig.label}</span>
                        </div>
                        <ExternalLink className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* No Content State */}
          {!bio && Object.keys(socialLinks).length === 0 && (
            <div className="text-center mb-12">
              <Card>
                <CardContent className="p-8">
                  <p className="text-muted-foreground text-sm">
                    このプロフィールはまだ設定されていません。
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* fanmark.id Logo */}
          <div className="text-center pt-8 border-t border-border/50">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="group inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-lg transition-all group-hover:scale-105">
                ✨
              </span>
              <span className="text-gradient text-lg font-semibold">fanmark.id</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};