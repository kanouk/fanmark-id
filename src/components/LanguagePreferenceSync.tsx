import { useEffect, useRef } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useProfile } from '@/hooks/useProfile';
import { useAuth } from '@/hooks/useAuth';
import { normalizeLanguage, isActiveLanguage, UPCOMING_LANGUAGES } from '@/lib/language';

export const LanguagePreferenceSync = () => {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { setLanguage } = useTranslation();
  const lastAppliedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user) {
      lastAppliedRef.current = null;
      return;
    }

    const preferredRaw = profile?.preferred_language ?? null;
    const preferred = normalizeLanguage(preferredRaw);

    if (!isActiveLanguage(preferredRaw ?? undefined) && preferredRaw) {
      const upcoming = UPCOMING_LANGUAGES.some((lang) => lang.value === preferredRaw);
      if (upcoming) {
        console.info(`Language "${preferredRaw}" stored but not yet supported in UI. Falling back to Japanese.`);
      }
    }

    if (lastAppliedRef.current === preferred) {
      return;
    }

    lastAppliedRef.current = preferred;
    setLanguage(preferred);
    try {
      localStorage.setItem('fanmark-language', preferred);
    } catch (error) {
      console.warn('Failed to persist preferred language locally:', error);
    }
  }, [user?.id, profile?.preferred_language, setLanguage]);

  return null;
};
