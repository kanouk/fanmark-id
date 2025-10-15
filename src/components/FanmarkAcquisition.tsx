import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Search, Sparkles, ExternalLink, Plus, Heart } from 'lucide-react';
import { FiInfo, FiAlertTriangle } from 'react-icons/fi';
import FanmarkSearch from '@/components/FanmarkSearch';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { navigateToFanmark } from '@/utils/emojiUrl';
import { canonicalizeEmojiString, convertEmojiSequenceToIdPair, segmentEmojiSequence, extractEmojiString } from '@/lib/emojiConversion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { FanmarkSearchResult } from '@/hooks/useFanmarkSearch';
import { FanmarkStatusBadge } from '@/components/FanmarkStatusBadge';
import { EmojiInputUtilities } from '@/components/EmojiInput';
import { FanmarkAcquisitionLoading } from '@/components/FanmarkAcquisitionLoading';
import { supabase } from '@/integrations/supabase/client';
import { useFavoriteFanmarks, useInvalidateFavoriteFanmarks } from '@/hooks/useFavoriteFanmarks';

const SCROLL_TARGET_KEY = 'fanmark-search:scroll-target';

interface FanmarkAcquisitionProps {
  prefilledEmoji?: string;
  fanmarkLimit?: number;
  currentCount?: number;
  onObtain?: (fanmark: { id: string; user_input_fanmark?: string; emoji_ids?: string[]; normalized_emoji_ids?: string[] }) => void;
  onRequireAuth?: (emoji: string) => void;
  rememberSearch?: boolean;
}

