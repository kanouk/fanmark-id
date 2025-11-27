import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Home, AlertCircle, Sparkles } from 'lucide-react';
import { FanmarkProfile } from './FanmarkProfile';
import { FanmarkMessage } from './FanmarkMessage';
import { PasswordProtection } from './PasswordProtection';
import { RedirectLoading } from './RedirectLoading';
import { MessageboardLoading } from './MessageboardLoading';
import { LanguageToggle } from '@/components/LanguageToggle';
import { SimpleHeader } from '@/components/layout/SimpleHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { createFanmarkBadgeStyle } from '@/lib/fanmarkBadge';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { normalizeEmojiPath, isEmojiOnly } from '@/utils/emojiUrl';
import { convertEmojiSequenceToIdPair, resolveFanmarkDisplay } from '@/lib/emojiConversion';
import NotFound from '@/pages/NotFound';
import { useAuth } from '@/hooks/useAuth';

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
  short_id?: string;
  license_id?: string;
}


export const FanmarkAccess = () => {
  const { emojiPath } = useParams<{ emojiPath: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [fanmark, setFanmark] = useState<FanmarkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPasswordVerified, setIsPasswordVerified] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [isShowingMessageboard, setIsShowingMessageboard] = useState(false);

  const handleFanmarkUnavailable = useCallback(
    (emoji: string | null, descriptionKey: string, variant: 'default' | 'destructive' = 'default') => {
      setLoading(false);
      try {
        if (emoji) {
          localStorage.setItem('fanmark.prefill', emoji);
        }
      } catch (storageError) {
        console.warn('Failed to cache fanmark emoji for redirect:', storageError);
      }

      toast({
        title: t('common.fanmarkNotFound'),
        description: t(descriptionKey),
        variant: variant === 'destructive' ? 'destructive' : undefined,
      });

      navigate('/', { replace: true, state: emoji ? { prefillFanmark: emoji } : undefined });
    },
    [navigate, setLoading, toast, t]
  );

  const decodedEmojiPath = React.useMemo(() => {
    if (!emojiPath) return '';
    try {
      return decodeURIComponent(emojiPath);
    } catch {
      return emojiPath;
    }
  }, [emojiPath]);

  const shouldShortCircuitToNotFound = React.useMemo(() => {
    if (!decodedEmojiPath) return true;
    return !isEmojiOnly(decodedEmojiPath);
  }, [decodedEmojiPath]);

  useEffect(() => {
    if (shouldShortCircuitToNotFound) {
      setFanmark(null);
      setLoading(false);
      return;
    }

    const loadFanmark = async () => {
      try {
        // 絵文字パスの正規化処理
        const normalizedEmoji = normalizeEmojiPath(decodedEmojiPath);
        console.log('🎯 Final emoji for database query:', { normalizedEmoji, length: normalizedEmoji.length });

        // Use the secure function to get only essential fanmark data
        let emojiIds: string[] = [];
        let normalizedEmojiIds: string[] = [];
        try {
          const pair = convertEmojiSequenceToIdPair(decodedEmojiPath.replace(/\s/g, ''));
          emojiIds = pair.emojiIds;
          normalizedEmojiIds = pair.normalizedEmojiIds;
        } catch (conversionError) {
          console.error('Failed to convert emoji to ids for lookup:', conversionError);
          handleFanmarkUnavailable(normalizedEmoji, 'common.fanmarkNotAcquiredDescription');
          return;
        }

        if (emojiIds.length === 0 || normalizedEmojiIds.length === 0) {
          handleFanmarkUnavailable(normalizedEmoji, 'common.fanmarkNotAcquiredDescription');
          return;
        }

        const { data, error } = await supabase
          .rpc('get_fanmark_by_emoji', { input_emoji_ids: normalizedEmojiIds });

        if (error) {
          console.error('Database error:', error);
          handleFanmarkUnavailable(normalizedEmoji, 'common.failedToLoadFanmark', 'destructive');
          return;
        }

        if (!data || data.length === 0) {
          handleFanmarkUnavailable(normalizedEmoji, 'common.fanmarkNotAcquiredDescription');
          return;
        }

        const fanmarkRecord = data[0] as FanmarkData;

        const resolvedEmojiIds = Array.isArray(fanmarkRecord.emoji_ids)
          ? (fanmarkRecord.emoji_ids as (string | null)[]).filter((value): value is string => Boolean(value))
          : [];
        const userInputValue =
          typeof fanmarkRecord.user_input_fanmark === 'string' ? fanmarkRecord.user_input_fanmark : '';
        const displayFanmark = resolveFanmarkDisplay(userInputValue, resolvedEmojiIds);

        const resolvedFanmark: FanmarkData = {
          ...fanmarkRecord,
          user_input_fanmark: userInputValue,
          emoji_ids: resolvedEmojiIds,
          fanmark: displayFanmark,
        };

        if (!resolvedFanmark.license_id) {
          console.warn('Loaded fanmark without license_id. Profile access requires active license linkage.');
        }

        // NEW: Redirect to short_id URL format for better UX
        if (resolvedFanmark.short_id) {
          const shortIdPath = `/a/${resolvedFanmark.short_id}`;
          console.log('🔄 Redirecting to short_id URL:', { from: window.location.pathname, to: shortIdPath });
          navigate(shortIdPath, { replace: true });
          return; // Don't proceed with rendering, let the redirect happen
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
            const targetUrl = resolvedFanmark.target_url!;
            window.location.href = targetUrl;
            if (targetUrl.startsWith('tel:')) {
              setTimeout(() => {
                navigate(user ? '/dashboard' : '/', { replace: true });
              }, 1000);
            }
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
        let normalizedEmoji: string | null = null;
        try {
          normalizedEmoji = emojiPath ? normalizeEmojiPath(emojiPath) : null;
        } catch (normalizeError) {
          normalizedEmoji = emojiPath ?? null;
        }

        handleFanmarkUnavailable(normalizedEmoji, 'common.failedToLoadFanmark', 'destructive');
      }
    };

    loadFanmark();
  }, [decodedEmojiPath, shouldShortCircuitToNotFound, handleFanmarkUnavailable]);

  // Trigger redirect/messageboard after verification
  useEffect(() => {
    if (isPasswordVerified && fanmark) {
      if (fanmark.access_type === 'redirect' && fanmark.target_url) {
        setIsRedirecting(true);
        setTimeout(() => {
          const targetUrl = fanmark.target_url!;
          window.location.href = targetUrl;
          if (targetUrl.startsWith('tel:')) {
            setTimeout(() => {
              navigate(user ? '/dashboard' : '/', { replace: true });
            }, 1000);
          }
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

  const displayFanmark = useMemo(() => {
    const raw = fanmark?.fanmark ?? fanmark?.user_input_fanmark ?? '';
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : '✨';
  }, [fanmark?.fanmark, fanmark?.user_input_fanmark]);

  if (shouldShortCircuitToNotFound) {
    return <NotFound />;
  }

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

  const badgeStyle = useMemo(
    () => createFanmarkBadgeStyle(displayFanmark),
    [displayFanmark]
  );

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
    
    case 'inactive': {
      const handleGetFanmark = () => {
        navigate('/', { state: { scrollToSearch: true } });
      };

      return (
        <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 flex flex-col">
          <SimpleHeader
            className="sticky top-0 z-50 border-border/40 bg-background/80 backdrop-blur-xl"
            showLanguageToggle={false}
            rightSlot={<LanguageToggle />}
          />

          <main className="container mx-auto flex-1 px-4 py-10 md:py-16 flex items-center justify-center">
            <Card className="w-full max-w-xl overflow-hidden border border-primary/20 bg-background/95 backdrop-blur shadow-[0_25px_60px_rgba(101,195,200,0.18)]">
              <CardContent className="p-10 text-center space-y-8">
                <div
                  className="mx-auto flex items-center justify-center bg-gradient-to-br from-primary/15 via-accent/10 to-blue-100 text-primary shadow-[0_20px_45px_rgba(101,195,200,0.25)]"
                  style={badgeStyle}
                >
                  {displayFanmark}
                </div>
                <div className="space-y-3">
                  <h1 className="text-2xl font-semibold text-foreground">
                    {t('common.inactiveTitle')}
                  </h1>
                </div>
                <Button onClick={handleGetFanmark} className="w-full" size="lg">
                  <Sparkles className="h-4 w-4 mr-2" />
                  {t('common.getFanmarkCta')}
                </Button>
              </CardContent>
            </Card>
          </main>

          <SiteFooter className="border-border/40 bg-background/80 backdrop-blur" />
        </div>
      );
    }

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
