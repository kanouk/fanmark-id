import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export interface TransferCode {
  id: string;
  license_id: string;
  fanmark_id: string;
  transfer_code: string;
  status: string;
  expires_at: string;
  created_at: string;
  fanmark?: {
    user_input_fanmark: string;
    display_fanmark?: string | null;
    short_id: string;
  };
}

export interface TransferRequest {
  id: string;
  transfer_code_id: string;
  fanmark_id: string;
  license_id: string;
  requester_user_id: string;
  requester_username: string | null;
  requester_display_name: string | null;
  status: string;
  applied_at: string;
  fanmark?: {
    user_input_fanmark: string;
    display_fanmark?: string | null;
    short_id: string;
  };
}

export const useTransferCode = () => {
  const { user } = useAuth();
  const [issuedCodes, setIssuedCodes] = useState<TransferCode[]>([]);
  const [pendingRequests, setPendingRequests] = useState<TransferRequest[]>([]);
  const [myRequests, setMyRequests] = useState<TransferRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTransferData = useCallback(async () => {
    if (!user) return;

    try {
      // Fetch issued codes (where I am the issuer)
      const { data: codes } = await supabase
        .from('fanmark_transfer_codes')
        .select(`
          id,
          license_id,
          fanmark_id,
          transfer_code,
          status,
          expires_at,
          created_at,
          fanmark_licenses (
            display_fanmark
          ),
          fanmarks (
            user_input_fanmark,
            short_id
          )
        `)
        .eq('issuer_user_id', user.id)
        .in('status', ['active', 'applied'])
        .order('created_at', { ascending: false });

      if (codes) {
        setIssuedCodes(codes.map(c => ({
          ...c,
          fanmark: {
            ...(c.fanmarks as TransferCode['fanmark']),
            display_fanmark: (c.fanmark_licenses as { display_fanmark?: string | null } | null)?.display_fanmark ?? null,
          }
        })));
      }

      // Fetch pending requests for my codes (where someone applied to my code)
      const { data: requests } = await supabase
        .from('fanmark_transfer_requests')
        .select(`
          id,
          transfer_code_id,
          fanmark_id,
          license_id,
          requester_user_id,
          requester_username,
          requester_display_name,
          status,
          applied_at,
          fanmark_licenses (
            display_fanmark
          ),
          fanmarks (
            user_input_fanmark,
            short_id
          )
        `)
        .eq('status', 'pending');

      if (requests) {
        // Filter requests where I am the issuer of the code
        const myCodeIds = new Set((codes || []).map(c => c.id));
        const pendingForMe: TransferRequest[] = requests
          .filter(r => myCodeIds.has(r.transfer_code_id))
          .map(r => ({
            ...r,
            fanmark: {
              ...(r.fanmarks as TransferRequest['fanmark']),
              display_fanmark: (r.fanmark_licenses as { display_fanmark?: string | null } | null)?.display_fanmark ?? null,
            }
          }));

        setPendingRequests(pendingForMe);
      }

      // Fetch my outgoing requests (where I am the requester)
      const { data: myReqs } = await supabase
        .from('fanmark_transfer_requests')
        .select(`
          id,
          transfer_code_id,
          fanmark_id,
          license_id,
          requester_user_id,
          requester_username,
          requester_display_name,
          status,
          applied_at,
          fanmark_licenses (
            display_fanmark
          ),
          fanmarks (
            user_input_fanmark,
            short_id
          )
        `)
        .eq('requester_user_id', user.id)
        .eq('status', 'pending')
        .order('applied_at', { ascending: false });

      if (myReqs) {
        setMyRequests(myReqs.map(r => ({
          ...r,
          fanmark: {
            ...(r.fanmarks as TransferRequest['fanmark']),
            display_fanmark: (r.fanmark_licenses as { display_fanmark?: string | null } | null)?.display_fanmark ?? null,
          }
        })));
      }
    } catch (error) {
      console.error('Failed to fetch transfer data:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchTransferData();
  }, [fetchTransferData]);

  const issueTransferCode = async (fanmarkId: string, licenseId: string) => {
    const { data, error } = await supabase.functions.invoke('generate-transfer-code', {
      body: {
        fanmark_id: fanmarkId,
        license_id: licenseId,
        disclaimer_agreed: true
      }
    });

    if (error) {
      let errorMessage = (error as Error)?.message || 'Unknown error';
      let lockedUntil: string | null = null;
      const anyError = error as { context?: unknown };
      const context = anyError?.context;
      const parsePayload = (payload: unknown) => {
        if (!payload) return;
        if (typeof payload === 'string') {
          try {
            const parsed = JSON.parse(payload);
            if (parsed?.error) {
              errorMessage = parsed.error;
            }
            if (parsed?.locked_until) {
              lockedUntil = parsed.locked_until;
            }
          } catch {
            if (payload.trim()) {
              errorMessage = payload;
            }
          }
          return;
        }
        if (typeof payload === 'object') {
          const maybeError = (payload as { error?: string }).error;
          if (maybeError) {
            errorMessage = maybeError;
          }
          const maybeLockedUntil = (payload as { locked_until?: string }).locked_until;
          if (maybeLockedUntil) {
            lockedUntil = maybeLockedUntil;
          }
        }
      };

      if (context instanceof Response) {
        try {
          const clone = context.clone ? context.clone() : context;
          const rawBody = await clone.text();
          if (rawBody.trim()) {
            parsePayload(rawBody);
          }
        } catch (parseError) {
          console.warn('[useTransferCode] Failed to parse error response:', parseError);
        }
      } else {
        parsePayload(context);
      }

      const err = new Error(errorMessage);
      if (lockedUntil) {
        (err as Error & { lockedUntil?: string }).lockedUntil = lockedUntil;
      }
      throw err;
    }
    if (data?.error) throw new Error(data.error);

    await fetchTransferData();
    return data;
  };

  const applyTransferCode = async (transferCode: string) => {
    const { data, error } = await supabase.functions.invoke('apply-transfer-code', {
      body: {
        transfer_code: transferCode,
        disclaimer_agreed: true
      }
    });

    // Handle errors - check both error object and data.error
    // When Edge Function returns non-2xx, error is set but data may contain the response body
    const errorData = data?.error ? data : null;

    if (error || errorData) {
      const errorInfo = errorData || {};
      let errorMessage = errorInfo.error || (error as Error)?.message || 'Unknown error';
      let errorCode = errorInfo.error || '';
      let current = errorInfo.current;
      let limit = errorInfo.limit;

      const parseErrorPayload = (payload: unknown) => {
        if (!payload) return;
        if (typeof payload === 'string') {
          try {
            const parsed = JSON.parse(payload);
            if (parsed && typeof parsed.error === 'string') {
              errorCode = parsed.error;
              errorMessage = parsed.error;
              current = parsed.current ?? current;
              limit = parsed.limit ?? limit;
            }
          } catch {
            if (payload.trim()) {
              errorMessage = payload;
            }
          }
          return;
        }
        if (typeof payload === 'object') {
          const maybeError = (payload as { error?: string }).error;
          if (typeof maybeError === 'string') {
            errorCode = maybeError;
            errorMessage = maybeError;
          }
          const maybeCurrent = (payload as { current?: number }).current;
          const maybeLimit = (payload as { limit?: number }).limit;
          if (maybeCurrent !== undefined) current = maybeCurrent;
          if (maybeLimit !== undefined) limit = maybeLimit;
        }
      };

      if (error && typeof error === 'object') {
        const anyError = error as { context?: unknown };
        const context = anyError.context;
        if (context instanceof Response) {
          try {
            const clone = context.clone ? context.clone() : context;
            const rawBody = await clone.text();
            parseErrorPayload(rawBody);
          } catch (parseError) {
            console.warn('[useTransferCode] Failed to parse error response:', parseError);
          }
        } else if (context && typeof context === 'object' && 'response' in context) {
          const response = (context as { response?: Response }).response;
          if (response) {
            try {
              const clone = response.clone ? response.clone() : response;
              const rawBody = await clone.text();
              parseErrorPayload(rawBody);
            } catch (parseError) {
              console.warn('[useTransferCode] Failed to parse error response:', parseError);
            }
          }
        } else {
          parseErrorPayload(context);
        }
      }

      // Include additional data (current, limit) in error message for limit exceeded errors
      const finalCode = errorCode || errorMessage;
      if (finalCode === 'fanmark_limit_exceeded' && current !== undefined && limit !== undefined) {
        throw new Error(`fanmark_limit_exceeded: current: ${current}, limit: ${limit}`);
      }
      throw new Error(finalCode || errorMessage);
    }

    await fetchTransferData();
    return data;
  };

  const approveRequest = async (requestId: string, transferredFanmarkName?: string) => {
    const { data, error } = await supabase.functions.invoke('approve-transfer-request', {
      body: { request_id: requestId, transferredFanmarkName }
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    await fetchTransferData();
    return data;
  };

  const rejectRequest = async (requestId: string) => {
    const { data, error } = await supabase.functions.invoke('reject-transfer-request', {
      body: { request_id: requestId }
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    await fetchTransferData();
    return data;
  };

  const cancelCode = async (transferCodeId: string) => {
    const { data, error } = await supabase.functions.invoke('cancel-transfer-code', {
      body: { transfer_code_id: transferCodeId }
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    await fetchTransferData();
    return data;
  };

  // Check if a fanmark has an active transfer
  const hasActiveTransfer = (fanmarkId: string): boolean => {
    return issuedCodes.some(c => c.fanmark_id === fanmarkId);
  };

  // Get transfer status for a fanmark
  const getTransferStatus = (fanmarkId: string): 'active' | 'applied' | null => {
    const code = issuedCodes.find(c => c.fanmark_id === fanmarkId);
    if (!code) return null;
    return code.status as 'active' | 'applied';
  };

  return {
    issuedCodes,
    pendingRequests,
    myRequests,
    loading,
    refetch: fetchTransferData,
    issueTransferCode,
    applyTransferCode,
    approveRequest,
    rejectRequest,
    cancelCode,
    hasActiveTransfer,
    getTransferStatus
  };
};
