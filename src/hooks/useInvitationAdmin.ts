import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import {
  createInvitationCode,
  deleteInvitationCode,
  getInvitationAdminBackend,
  loadInvitationCodes,
  updateInvitationCode,
} from '@/lib/invitation-admin-api';

// Export the Row type for use in other components
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
      if (getInvitationAdminBackend() === 'worker') {
        setCodes(await loadInvitationCodes() as unknown as InvitationCodeRow[]);
        return;
      }
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
        special_perks: (values.specialPerks as Database['public']['Tables']['invitation_codes']['Insert']['special_perks']) ?? null,
        is_active: true,
      };

      try {
        if (getInvitationAdminBackend() === 'worker') {
          const created = await createInvitationCode({
            // Let the Worker generate codes with its cryptographic RNG when
            // the admin leaves the field blank. Keep the legacy generator on
            // the unchanged Supabase path only.
            code: values.code?.trim() ? values.code.trim().toUpperCase() : null,
            max_uses: payload.max_uses,
            expires_at: payload.expires_at ?? null,
          special_perks: payload.special_perks ?? null,
          });
          await fetchCodes();
          return { success: true, code: created.code };
        }
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
        if (getInvitationAdminBackend() === 'worker') {
          const row = codes.find((code) => code.id === id);
          if (!row) throw new Error('Invitation code changed; refresh and try again');
          const patch: Parameters<typeof updateInvitationCode>[1] = { expectedUpdatedAt: row.updated_at };
          if (Object.prototype.hasOwnProperty.call(updates, 'max_uses') && updates.max_uses !== undefined) patch.max_uses = updates.max_uses;
          if (Object.prototype.hasOwnProperty.call(updates, 'expires_at')) patch.expires_at = updates.expires_at ?? null;
          if (Object.prototype.hasOwnProperty.call(updates, 'special_perks')) patch.special_perks = updates.special_perks ?? null;
          if (Object.prototype.hasOwnProperty.call(updates, 'is_active') && updates.is_active !== undefined) patch.is_active = updates.is_active;
          await updateInvitationCode(id, patch);
          await fetchCodes();
          return { success: true };
        }
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
    [codes, fetchCodes]
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
        if (getInvitationAdminBackend() === 'worker') {
          await deleteInvitationCode(id);
          await fetchCodes();
          return { success: true };
        }
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
