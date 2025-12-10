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
          fanmark: c.fanmarks as TransferCode['fanmark']
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
            fanmark: r.fanmarks as TransferRequest['fanmark']
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
          fanmark: r.fanmarks as TransferRequest['fanmark']
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

    if (error) throw error;
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

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

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
