// Re-export from the new hooks-based language system for backwards compatibility
// This file maintains the same API but now uses DB-driven languages via cache

import {
  getCachedActiveLanguages,
  isActiveLanguageSync,
  normalizeLanguageSync,
  FALLBACK_LANGUAGE,
} from '@/hooks/useLanguages';

// For backwards compatibility with existing code
// These are computed from the cached DB values
export const getActiveLanguages = () =>
  getCachedActiveLanguages().map((lang) => ({
    value: lang.code,
    label: lang.nativeLabel,
  }));

// Static fallback for initial render (before DB fetch)
export const ACTIVE_LANGUAGES = [
  { value: 'ja', label: '日本語' },
  { value: 'en', label: 'English' },
  { value: 'ko', label: '한국어' },
  { value: 'id', label: 'Bahasa Indonesia' },
] as const;

export const UPCOMING_LANGUAGES: ReadonlyArray<{ value: string; label: string }> = [];

export type ActiveLanguageCode = (typeof ACTIVE_LANGUAGES)[number]['value'];
export type AnyLanguageCode = ActiveLanguageCode | string;

export { FALLBACK_LANGUAGE };

export const isActiveLanguage = (value: string | null | undefined): value is ActiveLanguageCode =>
  isActiveLanguageSync(value) as boolean;

export const normalizeLanguage = (value: string | null | undefined): ActiveLanguageCode =>
  normalizeLanguageSync(value) as ActiveLanguageCode;
