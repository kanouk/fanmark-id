import { useContext } from "react";
import { TranslationContext, type TranslationContextType } from "./translation-context";

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
