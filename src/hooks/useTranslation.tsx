import React, { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import jaTranslations from '@/translations/ja.json';
import enTranslations from '@/translations/en.json';

type Language = 'ja' | 'en';
type Translations = typeof jaTranslations;

interface TranslationContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  // Returns JSX with <br/> for \n in translations
  tWithBreaks: (key: string) => ReactNode;
}

const TranslationContext = createContext<TranslationContextType | null>(null);

const translations: Record<Language, Translations> = {
  ja: jaTranslations,
  en: enTranslations,
};

export function TranslationProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('fanmark-language');
      return (saved as Language) || 'ja';
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

  const t = (key: string): string => {
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

      return typeof value === 'string' ? value : key;
    } catch (error) {
      console.warn(`Translation error for key "${key}":`, error);
      return key;
    }
  };

  // Render newlines as <br/> elements so JSON "\n" breaks appear on screen
  const tWithBreaks = (key: string): ReactNode => {
    const text = t(key);
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
    return {
      language: 'ja' as Language,
      setLanguage: () => {},
      t: (key: string) => key, // Return the key as fallback
      tWithBreaks: (key: string) => key
    };
  }
  return context;
}
