import { useState, useCallback, useEffect } from 'react';

import type { InvitationAdminCode } from '@/lib/invitation-admin-api';
import { createInvitationCode, deleteInvitationCode, loadInvitationCodes, updateInvitationCode } from '@/lib/invitation-admin-api';

// Export the Row type for use in other components
export type InvitationCodeRow = InvitationAdminCode;
type InvitationCodeInsert = Pick<InvitationAdminCode, 'code' | 'max_uses' | 'expires_at' | 'special_perks' | 'is_active'>;
type InvitationCodeUpdate = Partial<Pick<InvitationAdminCode, 'max_uses' | 'expires_at' | 'special_perks' | 'is_active'>>;

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
      {
        setCodes(await loadInvitationCodes() as unknown as InvitationCodeRow[]);
        return;
      }

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
        special_perks: (values.specialPerks as InvitationAdminCode['special_perks']) ?? null,
        is_active: true,
      };

      try {
        {
          const created = await createInvitationCode({
            // Let the Worker generate codes with its cryptographic RNG when
            // the admin leaves the field blank.
            code: values.code?.trim() ? values.code.trim().toUpperCase() : null,
            max_uses: payload.max_uses,
            expires_at: payload.expires_at ?? null,
          special_perks: payload.special_perks ?? null,
          });
          await fetchCodes();
          return { success: true, code: created.code };
        }

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
        {
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
        {
          await deleteInvitationCode(id);
          await fetchCodes();
          return { success: true };
        }

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
