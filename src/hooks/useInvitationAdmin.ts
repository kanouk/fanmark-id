import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type InvitationCodeRow = Database['public']['Tables']['invitation_codes']['Row'];
type InvitationCodeInsert = Database['public']['Tables']['invitation_codes']['Insert'];
type InvitationCodeUpdate = Database['public']['Tables']['invitation_codes']['Update'];

export interface InvitationCodeFormValues {
  code?: string;
  maxUses: number;
  expiresAt?: string | null;
  specialPerks?: Record<string, unknown> | null;
}

export function useInvitationAdmin() {
  const [codes, setCodes] = useState<InvitationCodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCodes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('invitation_codes')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;
      setCodes(data ?? []);
    } catch (err) {
      console.error('Failed to fetch invitation codes:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch invitation codes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCodes();
  }, [fetchCodes]);

  const createCode = useCallback(
    async (values: InvitationCodeFormValues) => {
      setError(null);
      const payload: InvitationCodeInsert = {
        code: values.code?.trim().toUpperCase() ?? generateCode(),
        max_uses: values.maxUses,
        expires_at: values.expiresAt || null,
        special_perks: values.specialPerks ?? null,
        is_active: true,
      };

      try {
        const { error: insertError } = await supabase.from('invitation_codes').insert(payload);
        if (insertError) throw insertError;
        await fetchCodes();
        return { success: true, code: payload.code };
      } catch (err) {
        console.error('Failed to create invitation code:', err);
        setError(err instanceof Error ? err.message : 'Failed to create invitation code');
        return { success: false, error: err };
      }
    },
    [fetchCodes]
  );

  const updateCode = useCallback(
    async (id: string, updates: InvitationCodeUpdate) => {
      setError(null);
      try {
        const { error: updateError } = await supabase.from('invitation_codes').update(updates).eq('id', id);
        if (updateError) throw updateError;
        await fetchCodes();
        return { success: true };
      } catch (err) {
        console.error('Failed to update invitation code:', err);
        setError(err instanceof Error ? err.message : 'Failed to update invitation code');
        return { success: false, error: err };
      }
    },
    [fetchCodes]
  );

  const toggleActive = useCallback(
    async (id: string, isActive: boolean) => {
      return updateCode(id, { is_active: isActive });
    },
    [updateCode]
  );

  const deleteCode = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const { error: deleteError } = await supabase.from('invitation_codes').delete().eq('id', id);
        if (deleteError) throw deleteError;
        await fetchCodes();
        return { success: true };
      } catch (err) {
        console.error('Failed to delete invitation code:', err);
        setError(err instanceof Error ? err.message : 'Failed to delete invitation code');
        return { success: false, error: err };
      }
    },
    [fetchCodes]
  );

  return {
    codes,
    loading,
    error,
    refresh: fetchCodes,
    createCode,
    updateCode,
    toggleActive,
    deleteCode,
  };
}

function generateCode(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
