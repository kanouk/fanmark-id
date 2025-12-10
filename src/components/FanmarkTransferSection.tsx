import { useState } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { TransferCode, TransferRequest } from '@/hooks/useTransferCode';
import { Copy, AlertTriangle, ArrowRightLeft, Clock, X, Check } from 'lucide-react';
import { TransferCodeInputDialog } from './TransferCodeInputDialog';
import { TransferApprovalDialog } from './TransferApprovalDialog';

interface FanmarkTransferSectionProps {
  issuedCodes: TransferCode[];
  pendingRequests: TransferRequest[];
  myRequests: TransferRequest[];
  loading: boolean;
  cancelCode: (id: string) => Promise<any>;
  approveRequest: (id: string) => Promise<any>;
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
      await approveRequest(requestId);
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
              {t('transfer.inputCodeButton')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-6 pb-6 space-y-6">
          {/* Notice */}
          <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800 dark:text-amber-200">
              {t('transfer.sectionNotice')}
            </p>
          </div>

          {/* Issued Codes */}
          {issuedCodes.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground">
                {t('transfer.issuedCodesTitle')}
              </h4>
              <div className="space-y-2">
                {issuedCodes.map((code) => (
                  <div
                    key={code.id}
                    className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{code.fanmark?.user_input_fanmark}</span>
                        <Badge variant={code.status === 'applied' ? 'default' : 'secondary'}>
                          {code.status === 'applied'
                            ? t('transfer.statusPendingApproval')
                            : t('transfer.statusWaiting')}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="font-mono">{code.transfer_code}</span>
                        <button
                          onClick={() => handleCopyCode(code.transfer_code)}
                          className="p-1 hover:text-foreground"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>{t('transfer.expiresAt')}: {formatDate(code.expires_at)}</span>
                      </div>
                    </div>
                    {code.status === 'active' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCancelCode(code.id)}
                        disabled={cancellingCodeId === code.id}
                      >
                        {cancellingCodeId === code.id ? (
                          <span className="animate-spin">...</span>
                        ) : (
                          <>
                            <X className="h-4 w-4 mr-1" />
                            {t('transfer.cancelCode')}
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pending Requests (for approval) */}
          {pendingRequests.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground">
                {t('transfer.pendingRequestsTitle')}
              </h4>
              <div className="space-y-2">
                {pendingRequests.map((request) => (
                  <div
                    key={request.id}
                    className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{request.fanmark?.user_input_fanmark}</span>
                        <span className="text-sm text-muted-foreground">→</span>
                        <span className="text-sm font-medium">
                          {request.requester_display_name || request.requester_username || 'unknown'}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t('transfer.appliedAt')}: {formatDate(request.applied_at)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRejectRequest(request.id)}
                        disabled={processingRequestId === request.id}
                      >
                        <X className="h-4 w-4 mr-1" />
                        {t('transfer.rejectRequest')}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setSelectedRequest(request);
                          setApprovalDialogOpen(true);
                        }}
                        disabled={processingRequestId === request.id}
                      >
                        <Check className="h-4 w-4 mr-1" />
                        {t('transfer.approveRequest')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* My Outgoing Requests */}
          {myRequests.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground">
                {t('transfer.myRequestsTitle')}
              </h4>
              <div className="space-y-2">
                {myRequests.map((request) => (
                  <div
                    key={request.id}
                    className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{request.fanmark?.user_input_fanmark}</span>
                        <Badge variant="secondary">
                          {t('transfer.statusPendingApproval')}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t('transfer.appliedAt')}: {formatDate(request.applied_at)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty State */}
          {issuedCodes.length === 0 && pendingRequests.length === 0 && myRequests.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <ArrowRightLeft className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">{t('transfer.noIssuedCodes')}</p>
            </div>
          )}
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