import { Check, ExternalLink, Heart, Search, Sparkles, Ticket, TicketX } from 'lucide-react';
import { useAcquisitionController } from './acquisition/useAcquisitionController';

import { EmojiInputUtilities } from '@/components/EmojiInput';
import { FanmarkAcquisitionLoading } from '@/components/FanmarkAcquisitionLoading';
import FanmarkSearch from '@/components/FanmarkSearch';
import { FanmarkStatusBadge } from '@/components/FanmarkStatusBadge';
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
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { extractEmojiString } from '@/lib/emojiConversion';

import { FanmarkSearchPanel } from '@/components/FanmarkSearchPanel';

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

export const FanmarkAcquisition = ({
  prefilledEmoji,
  fanmarkLimit = 0,
  currentCount = 0,
  onObtain,
  onRequireAuth,
  rememberSearch = false,
  scrollToSearch = false,
  onSearchScrolled,
}: FanmarkAcquisitionProps) => {
  const {
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
  } = useAcquisitionController({ prefilledEmoji, fanmarkLimit, currentCount, onObtain, onRequireAuth, rememberSearch, scrollToSearch, onSearchScrolled });

  return (
    <div ref={containerRef} className="space-y-6">
      {/* ファンマ取得中のローディング画面 */}
      {isRegistering && (
        <FanmarkAcquisitionLoading emoji={searchResult?.fanmark} />
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
              className="h-10 rounded-full border border-border bg-transparent px-5 text-sm font-semibold text-muted-foreground hover:bg-primary/10 hover:text-foreground"
              disabled={isRegistering}
            >
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-10 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-md hover:bg-primary/90"
              onClick={handleConfirmAcquire}
              disabled={isRegistering}
            >
              {isRegistering ? t('common.processing') : t('dashboard.acquireConfirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <FanmarkSearchPanel
        label=""
        icon={<Search className="h-6 w-6 text-primary" />}
        title={t('dashboard.searchFanma')}
        meta={
          searchResult && searchResult.fanmark && !searchResult.error ? (
            <div className="flex w-full items-center justify-end gap-2">
              <FanmarkStatusBadge
                status={
                  searchResult.status === 'available'
                    ? 'available'
                    : searchResult.blocking_status === 'grace'
                      ? 'unavailable'
                      : (isOwnedByMe ? 'taken' : 'unavailable')
                }
              />
              {canShowFavoriteButton && (
                <Button
                  size="icon"
                  variant="ghost"
                  className={`h-9 w-9 rounded-full border border-transparent transition-colors duration-200 ${
                    effectiveIsFavorited
                      ? 'bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary'
                      : 'text-muted-foreground hover:bg-primary/10 hover:text-primary'
                  }`}
                  onClick={handleToggleFavorite}
                  disabled={isFavoriteButtonDisabled}
                  aria-label={effectiveIsFavorited ? t('fanmarkDetails.unfavorite') : t('fanmarkDetails.favorite')}
                >
                  <Heart className={`h-4 w-4 ${effectiveIsFavorited ? 'fill-current' : ''}`} />
                </Button>
              )}
            </div>
          ) : null
        }
        className={getSearchAreaBackgroundClass}
      >
        {/* ファンマ入力グループ - 入力と便利ツールが一体 */}
        <div className="mt-6 mb-10 space-y-6">
          <FanmarkSearch
            onSignupPrompt={() => onRequireAuth?.('')}
            statusVariant={user ? 'authenticated' : 'public'}
            showRecent={false}
            onResultChange={setSearchResult}
            query={query}
            onQueryChange={handleQueryChange}
          />

          {/* 便利ツール - レスポンシブ間隔 */}
          <div className="flex justify-center">
            <EmojiInputUtilities
              disabled={false}
              hasValue={!!searchResult?.fanmark}
              onPaste={async () => {
                try {
                  if (!navigator.clipboard) {
                    toast({
                      title: t('common.error'),
                      description: t('common.clipboardNotSupported'),
                      variant: 'destructive',
                    });
                    return false;
                  }

                  const clipboardText = await navigator.clipboard.readText();
                  if (!clipboardText.trim()) {
                    toast({
                      title: t('common.clipboardEmptyTitle'),
                      description: t('common.clipboardEmptyBody'),
                      variant: 'warning',
                    });
                    return true;
                  }

                  const extracted = extractEmojiString(clipboardText);
                  if (!extracted) {
                    toast({
                      title: t('common.nonEmojiRejectedTitle'),
                      description: t('common.nonEmojiRejectedBody'),
                      variant: 'warning',
                    });
                    return true;
                  }

                  handleQueryChange(extracted);

                  toast({
                    title: t('common.pasteCompletedTitle'),
                    description: t('common.pasteCompleted'),
                  });
                  return true;

                } catch (error) {
                  toast({
                    title: t('common.error'),
                    description: t('common.clipboardReadFailed'),
                    variant: 'destructive',
                  });
                  return false;
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
              }}
                value={query}
              />
          </div>
        </div>
      </FanmarkSearchPanel>

      {/* アクションボタン - 入力グループから分離 */}
      <div className="flex flex-col gap-4 items-center w-full">
        <TooltipProvider>
          <div className="flex w-full items-center justify-center">
            {/* 取得ボタンを relative で囲み、右側のボタンを絶対配置 */}
            <div className="relative">
              <Button
                size="default"
                className="rounded-full gap-2 px-6 text-sm font-semibold shadow-md hover:shadow-lg transition-colors duration-200"
                onClick={handleAcquireRequest}
                disabled={!canAcquireNow}
              >
                <Check className="h-4 w-4" />
                {user
                  ? isMobile && isGraceBlocked
                    ? t('dashboard.acquireButtonShort')
                    : t('dashboard.acquireButton')
                  : t('dashboard.acquireLoginButton')}
              </Button>
              {/* 右側のボタングループ - 取得ボタンの右隣に絶対配置 */}
              <div className="absolute left-full top-1/2 -translate-y-1/2 ml-3 flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 rounded-full border border-primary/15 bg-background/80 text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                      onClick={handleVisitFanmark}
                      disabled={!canVisitFanmark}
                      aria-label={t('dashboard.visitFanmarkButton')}
                    >
                      <ExternalLink className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {t('dashboard.visitFanmarkButton')}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 rounded-full border border-primary/15 bg-background/80 text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                      onClick={() => {
                        if (!canNavigateToDetail || !searchResult?.short_id) return;
                        navigate(`/f/${searchResult.short_id}`);
                      }}
                      disabled={!canNavigateToDetail}
                      aria-label={t('dashboard.openFanmarkPage')}
                    >
                      <Sparkles className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {t('dashboard.openFanmarkPage')}
                  </TooltipContent>
                </Tooltip>
            {isGraceBlocked && user && (
              <div className="relative">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`h-10 w-10 rounded-full border border-primary/15 bg-background/80 transition-colors duration-200 ${
                        searchResult?.has_user_lottery_entry
                          ? 'text-primary hover:bg-primary/15 hover:text-primary'
                          : 'text-muted-foreground hover:bg-primary/10 hover:text-primary'
                      }`}
                      disabled={lotteryLoading}
                      aria-label={
                        searchResult?.has_user_lottery_entry
                          ? t('dashboard.tooltip.cancelLottery')
                          : t('dashboard.tooltip.applyLottery')
                      }
                      onClick={async () => {
                        if (!searchResult?.id) return;

                        try {
                          if (searchResult.has_user_lottery_entry && searchResult.user_lottery_entry_id) {
                            await cancelLotteryEntry(searchResult.user_lottery_entry_id, {
                              emoji: searchResult.fanmark,
                              optimisticUpdate: (status) => {
                                if (status === 'cancelled') {
                                  setSearchResult((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          has_user_lottery_entry: false,
                                          user_lottery_entry_id: null,
                                          lottery_entry_count:
                                            typeof prev.lottery_entry_count === 'number' &&
                                            prev.lottery_entry_count > 0
                                              ? prev.lottery_entry_count - 1
                                              : prev.lottery_entry_count,
                                        }
                                      : prev,
                                  );
                                }
                              },
                              onSettled: async () => {
                                try {
                                  if (query) handleQueryChange(query);
                                } catch (error) {
                                  console.error('Failed to refresh search results after cancel:', error);
                                }
                              },
                            });
                          } else {
                            await applyToLottery(searchResult.id, {
                              emoji: searchResult.fanmark,
                              optimisticUpdate: (status, payload) => {
                                if (status === 'applied') {
                                  setSearchResult((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          has_user_lottery_entry: true,
                                          user_lottery_entry_id: payload?.entry_id ?? prev.user_lottery_entry_id,
                                          lottery_entry_count:
                                            payload?.total_entries_count ??
                                            (typeof prev.lottery_entry_count === 'number'
                                              ? prev.lottery_entry_count + 1
                                              : prev.lottery_entry_count),
                                        }
                                      : prev,
                                  );
                                }
                              },
                              onSettled: async () => {
                                try {
                                  if (query) handleQueryChange(query);
                                } catch (error) {
                                  console.error('Failed to refresh search results after apply:', error);
                                }
                              },
                            });
                          }
                        } catch (error) {
                          console.error('Failed to toggle lottery entry:', error);
                        }
                      }}
                    >
                      {searchResult?.has_user_lottery_entry ? (
                        <TicketX className="h-5 w-5" />
                      ) : (
                        <Ticket className="h-5 w-5" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {searchResult?.has_user_lottery_entry
                      ? t('dashboard.tooltip.cancelLottery')
                      : t('dashboard.tooltip.applyLottery')}
                  </TooltipContent>
                </Tooltip>

                {(() => {
                  const lotteryEntryCount = Math.max(0, searchResult?.lottery_entry_count ?? 0);
                  return (
                    <div className="absolute -top-9 right-0 sm:-top-8 sm:left-1/2 sm:right-auto sm:-translate-x-1/2">
                      <div className="relative rounded-2xl bg-primary px-4 py-1.5 text-[11px] font-semibold text-primary-foreground shadow-[0_8px_18px_rgba(101,195,200,0.25)] whitespace-nowrap">
                        {t('lottery.entryCount', { count: lotteryEntryCount })}
                        <span
                          aria-hidden="true"
                          className="absolute right-4 top-full -mt-[5px] h-2.5 w-2.5 rotate-45 bg-primary sm:left-1/2 sm:right-auto sm:-translate-x-1/2"
                        />
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
              </div>
            </div>
          </div>
        </TooltipProvider>

        {(displayedFanmark || (isGraceBlocked && user)) && canShowFanmarkAccess && (
          <TooltipProvider>
            <div className="flex w-full flex-col items-center gap-2">
              <div className="flex items-center justify-center gap-3">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 rounded-full border border-primary/15 bg-background/80 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                      onClick={handleVisitFanmark}
                      aria-label={t('dashboard.visitFanmarkButton')}
                    >
                      <ExternalLink className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {t('dashboard.visitFanmarkButton')}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </TooltipProvider>
        )}

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
    </div>
  );
};
