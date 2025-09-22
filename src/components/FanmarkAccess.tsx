import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Home, AlertCircle } from 'lucide-react';
import { FanmarkProfile } from './FanmarkProfile';
import { FanmarkMessage } from './FanmarkMessage';
import { useTranslation } from '@/hooks/useTranslation';

interface FanmarkData {
  id: string;
  emoji_combination: string;
  display_name: string;
  access_type: 'profile' | 'redirect' | 'text' | 'inactive';
  target_url?: string;
  text_content?: string;
  status: string;
  user_id: string;
}

export const FanmarkAccess = () => {
  const { emojiPath } = useParams<{ emojiPath: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [fanmark, setFanmark] = useState<FanmarkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        
        // Query fanmarks by emoji_combination
        const { data, error } = await supabase
          .from('fanmarks')
          .select('*')
          .eq('emoji_combination', decodedEmoji)
          .eq('status', 'active')
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            setError('Fanmark not found');
          } else {
            setError('Failed to load fanmark');
          }
          setLoading(false);
          return;
        }

        setFanmark(data as FanmarkData);

        // Handle redirect immediately
        if (data.access_type === 'redirect' && data.target_url) {
          window.location.href = data.target_url;
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
      return <FanmarkMessage fanmark={fanmark} />;
    
    case 'inactive':
      return (
        <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 flex items-center justify-center">
          <Card className="w-96">
            <CardContent className="p-8 text-center space-y-4">
              <div className="text-6xl mb-4">{fanmark.emoji_combination}</div>
              <h1 className="text-xl font-semibold">{fanmark.display_name}</h1>
              <p className="text-muted-foreground">
                This fanmark is currently inactive.
              </p>
              <Button onClick={() => navigate('/')} className="w-full">
                <Home className="h-4 w-4 mr-2" />
                Go to Home
              </Button>
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