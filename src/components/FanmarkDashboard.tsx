import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatInTimeZone } from 'date-fns-tz';
import { createDashboardPresentation } from './dashboard/presentation';
import { useDashboardController } from './dashboard/useDashboardController';

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle, ArrowRightLeft, BarChart3, Copy, ExternalLink, Heart, MoreVertical, QrCode, Settings, Undo2 } from 'lucide-react';
import { FiClock, FiCompass, FiLayers, FiTarget } from 'react-icons/fi';
import { MdSpaceDashboard } from 'react-icons/md';
import { ExtendLicenseDialog } from './ExtendLicenseDialog';
import { FanmarkAcquisition } from './FanmarkAcquisition';
import { FanmarkReturnLoading } from './FanmarkReturnLoading';
import { LicenseCountdown } from './LicenseCountdown';
import { ReturnFanmarkDialog } from './ReturnFanmarkDialog';
// Using Undo2 for return/return action

import { parseDateString } from '@/lib/utils';
import { getFanmarkUrlForClipboard, navigateToFanmark } from '@/utils/emojiUrl';

import { FanmarkTransferSection } from '@/components/FanmarkTransferSection';
import { TransferCodeIssueDialog } from '@/components/TransferCodeIssueDialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export const FanmarkDashboard = () => {
  const {
    toast,
    t,
    navigate,
    location,
    fanmarkLimit,
    isUnlimited,
    favoriteCount,
    favoritesLoading,
    getPendingCheckout,
    canAccessAnalytics,
    extensionConfirmation,
    setExtensionConfirmationRetry,
    loading,
    activeTab,
    setActiveTab,
    prefilledEmoji,
    setPrefilledEmoji,
    shouldScrollToSearch,
    setShouldScrollToSearch,
    returningFanmarkId,
    returningFanmarkEmoji,
    returnDialogOpen,
    setReturnDialogOpen,
    returnTargetFanmark,
    setReturnTargetFanmark,
    extendDialogOpen,
    setExtendDialogOpen,
    extendTarget,
    setExtendTarget,
    extendSelectedPlan,
    setExtendSelectedPlan,
    extendProcessing,
    totalAccessCount,
    accessCountLoading,
    paymentWarningDate,
    showPaymentWarning,
    transferCodeData,
    hasActiveTransfer,
    getTransferStatus,
    refetchTransfer,
    transferDialogOpen,
    setTransferDialogOpen,
    transferTargetFanmark,
    openTransferDialog,
    handleOpenSettings,
    openReturnDialog,
    handleConfirmReturn,
    openExtendDialog,
    handleChangePlan,
    handleExtendSubmit,
    fetchFanmarks,
    getLicenseTiming,
    isFanmarkInactive,
    isReturned,
    activeFanmarks,
    shouldBlockGraceExtension,
    filteredFanmarks,
    handleRequireAuth,
  } = useDashboardController();
  const { getStatusBadge, getTierOvalStyle, getTierBadgeStyle, getTierLabel, getAccessTypeBadge } = createDashboardPresentation(t);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
      </div>
    );
  }

  return (
    <section className="w-full bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <div className="container mx-auto px-4 py-12 space-y-10">
        <div className="space-y-3 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground flex items-center justify-center gap-3">
            <span className="flex items-center justify-center text-foreground">
              <MdSpaceDashboard className="h-7 w-7" />
            </span>
            {t('dashboard.title')}
          </h1>
          <p className="mx-auto max-w-2xl text-sm sm:text-base text-muted-foreground">
            {t('dashboard.subtitle')}
          </p>
        </div>

        {extensionConfirmation && (
          <Alert role="status">
            <AlertTitle>{t(`dashboard.extensionConfirmation.${extensionConfirmation}`)}</AlertTitle>
            <AlertDescription>{t('dashboard.extensionConfirmation.description')}</AlertDescription>
            {extensionConfirmation === 'timeout' && (
              <Button variant="outline" onClick={() => setExtensionConfirmationRetry((value) => value + 1)}>
                {t('dashboard.extensionConfirmation.retry')}
              </Button>
            )}
          </Alert>
        )}

        {showPaymentWarning && (
          <Alert className="rounded-2xl border border-amber-200/70 bg-amber-50/80 px-5 py-4 text-amber-950 shadow-sm sm:px-6 sm:py-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="flex-1 space-y-1">
                <AlertTitle className="text-base font-semibold text-amber-900">
                  {t('dashboard.paymentFailureWarningTitle')}
                </AlertTitle>
                <AlertDescription className="text-sm leading-relaxed text-amber-900/90">
                  {paymentWarningDate
                    ? t('dashboard.paymentFailureWarningDescription', { date: paymentWarningDate })
                    : t('dashboard.paymentFailureWarningDescriptionNoDate')}
                </AlertDescription>
              </div>
            </div>
          </Alert>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {/* Your Fanmarks */}
          <Card className="relative overflow-hidden rounded-3xl border border-primary/25 bg-background/85 shadow-[0_15px_40px_rgba(101,195,200,0.16)] backdrop-blur">
            <CardContent className="flex h-full flex-col p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">
                    {t('dashboard.stats.yourFanmarks')}
                  </p>
                   <div className="flex items-baseline gap-3">
                     <span className="text-3xl font-bold text-primary">
                       {activeFanmarks}/{isUnlimited ? '∞' : fanmarkLimit}
                     </span>
                   </div>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <FiTarget className="h-6 w-6" />
                </div>
              </div>
              <div className="mt-4 w-full overflow-hidden rounded-full bg-muted h-2.5">
                 <div
                   className="bg-primary h-2.5 rounded-full transition-all duration-500"
                   style={{ width: `${isUnlimited ? 0 : Math.min((activeFanmarks / fanmarkLimit) * 100, 100)}%` }}
                 />
              </div>
              <div className="mt-auto flex justify-end pt-4">
                <button
                  type="button"
                  onClick={() => navigate('/plans', { state: { from: location.pathname } })}
                  className="text-xs text-muted-foreground hover:text-primary hover:underline"
                >
                  {t('dashboard.stats.upgradePlan')}
                </button>
              </div>
            </CardContent>
          </Card>

          {/* Access Count */}
          <Card className="relative overflow-hidden rounded-3xl border border-primary/25 bg-background/85 shadow-[0_15px_40px_rgba(101,195,200,0.16)] backdrop-blur">
            <CardContent className="flex h-full flex-col p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">
                    {t('dashboard.stats.accessCount')}
                  </p>
                  <div className="flex items-baseline gap-3">
                    <span className="text-3xl font-bold text-primary">
                      {accessCountLoading ? '—' : (totalAccessCount ?? 0).toLocaleString()}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t('dashboard.stats.last30days')}
                    </span>
                  </div>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <BarChart3 className="h-6 w-6" />
                </div>
              </div>
              <div className="mt-auto flex justify-end pt-4">
                <button
                  type="button"
                  onClick={() => navigate('/analytics', { state: { from: location.pathname } })}
                  className="text-xs text-muted-foreground hover:text-primary hover:underline"
                >
                  {t('dashboard.stats.viewAnalytics')}
                </button>
              </div>
            </CardContent>
          </Card>

          {/* Favorites */}
          <Card className="relative overflow-hidden rounded-3xl border border-primary/25 bg-background/85 shadow-[0_15px_40px_rgba(101,195,200,0.16)] backdrop-blur">
            <CardContent className="flex h-full flex-col p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">
                    {t('dashboard.stats.favoriteFanmarks')}
                  </p>
                  <div className="flex items-baseline gap-3">
                    <span className="text-3xl font-bold text-primary">
                      {favoritesLoading ? '—' : favoriteCount}
                    </span>
                  </div>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Heart className="h-6 w-6" />
                </div>
              </div>
              <div className="mt-auto flex justify-end pt-4">
                <button
                  type="button"
                  onClick={() => navigate('/favorites', { state: { from: location.pathname } })}
                  className="text-xs text-muted-foreground hover:text-primary hover:underline"
                >
                  {t('dashboard.stats.viewFavorites')}
                </button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
          <TabsList className="grid w-full grid-cols-2 gap-1.5 sm:gap-2 rounded-full border border-primary/20 bg-background/70 p-1.5 sm:p-2 backdrop-blur">
            <TabsTrigger
              value="my-fanmarks"
              className="gap-1.5 sm:gap-2 rounded-full py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm font-medium transition-all duration-200 data-[state=active]:bg-primary/15 data-[state=active]:text-foreground data-[state=active]:shadow-lg whitespace-nowrap"
            >
              <FiLayers className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
              {t('dashboard.tabs.myFanmarks')}
            </TabsTrigger>
            <TabsTrigger
              value="acquisition"
              className="gap-1.5 sm:gap-2 rounded-full py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm font-medium transition-all duration-200 data-[state=active]:bg-primary/15 data-[state=active]:text-foreground data-[state=active]:shadow-lg whitespace-nowrap"
            >
              <FiCompass className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
              {t('dashboard.tabs.getFanma')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="my-fanmarks" className="space-y-6">
            {/* Fanmarks List */}
            <Card className="rounded-3xl border border-primary/15 bg-background/90 shadow-[0_20px_45px_rgba(101,195,200,0.14)] backdrop-blur">
              <CardHeader className="px-6 pt-8 pb-6">
                <CardTitle>
                  <div className="space-y-3 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <FiLayers className="h-6 w-6" />
                    </div>
                    <h3 className="text-xl font-bold text-foreground">
                      {t('dashboard.yourFanmarks')}
                    </h3>
                    <p className="mx-auto max-w-xl text-sm text-muted-foreground">
                      {t('dashboard.manageFanmarks')}
                    </p>
                  </div>
                </CardTitle>
              </CardHeader>

              <CardContent className="space-y-12 px-6 pb-6">
                {filteredFanmarks.length === 0 ? (
                  <div className="py-14 px-4 text-center space-y-5">
                    <p className="text-base font-medium text-muted-foreground">
                      {t('dashboard.noFanmarksYet')}
                    </p>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button
                          size="default"
                          className="gap-2 rounded-full bg-primary text-primary-foreground shadow-md hover:shadow-lg transition-all duration-200 px-5"
                        >
                          {t('dashboard.createFirstFanma')}
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>{t('dashboard.createFirstFanma')}</DialogTitle>
                          <DialogDescription>
                            {t('dashboard.createFanmarkDescription')}
                          </DialogDescription>
                        </DialogHeader>
                        <FanmarkAcquisition
                          prefilledEmoji={prefilledEmoji}
                          fanmarkLimit={isUnlimited ? -1 : fanmarkLimit}
                          currentCount={activeFanmarks}
                          rememberSearch
                          scrollToSearch={shouldScrollToSearch}
                          onSearchScrolled={() => setShouldScrollToSearch(false)}
                          onObtain={() => {
                            setPrefilledEmoji(undefined);
                            fetchFanmarks();
                            setActiveTab('my-fanmarks');
                          }}
                          onRequireAuth={handleRequireAuth}
                        />
                      </DialogContent>
                    </Dialog>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Desktop Table View */}
                    <div className="hidden lg:block">
                      <div className="rounded-2xl border border-primary/10 bg-background/50">
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[920px]">
                            <thead>
                              <tr className="bg-gradient-to-r from-primary/5 via-accent/5 to-primary/5 border-b border-primary/10">
                                <th className="text-muted-foreground font-medium text-xs uppercase tracking-wide text-left px-4 py-3">{t('dashboard.fanmark')}</th>
                                <th className="text-muted-foreground font-medium text-xs uppercase tracking-wide text-left px-4 py-3">{t('dashboard.fanmarkId')}</th>
                                <th className="text-muted-foreground font-medium text-xs uppercase tracking-wide text-left px-4 py-3">{t('dashboard.accessType')}</th>
                                <th className="text-muted-foreground font-medium text-xs uppercase tracking-wide text-left px-4 py-3">{t('dashboard.acquisitionDate')}</th>
                                <th className="text-muted-foreground font-medium text-xs uppercase tracking-wide text-left px-4 py-3">{t('dashboard.returnDate')}</th>
                                <th className="text-muted-foreground font-medium text-xs uppercase tracking-wide text-left px-4 py-3">{t('dashboard.remainingDays')}</th>
                                <th className="text-muted-foreground font-medium text-xs uppercase tracking-wide text-left px-4 py-3">{t('dashboard.status')}</th>
                                <th className="text-left px-3 py-3 w-12"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredFanmarks.map((fanmark, idx) => {
                                const licenseData = fanmark.fanmark_licenses;
                                const acquisitionDateValue = parseDateString(licenseData?.license_start);
                                const acquisitionDate = acquisitionDateValue ? formatInTimeZone(acquisitionDateValue, 'Asia/Tokyo', 'yyyy/MM/dd') : '-';
                                const timing = getLicenseTiming(licenseData);
                                const expirationDateUTC = timing.licenseEndDate;
                                const msRemaining = timing.remainingMs;
                                const daysRemaining = timing.remainingWholeDays;
                                const isExpiringSoon = msRemaining !== null && msRemaining > 0 && msRemaining <= 3 * 24 * 60 * 60 * 1000;
                                const timeDisplayClass = `font-medium whitespace-nowrap text-sm ${isExpiringSoon ? 'text-destructive' : 'text-foreground'}`;
                                const canNavigateToSettings = timing.status === 'active';
                                const handleRowNavigation = () => {
                                  if (!canNavigateToSettings || isReturned(fanmark)) return;
                                  navigate(`/fanmarks/${fanmark.id}/settings`);
                                };
                                const isGraceReturn = timing.status === 'grace-return';
                                const hasPerpetualLicense = !licenseData?.license_end;
                                const canReturn = !isReturned(fanmark) && timing.status === 'active';
                                const canExtend = (['active', 'grace', 'grace-return'].includes(timing.status)) && (!isReturned(fanmark) || isGraceReturn) && !hasPerpetualLicense && !shouldBlockGraceExtension(timing);

                                const rowKey = `${fanmark.emoji_key}-${fanmark.current_license_id ?? licenseData?.license_end ?? idx}`;
                                const isInactive = isFanmarkInactive(fanmark);
                                const rowVisualState = isInactive
                                  ? 'bg-gray-200/60 dark:bg-gray-700/60 text-muted-foreground/70'
                                  : (timing.status === 'grace' || timing.status === 'grace-return')
                                    ? `${canNavigateToSettings ? 'bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50' : 'bg-amber-50/70 dark:bg-amber-950/20'}`
                                    : `${canNavigateToSettings ? 'hover:bg-primary/5 hover:shadow-sm' : ''}`;
                                const tierOvalStyle = isInactive
                                  ? 'bg-none bg-gray-200 border border-gray-300 text-muted-foreground/70 hover:scale-100 saturate-0'
                                  : getTierOvalStyle(fanmark.tier_level || 1);
                                const tierBadgeStyle = isInactive
                                  ? 'bg-gray-300 text-muted-foreground border border-gray-400'
                                  : getTierBadgeStyle(fanmark.tier_level);
                                const primaryTextClass = isInactive ? 'text-muted-foreground/70' : 'text-foreground';
                                const countdownClass = isInactive ? 'font-medium whitespace-nowrap text-sm text-muted-foreground/70' : timeDisplayClass;
                                const graceCountdownClass = isInactive
                                  ? 'font-medium whitespace-nowrap text-sm text-muted-foreground/70'
                                  : 'font-medium whitespace-nowrap text-sm text-destructive font-mono tabular-nums';
                                const transferStatus = getTransferStatus(fanmark.id);

                                return (
                                  <tr
                                    key={rowKey}
                                    onClick={handleRowNavigation}
                                    className={`relative border-b border-primary/5 transition-all duration-200 after:pointer-events-none after:absolute after:left-0 after:bottom-0 after:h-px after:w-full after:bg-primary/10 ${rowVisualState}`}
                                  >
                                    <td className="relative overflow-visible px-4 py-3">
                                      <div className="min-h-[2.25rem] flex items-end overflow-visible relative" onClick={(event) => event.stopPropagation()}>
                                        <div
                                          className={`relative flex items-center px-3.5 py-2.5 rounded-md shadow-sm transition-transform ${isInactive ? '' : 'hover:scale-105'} whitespace-nowrap cursor-pointer overflow-visible ${tierOvalStyle}`}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            navigator.clipboard.writeText(fanmark.fanmark);
                                            toast({
                                              title: t('dashboard.emojiCopiedTitle'),
                                              description: fanmark.fanmark,
                                            });
                                          }}
                                          title={t('dashboard.clickToCopyEmoji')}
                                        >
                                          <span className={`absolute -top-2 -left-2 z-20 rounded-full px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-widest shadow ${tierBadgeStyle}`}>
                                            {getTierLabel(fanmark.tier_level)}
                                          </span>
                                          <span className="text-2xl leading-none select-none" style={{ letterSpacing: '0.2em' }}>{fanmark.fanmark}</span>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="min-h-[2.25rem] flex items-center" onClick={(event) => event.stopPropagation()}>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <button
                                              type="button"
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                navigate(`/f/${fanmark.short_id}`);
                                              }}
                                            className="rounded-md border border-border/50 bg-muted/60 px-2.5 py-1 text-[0.7rem] font-medium tracking-wide text-muted-foreground transition-colors hover:bg-muted/80"
                                              aria-label={t('dashboard.viewDetails')}
                                            >
                                              {fanmark.short_id}
                                            </button>
                                          </TooltipTrigger>
                                          <TooltipContent>{t('dashboard.viewDetails')}</TooltipContent>
                                        </Tooltip>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="min-h-[2.25rem] flex items-center min-w-fit">
                                        {!isFanmarkInactive(fanmark) && timing.status === 'active' && getAccessTypeBadge(fanmark.access_type, fanmark.fanmark)}
                                      </div>
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="min-h-[2.25rem] flex items-center">
                                        <div className={`text-sm font-medium ${primaryTextClass}`}>
                                          {acquisitionDate}
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className={`min-h-[2.25rem] flex items-center text-sm font-medium ${primaryTextClass}`}>
                                        {expirationDateUTC ? (
                                          <span>{formatInTimeZone(expirationDateUTC, 'Asia/Tokyo', 'yyyy/MM/dd')}</span>
                                        ) : (
                                          <span className="text-muted-foreground">{t('dashboard.perpetualLicense')}</span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 align-middle">
                                      <div className="relative min-h-[2.25rem] flex items-center gap-1.5">
                                        {(timing.status === 'grace' || timing.status === 'grace-return') && timing.graceExpiresDate ? (
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <LicenseCountdown
                                                expirationDate={timing.graceExpiresDate}
                                                className={graceCountdownClass}
                                              />
                                            </TooltipTrigger>
                                            <TooltipContent className="rounded-2xl border border-rose-200 bg-rose-100 px-4 py-2 text-[0.7rem] font-medium text-rose-900 shadow-lg">
                                              {t('dashboard.extendHint')}
                                            </TooltipContent>
                                          </Tooltip>
                                        ) : timing.status === 'active' && expirationDateUTC ? (
                                          <div className={`${countdownClass} min-w-[6rem]`}>
                                            {msRemaining !== null && msRemaining > 0 && msRemaining < 24 * 60 * 60 * 1000 ? (
                                              <LicenseCountdown expirationDate={expirationDateUTC} className={`${countdownClass} font-mono tabular-nums`} />
                                            ) : (
                                              t('dashboard.daysRemaining', { days: Math.max(daysRemaining ?? 0, 0) })
                                            )}
                                          </div>
                                        ) : isReturned(fanmark) ? (
                                          <span className="text-muted-foreground text-sm">{t('dashboard.returned')}</span>
                                        ) : (
                                          <span className="text-muted-foreground text-sm">-</span>
                                        )}
                                        {/* Bubble removed per design */}
                                      </div>
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="min-h-[2.25rem] flex items-center gap-1 sm:gap-1.5 min-w-fit flex-nowrap whitespace-nowrap">
                                        <span className={isInactive ? 'opacity-60 saturate-50' : ''}>{getStatusBadge(timing)}</span>
                                        {transferStatus === 'active' && (
                                          <Badge
                                            variant="outline"
                                            className="inline-flex items-center gap-1.5 rounded-full border-sky-500/35 bg-sky-500/10 px-2 py-0.5 text-[0.68rem] font-semibold text-sky-800 shadow-[0_4px_12px_rgba(56,189,248,0.18)] whitespace-nowrap"
                                          >
                                            <ArrowRightLeft className="h-3.5 w-3.5" />
                                            {t('transfer.badgeTransferring')}
                                          </Badge>
                                        )}
                                        {transferStatus === 'applied' && (
                                          <Badge
                                            variant="outline"
                                            className="inline-flex items-center gap-1.5 rounded-full border-amber-400/45 bg-amber-50/90 px-2 py-0.5 text-[0.68rem] font-semibold text-amber-800 shadow-[0_4px_12px_rgba(251,191,36,0.16)] whitespace-nowrap"
                                          >
                                            <FiClock className="h-3.5 w-3.5" />
                                            {t('transfer.badgePendingApproval')}
                                          </Badge>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                                      <div className="flex items-center">
                                        <DropdownMenu>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <DropdownMenuTrigger asChild>
                                                <Button
                                                  size="sm"
                                                  variant="ghost"
                                                  type="button"
                                                  onClick={(event) => event.stopPropagation()}
                                                  className="h-9 w-9 rounded-md border border-border/60 bg-background/50 text-foreground hover:bg-background transition-colors"
                                                  aria-label={t('dashboard.actionsMenu')}
                                                >
                                                  <MoreVertical className="h-5 w-5" />
                                                </Button>
                                              </DropdownMenuTrigger>
                                            </TooltipTrigger>
                                            <TooltipContent>{t('dashboard.actionsMenu')}</TooltipContent>
                                          </Tooltip>
                                          <DropdownMenuContent align="end" sideOffset={8} collisionPadding={16} className="w-48">
                                            <DropdownMenuItem
                                              onSelect={(event) => { event.stopPropagation(); navigateToFanmark(fanmark.fanmark, true); }}
                                              className="gap-2"
                                            >
                                              <ExternalLink className="h-4 w-4 text-primary" />
                                              <span>{t('dashboard.visitFanmarkTooltip')}</span>
                                            </DropdownMenuItem>
                                            {fanmark.short_id && (
                                              <DropdownMenuItem
                                                onSelect={(event) => { event.stopPropagation(); window.open(`/q/${fanmark.short_id}`, '_blank', 'noopener,noreferrer'); }}
                                                className="gap-2"
                                              >
                                                <QrCode className="h-4 w-4 text-primary" />
                                                <span>{t('dashboard.actionsQRCode')}</span>
                                              </DropdownMenuItem>
                                            )}
                                            <DropdownMenuItem
                                              onSelect={(event) => {
                                                event.stopPropagation();
                                                const fullUrl = getFanmarkUrlForClipboard(fanmark.fanmark);
                                                navigator.clipboard.writeText(fullUrl);
                                                toast({
                                                  title: t('dashboard.urlCopiedTitle'),
                                                  description: fullUrl,
                                                });
                                              }}
                                              className="gap-2"
                                            >
                                              <Copy className="h-4 w-4 text-primary" />
                                              <span>{t('dashboard.copyFanmarkLink')}</span>
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                              onSelect={(event) => {
                                                event.stopPropagation();
                                                if (!canExtend) return;
                                                openExtendDialog(fanmark, timing);
                                              }}
                                              className="gap-2"
                                              disabled={!canExtend}
                                            >
                                              <FiClock className="h-4 w-4 text-primary" />
                                              <span>{t('dashboard.extendMenuLabel')}</span>
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                              onSelect={(event) => {
                                                event.stopPropagation();
                                                if (!canReturn) return;
                                                openReturnDialog(fanmark);
                                              }}
                                              className="gap-2"
                                              disabled={!canReturn}
                                            >
                                              <Undo2 className="h-4 w-4 text-primary" />
                                              <span>{t('dashboard.actionsReturn')}</span>
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                              onSelect={(event) => {
                                                event.stopPropagation();
                                                if (!canReturn || hasActiveTransfer(fanmark.id)) return;
                                                openTransferDialog(fanmark);
                                              }}
                                              className="gap-2"
                                              disabled={!canReturn || hasActiveTransfer(fanmark.id)}
                                            >
                                              <ArrowRightLeft className="h-4 w-4 text-primary" />
                                              <span>{t('transfer.issueCode')}</span>
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            {canAccessAnalytics && (
                                              <DropdownMenuItem
                                                onSelect={(event) => { event.stopPropagation(); navigate(`/analytics?fanmark=${fanmark.short_id}`); }}
                                                className="gap-2"
                                              >
                                                <BarChart3 className="h-4 w-4 text-primary" />
                                                <span>{t('dashboard.viewStats')}</span>
                                              </DropdownMenuItem>
                                            )}
                                            <DropdownMenuItem
                                              onSelect={() => handleOpenSettings(fanmark.id)}
                                              className="gap-2"
                                              disabled={isReturned(fanmark) || timing.status !== 'active'}
                                            >
                                              <Settings className="h-4 w-4 text-primary" />
                                              <span>{t('dashboard.actionsSettings')}</span>
                                            </DropdownMenuItem>
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    {/* Mobile Card View */}
                    <div className="lg:hidden space-y-4">
                      {filteredFanmarks.map((fanmark, idx) => {
                        const licenseData = fanmark.fanmark_licenses;
                        const acquisitionDateValue = parseDateString(licenseData?.license_start);
                        const acquisitionDate = acquisitionDateValue ? formatInTimeZone(acquisitionDateValue, 'Asia/Tokyo', 'yyyy/MM/dd') : '-';
                        const timing = getLicenseTiming(licenseData);
                        const expirationDate = timing.licenseEndDate;
                        const msRemainingMobile = timing.remainingMs;
                        const daysRemaining = timing.remainingWholeDays;
                        const isExpiringSoon = msRemainingMobile !== null && msRemainingMobile > 0 && msRemainingMobile <= 3 * 24 * 60 * 60 * 1000;
                        const isCountdownActiveMobile = msRemainingMobile !== null && msRemainingMobile > 0 && msRemainingMobile <= 24 * 60 * 60 * 1000;
                        const mobileTimeDisplayClass = `font-medium whitespace-nowrap text-sm ${isExpiringSoon ? 'text-destructive' : 'text-foreground'}`;
                        const isGraceReturn = timing.status === 'grace-return';
                        const hasPerpetualLicense = !licenseData?.license_end;
                        const canReturn = !isReturned(fanmark) && timing.status === 'active';
                        const canExtend = (['active', 'grace', 'grace-return'].includes(timing.status)) && (!isReturned(fanmark) || isGraceReturn) && !hasPerpetualLicense && !shouldBlockGraceExtension(timing);
                        const mobileTransferStatus = getTransferStatus(fanmark.id);

                        const cardKey = `${fanmark.id}-${fanmark.current_license_id ?? licenseData?.license_end ?? idx}`;
                        const isInactiveCard = isFanmarkInactive(fanmark);
                        const cardVisualState = isInactiveCard
                          ? 'bg-gray-200/60 dark:bg-gray-700/60 text-muted-foreground/70'
                          : (timing.status === 'grace' || timing.status === 'grace-return')
                            ? 'bg-amber-50 dark:bg-amber-950/30 hover:border-amber-200'
                            : 'bg-background/80 hover:border-primary/20';
                        const mobileTierOvalStyle = isInactiveCard
                          ? 'bg-none bg-gray-200 border border-gray-300 text-muted-foreground/70 hover:scale-100 saturate-0'
                          : getTierOvalStyle(fanmark.tier_level || 1);
                        const mobileTierBadgeStyle = isInactiveCard
                          ? 'bg-gray-300 text-muted-foreground border border-gray-400'
                          : getTierBadgeStyle(fanmark.tier_level);
                        const mobilePrimaryText = isInactiveCard ? 'text-muted-foreground/70' : 'text-foreground';
                        const mobileCountdownClass = isInactiveCard
                          ? 'font-medium whitespace-nowrap text-sm text-muted-foreground/70'
                          : mobileTimeDisplayClass;
                        const mobileGraceCountdownClass = isInactiveCard
                          ? 'font-medium whitespace-nowrap text-sm text-muted-foreground/70'
                          : 'font-medium whitespace-nowrap text-sm text-destructive font-mono tabular-nums';

                         return (
                          <Card key={cardKey} className={`overflow-visible rounded-3xl border border-primary/10 transition-colors ${cardVisualState}`}>
                            <CardContent className="overflow-visible p-5">
                                  <div className="space-y-3">
                                   <div className="flex flex-col gap-3">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-end overflow-visible">
                                        <div
                                          className={`relative flex items-center px-3 py-2 rounded-md cursor-pointer transition-transform ${isInactiveCard ? '' : 'hover:scale-105'} overflow-visible ${mobileTierOvalStyle}`}
                                          onClick={() => {
                                            navigator.clipboard.writeText(fanmark.fanmark);
                                            toast({
                                              title: t('dashboard.emojiCopiedTitle'),
                                              description: fanmark.fanmark,
                                            });
                                          }}
                                          title={t('dashboard.clickToCopyEmoji')}
                                        >
                                          <span className={`absolute -top-2 -left-2 z-20 rounded-full px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-widest shadow ${mobileTierBadgeStyle}`}>
                                            {getTierLabel(fanmark.tier_level)}
                                          </span>
                                          <span
                                            className="text-2xl sm:text-3xl leading-none select-none whitespace-nowrap tracking-[0.1em]"
                                            style={{ wordBreak: 'keep-all' }}
                                          >
                                            {fanmark.fanmark}
                                          </span>
                                        </div>
                                      </div>
                                      <div className="flex-shrink-0 flex flex-nowrap items-center gap-1 whitespace-nowrap">
                                        <span className={isInactiveCard ? 'opacity-60 saturate-50' : ''}>{getStatusBadge(timing)}</span>
                                        {mobileTransferStatus === 'active' && (
                                          <Badge
                                            variant="outline"
                                            className="inline-flex items-center gap-1.5 rounded-full border-sky-500/35 bg-sky-500/10 px-2 py-0.5 text-[0.68rem] font-semibold text-sky-800 shadow-[0_4px_12px_rgba(56,189,248,0.18)] whitespace-nowrap"
                                          >
                                            <ArrowRightLeft className="h-3.5 w-3.5" />
                                            {t('transfer.badgeTransferring')}
                                          </Badge>
                                        )}
                                        {mobileTransferStatus === 'applied' && (
                                          <Badge
                                            variant="outline"
                                            className="inline-flex items-center gap-1.5 rounded-full border-amber-400/45 bg-amber-50/90 px-2 py-0.5 text-[0.68rem] font-semibold text-amber-800 shadow-[0_4px_12px_rgba(251,191,36,0.16)] whitespace-nowrap"
                                          >
                                            <FiClock className="h-3.5 w-3.5" />
                                            {t('transfer.badgePendingApproval')}
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                 </div>

                                 {/* Date Information */}
                               <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm bg-muted/20 rounded-lg p-3">
                                  <div>
                                    <div className="text-xs text-muted-foreground font-semibold mb-1">
                                      {t('dashboard.fanmarkId')}
                                    </div>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button
                                          type="button"
                                          onClick={() => navigate(`/f/${fanmark.short_id}`)}
                                          className="rounded-md border border-border/50 bg-muted/60 px-3 py-1 text-[0.7rem] font-medium tracking-wide text-muted-foreground transition-colors hover:bg-muted/80"
                                          aria-label={t('dashboard.viewDetails')}
                                        >
                                          {fanmark.short_id}
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent>{t('dashboard.viewDetails')}</TooltipContent>
                                    </Tooltip>
                                  </div>
                                  <div>
                                    <div className="text-xs text-muted-foreground font-semibold mb-1">
                                      {t('dashboard.accessType')}
                                    </div>
                                    <div className={mobilePrimaryText}>
                                      {!isInactiveCard && timing.status === 'active'
                                        ? getAccessTypeBadge(fanmark.access_type, fanmark.fanmark)
                                        : <span className="text-muted-foreground text-sm">{t('dashboard.accessTypes.inactive')}</span>}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-xs text-muted-foreground font-semibold mb-1">
                                      {t('dashboard.acquisitionDate')}
                                    </div>
                                    <div className={mobilePrimaryText}>{acquisitionDate}</div>
                                  </div>
                                   <div>
                                     <div className="text-xs text-muted-foreground font-semibold mb-1">
                                       {t('dashboard.returnDate')}
                                     </div>
                                     <div className={mobilePrimaryText}>
                                       {expirationDate
                                         ? formatInTimeZone(expirationDate, 'Asia/Tokyo', 'yyyy/MM/dd')
                                         : t('dashboard.perpetualLicense')}
                                     </div>
                                   </div>
                                   <div>
                                     <div className="text-xs text-muted-foreground font-semibold mb-1">
                                       {t('dashboard.remainingDays')}
                                     </div>
                                      <div className="flex items-start justify-between gap-2">
                                        <div>
                                          {(timing.status === 'grace' || timing.status === 'grace-return') && timing.graceExpiresDate ? (
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <LicenseCountdown
                                                  expirationDate={timing.graceExpiresDate}
                                                  className={mobileGraceCountdownClass}
                                                />
                                              </TooltipTrigger>
                                              <TooltipContent className="rounded-2xl border border-rose-200 bg-rose-100 px-4 py-2 text-[0.7rem] font-medium text-rose-900 shadow-lg">
                                                {t('dashboard.extendHint')}
                                              </TooltipContent>
                                            </Tooltip>
                                          ) : timing.status === 'active' && expirationDate ? (
                                            <div>
                                              {msRemainingMobile !== null && msRemainingMobile > 0 && msRemainingMobile < 24 * 60 * 60 * 1000 ? (
                                                <LicenseCountdown expirationDate={expirationDate} className={mobileCountdownClass} />
                                              ) : (
                                                <span className={mobileCountdownClass}>
                                                  {t('dashboard.daysRemaining', { days: Math.max(daysRemaining ?? 0, 0) })}
                                                </span>
                                              )}
                                            </div>
                                          ) : timing.status === 'active' && !expirationDate ? (
                                            <span className="text-muted-foreground text-sm">
                                              {t('dashboard.perpetualLicense')}
                                            </span>
                                          ) : isReturned(fanmark) ? (
                                            <span className="text-muted-foreground text-sm">{t('dashboard.returned')}</span>
                                          ) : (
                                            <span className="text-muted-foreground text-sm">-</span>
                                          )}
                                        </div>
                                     </div>
                                   </div>
                                </div>

                                  <div className="flex items-center justify-end pt-2">
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="gap-2 px-3 rounded-md border border-border/60 bg-background/50 text-foreground hover:bg-background"
                                          aria-label={t('dashboard.actionsMenu')}
                                        >
                                          <MoreVertical className="h-5 w-5" />
                                          <span className="text-xs font-medium">{t('dashboard.actionsMenu')}</span>
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" sideOffset={8} collisionPadding={16} className="w-48">
                                        <DropdownMenuItem
                                          onSelect={(event) => { event.preventDefault(); event.stopPropagation(); navigateToFanmark(fanmark.fanmark, true); }}
                                          className="gap-2"
                                        >
                                          <ExternalLink className="h-4 w-4 text-primary" />
                                          <span>{t('dashboard.visitFanmarkTooltip')}</span>
                                        </DropdownMenuItem>
                                        {fanmark.short_id && (
                                          <DropdownMenuItem
                                            onSelect={(event) => { event.preventDefault(); event.stopPropagation(); window.open(`/q/${fanmark.short_id}`, '_blank', 'noopener,noreferrer'); }}
                                            className="gap-2"
                                          >
                                            <QrCode className="h-4 w-4 text-primary" />
                                            <span>{t('dashboard.actionsQRCode')}</span>
                                          </DropdownMenuItem>
                                        )}
                                       <DropdownMenuItem
                                         onSelect={() => {
                                           const fullUrl = getFanmarkUrlForClipboard(fanmark.fanmark);
                                           navigator.clipboard.writeText(fullUrl);
                                           toast({
                                             title: t('dashboard.urlCopiedTitle'),
                                             description: fullUrl,
                                           });
                                         }}
                                         className="gap-2"
                                       >
                                         <Copy className="h-4 w-4 text-primary" />
                                         <span>{t('dashboard.copyFanmarkLink')}</span>
                                       </DropdownMenuItem>
                                        <DropdownMenuItem
                                          onSelect={() => {
                                            if (!canExtend) return;
                                            openExtendDialog(fanmark, timing);
                                          }}
                                          className="gap-2"
                                          disabled={!canExtend}
                                        >
                                          <FiClock className="h-4 w-4 text-primary" />
                                          <span>{t('dashboard.extendMenuLabel')}</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          onSelect={() => {
                                            if (!canReturn) return;
                                            openReturnDialog(fanmark);
                                          }}
                                          className="gap-2"
                                          disabled={!canReturn}
                                        >
                                          <Undo2 className="h-4 w-4 text-primary" />
                                          <span>{t('dashboard.actionsReturn')}</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          onSelect={() => {
                                            if (!canReturn || hasActiveTransfer(fanmark.id)) return;
                                            openTransferDialog(fanmark);
                                          }}
                                          className="gap-2"
                                          disabled={!canReturn || hasActiveTransfer(fanmark.id)}
                                        >
                                          <ArrowRightLeft className="h-4 w-4 text-primary" />
                                          <span>{t('transfer.issueCode')}</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        {canAccessAnalytics && (
                                          <DropdownMenuItem
                                            onSelect={() => navigate(`/analytics?fanmark=${fanmark.short_id}`)}
                                            className="gap-2"
                                          >
                                            <BarChart3 className="h-4 w-4 text-primary" />
                                            <span>{t('dashboard.viewStats')}</span>
                                          </DropdownMenuItem>
                                        )}
                                        <DropdownMenuItem
                                          onSelect={() => handleOpenSettings(fanmark.id)}
                                          className="gap-2"
                                          disabled={isReturned(fanmark) || timing.status !== 'active'}
                                        >
                                          <Settings className="h-4 w-4 text-primary" />
                                          <span>{t('dashboard.actionsSettings')}</span>
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Transfer Section */}
            <FanmarkTransferSection
              issuedCodes={transferCodeData.issuedCodes}
              pendingRequests={transferCodeData.pendingRequests}
              myRequests={transferCodeData.myRequests}
              loading={transferCodeData.loading}
              cancelCode={transferCodeData.cancelCode}
              approveRequest={transferCodeData.approveRequest}
              rejectRequest={transferCodeData.rejectRequest}
              applyTransferCode={transferCodeData.applyTransferCode}
              onDataChange={() => {
                refetchTransfer();
                fetchFanmarks();
              }}
            />
          </TabsContent>

          <TabsContent value="acquisition" className="space-y-6">
            <Card
              id="dashboard-fanmark-search"
              className="overflow-hidden rounded-3xl border border-primary/20 bg-background/90 shadow-[0_20px_45px_rgba(101,195,200,0.14)] backdrop-blur"
            >
              <CardContent className="space-y-6 p-6 sm:p-8">
                <div className="space-y-3 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <FiCompass className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground">
                    {t('dashboard.getFanmaTitle')}
                  </h3>
                  <p className="mx-auto max-w-xl text-sm text-muted-foreground">
                    {t('dashboard.getFanmaDescription')}
                  </p>
                </div>
                <FanmarkAcquisition
                  prefilledEmoji={prefilledEmoji}
                  fanmarkLimit={isUnlimited ? -1 : fanmarkLimit}
                  currentCount={activeFanmarks}
                  rememberSearch
                  scrollToSearch={shouldScrollToSearch}
                  onSearchScrolled={() => setShouldScrollToSearch(false)}
                  onObtain={() => {
                    setPrefilledEmoji(undefined);
                    fetchFanmarks();
                    setActiveTab('my-fanmarks');
                  }}
                  onRequireAuth={handleRequireAuth}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

      </div>
      {returningFanmarkId && (
        <FanmarkReturnLoading fanmark={returningFanmarkEmoji || returnTargetFanmark?.fanmark} />
      )}

      <ExtendLicenseDialog
        target={extendTarget}
        open={extendDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            if (extendProcessing) return;
            setExtendDialogOpen(false);
            setExtendTarget(null);
            setExtendSelectedPlan(null);
          } else {
            setExtendDialogOpen(true);
          }
        }}
        onChangePlan={handleChangePlan}
        onSubmit={handleExtendSubmit}
        isProcessing={extendProcessing}
        selectedPlan={extendSelectedPlan}
        onCouponApplied={() => {
          // Refetch fanmarks to reflect the updated license
          fetchFanmarks();
        }}
      />

      <ReturnFanmarkDialog
        fanmark={returnTargetFanmark ? {
          emoji: returnTargetFanmark.fanmark,
          shortId: returnTargetFanmark.short_id,
          tierLevel: returnTargetFanmark.tier_level ?? undefined,
          licenseEnd: returnTargetFanmark.fanmark_licenses?.license_end,
        } : null}
        open={returnDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            if (returningFanmarkId) return;
            setReturnDialogOpen(false);
            setReturnTargetFanmark(null);
          } else {
            setReturnDialogOpen(true);
          }
        }}
        onConfirm={handleConfirmReturn}
        isProcessing={Boolean(returningFanmarkId)}
        hasPendingCheckout={
          returnTargetFanmark
            ? getPendingCheckout()?.fanmarkId === returnTargetFanmark.id
            : false
        }
      />

      <TransferCodeIssueDialog
        open={transferDialogOpen}
        onOpenChange={setTransferDialogOpen}
        fanmarkId={transferTargetFanmark?.fanmarkId ?? null}
        licenseId={transferTargetFanmark?.licenseId ?? null}
        fanmarkEmoji={transferTargetFanmark?.emoji ?? ''}
        onSuccess={() => {
          refetchTransfer();
          fetchFanmarks();
        }}
      />
    </section>
  );
};
