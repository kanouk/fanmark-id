import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';

export function LanguageToggle() {
  const { language, setLanguage } = useTranslation();

  const toggleLanguage = () => {
    setLanguage(language === 'ja' ? 'en' : 'ja');
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggleLanguage}
      className="text-lg hover:scale-110 transition-transform"
    >
      {language === 'ja' ? '🇺🇸' : '🇯🇵'}
    </Button>
  );
}