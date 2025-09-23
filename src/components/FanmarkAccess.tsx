import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Home, AlertCircle } from 'lucide-react';
import { FanmarkProfile } from './FanmarkProfile';
import { FanmarkMessage } from './FanmarkMessage';
import { PasswordProtection } from './PasswordProtection';
import { useTranslation } from '@/hooks/useTranslation';

interface FanmarkData {
  emoji_combination: string;
  display_name: string;
  access_type: 'profile' | 'redirect' | 'text' | 'inactive';
  target_url?: string;
  text_content?: string;
  status: string;
  is_password_protected?: boolean;
  access_password?: string;
}

export const FanmarkAccess = () => {
  const { emojiPath } = useParams<{ emojiPath: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [fanmark, setFanmark] = useState<FanmarkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPasswordVerified, setIsPasswordVerified] = useState(false);

  useEffect(() => {
    const loadFanmark = async () => {
      if (!emojiPath) {
        setError('Invalid fanmark URL');
        setLoading(false);
        return;
      }

      try {
        // Decode the emoji path
        const decodedEmoji = decodeURIComponent(emojiPath);
        
        // Use the secure function to get only essential fanmark data
        const { data, error } = await supabase
          .rpc('get_fanmark_by_emoji', { emoji_combo: decodedEmoji });

        if (error) {
          console.error('Database error:', error);
          setError('Failed to load fanmark');
          setLoading(false);
          return;
        }

        if (!data || data.length === 0) {
          setError('Fanmark not found');
          setLoading(false);
          return;
        }

        const fanmarkData = data[0] as FanmarkData;
        setFanmark(fanmarkData);

        // Handle redirect immediately
        if (fanmarkData.access_type === 'redirect' && fanmarkData.target_url) {
          window.location.href = fanmarkData.target_url;
          return;
        }

        setLoading(false);
      } catch (err) {
        console.error('Error loading fanmark:', err);
        setError('Failed to load fanmark');
        setLoading(false);
      }
    };

    loadFanmark();
  }, [emojiPath]);

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

  if (error || !fanmark) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 flex items-center justify-center">
        <Card className="w-96">
          <CardContent className="p-8 text-center space-y-4">
            <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
            <h1 className="text-xl font-semibold">Fanmark not found</h1>
            <p className="text-muted-foreground">
              {error || 'This fanmark does not exist or is not available.'}
            </p>
            <Button onClick={() => navigate('/')} className="w-full">
              <Home className="h-4 w-4 mr-2" />
              Go to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Handle different access types
  switch (fanmark.access_type) {
    case 'profile':
      return <FanmarkProfile fanmark={fanmark} />;
    
    case 'text':
      // Check if password protection is enabled
      if (fanmark.is_password_protected && !isPasswordVerified) {
        return (
          <PasswordProtection 
            fanmark={fanmark} 
            onSuccess={() => setIsPasswordVerified(true)} 
          />
        );
      }
      return <FanmarkMessage fanmark={fanmark} />;
    
    case 'inactive':
      return (
        <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 flex items-center justify-center">
          <Card className="w-96">
            <CardContent className="p-8 text-center space-y-4">
              <div className="text-6xl mb-4">{fanmark.emoji_combination}</div>
              <p className="text-lg font-medium text-foreground">
                あなたもファンマを取得しよう！
              </p>
              <div className="flex justify-center">
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
              </div>
            </CardContent>
          </Card>
        </div>
      );
    
    default:
      return (
        <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 flex items-center justify-center">
          <Card className="w-96">
            <CardContent className="p-8 text-center space-y-4">
              <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
              <h1 className="text-xl font-semibold">Invalid Access Type</h1>
              <p className="text-muted-foreground">
                This fanmark has an invalid configuration.
              </p>
              <Button onClick={() => navigate('/')} className="w-full">
                <Home className="h-4 w-4 mr-2" />
                Go to Home
              </Button>
            </CardContent>
          </Card>
        </div>
      );
  }
};