export const FanmarkAcquisition = ({
  prefilledEmoji,
  fanmarkLimit = 0,
  currentCount = 0,
  onObtain,
  onRequireAuth,
  rememberSearch = false,
}: FanmarkAcquisitionProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { favorites, isLoading: favoritesLoading } = useFavoriteFanmarks({
    enabled: Boolean(user),
  });
  const invalidateFavorites = useInvalidateFavoriteFanmarks();

  const [searchResult, setSearchResult] = useState<FanmarkSearchResult | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [favoriteOverride, setFavoriteOverride] = useState<boolean | null>(null);
  const [favoriteProcessing, setFavoriteProcessing] = useState(false);
  const normalizeQuery = useCallback((value: string | undefined) => {
    if (!value) return '';
    const extracted = extractEmojiString(value);
    if (!extracted) return '';
    const canonical = canonicalizeEmojiString(extracted);
    return segmentEmojiSequence(canonical).slice(0, 5).join('');
  }, []);

  const [query, setQuery] = useState(() => normalizeQuery(prefilledEmoji));
  const storageKey = useMemo(() => (rememberSearch ? `fanmark-search:${location.pathname}` : null), [rememberSearch, location.pathname]);
  const hasLoadedInitialStorage = useRef(false);
  const hasScrolledRef = useRef(false);
  const remainingCapacity = useMemo(() => {
    if (!user || fanmarkLimit === -1) {
      return Infinity; // 非ログイン時/無制限
    }
    return Math.max(fanmarkLimit - currentCount, 0);
  }, [fanmarkLimit, currentCount, user]);

  const isResultAcquirable = useMemo(() => searchResult?.status === 'available', [searchResult]);

  const isOwnedByMe = useMemo(() => {
    return !!(searchResult?.owner?.user_id && user?.id && searchResult.owner.user_id === user.id);
  }, [searchResult?.owner?.user_id, user?.id]);

  const isTaken = useMemo(() => searchResult?.status === 'taken' || searchResult?.status === 'not_available', [searchResult?.status]);
  const canNavigateToDetail = Boolean(searchResult?.short_id);
  const displayedFanmark = searchResult?.fanmark || searchResult?.user_input_fanmark || '';
  const favoriteSequenceKeys = useMemo(() => {
    return new Set(
      favorites.map((favorite) => favorite.normalizedEmojiIds.join(','))
    );
  }, [favorites]);
  const currentNormalizedKey = useMemo(() => {
    const normalized = Array.isArray(searchResult?.normalized_emoji_ids)
      ? (searchResult?.normalized_emoji_ids as (string | null)[]).filter((value): value is string => Boolean(value))
      : [];
    return normalized.join(',');
  }, [searchResult?.normalized_emoji_ids]);
  const isFavorited = useMemo(() => {
    if (!currentNormalizedKey) return false;
    return favoriteSequenceKeys.has(currentNormalizedKey);
  }, [favoriteSequenceKeys, currentNormalizedKey]);
  const effectiveIsFavorited = favoriteOverride ?? isFavorited;
  const isFavoriteButtonDisabled = favoriteProcessing || (!!user && favoritesLoading);
  useEffect(() => {
    setFavoriteOverride(null);
    setFavoriteProcessing(false);
  }, [searchResult?.id]);

  const getSearchAreaBackgroundClass = useMemo(() => {
    if (!searchResult || !searchResult.user_input_fanmark || searchResult.error) {
      return 'bg-background/90';
    }
    if (searchResult.status === 'available') return 'bg-emerald-50/30';
    // not_available
    return isOwnedByMe ? 'bg-sky-50/30' : 'bg-rose-50/30';
  }, [searchResult, isOwnedByMe]);

  const handleAcquireRequest = () => {
    if (!searchResult || !isResultAcquirable) return;

    if (!user) {
      onRequireAuth?.(searchResult.user_input_fanmark);
      return;
    }

    if (fanmarkLimit !== -1 && remainingCapacity <= 0) {
      toast({
        title: t('dashboard.acquireLimitReachedTitle'),
        description: t('dashboard.acquireLimitReachedDescription'),
        variant: 'destructive',
      });
      return;
    }

    setIsConfirmOpen(true);
  };

  const handleConfirmAcquire = useCallback(async () => {
    if (!searchResult) return;
    setIsRegistering(true);

    try {
      const compactEmoji = searchResult.user_input_fanmark.replace(/\s/g, '');
      let emojiIds: string[] = [];
      let normalizedEmojiIds: string[] = [];
      try {
        const pair = convertEmojiSequenceToIdPair(compactEmoji);
        emojiIds = pair.emojiIds;
        normalizedEmojiIds = pair.normalizedEmojiIds;
      } catch (conversionError) {
        const message = conversionError instanceof Error ? conversionError.message : t('dashboard.acquireFailedDescription');
        toast({
          title: t('dashboard.acquireFailedTitle'),
          description: message,
          variant: 'destructive',
        });
        setIsRegistering(false);
        setIsConfirmOpen(false);
        return;
      }

      const response = await supabase.functions.invoke<{ success: boolean; fanmark?: { id: string; user_input_fanmark?: string; emoji_ids?: string[]; normalized_emoji_ids?: string[] }; error?: string }>('register-fanmark', {
        body: { user_input_fanmark: searchResult.user_input_fanmark, emoji_ids: emojiIds, normalized_emoji_ids: normalizedEmojiIds },
      });

      if (response.error || !response.data?.success || !response.data.fanmark) {
        throw new Error(response.error?.message || response.data?.error || 'Failed to register fanmark');
      }

      const fanmark = response.data.fanmark;

      toast({
        title: t('dashboard.acquireSuccessTitle'),
        description: t('dashboard.acquireSuccessDescription'),
      });

      onObtain?.(fanmark);
      navigate(`/fanmarks/${fanmark.id}/settings`, { state: { isNew: true } });
    } catch (error) {
      console.error('Fanmark registration failed:', error);
      
      toast({
        title: t('dashboard.acquireFailedTitle'),
        description: error instanceof Error ? error.message : t('dashboard.acquireFailedDescription'),
        variant: 'destructive',
      });
    } finally {
      setIsRegistering(false);
      setIsConfirmOpen(false);
    }
  }, [navigate, onObtain, searchResult, t, toast]);

  const handleVisitFanmark = useCallback(() => {
    if (!searchResult?.user_input_fanmark) return;

    navigateToFanmark(searchResult.fanmark || searchResult.user_input_fanmark, true);
  }, [searchResult?.fanmark, searchResult?.user_input_fanmark]);

  const handleToggleFavorite = useCallback(async () => {
    if (!searchResult) return;
    const emojiIds = Array.isArray(searchResult.emoji_ids)
      ? (searchResult.emoji_ids as (string | null)[]).filter((value): value is string => Boolean(value))
      : [];
    if (emojiIds.length === 0) return;

    if (!user) {
      onRequireAuth?.(searchResult.user_input_fanmark ?? displayedFanmark);
      return;
    }

    setFavoriteProcessing(true);
    try {
      if (effectiveIsFavorited) {
        const { data, error } = await supabase.rpc('remove_fanmark_favorite', {
          input_emoji_ids: emojiIds,
        });
        if (error) throw error;
        if (data) {
          setFavoriteOverride(false);
          invalidateFavorites();
        }
      } else {
        const { data, error } = await supabase.rpc('add_fanmark_favorite', {
          input_emoji_ids: emojiIds,
        });
        if (error) throw error;
        if (data) {
          setFavoriteOverride(true);
          invalidateFavorites();
        }
      }
    } catch (error) {
      console.error('Error toggling favorite:', error);
      toast({
        title: t('common.error'),
        description: t('favorites.loadError'),
        variant: 'destructive',
      });
    } finally {
      setFavoriteProcessing(false);
    }
  }, [displayedFanmark, effectiveIsFavorited, invalidateFavorites, onRequireAuth, searchResult, t, toast, user]);

  useEffect(() => {
    if (!rememberSearch || !storageKey) {
      return;
    }
    if (typeof window === 'undefined') return;
    if (hasLoadedInitialStorage.current) return;

    const stored = sessionStorage.getItem(storageKey);
    if (stored !== null) {
      setQuery(normalizeQuery(stored));
      hasLoadedInitialStorage.current = true;
    }
  }, [rememberSearch, storageKey, normalizeQuery]);

  useEffect(() => {
    if (!rememberSearch) {
      setQuery(normalizeQuery(prefilledEmoji));
    }
  }, [rememberSearch, prefilledEmoji, normalizeQuery]);

  const handleQueryChange = useCallback(
    (value: string) => {
      const trimmed = value.trim();

      if (!trimmed) {
        setQuery('');
        if (rememberSearch && storageKey) {
          sessionStorage.removeItem(storageKey);
        }
        return;
      }

      const extracted = extractEmojiString(trimmed);
      if (!extracted) {
        toast({
          title: t('common.nonEmojiRejectedTitle'),
          description: t('common.nonEmojiRejectedBody'),
          variant: 'warning',
        });
        return;
      }

      const normalized = normalizeQuery(extracted);
      setQuery(normalized);
      if (!rememberSearch || !storageKey) return;

      if (!normalized.trim()) {
        sessionStorage.removeItem(storageKey);
        return;
      }

      sessionStorage.setItem(storageKey, normalized);
    },
    [rememberSearch, storageKey, normalizeQuery, toast, t],
  );

  const clearQuery = useCallback(() => {
    setQuery('');
    if (storageKey && typeof window !== 'undefined') {
      sessionStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!rememberSearch) return;
    if (typeof window === 'undefined') return;
    if (hasScrolledRef.current) return;

    const targetPath = sessionStorage.getItem(SCROLL_TARGET_KEY);
    if (targetPath && targetPath === location.pathname && containerRef.current) {
      hasScrolledRef.current = true;
      window.requestAnimationFrame(() => {
        containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        sessionStorage.removeItem(SCROLL_TARGET_KEY);
      });
    }
  }, [rememberSearch, location.pathname]);

  return (
    <div ref={containerRef} className="space-y-6">
      {/* ファンマ取得中のローディング画面 */}
      {isRegistering && (
        <FanmarkAcquisitionLoading emoji={searchResult?.user_input_fanmark} />
      )}

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent className="rounded-3xl border border-primary/20 bg-background/95 shadow-[0_25px_60px_rgba(101,195,200,0.2)]">
          <AlertDialogHeader className="space-y-3 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="h-6 w-6" />
            </div>
            <AlertDialogTitle className="text-xl font-semibold text-foreground">
              {t('dashboard.acquireConfirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              {t('dashboard.acquireConfirmDescription', {
                remaining: fanmarkLimit === -1 ? '∞' : Math.max(remainingCapacity - 1, 0),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <AlertDialogCancel
              className="h-11 rounded-full border border-border bg-transparent px-6 text-sm font-semibold text-muted-foreground hover:bg-primary/10 hover:text-foreground"
              disabled={isRegistering}
            >
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-lg hover:bg-primary/90"
              onClick={handleConfirmAcquire}
              disabled={isRegistering}
            >
              {isRegistering ? t('common.processing') : t('dashboard.acquireConfirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className={`rounded-3xl border border-primary/15 ${getSearchAreaBackgroundClass} shadow-[0_15px_35px_rgba(101,195,200,0.12)] backdrop-blur transition-colors duration-300`}>
        <CardHeader className="space-y-2 px-6 pt-6 pb-2">
          <CardTitle className="flex items-center justify-between text-lg font-semibold">
            <span className="flex items-center gap-2 text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              <Search className="h-6 w-6 text-primary" />
              {t('dashboard.searchFanma')}
            </span>
            {searchResult && (searchResult.fanmark || searchResult.user_input_fanmark) && !searchResult.error && (
              <div className="flex-shrink-0">
                <FanmarkStatusBadge
                  status={
                    searchResult.status === 'available'
                      ? 'available'
                      : (isOwnedByMe ? 'taken' : 'unavailable')
                  }
                />
              </div>
            )}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t('dashboard.searchSubtitle')}
          </p>
        </CardHeader>
        <CardContent className="px-6 pb-6">
          {/* ファンマ入力グループ - 入力と便利ツールが一体 */}
          <div className="mt-6 mb-10">
            <FanmarkSearch
              onSignupPrompt={() => onRequireAuth?.('')}
              statusVariant={user ? 'authenticated' : 'public'}
              showRecent={false}
              onResultChange={setSearchResult}
              query={query}
              onQueryChange={handleQueryChange}
            />

            {/* 便利ツール - レスポンシブ間隔 */}
            <div className="flex justify-center mt-1 sm:mt-6">
            <EmojiInputUtilities
              disabled={false}
              hasValue={!!(searchResult?.fanmark || searchResult?.user_input_fanmark)}
              onPaste={async () => {
                try {
                  if (!navigator.clipboard) {
                    toast({
                      title: t('common.error'),
                      description: t('common.clipboardNotSupported'),
                      variant: 'destructive',
                    });
                    return;
                  }

                  const clipboardText = await navigator.clipboard.readText();
                  if (!clipboardText.trim()) {
                    toast({
                      title: t('common.clipboardEmptyTitle'),
                      description: t('common.clipboardEmptyBody'),
                      variant: 'warning',
                    });
                    return;
                  }

                  const extracted = extractEmojiString(clipboardText);
                  if (!extracted) {
                    toast({
                      title: t('common.nonEmojiRejectedTitle'),
                      description: t('common.nonEmojiRejectedBody'),
                      variant: 'warning',
                    });
                    return;
                  }

                  handleQueryChange(extracted);

                  toast({
                    title: t('common.pasteCompletedTitle'),
                    description: t('common.pasteCompleted'),
                  });

                } catch (error) {
                  toast({
                    title: t('common.error'),
                    description: t('common.clipboardReadFailed'),
                    variant: 'destructive',
                  });
                }
              }}
              onDirectInput={(input: string) => {
                if (!input.trim()) return;

                const extracted = extractEmojiString(input);
                if (!extracted) {
                  toast({
                    title: t('common.nonEmojiRejectedTitle'),
                    description: t('common.nonEmojiRejectedBody'),
                    variant: 'warning',
                  });
                  return;
                }

                handleQueryChange(extracted);

                toast({
                  title: t('common.inputCompletedTitle'),
                  description: t('common.inputCompleted'),
                });
              }}
              onClear={() => {
                clearQuery();
                toast({
                  title: t('common.clearCompletedTitle'),
                });
              }}
              value={query}
            />
            </div>
          </div>

          {/* アクションボタン - 入力グループから分離 */}
          {searchResult && (
            <div className="flex flex-col gap-4 items-center">
              {/* Show acquisition button for available fanmarks */}
              {isResultAcquirable && (
                <Button
                  size="lg"
                  className="rounded-full px-8 py-3 gap-3 text-base font-semibold shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105"
                  onClick={handleAcquireRequest}
                  disabled={!searchResult || (fanmarkLimit !== -1 && remainingCapacity <= 0)}
                >
                  <Plus className="h-5 w-5" />
                  {user ? t('dashboard.acquireButton') : t('dashboard.acquireLoginButton')}
                </Button>
              )}

              {/* Action buttons for taken or discovered fanmarks */}
              {displayedFanmark && (
                <div className="flex w-full flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap">
                  {isTaken && (
                    <>
                      <Button
                        size="lg"
                        variant="outline"
                        className="rounded-full px-8 py-3 gap-3 text-base font-semibold border-primary/20 hover:border-primary/40 hover:bg-primary/5 transition-all duration-300"
                        onClick={handleVisitFanmark}
                  >
                    <ExternalLink className="h-5 w-5" />
                    {t('dashboard.visitFanmarkButton')}
                      </Button>
                      {canNavigateToDetail && searchResult?.short_id && (
                        <Button
                          size="lg"
                          variant="outline"
                          className="rounded-full px-8 py-3 gap-3 text-base font-semibold border-primary/20 hover:border-primary/40 hover:bg-primary/5 transition-all duration-300"
                          asChild
                    >
                      <Link to={`/f/${searchResult.short_id}`} className="flex items-center gap-3">
                        <Sparkles className="h-5 w-5" />
                        {t('dashboard.openFanmarkPage')}
                      </Link>
                    </Button>
                      )}
                    </>
                  )}
                  <Button
                    size="lg"
                    variant={effectiveIsFavorited ? 'default' : 'outline'}
                    className={`rounded-full px-8 py-3 gap-3 text-base font-semibold transition-all duration-300 ${
                      effectiveIsFavorited ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'border-primary/20 hover:border-primary/40 hover:bg-primary/5'
                    }`}
                    onClick={handleToggleFavorite}
                    disabled={isFavoriteButtonDisabled}
                  >
                    <Heart className={`h-5 w-5 ${effectiveIsFavorited ? 'fill-current' : ''}`} />
                    {effectiveIsFavorited ? t('fanmarkDetails.unfavorite') : t('fanmarkDetails.favorite')}
                  </Button>
                </div>
              )}

              {/* エラーメッセージ */}
              {searchResult?.status === 'available' && user && fanmarkLimit !== -1 && remainingCapacity <= 0 && (
                <div className="text-center p-4 rounded-xl bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/30">
                  <div className="text-amber-800 font-medium dark:text-amber-100">
                    {t('dashboard.acquireLimitReachedDescription')}
                  </div>
                  <div
                    className="mt-2 text-xs underline text-amber-800 cursor-pointer dark:text-amber-100"
                    onClick={() => {
                      if (typeof window !== 'undefined') {
                        sessionStorage.setItem(SCROLL_TARGET_KEY, location.pathname);
                      }
                      navigate('/plans', { state: { from: location.pathname } });
                    }}
                  >
                    {t('dashboard.acquireLimitIncreaseCta')}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
};
