import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface Language {
  code: string;
  label: string;
  nativeLabel: string;
  isActive: boolean;
  sortOrder: number;
}

interface UseLanguagesResult {
  languages: Language[];
  activeLanguages: Language[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  isActiveLanguage: (code: string | null | undefined) => boolean;
  normalizeLanguage: (code: string | null | undefined) => string;
}

const FALLBACK_LANGUAGE = 'ja';

// Default languages for SSR/initial render before DB fetch
const DEFAULT_LANGUAGES: Language[] = [
  { code: 'ja', label: 'Japanese', nativeLabel: '日本語', isActive: true, sortOrder: 1 },
  { code: 'en', label: 'English', nativeLabel: 'English', isActive: true, sortOrder: 2 },
  { code: 'ko', label: 'Korean', nativeLabel: '한국어', isActive: true, sortOrder: 3 },
  { code: 'id', label: 'Indonesian', nativeLabel: 'Bahasa Indonesia', isActive: true, sortOrder: 4 },
];

export function useLanguages(): UseLanguagesResult {
  const [languages, setLanguages] = useState<Language[]>(DEFAULT_LANGUAGES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchLanguages = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('languages')
        .select('code, label, native_label, is_active, sort_order')
        .order('sort_order', { ascending: true });

      if (fetchError) throw fetchError;

      if (data) {
        setLanguages(
          data.map((lang) => ({
            code: lang.code,
            label: lang.label,
            nativeLabel: lang.native_label,
            isActive: lang.is_active,
            sortOrder: lang.sort_order,
          }))
        );
      }
    } catch (err) {
      console.error('Failed to fetch languages:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch languages'));
      // Keep default languages on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLanguages();
  }, [fetchLanguages]);

  const activeLanguages = languages.filter((lang) => lang.isActive);

  const isActiveLanguage = useCallback(
    (code: string | null | undefined): boolean => {
      if (!code) return false;
      return activeLanguages.some((lang) => lang.code === code);
    },
    [activeLanguages]
  );

  const normalizeLanguage = useCallback(
    (code: string | null | undefined): string => {
      if (isActiveLanguage(code)) return code!;
      return FALLBACK_LANGUAGE;
    },
    [isActiveLanguage]
  );

  return {
    languages,
    activeLanguages,
    loading,
    error,
    refetch: fetchLanguages,
    isActiveLanguage,
    normalizeLanguage,
  };
}

// Singleton for non-hook contexts (sync access with cached data)
let cachedLanguages: Language[] = DEFAULT_LANGUAGES;

export function getCachedLanguages(): Language[] {
  return cachedLanguages;
}

export function getCachedActiveLanguages(): Language[] {
  return cachedLanguages.filter((lang) => lang.isActive);
}

export function updateCachedLanguages(languages: Language[]): void {
  cachedLanguages = languages;
}

// Sync utility functions for use outside React components
export function isActiveLanguageSync(code: string | null | undefined): boolean {
  if (!code) return false;
  return getCachedActiveLanguages().some((lang) => lang.code === code);
}

export function normalizeLanguageSync(code: string | null | undefined): string {
  if (isActiveLanguageSync(code)) return code!;
  return FALLBACK_LANGUAGE;
}

export { FALLBACK_LANGUAGE };
