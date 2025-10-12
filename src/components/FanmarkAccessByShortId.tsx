import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Home, AlertCircle } from 'lucide-react';
import { FanmarkProfile } from './FanmarkProfile';
import { FanmarkMessage } from './FanmarkMessage';
import { PasswordProtection } from './PasswordProtection';
import { RedirectLoading } from './RedirectLoading';
import { MessageboardLoading } from './MessageboardLoading';
import { resolveFanmarkDisplay } from '@/lib/emojiConversion';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';

interface FanmarkData {
  id: string;
  user_input_fanmark: string;
  emoji_ids?: string[];
  fanmark?: string;
  fanmark_name: string;
  access_type: 'profile' | 'redirect' | 'text' | 'inactive';
  target_url?: string;
  text_content?: string;
  status: string;
  is_password_protected?: boolean;
  license_id?: string;
}

export const FanmarkAccessByShortId = () => {
  const { shortId } = useParams<{ shortId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [fanmark, setFanmark] = useState<FanmarkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPasswordVerified, setIsPasswordVerified] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [isShowingMessageboard, setIsShowingMessageboard] = useState(false);

  const handleFanmarkUnavailable = useCallback(
    (descriptionKey: string, variant: 'default' | 'destructive' = 'default') => {
      setLoading(false);
      toast({
        title: t('common.fanmarkNotFound'),
        description: t(descriptionKey),
        variant: variant === 'destructive' ? 'destructive' : undefined,
      });

      navigate('/', { replace: true });
    },
    [navigate, setLoading, toast, t]
  );

  useEffect(() => {
    const loadFanmark = async () => {
      if (!shortId) {
        handleFanmarkUnavailable('common.invalidFanmarkUrl', 'destructive');
        return;
      }

      try {
        console.log('🎯 Loading fanmark by short_id:', shortId);

        // Use the dedicated function to get fanmark data by short_id
        const { data, error } = await supabase
          .rpc('get_fanmark_by_short_id', { shortid_param: shortId });

        if (error) {
          console.error('Database error:', error);
          handleFanmarkUnavailable('common.failedToLoadFanmark', 'destructive');
          return;
        }

        if (!data || (Array.isArray(data) && data.length === 0)) {
          handleFanmarkUnavailable('common.fanmarkNotAcquiredDescription');
          return;
        }

        const fanmarkData = data[0] as FanmarkData;
        const emojiIds = Array.isArray(fanmarkData.emoji_ids)
          ? (fanmarkData.emoji_ids as (string | null)[]).filter((value): value is string => Boolean(value))
          : [];
        const resolvedFanmark: FanmarkData = {
          ...fanmarkData,
          emoji_ids: emojiIds,
          fanmark: resolveFanmarkDisplay(fanmarkData.user_input_fanmark ?? '', emojiIds),
        };

        if (!resolvedFanmark.license_id) {
          console.warn('Loaded fanmark without license_id. Profile access requires active license linkage.');
        }

        // Show redirect loading and then redirect if it's a redirect type without password protection
        if (resolvedFanmark.access_type === 'redirect' &&
            resolvedFanmark.target_url &&
            !resolvedFanmark.is_password_protected) {
          console.log('Redirecting to:', resolvedFanmark.target_url);
          setFanmark(resolvedFanmark); // Set fanmark for RedirectLoading
          setIsRedirecting(true);
          setLoading(false); // Stop loading immediately
          setTimeout(() => {
            window.location.href = resolvedFanmark.target_url!;
          }, 2000); // Show redirect loading for 2 seconds
          return;
        }

        // Show messageboard loading for text type without password protection
        if (resolvedFanmark.access_type === 'text' && !resolvedFanmark.is_password_protected) {
          setFanmark(resolvedFanmark);
          setIsShowingMessageboard(true);
          setLoading(false);
          setTimeout(() => {
            setIsShowingMessageboard(false);
          }, 1500); // Show messageboard loading for 1.5 seconds
          return;
        }

        setFanmark(resolvedFanmark);
        setLoading(false);
      } catch (err) {
        console.error('Error loading fanmark:', err);
        handleFanmarkUnavailable('common.failedToLoadFanmark', 'destructive');
      }
    };

    loadFanmark();
  }, [shortId, handleFanmarkUnavailable]);

  // Trigger redirect/messageboard after verification
  useEffect(() => {
    if (isPasswordVerified && fanmark) {
      if (fanmark.access_type === 'redirect' && fanmark.target_url) {
        setIsRedirecting(true);
        setTimeout(() => {
          window.location.href = fanmark.target_url!;
        }, 2000); // Show loading for 2 seconds
      } else if (fanmark.access_type === 'text') {
        setIsShowingMessageboard(true);
        setTimeout(() => {
          setIsShowingMessageboard(false);
        }, 1500); // Show messageboard loading for 1.5 seconds
      }
    }
  }, [isPasswordVerified, fanmark]);

  // Handle password verification success for all access types
  const handlePasswordSuccess = () => {
    setIsPasswordVerified(true);
  };

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

  if (!fanmark) {
    return null;
  }

  // Handle password protection for all access types
  if (fanmark.is_password_protected && !isPasswordVerified) {
    return (
      <PasswordProtection
        fanmark={fanmark}
        onSuccess={handlePasswordSuccess}
      />
    );
  }

  // Show redirect loading screen when redirecting
  if (isRedirecting && fanmark.access_type === 'redirect' && fanmark.target_url) {
    return (
      <RedirectLoading
        targetUrl={fanmark.target_url}
        fanmark={fanmark.fanmark || fanmark.user_input_fanmark}
      />
    );
  }

  // Show messageboard loading screen when showing messageboard
  if (isShowingMessageboard && fanmark.access_type === 'text') {
    return (
      <MessageboardLoading
        fanmark={fanmark.fanmark || fanmark.user_input_fanmark}
      />
    );
  }

  // Handle different access types after password verification
  switch (fanmark.access_type) {
    case 'profile':
      return <FanmarkProfile fanmark={fanmark} />;

    case 'text':
      return <FanmarkMessage fanmark={fanmark} />;

    case 'redirect':
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

    case 'inactive':
      return (
        <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 flex items-center justify-center">
          <Card className="w-96">
            <CardContent className="p-8 text-center space-y-4">
              <div className="text-6xl mb-4">{fanmark.fanmark || fanmark.user_input_fanmark}</div>
              <p className="text-lg font-medium text-foreground">
                {t('common.getYourFanmark')}
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
              <h1 className="text-xl font-semibold">{t('common.invalidAccessType')}</h1>
              <p className="text-muted-foreground">
                {t('common.invalidConfiguration')}
              </p>
              <Button onClick={() => navigate('/')} className="w-full">
                <Home className="h-4 w-4 mr-2" />
                {t('common.goToHome')}
              </Button>
            </CardContent>
          </Card>
        </div>
      );
  }
};
