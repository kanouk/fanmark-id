import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Loader2, Home, User, Globe, Calendar } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { getPublicEmojiProfile, type PublicEmojiProfile } from '@/hooks/useEmojiProfile';

interface FanmarkData {
  emoji_combination: string;
  display_name: string;
  access_type: 'profile' | 'redirect' | 'text' | 'inactive';
  target_url?: string;
  text_content?: string;
  status: string;
  id?: string; // Add fanmark id for potential profile loading
}

interface EmojiProfile {
  id: string;
  bio?: string;
  theme_settings?: any;
  social_links?: any;
  created_at: string;
  updated_at: string;
}

interface UserProfile {
  display_name?: string;
  avatar_url?: string;
  username: string;
}

interface FanmarkProfileProps {
  fanmark: FanmarkData;
}

export const FanmarkProfile = ({ fanmark }: FanmarkProfileProps) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [emojiProfile, setEmojiProfile] = useState<PublicEmojiProfile | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProfile = async () => {
      // We can now safely load public profile data using the secure function
      // This doesn't expose user_id or other sensitive information
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
      <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 flex items-center justify-center">
        <Card className="w-96">
          <CardContent className="p-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-muted-foreground">{t('common.loading')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const displayName = fanmark.display_name || 'Anonymous';
  const bio = emojiProfile?.bio || `Profile for ${fanmark.emoji_combination}`;

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-8xl mb-4">{fanmark.emoji_combination}</div>
          <h1 className="text-3xl font-bold mb-2">{displayName}</h1>
          <Badge variant="secondary" className="mb-4">
            <User className="h-3 w-3 mr-1" />
            Fanmark Profile
          </Badge>
        </div>

        {/* Profile Content */}
        <Card className="mb-6">
          <CardContent className="p-6">
            <div className="flex items-start gap-4 mb-6">
              <Avatar className="h-16 w-16">
                <AvatarFallback>
                  {displayName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <h2 className="text-xl font-semibold mb-2">{displayName}</h2>
                <p className="text-muted-foreground">{bio}</p>
              </div>
            </div>

            <div className="bg-muted/30 rounded-lg p-4">
              {emojiProfile ? (
                <div className="space-y-2">
                  {emojiProfile.social_links && Object.keys(emojiProfile.social_links).length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium mb-2">Social Links</h3>
                      <div className="flex gap-2 flex-wrap">
                        {Object.entries(emojiProfile.social_links as Record<string, string>).map(([platform, url]) => (
                          <Button
                            key={platform}
                            variant="outline"
                            size="sm"
                            onClick={() => window.open(url, '_blank')}
                          >
                            <Globe className="h-3 w-3 mr-1" />
                            {platform}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground mt-4">
                    <Calendar className="h-3 w-3 inline mr-1" />
                    Profile created: {new Date(emojiProfile.created_at).toLocaleDateString()}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center">
                  {fanmark.access_type === 'profile' 
                    ? 'No detailed profile information available.'
                    : 'This fanmark is not configured as a profile.'}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Back to Home */}
        <div className="text-center">
          <Button onClick={() => navigate('/')} variant="outline">
            <Home className="h-4 w-4 mr-2" />
            Go to Home
          </Button>
        </div>
      </div>
    </div>
  );
};