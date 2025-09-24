import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, ExternalLink, Share, Heart, Copy, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { getPublicEmojiProfile, type PublicEmojiProfile } from '@/hooks/useEmojiProfile';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
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
  id: string;
  emoji_combination: string;
  fanmark_name: string;
  access_type: 'profile' | 'redirect' | 'text' | 'inactive';
  target_url?: string;
  text_content?: string;
  status: string;
}

const socialPlatforms = [
  { key: 'instagram', label: 'Instagram', icon: FiInstagram, color: 'from-purple-500 to-pink-500', textColor: 'text-white' },
  { key: 'tiktok', label: 'TikTok', icon: SiTiktok, color: 'from-black to-gray-800', textColor: 'text-white' },
  { key: 'x', label: 'X', icon: FiTwitter, color: 'from-black to-gray-800', textColor: 'text-white' },
  { key: 'github', label: 'GitHub', icon: FiGithub, color: 'from-gray-800 to-gray-900', textColor: 'text-white' },
  { key: 'youtube', label: 'YouTube', icon: FiYoutube, color: 'from-red-500 to-red-600', textColor: 'text-white' },
  { key: 'line', label: 'LINE', icon: SiLine, color: 'from-green-400 to-green-500', textColor: 'text-white' },
  { key: 'twitch', label: 'Twitch', icon: SiTwitch, color: 'from-purple-500 to-purple-600', textColor: 'text-white' },
  { key: 'discord', label: 'Discord', icon: SiDiscord, color: 'from-indigo-500 to-indigo-600', textColor: 'text-white' },
  { key: 'website', label: 'ウェブサイト', icon: FiGlobe, color: 'from-primary to-accent', textColor: 'text-white' },
];

interface FanmarkProfileProps {
  fanmark: FanmarkData;
}

export const FanmarkProfile = ({ fanmark }: FanmarkProfileProps) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [emojiProfile, setEmojiProfile] = useState<PublicEmojiProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLiked, setIsLiked] = useState(false);

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
            id: profile?.id,
            fanmark_id: profile?.fanmark_id,
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

  const handleShare = async () => {
    const url = `https://fanmark.id/${fanmark.emoji_combination}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: displayName,
          url: url,
        });
      } catch (error) {
        navigator.clipboard.writeText(url);
        toast({
          title: "リンクをコピーしました",
          description: url,
        });
      }
    } else {
      navigator.clipboard.writeText(url);
      toast({
        title: "リンクをコピーしました",
        description: url,
      });
    }
  };

  const handleLike = () => {
    setIsLiked(!isLiked);
    toast({
      title: isLiked ? "いいねを取り消しました" : "いいねしました！",
      description: isLiked ? "" : "このプロフィールが気に入りました",
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 flex items-center justify-center">
        <Card className="w-96 rounded-3xl border border-primary/20 shadow-lg">
          <CardContent className="p-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-muted-foreground">{t('common.loading')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const displayName = emojiProfile?.display_name || fanmark.fanmark_name || 'Anonymous';
  const bio = emojiProfile?.bio || '';
  const coverImage = emojiProfile?.theme_settings?.cover_image_url;
  const profileImage = emojiProfile?.theme_settings?.profile_image_url;
  const socialLinks = emojiProfile?.social_links as Record<string, string> || {};

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <div className="container mx-auto px-4 py-8 max-w-md">
        {/* Header Actions */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="text-2xl">{fanmark.emoji_combination}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(`https://fanmark.id/${fanmark.emoji_combination}`);
                toast({
                  title: "URLをコピーしました",
                  description: `https://fanmark.id/${fanmark.emoji_combination}`,
                });
              }}
              className="h-8 w-8 p-0 rounded-full hover:bg-primary/10"
            >
              <Copy className="h-3 w-3" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLike}
              className="rounded-full h-10 w-10 p-0 hover:bg-red-50 hover:text-red-500"
            >
              <Heart className={`h-4 w-4 ${isLiked ? 'fill-current text-red-500' : ''}`} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleShare}
              className="rounded-full h-10 w-10 p-0 hover:bg-primary/10"
            >
              <Share className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Cover Image */}
        <div className="relative mb-6">
          <div
            className="w-full h-48 rounded-3xl overflow-hidden bg-gradient-to-r from-primary/20 via-accent/20 to-primary/10 shadow-lg mb-6"
            style={coverImage ? {
              backgroundImage: `url(${coverImage})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            } : {}}
          >
            {!coverImage && (
              <div className="w-full h-full flex items-center justify-center">
                <div className="text-center space-y-2 text-primary/70">
                  <div className="text-6xl animate-float">✨</div>
                  <p className="text-sm font-medium px-4">素敵なプロフィールページ</p>
                </div>
              </div>
            )}
          </div>

          {/* Profile Image */}
          <div className="absolute -bottom-12 left-1/2 transform -translate-x-1/2">
            <div className="relative">
              <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-background shadow-xl bg-background">
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
              <div className="absolute -bottom-1 -right-1">
                <Badge className="bg-emerald-500 text-white border-2 border-background rounded-full px-2 py-1 text-xs shadow-lg">
                  アクティブ
                </Badge>
              </div>
            </div>
          </div>
        </div>

        {/* Profile Info */}
        <div className="text-center mb-8 mt-16">
          <h1 className="text-2xl font-bold text-foreground mb-3">
            {displayName}
          </h1>
          {bio && (
            <p className="text-foreground/80 leading-relaxed text-sm px-4 mb-4">
              {bio}
            </p>
          )}
        </div>

        {/* Social Links */}
        {Object.keys(socialLinks).length > 0 && (
          <div className="space-y-3 mb-8">
            {Object.entries(socialLinks).map(([platform, url]) => {
              const platformConfig = socialPlatforms.find(p => p.key === platform);
              if (!platformConfig || !url) return null;

              const Icon = platformConfig.icon;

              return (
                <Card key={platform} className="overflow-hidden transition-all duration-300 hover:scale-[1.02] hover:shadow-lg rounded-2xl border border-primary/10">
                  <CardContent className="p-0">
                    <button
                      onClick={() => window.open(url, '_blank')}
                      className="w-full p-4 flex items-center gap-4 text-left hover:bg-primary/5 transition-all duration-200"
                    >
                      <div className={`p-3 rounded-full bg-gradient-to-r ${platformConfig.color} ${platformConfig.textColor} flex items-center justify-center shadow-lg`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <span className="font-medium text-foreground">{platformConfig.label}</span>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{url}</p>
                      </div>
                      <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    </button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* No Content State */}
        {!bio && Object.keys(socialLinks).length === 0 && (
          <Card className="mb-8 rounded-3xl border border-primary/15 bg-background/90 shadow-lg backdrop-blur">
            <CardContent className="p-8 text-center">
              <div className="space-y-4">
                <div className="w-16 h-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="h-8 w-8 text-primary/50" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground mb-2">プロフィールを作成中</h3>
                  <p className="text-sm text-muted-foreground">
                    まもなく素敵なプロフィールが公開されます
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* fanmark.id Logo */}
        <div className="text-center pt-8">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="group inline-flex items-center gap-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 via-accent/20 to-primary/10 text-xl transition-all group-hover:scale-105 shadow-lg">
              ✨
            </span>
            <div className="text-left">
              <div className="text-gradient text-lg font-bold">fanmark.id</div>
              <div className="text-xs text-muted-foreground">あなたのファンマークを見つけよう</div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};