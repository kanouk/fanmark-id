import { useState } from 'react';

import { betterAuthClient } from '@/lib/auth-backend';
import { submitWaitlistSignup } from '@/lib/waitlist-signup-api';
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
      {
        const result = await betterAuthClient.validateInvitationCode(code.toUpperCase());
        if (!result.isValid) {
          return {
            isValid: false,
            message: result.remainingUses <= 0 ? t('invitation.codeFullyUsed') : t('invitation.invalidCode'),
          };
        }
        return {
          isValid: true,
          message: t('invitation.validCode'),
          perks: result.perks,
        };
      }

      // Use the secure validation function

      // Check if code has remaining uses

    } catch (error) {
      console.error('Error validating invitation code:', error);
      return { isValid: false, message: t('invitation.errorValidating') };
    } finally {
      setValidationLoading(false);
    }
  };

  const useCode = async (code: string): Promise<{ success: boolean; perks?: InvitationPerks; errorMessage?: string }> => {
    {
      return { success: false, errorMessage: t('invitation.errorValidating') };
    }

  };

  const joinWaitlist = async (email: string, referralSource?: string): Promise<boolean> => {
    try {
      await submitWaitlistSignup(email, referralSource);
      return true;
    } catch (error) {
      console.error('Error joining waitlist:', error);
      return false;
    }
  };

  return { validationLoading, validateCode, useCode, joinWaitlist };
};
