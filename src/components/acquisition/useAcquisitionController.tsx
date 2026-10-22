import { useInvalidateOwnedFanmarks } from '@/hooks/useOwnedFanmarks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useIsMobile } from '@/hooks/use-mobile';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useEmojiCatalog } from '@/hooks/useEmojiCatalog';
import { emojiCatalog } from '@/lib/emoji-catalog-state';
import { FanmarkSearchResult } from '@/hooks/useFanmarkSearch';
import { useTranslation } from '@/hooks/useTranslation';
import { canonicalizeEmojiString, convertEmojiSequenceToIdPair, extractEmojiString, segmentEmojiSequence } from '@/lib/emojiConversion';
import { navigateToFanmark } from '@/utils/emojiUrl';

import { useFavoriteFanmarks, useInvalidateFavoriteFanmarks } from '@/hooks/useFavoriteFanmarks';
import { useLotteryEntry } from '@/hooks/useLotteryEntry';
import { invokeFanmarkRegistration } from '@/lib/fanmark-registration-api';
import { addFavoriteFanmark, removeFavoriteFanmark } from '@/lib/favorites-backend';

const SCROLL_TARGET_KEY = 'fanmark-search:scroll-target';

interface FanmarkAcquisitionProps {
  prefilledEmoji?: string;
  fanmarkLimit?: number;
  currentCount?: number;
  onObtain?: (fanmark: { id: string; user_input_fanmark?: string; emoji_ids?: string[]; normalized_emoji_ids?: string[] }) => void;
  onRequireAuth?: (emoji: string) => void;
  rememberSearch?: boolean;
  scrollToSearch?: boolean;
  onSearchScrolled?: () => void;
}
export function useAcquisitionController({
  prefilledEmoji,
  fanmarkLimit = 0,
  currentCount = 0,
  onObtain,
  onRequireAuth,
  rememberSearch = false,
  scrollToSearch = false,
  onSearchScrolled,
}: FanmarkAcquisitionProps) {
  const { t, language } = useTranslation();
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { ready: catalogReady } = useEmojiCatalog();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { favorites, isLoading: favoritesLoading } = useFavoriteFanmarks({
    enabled: Boolean(user),
  });
  const invalidateFavorites = useInvalidateFavoriteFanmarks();
  const invalidateOwned = useInvalidateOwnedFanmarks();
  const { applyToLottery, cancelLotteryEntry, loading: lotteryLoading } = useLotteryEntry();

  const [searchResult, setSearchResult] = useState<FanmarkSearchResult | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [favoriteOverride, setFavoriteOverride] = useState<boolean | null>(null);
  const [favoriteProcessing, setFavoriteProcessing] = useState(false);
  const normalizeQuery = useCallback((value: string | undefined) => {
    if (!value) return '';
    if (emojiCatalog.getSnapshot().phase !== 'ready') return value;
    const extracted = extractEmojiString(value);
    if (!extracted) return '';
    const canonical = canonicalizeEmojiString(extracted);
    return segmentEmojiSequence(canonical).slice(0, 5).join('');
  }, []);

  const [query, setQuery] = useState(() => normalizeQuery(prefilledEmoji));
  useEffect(() => {
    if (catalogReady) setQuery(current => normalizeQuery(current));
  }, [catalogReady, normalizeQuery]);
  const scopedUserKey = user?.id ?? 'guest';
  const storageKey = useMemo(
    () => (rememberSearch ? `fanmark-search:${scopedUserKey}:${location.pathname}` : null),
    [rememberSearch, scopedUserKey, location.pathname],
  );
  const hasLoadedInitialStorage = useRef(false);
  const hasScrolledRef = useRef(false);
  const previousStorageKeyRef = useRef<string | null>(null);
  const remainingCapacity = useMemo(() => {
    if (!user || fanmarkLimit === -1) {
      return Infinity; // 非ログイン時/無制限
    }
    return Math.max(fanmarkLimit - currentCount, 0);
  }, [fanmarkLimit, currentCount, user]);

  const isOwnedByMe = useMemo(() => {
    return !!(searchResult?.owner?.user_id && user?.id && searchResult.owner.user_id === user.id);
  }, [searchResult?.owner?.user_id, user?.id]);

  const isTaken = useMemo(() => searchResult?.status === 'taken' || searchResult?.status === 'not_available', [searchResult?.status]);
  const canShowFanmarkAccess = useMemo(() => searchResult?.status === 'taken', [searchResult?.status]);
  const canNavigateToDetail = Boolean(searchResult?.short_id);
  const displayedFanmark =
    searchResult?.display_fanmark || searchResult?.fanmark || searchResult?.user_input_fanmark || '';
  const isGraceBlocked = searchResult?.blocking_status === 'grace';
  const canVisitFanmark = Boolean(displayedFanmark) &&
    searchResult?.status !== 'available' &&
    !isGraceBlocked &&
    !(searchResult?.status === 'invalid' && searchResult?.id === 'invalid');
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
    if (!searchResult || !searchResult.fanmark || searchResult.error) {
      return 'bg-background/90';
    }
    if (searchResult.status === 'available') return 'bg-emerald-50/30';
    // not_available
    return isOwnedByMe ? 'bg-sky-50/30' : 'bg-rose-50/30';
  }, [searchResult, isOwnedByMe]);

  const formattedGraceAvailableAt = useMemo(() => {
    if (!searchResult?.available_at) return null;
    const date = new Date(searchResult.available_at);
    if (Number.isNaN(date.getTime())) return null;
    try {
      return new Intl.DateTimeFormat(language === 'ja' ? 'ja-JP' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
    } catch {
      return null;
    }
  }, [language, searchResult?.available_at]);

  const canAcquireNow = useMemo(() => {
    if (!searchResult || searchResult.status !== 'available') {
      return false;
    }
    if (isOwnedByMe) {
      return false;
    }
    if (fanmarkLimit !== -1 && remainingCapacity <= 0) {
      return false;
    }
    return true;
  }, [searchResult, isOwnedByMe, fanmarkLimit, remainingCapacity]);

  const handleAcquireRequest = () => {
    if (!searchResult || !canAcquireNow) return;

    if (!user) {
      onRequireAuth?.(searchResult.fanmark);
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

      if (!catalogReady) {
        setQuery(trimmed);
        if (rememberSearch && storageKey) sessionStorage.setItem(storageKey, trimmed);
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
    [catalogReady, rememberSearch, storageKey, normalizeQuery, toast, t],
  );

  const handleConfirmAcquire = useCallback(async () => {
    if (!searchResult) return;
    setIsRegistering(true);

    try {
      const sourceEmoji = searchResult.display_fanmark || searchResult.user_input_fanmark || searchResult.fanmark || '';
      const compactEmoji = sourceEmoji.replace(/\s/g, '');
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

      const registrationBody = {
          user_input_fanmark: sourceEmoji,
          emoji_ids: emojiIds,
          normalized_emoji_ids: normalizedEmojiIds,
          defaultFanmarkName: t('fanmarkSettings.summary.defaultName'),
      };
      const response = await invokeFanmarkRegistration(registrationBody);

      if (response.error || !response.data?.success || !response.data.fanmark) {
        throw new Error(response.error?.message || response.data?.error || 'Failed to register fanmark');
      }

      const fanmark = response.data.fanmark;
      // Registration links previously unclaimed favorites to the new fanmark.
      void invalidateFavorites();
      void invalidateOwned();

      toast({
        title: t('dashboard.acquireSuccessTitle'),
        description: t('dashboard.acquireSuccessDescription'),
      });

      // Clear search input/result so the search box resets after acquisition
      setSearchResult(null);
      handleQueryChange('');

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
  }, [handleQueryChange, invalidateFavorites, invalidateOwned, navigate, onObtain, searchResult, t, toast]);

  const handleVisitFanmark = useCallback(() => {
    if (!displayedFanmark) return;

    navigateToFanmark(displayedFanmark, true);
  }, [displayedFanmark]);

  const handleToggleFavorite = useCallback(async () => {
    if (!searchResult) return;
    const emojiIds = Array.isArray(searchResult.emoji_ids)
      ? (searchResult.emoji_ids as (string | null)[]).filter((value): value is string => Boolean(value))
      : [];
    if (emojiIds.length === 0) return;

    if (!user) {
      onRequireAuth?.(displayedFanmark);
      return;
    }

    setFavoriteProcessing(true);
    try {
      if (effectiveIsFavorited) {
        const removed = await removeFavoriteFanmark(emojiIds);
        if (removed) {
          setFavoriteOverride(false);
          invalidateFavorites();
        }
      } else {
        const added = await addFavoriteFanmark(
          emojiIds,
          searchResult.display_fanmark || searchResult.user_input_fanmark || displayedFanmark,
        );
        if (added) {
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
  const canShowFavoriteButton = Boolean(
    searchResult &&
    displayedFanmark &&
    !searchResult.error &&
    searchResult.status !== 'invalid',
  );

  useEffect(() => {
    if (!rememberSearch) {
      if (typeof window !== 'undefined') {
        const prevKey = previousStorageKeyRef.current;
        if (prevKey) {
          sessionStorage.removeItem(prevKey);
        }
      }
      previousStorageKeyRef.current = null;
      hasLoadedInitialStorage.current = false;
      return;
    }
    if (!storageKey) return;
    if (typeof window === 'undefined') return;

    const prevKey = previousStorageKeyRef.current;
    if (prevKey && prevKey !== storageKey) {
      sessionStorage.removeItem(prevKey);
      hasLoadedInitialStorage.current = false;
    }
    previousStorageKeyRef.current = storageKey;
  }, [rememberSearch, storageKey]);

  useEffect(() => {
    if (!rememberSearch) {
      setQuery(normalizeQuery(prefilledEmoji));
      return;
    }
    if (!storageKey || typeof window === 'undefined') return;

    // 🎯 prefilledEmoji が明示的に渡されている場合は、sessionStorage より優先
    // hasLoadedInitialStorage より先にチェックすることで、後から渡された場合にも対応
    // これにより、存在しないファンマへのアクセス後のリダイレクトで確実に検索フィールドに設定される
    if (prefilledEmoji) {
      setQuery(normalizeQuery(prefilledEmoji));
      hasLoadedInitialStorage.current = true;
      return;
    }

    if (hasLoadedInitialStorage.current) return;

    // prefilledEmoji がない場合のみ sessionStorage から復元
    const stored = sessionStorage.getItem(storageKey);
    if (stored) {
      setQuery(normalizeQuery(stored));
    }
    hasLoadedInitialStorage.current = true;
  }, [rememberSearch, storageKey, normalizeQuery, prefilledEmoji]);

  useEffect(() => {
    if (!rememberSearch) {
      setQuery(normalizeQuery(prefilledEmoji));
    }
  }, [rememberSearch, prefilledEmoji, normalizeQuery]);

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

  useEffect(() => {
    if (!scrollToSearch) return;

    const timer = window.setTimeout(() => {
      if (containerRef.current) {
        containerRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      onSearchScrolled?.();
    }, 50);

    return () => window.clearTimeout(timer);
  }, [scrollToSearch, onSearchScrolled]);
  return {
    t,
    isMobile,
    user,
    toast,
    navigate,
    location,
    containerRef,
    applyToLottery,
    cancelLotteryEntry,
    lotteryLoading,
    searchResult,
    setSearchResult,
    isConfirmOpen,
    setIsConfirmOpen,
    isRegistering,
    query,
    remainingCapacity,
    isOwnedByMe,
    canShowFanmarkAccess,
    canNavigateToDetail,
    displayedFanmark,
    isGraceBlocked,
    canVisitFanmark,
    effectiveIsFavorited,
    isFavoriteButtonDisabled,
    getSearchAreaBackgroundClass,
    canAcquireNow,
    handleAcquireRequest,
    handleConfirmAcquire,
    handleVisitFanmark,
    handleToggleFavorite,
    canShowFavoriteButton,
    handleQueryChange,
    clearQuery,
  };
}
