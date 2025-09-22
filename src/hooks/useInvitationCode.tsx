import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from './useTranslation';

export type InvitationPerks = Record<string, unknown> | string[] | null;

interface InvitationCodeResult {
  isValid: boolean;
  message: string;
  perks?: InvitationPerks;
}

export function useInvitationCode() {
  const { t } = useTranslation();
  const [validationLoading, setValidationLoading] = useState(false);

  const validateCode = async (code: string): Promise<InvitationCodeResult> => {
    if (!code.trim()) {
      return { isValid: false, message: t('invitation.codeRequired') };
    }

    setValidationLoading(true);
    try {
      const { data, error } = await supabase
        .from('invitation_codes')
        .select('id, special_perks, max_uses, used_count, expires_at')
        .eq('code', code.toUpperCase())
        .eq('is_active', true)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        return { isValid: false, message: t('invitation.invalidCode') };
      }

      // Check if code is expired
      if (data.expires_at && new Date(data.expires_at) < new Date()) {
        return { isValid: false, message: t('invitation.expiredCode') };
      }

      // Check if code has reached max uses
      if (data.used_count >= data.max_uses) {
        return { isValid: false, message: t('invitation.codeFullyUsed') };
      }

      return {
        isValid: true,
        message: t('invitation.validCode'),
        perks: data.special_perks as InvitationPerks,
      };
    } catch (error) {
      console.error('Error validating invitation code:', error);
      return { isValid: false, message: t('invitation.errorValidating') };
    } finally {
      setValidationLoading(false);
    }
  };

  const joinWaitlist = async (email: string, referralSource?: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('waitlist')
        .insert({
          email: email.toLowerCase(),
          referral_source: referralSource || 'landing_page',
        });

      if (error) {
        // Check if it's a duplicate email error
        if (error.code === '23505') {
          return true; // Consider duplicate as success (already in waitlist)
        }
        throw error;
      }

      return true;
    } catch (error) {
      console.error('Error joining waitlist:', error);
      return false;
    }
  };

  return {
    validateCode,
    validationLoading,
    joinWaitlist,
  };
}
