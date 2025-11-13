export const ACTIVE_LANGUAGES = [
  { value: 'ja', label: '日本語' },
  { value: 'en', label: 'English' },
  { value: 'ko', label: '한국어' },
  { value: 'id', label: 'Bahasa Indonesia' },
] as const;

export const UPCOMING_LANGUAGES = [] as const;

export type ActiveLanguageCode = typeof ACTIVE_LANGUAGES[number]['value'];
export type AnyLanguageCode = ActiveLanguageCode | typeof UPCOMING_LANGUAGES[number]['value'];

export const FALLBACK_LANGUAGE: ActiveLanguageCode = 'ja';

export const isActiveLanguage = (value: string | null | undefined): value is ActiveLanguageCode =>
  Boolean(value && ACTIVE_LANGUAGES.some((option) => option.value === value));

export const normalizeLanguage = (value: string | null | undefined): ActiveLanguageCode =>
  isActiveLanguage(value) ? value : FALLBACK_LANGUAGE;
