import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface InvitationCodeResult {
  isValid: boolean;
  message: string;
  perks?: any;
}

export function useInvitationCode() {
  const [validationLoading, setValidationLoading] = useState(false);

  const validateCode = async (code: string): Promise<InvitationCodeResult> => {
    if (!code.trim()) {
      return { isValid: false, message: 'Invitation code is required' };
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
        return { isValid: false, message: 'Invalid invitation code' };
      }

      // Check if code is expired
      if (data.expires_at && new Date(data.expires_at) < new Date()) {
        return { isValid: false, message: 'Code has expired' };
      }

      // Check if code has reached max uses
      if (data.used_count >= data.max_uses) {
        return { isValid: false, message: 'Code has been fully used' };
      }

      return {
        isValid: true,
        message: 'Valid invitation code',
        perks: data.special_perks,
      };
    } catch (error) {
      console.error('Error validating invitation code:', error);
      return { isValid: false, message: 'Error validating code' };
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