import { useMemo, useState } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { TransferCode, TransferRequest } from '@/hooks/useTransferCode';
import { Copy, AlertTriangle, ArrowRightLeft, Clock, X, Check, Handshake } from 'lucide-react';
import { TransferCodeInputDialog } from './TransferCodeInputDialog';
import { TransferApprovalDialog } from './TransferApprovalDialog';

interface FanmarkTransferSectionProps {
  issuedCodes: TransferCode[];
  pendingRequests: TransferRequest[];
  myRequests: TransferRequest[];
  loading: boolean;
  cancelCode: (id: string) => Promise<any>;
  approveRequest: (id: string, transferredFanmarkName?: string) => Promise<any>;
  rejectRequest: (id: string) => Promise<any>;
  applyTransferCode: (code: string) => Promise<any>;
  onDataChange?: () => void;
}

export const FanmarkTransferSection = ({
  issuedCodes,
  pendingRequests,
  myRequests,
  loading,
  cancelCode,
  approveRequest,
  rejectRequest,
  applyTransferCode,
  onDataChange
}: FanmarkTransferSectionProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [inputDialogOpen, setInputDialogOpen] = useState(false);
  const [approvalDialogOpen, setApprovalDialogOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<TransferRequest | null>(null);
  const [cancellingCodeId, setCancellingCodeId] = useState<string | null>(null);
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast({
        title: t('common.linkCopied'),
        description: code
      });
    } catch {
      // Fallback
    }
  };

  const handleCancelCode = async (codeId: string) => {
    setCancellingCodeId(codeId);
    try {
      await cancelCode(codeId);
      toast({
        title: t('transfer.success.codeCancelled')
      });
      onDataChange?.();
    } catch (error) {
      toast({
        title: t('transfer.error.cancelFailed'),
        variant: 'destructive'
      });
    } finally {
      setCancellingCodeId(null);
    }
  };

  const handleApproveRequest = async (requestId: string) => {
    setProcessingRequestId(requestId);
    try {
      await approveRequest(requestId, t('fanmarkSettings.summary.transferredName'));
      toast({
        title: t('transfer.success.requestApproved'),
        description: t('transfer.success.requestApprovedDesc')
      });
      setApprovalDialogOpen(false);
      setSelectedRequest(null);
      onDataChange?.();
    } catch (error) {
      toast({
        title: t('transfer.error.approveFailed'),
        variant: 'destructive'
      });
    } finally {
      setProcessingRequestId(null);
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    setProcessingRequestId(requestId);
    try {
      await rejectRequest(requestId);
      toast({
        title: t('transfer.success.requestRejected')
      });
      onDataChange?.();
    } catch (error) {
      toast({
        title: t('transfer.error.rejectFailed'),
        variant: 'destructive'
      });
    } finally {
      setProcessingRequestId(null);
    }
  };

  const formatDate = (dateString: string) => {
    try {
      return formatInTimeZone(new Date(dateString), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
    } catch {
      return dateString;
    }
  };

  type TransferEntry = {
    fanmarkId: string;
    fanmarkLabel: string;
    shortId?: string;
    issuedCode?: TransferCode;
    requestsForMyCode: TransferRequest[];
    myRequest?: TransferRequest;
  };

  const transferEntries = useMemo(() => {
    const map = new Map<string, TransferEntry>();

    const ensureEntry = (fanmarkId: string, fanmark?: TransferCode['fanmark']) => {
      const existing = map.get(fanmarkId);
      if (existing) {
        if (!existing.fanmarkLabel && fanmark?.display_fanmark) {
          existing.fanmarkLabel = fanmark.display_fanmark;
        }
        if (!existing.shortId && fanmark?.short_id) {
          existing.shortId = fanmark.short_id;
        }
        return existing;
      }

      const created: TransferEntry = {
        fanmarkId,
        fanmarkLabel: fanmark?.display_fanmark ?? '',
        shortId: fanmark?.short_id,
        requestsForMyCode: []
      };
      map.set(fanmarkId, created);
      return created;
    };

    issuedCodes.forEach(code => {
      const entry = ensureEntry(code.fanmark_id, code.fanmark);
      entry.issuedCode = code;
    });

    pendingRequests.forEach(request => {
      const entry = ensureEntry(request.fanmark_id, request.fanmark);
      entry.requestsForMyCode.push(request);
    });

    myRequests.forEach(request => {
      const entry = ensureEntry(request.fanmark_id, request.fanmark);
      entry.myRequest = request;
    });

    const sorted = Array.from(map.values()).sort((a, b) => {
      const aDate = a.issuedCode?.created_at ?? a.myRequest?.applied_at ?? '';
      const bDate = b.issuedCode?.created_at ?? b.myRequest?.applied_at ?? '';
      return bDate.localeCompare(aDate);
    });

    return sorted.map(entry => ({
      ...entry,
      fanmarkLabel: entry.fanmarkLabel || t('common.unknownUser')
    }));
  }, [issuedCodes, pendingRequests, myRequests, t]);

  const getEntryStatus = (entry: TransferEntry) => {
    if (entry.myRequest) {
      return {
        badge: t('transfer.badgePendingApproval'),
        badgeVariant: 'default' as const,
        actionText: t('transfer.nextActionWaitingApproval'),
        roleLabel: t('transfer.roleReceiver')
      };
    }

    if (entry.requestsForMyCode.length > 0) {
      return {
        badge: t('transfer.statusPendingApproval'),
        badgeVariant: 'default' as const,
        actionText: t('transfer.nextActionApprove', { count: entry.requestsForMyCode.length }),
        roleLabel: t('transfer.roleIssuer')
      };
    }

    if (entry.issuedCode) {
      return {
        badge: t('transfer.statusWaiting'),
        badgeVariant: 'secondary' as const,
        actionText: t('transfer.nextActionShareCode'),
        roleLabel: t('transfer.roleIssuer')
      };
    }

    return {
      badge: t('transfer.statusPendingApproval'),
      badgeVariant: 'secondary' as const,
      actionText: '',
      roleLabel: ''
    };
  };

  type FlowStep = {
    id: 'issue' | 'apply' | 'review';
    label: string;
    status: 'done' | 'current' | 'upcoming';
  };

  const getFlowSteps = (entry: TransferEntry): FlowStep[] => {
    const hasPending = entry.requestsForMyCode.length > 0;
    const hasIssued = Boolean(entry.issuedCode);

    // Receiver view (I applied)
    if (entry.myRequest) {
      return [
        { id: 'issue', label: t('transfer.flow.issueCode'), status: 'done' },
        { id: 'apply', label: t('transfer.flow.applyCode'), status: 'done' },
        { id: 'review', label: t('transfer.flow.reviewRequests'), status: 'current' }
      ];
    }

    return [
      { id: 'issue', label: t('transfer.flow.issueCode'), status: hasIssued ? 'done' : 'upcoming' },
      { id: 'apply', label: t('transfer.flow.applyCode'), status: hasPending ? 'done' : hasIssued ? 'current' : 'upcoming' },
      { id: 'review', label: t('transfer.flow.reviewRequests'), status: hasPending ? 'current' : 'upcoming' }
    ];
  };

  const flowCircleClass = (status: FlowStep['status']) => {
    if (status === 'current') return 'bg-primary text-primary-foreground border-primary shadow-md';
    if (status === 'done') return 'bg-primary/15 text-primary border-primary/30';
    return 'bg-muted text-muted-foreground border-border';
  };

  if (loading) {
    return (
      <Card className="rounded-2xl border border-primary/15 bg-background/90">
        <CardContent className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-muted rounded w-1/3"></div>
            <div className="h-20 bg-muted rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="rounded-2xl border border-primary/15 bg-background/90">
        <CardHeader className="px-6 pt-6 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg font-semibold">
                {t('transfer.sectionTitle')}
              </CardTitle>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setInputDialogOpen(true)}
            >
              <Handshake className="h-4 w-4 mr-1" />
              {t('transfer.inputCodeButton')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-6 pb-6 space-y-6">
          {transferEntries.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <ArrowRightLeft className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">{t('transfer.noIssuedCodes')}</p>
            </div>
          )}

          {transferEntries.map((entry) => {
            const status = getEntryStatus(entry);
            const steps = getFlowSteps(entry);
            const fanmarkLabel = entry.fanmarkLabel || t('common.unknownUser');

            return (
              <div
                key={entry.fanmarkId}
                className="rounded-xl border bg-muted/40 p-4 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-semibold">{fanmarkLabel}</span>
                      {entry.shortId && (
                        <span className="rounded-md border border-border/50 bg-muted/60 px-2.5 py-1 text-[0.7rem] font-medium tracking-wide text-muted-foreground">
                          {entry.shortId}
                        </span>
                      )}
                    </div>
                    {entry.issuedCode && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground self-end">
                        <Clock className="h-3 w-3" />
                        {t('transfer.expiresAt')}: {formatDate(entry.issuedCode.expires_at)}
                      </div>
                    )}
                  </div>
                  {entry.issuedCode && entry.issuedCode.status === 'active' && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCancelCode(entry.issuedCode!.id)}
                        disabled={cancellingCodeId === entry.issuedCode.id}
                      >
                        {cancellingCodeId === entry.issuedCode.id ? (
                          <span className="animate-spin">...</span>
                        ) : (
                          <>
                            <X className="h-4 w-4 mr-1" />
                            {t('transfer.cancelCode')}
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4 space-y-4">
                  <div className="flex items-center gap-3 text-sm font-medium text-foreground">
                    <ArrowRightLeft className="h-4 w-4 text-primary" />
                    <span>{t('transfer.flowTitle')}</span>
                  </div>
                  <div className="flex flex-col gap-3">
                    <div className="hidden items-center gap-3 md:gap-4 md:flex">
                      {steps.map((step, index) => {
                        const isCurrent = step.status === 'current';
                        const isDone = step.status === 'done';
                        const labelColor = isCurrent
                          ? 'text-foreground'
                          : isDone
                            ? 'text-muted-foreground'
                            : 'text-muted-foreground/80';
                        const lineTone = isCurrent ? 'from-primary/60 via-primary/30' : 'from-border via-border';

                        return (
                          <div key={index} className="flex items-center gap-3 md:gap-4 flex-1">
                            <div className="flex items-center gap-2">
                              <div
                                className={`flex h-10 w-10 items-center justify-center rounded-full border text-sm font-semibold ${flowCircleClass(step.status)}`}
                              >
                                {index + 1}
                              </div>
                              <span className={`text-xs sm:text-sm ${labelColor}`}>{step.label}</span>
                            </div>
                            {index < steps.length - 1 && (
                              <div className={`h-px flex-1 bg-gradient-to-r ${lineTone} to-transparent`} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex flex-col gap-4 md:grid md:grid-cols-3 md:auto-rows-fr">
                      {steps.map((step) => {
                        const isCurrent = step.status === 'current';
                        const isDone = step.status === 'done';
                        const panelClasses = isCurrent
                          ? 'border-primary/40 bg-background shadow-sm'
                          : 'border-muted bg-muted/40';

                        const statusBadgeClass = (() => {
                          if (isCurrent) return 'bg-primary text-primary-foreground border-primary/70';
                          if (isDone) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
                          return 'bg-muted text-muted-foreground border-border';
                        })();

                        const renderStepActions = () => {
                          switch (step.id) {
                            case 'issue':
                              if (entry.myRequest) {
                                return (
                                  <div className="text-xs text-muted-foreground leading-relaxed">
                                    {t('transfer.stepDetail.receiverIssueInfo')}
                                  </div>
                                );
                              }
                              return entry.issuedCode ? (
                                <div className="space-y-3">
                                  <div className="flex items-center justify-between gap-3 text-sm">
                                    <span className="font-mono text-base font-semibold text-foreground tracking-wide">{entry.issuedCode.transfer_code}</span>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-9 w-9 border"
                                      onClick={() => handleCopyCode(entry.issuedCode!.transfer_code)}
                                    >
                                      <Copy className="h-4 w-4" />
                                    </Button>
                                  </div>
                                  <p className="text-xs text-muted-foreground leading-relaxed">
                                    {t('transfer.stepDetail.issueShare')}
                                  </p>
                                </div>
                              ) : (
                                <div className="text-xs text-muted-foreground">{t('transfer.stepDetail.issueShare')}</div>
                              );
                            case 'apply':
                              if (entry.myRequest) {
                                return (
                                  <div className="text-xs text-muted-foreground">
                                    {t('transfer.stepDetail.appliedInfo', { date: formatDate(entry.myRequest?.applied_at || '') })}
                                  </div>
                                );
                              }
                              if (entry.requestsForMyCode.length > 0) {
                                const names = entry.requestsForMyCode.map((r) => r.requester_display_name || r.requester_username || t('common.unknownUser'));
                                const primary = names[0];
                                const extraCount = names.length - 1;
                                return (
                                  <div className="text-xs text-muted-foreground leading-relaxed">
                                    {t('transfer.stepDetail.applyReceivedOwner', { user: primary })}
                                    {extraCount > 0 && (
                                      <span className="block text-muted-foreground">
                                        {t('transfer.stepDetail.applyReceivedAdditional', { count: extraCount })}
                                      </span>
                                    )}
                                  </div>
                                );
                              }
                              return (
                                <div className="text-xs text-muted-foreground">
                                  {t('transfer.stepDetail.waitForRequest')}
                                </div>
                              );
                            case 'review':
                              if (entry.myRequest) {
                                return (
                                  <div className="text-xs text-muted-foreground">
                                    {t('transfer.stepDetail.waitForApproval')}
                                  </div>
                                );
                              }
                              if (entry.requestsForMyCode.length > 0) {
                                const first = entry.requestsForMyCode[0];
                                const deadline =
                                  entry.issuedCode?.expires_at || first.applied_at;
                                return (
                                  <div className="text-xs text-muted-foreground leading-relaxed">
                                    {t('transfer.stepDetail.approvalDeadline', {
                                      date: formatDate(deadline)
                                    })}
                                  </div>
                                );
                              }
                              return (
                                <div className="text-xs text-muted-foreground">
                                  {t('transfer.stepDetail.waitForRequest')}
                                </div>
                              );
                            default:
                              return null;
                          }
                        };

                        return (
                          <div
                            key={step.id}
                            className={`rounded-lg border p-3 flex flex-col justify-between gap-2 h-full ${panelClasses}`}
                          >
                            <div className="flex items-center justify-between md:hidden">
                              <div className="flex items-center gap-2">
                                <div
                                  className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold ${flowCircleClass(step.status)}`}
                                >
                                  {steps.indexOf(step) + 1}
                                </div>
                                <span className="text-sm text-foreground">{step.label}</span>
                              </div>
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass}`}
                              >
                                {isCurrent
                                  ? t('transfer.stepStatus.current')
                                  : isDone
                                    ? t('transfer.stepStatus.done')
                                    : t('transfer.stepStatus.upcoming')}
                              </span>
                            </div>
                            <div className="hidden items-center justify-end text-sm font-medium md:flex">
                              <span
                                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeClass}`}
                              >
                                {isCurrent
                                  ? t('transfer.stepStatus.current')
                                  : isDone
                                    ? t('transfer.stepStatus.done')
                                    : t('transfer.stepStatus.upcoming')}
                              </span>
                            </div>
                            <div className="space-y-2 text-sm flex-1">
                              <div className="rounded-md border border-dashed border-border/60 bg-background/50 p-3 min-h-[96px] flex items-start">
                                <div className="w-full">
                                  {renderStepActions()}
                                </div>
                              </div>
                            </div>
                            {(step.id === 'issue' && entry.issuedCode) || (step.id === 'review' && entry.requestsForMyCode.length > 0) ? (
                              <div className="flex justify-end pt-2 gap-2">
                                {step.id === 'issue' && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-muted-foreground h-8 text-xs border"
                                    disabled={entry.issuedCode!.status !== 'active' || cancellingCodeId === entry.issuedCode!.id}
                                    onClick={() => handleCancelCode(entry.issuedCode!.id)}
                                  >
                                    {cancellingCodeId === entry.issuedCode!.id ? (
                                      <span className="animate-spin">...</span>
                                    ) : (
                                      <>
                                        <X className="h-3 w-3 mr-1" />
                                        {t('transfer.cancelCode')}
                                      </>
                                    )}
                                  </Button>
                                )}
                                {step.id === 'review' && entry.requestsForMyCode.length > 0 && (
                                  <div className="flex gap-2">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="text-muted-foreground h-8 text-xs border"
                                      disabled={processingRequestId !== null}
                                      onClick={() => {
                                        const req = entry.requestsForMyCode[0];
                                        if (req) handleRejectRequest(req.id);
                                      }}
                                    >
                                      <X className="h-3 w-3 mr-1" />
                                      {t('transfer.rejectRequest')}
                                    </Button>
                                    <Button
                                      size="sm"
                                      className="h-8 text-xs"
                                      disabled={processingRequestId !== null}
                                      onClick={() => {
                                        const req = entry.requestsForMyCode[0];
                                        if (req) {
                                          setSelectedRequest(req);
                                          setApprovalDialogOpen(true);
                                        }
                                      }}
                                    >
                                      <Check className="h-3 w-3 mr-1" />
                                      {t('transfer.approveRequest')}
                                    </Button>
                                  </div>
                                )}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <TransferCodeInputDialog
        open={inputDialogOpen}
        onOpenChange={setInputDialogOpen}
        applyTransferCode={applyTransferCode}
        onSuccess={() => {
          onDataChange?.();
          setInputDialogOpen(false);
        }}
      />

      {selectedRequest && (
        <TransferApprovalDialog
          open={approvalDialogOpen}
          onOpenChange={setApprovalDialogOpen}
          request={selectedRequest}
          onApprove={() => handleApproveRequest(selectedRequest.id)}
          processing={processingRequestId === selectedRequest.id}
        />
      )}
    </>
  );
};
