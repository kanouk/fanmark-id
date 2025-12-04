import { useEffect } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * Syncs the document title with the current language selection.
 * Uses translation keys for service name and tagline.
 */
export const DocumentTitleSync = () => {
  const { t, language } = useTranslation();

  useEffect(() => {
    const serviceName = t('common.serviceName');
    const tagline = t('common.serviceTagline');
    document.title = `${serviceName} | ${tagline}`;
  }, [t, language]);

  return null;
};
