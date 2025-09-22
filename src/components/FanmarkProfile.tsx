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
  emoji_combination: string;
  display_name: string;
  access_type: 'profile' | 'redirect' | 'text' | 'inactive';
  target_url?: string;
  text_content?: string;
  status: string;
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
    // For security reasons, we can't load detailed profile information
    // when accessing via emoji URL since we don't expose user_id
    setLoading(false);
  }, []);

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
  const bio = `Profile for ${fanmark.emoji_combination}`;

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
              <p className="text-sm text-muted-foreground text-center">
                This is a simplified profile view. Full profile features are available when logged in.
              </p>
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