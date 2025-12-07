import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Home, AlertCircle, Sparkles } from 'lucide-react';
import { FanmarkProfile } from './FanmarkProfile';
import { FanmarkMessage } from './FanmarkMessage';
import { PasswordProtection } from './PasswordProtection';
import { RedirectLoading } from './RedirectLoading';
import { MessageboardLoading } from './MessageboardLoading';
import { resolveFanmarkDisplay, segmentEmojiSequence } from '@/lib/emojiConversion';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { AppHeader } from '@/components/layout/AppHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { createFanmarkBadgeStyle } from '@/lib/fanmarkBadge';
import { useAuth } from '@/hooks/useAuth';
import { FiCompass } from 'react-icons/fi';

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
  short_id?: string;
}

export const FanmarkAccessByShortId = () => {
  const { shortId } = useParams<{ shortId: string }>();
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

        // Record access analytics (fire-and-forget, non-blocking)
        const recordAccess = async () => {
          try {
            const searchParams = new URLSearchParams(window.location.search);
            await supabase.functions.invoke('record-fanmark-access', {
              body: {
                fanmark_id: fanmarkData.id,
                short_id: shortId,
                referrer: document.referrer || null,
                user_agent: navigator.userAgent,
                utm_source: searchParams.get('utm_source'),
                utm_medium: searchParams.get('utm_medium'),
                utm_campaign: searchParams.get('utm_campaign'),
                access_type: resolvedFanmark.access_type || null,
              },
            });
          } catch (error) {
            console.warn('Failed to record fanmark access:', error);
          }
        };
        recordAccess();

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

  const badgeStyle = useMemo(
    () => createFanmarkBadgeStyle(displayFanmark),
    [displayFanmark]
  );
  const segmentedFanmark = useMemo(
    () => segmentEmojiSequence(displayFanmark),
    [displayFanmark]
  );
  const isUnclaimed = useMemo(() => !fanmark?.license_id, [fanmark?.license_id]);
  const compactBadgeStyle = useMemo(() => {
    const count = Math.max(segmentedFanmark.length, 1);
    const emojiWidthRem = 2.1; // 絵文字実寸よりやや大きめに見積もる
    const gapRem = 0.4;
    const sidePaddingRem = 0.8; // 左右0.8remずつで背景をわずかに拡張
    const totalWidthRem = count * emojiWidthRem + Math.max(count - 1, 0) * gapRem + sidePaddingRem * 2;

    return {
      height: badgeStyle.height,
      fontSize: badgeStyle.fontSize,
      lineHeight: badgeStyle.lineHeight,
      borderRadius: '18px',
      width: `${totalWidthRem}rem`,
      minWidth: 'max-content',
      padding: `${typeof badgeStyle.padding === 'string' ? badgeStyle.padding.split(' ')[0] : (badgeStyle.padding ?? 0)} ${sidePaddingRem}rem`,
    } as React.CSSProperties;
  }, [badgeStyle.fontSize, badgeStyle.height, badgeStyle.lineHeight, badgeStyle.padding, segmentedFanmark.length]);

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

  // Unclaimed / ownerless fanmark
  if (isUnclaimed) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/40 flex flex-col">
        <AppHeader
          className="sticky top-0 z-50 border-border/40 bg-background/80 backdrop-blur-xl"
          showNotifications={false}
          showLanguageToggle
        />

        <main className="container mx-auto flex-1 px-4 py-10 md:py-16 flex items-center justify-center">
          <Card className="w-full max-w-xl overflow-hidden rounded-3xl border border-primary/20 bg-background/95 backdrop-blur shadow-[0_25px_60px_rgba(101,195,200,0.18)]">
            <CardContent className="p-10 text-center space-y-8">
              <div
                className="mx-auto inline-flex items-center justify-center bg-gradient-to-br from-primary/15 via-accent/10 to-blue-100 text-primary shadow-[0_20px_45px_rgba(101,195,200,0.25)]"
                style={compactBadgeStyle}
              >
                <div className="flex items-center justify-center gap-1.5 leading-none">
                  {segmentedFanmark.map((segment, index) => (
                    <span key={`${segment}-${index}`} className="inline-flex min-w-[1.15rem] justify-center">
                      {segment}
                    </span>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <h1 className="text-xl font-semibold text-foreground">
                  {t('common.fanmarkNotAcquiredDescription')}
                </h1>
              </div>
              <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                <Button
                  onClick={() => {
                    try {
                      localStorage.setItem('fanmark.prefill', displayFanmark);
                    } catch (error) {
                      console.warn('Failed to persist fanmark prefill:', error);
                    }
                    navigate('/', { state: { prefillFanmark: displayFanmark, scrollToSearch: true } });
                  }}
                  className="px-5 min-w-[10rem]"
                  size="default"
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  {t('common.acquireThisFanmark')}
                </Button>
                {fanmark.short_id && (
                  <Button
                    asChild
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 rounded-full border border-primary/15 bg-background/80 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                    aria-label={t('common.viewFanmarkDetails')}
                  >
                    <Link to={`/f/${fanmark.short_id}`}>
                      <Sparkles className="h-5 w-5" />
                    </Link>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </main>

        <SiteFooter className="border-border/40 bg-background/80 backdrop-blur" />
      </div>
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
        <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/40 flex flex-col">
          <AppHeader
            className="sticky top-0 z-50 border-border/40 bg-background/80 backdrop-blur-xl"
            showNotifications={false}
            showLanguageToggle
          />

          <main className="container mx-auto flex-1 px-4 py-10 md:py-16 flex items-center justify-center">
            <Card className="w-full max-w-lg overflow-hidden rounded-3xl border border-primary/20 bg-background/95 backdrop-blur shadow-[0_25px_60px_rgba(101,195,200,0.18)]">
              <CardContent className="p-8 text-center space-y-6">
                <div
                  className="mx-auto inline-flex items-center justify-center bg-gradient-to-br from-primary/15 via-accent/10 to-blue-100 text-primary shadow-[0_20px_45px_rgba(101,195,200,0.25)]"
                  style={compactBadgeStyle}
                >
                  <div className="flex items-center justify-center gap-1.5 leading-none">
                    {segmentedFanmark.map((segment, index) => (
                      <span key={`${segment}-${index}`} className="inline-flex min-w-[1.15rem] justify-center">
                        {segment}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <h1 className="text-xl font-semibold text-foreground">
                    {t('common.inactiveTitle')}
                  </h1>
                </div>
                <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                  <Button onClick={handleGetFanmark} className="px-5 min-w-[10rem]" size="default">
                    <Sparkles className="h-4 w-4 mr-2" />
                    {t('common.getFanmarkCta')}
                  </Button>
                  {fanmark.short_id && (
                    <Button
                      asChild
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 rounded-full border border-primary/15 bg-background/80 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                      aria-label={t('common.viewFanmarkDetails')}
                    >
                      <Link to={`/f/${fanmark.short_id}`}>
                        <Sparkles className="h-5 w-5" />
                      </Link>
                    </Button>
                  )}
                </div>
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
