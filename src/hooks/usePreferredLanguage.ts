import { useCallback, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';

import { ActiveLanguageCode, normalizeLanguage } from '@/lib/language';
import { useTranslation } from '@/hooks/useTranslation';
import { updateOwnProfile } from '@/lib/profile-api';

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
        {
          await updateOwnProfile({ preferred_language: normalized });
          return normalized;
        }

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
