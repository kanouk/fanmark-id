import { useCallback, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { ActiveLanguageCode, normalizeLanguage } from '@/lib/language';
import { useTranslation } from '@/hooks/useTranslation';

export const usePreferredLanguage = () => {
  const { user } = useAuth();
  const { setLanguage } = useTranslation();
  const [isSaving, setIsSaving] = useState(false);

  const persistPreferredLanguage = useCallback(
    async (language: ActiveLanguageCode) => {
      const normalized = normalizeLanguage(language);
      setLanguage(normalized);

      if (!user) {
        return normalized;
      }

      setIsSaving(true);
      try {
        const { error } = await supabase
          .from('user_settings')
          .update({
            preferred_language: normalized,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user.id);

        if (error) {
          throw error;
        }
        return normalized;
      } finally {
        setIsSaving(false);
      }
    },
    [user, setLanguage],
  );

  return {
    isSaving,
    persistPreferredLanguage,
  };
};
