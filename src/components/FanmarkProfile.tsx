import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Loader2, Home, User, Globe, Calendar } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';

interface FanmarkData {
  id: string;
  emoji_combination: string;
  display_name: string;
  user_id: string;
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
  const [emojiProfile, setEmojiProfile] = useState<EmojiProfile | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        // Load emoji profile
        const { data: emojiData, error: emojiError } = await supabase
          .from('emoji_profiles')
          .select('*')
          .eq('fanmark_id', fanmark.id)
          .eq('is_public', true)
          .single();

        if (emojiError && emojiError.code !== 'PGRST116') {
          console.error('Error loading emoji profile:', emojiError);
        } else {
          setEmojiProfile(emojiData);
        }

        // Load user profile for basic info
        const { data: userData, error: userError } = await supabase
          .from('profiles')
          .select('display_name, avatar_url, username')
          .eq('user_id', fanmark.user_id)
          .single();

        if (userError && userError.code !== 'PGRST116') {
          console.error('Error loading user profile:', userError);
        } else {
          setUserProfile(userData);
        }

        setLoading(false);
      } catch (err) {
        console.error('Error loading profile:', err);
        setLoading(false);
      }
    };

    loadProfile();
  }, [fanmark.id, fanmark.user_id]);

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

  const displayName = fanmark.display_name || userProfile?.display_name || userProfile?.username || 'Anonymous';
  const bio = emojiProfile?.bio || `Profile for ${fanmark.emoji_combination}`;
  const socialLinks = emojiProfile?.social_links || {};

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
                <AvatarImage src={userProfile?.avatar_url} />
                <AvatarFallback>
                  {displayName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <h2 className="text-xl font-semibold mb-2">{displayName}</h2>
                <p className="text-muted-foreground">{bio}</p>
              </div>
            </div>

            {/* Social Links */}
            {Object.keys(socialLinks).length > 0 && (
              <div className="space-y-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <Globe className="h-4 w-4" />
                  Links
                </h3>
                <div className="grid gap-2">
                  {Object.entries(socialLinks).map(([platform, url]) => (
                    <a
                      key={platform}
                      href={url as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                    >
                      <span className="font-medium capitalize">{platform}</span>
                      <span className="text-muted-foreground truncate">{url as string}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Profile Info */}
            {emojiProfile && (
              <div className="mt-6 pt-6 border-t border-border">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  Created {new Date(emojiProfile.created_at).toLocaleDateString()}
                </div>
              </div>
            )}
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