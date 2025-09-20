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
    const saved = localStorage.getItem('fanmark-language');
    return (saved as Language) || 'ja';
  });

  useEffect(() => {
    localStorage.setItem('fanmark-language', language);
  }, [language]);

  const t = (key: string): string => {
    const keys = key.split('.');
    let value: any = translations[language];
    
    for (const k of keys) {
      value = value?.[k];
    }
    
    return value || key;
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
    throw new Error('useTranslation must be used within a TranslationProvider');
  }
  return context;
}