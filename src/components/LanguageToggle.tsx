import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Globe, ChevronDown, Check } from 'lucide-react';
import { ACTIVE_LANGUAGES, UPCOMING_LANGUAGES, isActiveLanguage } from '@/lib/language';

export function LanguageToggle() {
  const { language, setLanguage, t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  const currentLanguage =
    ACTIVE_LANGUAGES.find((option) => option.value === language) ||
    ACTIVE_LANGUAGES[0];

  const handleLanguageChange = (nextValue: string) => {
    if (!isActiveLanguage(nextValue) || nextValue === language) {
      return;
    }
    setLanguage(nextValue);
    setIsOpen(false);
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="flex items-center gap-2 rounded-full border-border/60 bg-background/80 px-3 py-2 text-sm font-medium shadow-sm transition-transform hover:-translate-y-px hover:border-primary/40 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Globe className="h-4 w-4" />
          <span>{currentLanguage.label}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        {ACTIVE_LANGUAGES.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={(event) => {
              event.preventDefault();
              handleLanguageChange(option.value);
            }}
            className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium focus:bg-primary/10 focus:text-primary"
          >
            <span>{option.label}</span>
            {language === option.value && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
        {UPCOMING_LANGUAGES.length > 0 && <DropdownMenuSeparator />}
        {UPCOMING_LANGUAGES.map((option) => (
          <DropdownMenuItem key={option.value} disabled className="flex flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-sm font-medium opacity-60">
            <span>{option.label}</span>
            <span className="text-xs text-muted-foreground">{t('languageToggle.comingSoon')}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
