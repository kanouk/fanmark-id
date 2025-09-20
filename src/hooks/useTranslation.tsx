import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import jaTranslations from '@/translations/ja.json';
import enTranslations from '@/translations/en.json';

type Language = 'ja' | 'en';
type Translations = typeof jaTranslations;

interface TranslationContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
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
      let value: any = translations[language];
      
      for (const k of keys) {
        value = value?.[k];
      }
      
      return value || key;
    } catch (error) {
      console.warn(`Translation error for key "${key}":`, error);
      return key;
    }
  };

  return (
    <TranslationContext.Provider value={{ language, setLanguage, t }}>
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
      t: (key: string) => key // Return the key as fallback
    };
  }
  return context;
}