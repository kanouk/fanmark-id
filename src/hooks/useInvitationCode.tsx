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
      // Use the secure validation function
      const { data, error } = await supabase
        .rpc('validate_invitation_code', { code_to_check: code.toUpperCase() });

      if (error) throw error;

      if (!data || data.length === 0 || !data[0].is_valid) {
        return { isValid: false, message: t('invitation.invalidCode') };
      }

      const result = data[0];
      
      // Check if code has remaining uses
      if (result.remaining_uses <= 0) {
        return { isValid: false, message: t('invitation.codeFullyUsed') };
      }

      return {
        isValid: true,
        message: t('invitation.validCode'),
        perks: result.special_perks as InvitationPerks,
      };
    } catch (error) {
      console.error('Error validating invitation code:', error);
      return { isValid: false, message: t('invitation.errorValidating') };
    } finally {
      setValidationLoading(false);
    }
  };

  const useCode = async (code: string): Promise<{ success: boolean; perks?: InvitationPerks; errorMessage?: string }> => {
    try {
      const { data, error } = await supabase
        .rpc('use_invitation_code', { code_to_use: code.toUpperCase() });

      if (error) throw error;

      if (!data || data.length === 0) {
        return { success: false, errorMessage: t('invitation.invalidCode') };
      }

      const result = data[0];
      
      if (!result.success) {
        return { success: false, errorMessage: result.error_message || t('invitation.invalidCode') };
      }

      return {
        success: true,
        perks: result.special_perks as InvitationPerks,
      };
    } catch (error) {
      console.error('Error using invitation code:', error);
      return { success: false, errorMessage: t('invitation.errorValidating') };
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
    useCode,
    validationLoading,
    joinWaitlist,
  };
}
