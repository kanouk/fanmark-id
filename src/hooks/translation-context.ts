import { createContext, type ReactNode } from "react";

export type Language = 'ja' | 'en' | 'ko' | 'id';
export type TranslationVars = Record<string, string | number>;

export interface TranslationContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, vars?: TranslationVars) => string;
  // Returns JSX with <br/> for \n in translations
  tWithBreaks: (key: string, vars?: TranslationVars) => ReactNode;
}

export const TranslationContext = createContext<TranslationContextType | null>(null);

