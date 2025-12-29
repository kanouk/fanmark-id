import React, { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import jaTranslations from '@/translations/ja.json';
import enTranslations from '@/translations/en.json';
import koTranslations from '@/translations/ko.json';
import idTranslations from '@/translations/id.json';
import { normalizeLanguage } from '@/lib/language';

type Language = 'ja' | 'en' | 'ko' | 'id';
type Translations = typeof jaTranslations;
type TranslationVars = Record<string, string | number>;

interface TranslationContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, vars?: TranslationVars) => string;
  // Returns JSX with <br/> for \n in translations
  tWithBreaks: (key: string, vars?: TranslationVars) => ReactNode;
}

const TranslationContext = createContext<TranslationContextType | null>(null);

const translations: Record<Language, Translations> = {
  ja: jaTranslations,
  en: enTranslations,
  ko: koTranslations,
  id: idTranslations,
};

export function TranslationProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('fanmark-language');
      return normalizeLanguage(saved) as Language;
    } catch (error) {
      console.warn('Failed to load language from localStorage:', error);
      return 'ja';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('fanmark-language', language);
    } catch (error) {
      console.warn('Failed to save language to localStorage:', error);
    }
  }, [language]);

  const interpolate = (text: string, vars?: TranslationVars) => {
    if (!vars) return text;

    let interpolated = text;
    const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    for (const [varKey, varValue] of Object.entries(vars)) {
      const value = String(varValue);
      const doubleBracePattern = new RegExp(`{{\\s*${escapeRegExp(varKey)}\\s*}}`, 'g');
      const singleBracePattern = new RegExp(`{\\s*${escapeRegExp(varKey)}\\s*}`, 'g');
      interpolated = interpolated.replace(doubleBracePattern, value).replace(singleBracePattern, value);
    }

    return interpolated;
  };

  const t = (key: string, vars?: TranslationVars): string => {
    try {
      const keys = key.split('.');
      let value: unknown = translations[language];

      for (const k of keys) {
        if (typeof value === 'object' && value !== null && k in value) {
          value = (value as Record<string, unknown>)[k];
        } else {
          return key;
        }
      }

      if (typeof value !== 'string') {
        return key;
      }

      return interpolate(value, vars);
    } catch (error) {
      console.warn(`Translation error for key "${key}":`, error);
      return key;
    }
  };

  // Render newlines as <br/> elements so JSON "\n" breaks appear on screen
  const tWithBreaks = (key: string, vars?: TranslationVars): ReactNode => {
    const text = t(key, vars);
    // If no newline, return plain string to avoid extra nodes
    if (!text.includes('\n')) return text;
    const parts = text.split('\n');
    return parts.map((part, i) => (
      // wrap each segment to provide a stable key; insert <br/> before subsequent lines
      <span key={`tbr-${key}-${i}`}>
        {i > 0 && <br />}
        {part}
      </span>
    ));
  };

  return (
    <TranslationContext.Provider value={{ language, setLanguage, t, tWithBreaks }}>
      {children}
    </TranslationContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(TranslationContext);
  if (!context) {
    console.error('useTranslation hook called outside of TranslationProvider. Make sure component is wrapped with TranslationProvider.');
    // Provide a fallback instead of throwing to prevent app crash
    const fallbackT: TranslationContextType['t'] = (key) => key;
    const fallbackTWithBreaks: TranslationContextType['tWithBreaks'] = (key) => key;

    return {
      language: 'ja',
      setLanguage: () => {},
      t: fallbackT,
      tWithBreaks: fallbackTWithBreaks,
    };
  }
  return context;
}
