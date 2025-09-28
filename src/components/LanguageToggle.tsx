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

const SUPPORTED_LANGUAGES = [
  { value: 'ja' as const, label: '日本語' },
  { value: 'en' as const, label: 'English' },
];

const UPCOMING_LANGUAGES = [
  { value: 'ko', label: '한국어' },
  { value: 'id', label: 'Bahasa Indonesia' },
];

type SupportedLanguageValue = typeof SUPPORTED_LANGUAGES[number]['value'];

const isSupportedLanguage = (value: string): value is SupportedLanguageValue =>
  SUPPORTED_LANGUAGES.some((option) => option.value === value);

export function LanguageToggle() {
  const { language, setLanguage } = useTranslation();

  const currentLanguage =
    SUPPORTED_LANGUAGES.find((option) => option.value === language) ||
    SUPPORTED_LANGUAGES[0];

  const handleLanguageChange = (nextValue: string) => {
    if (!isSupportedLanguage(nextValue) || nextValue === language) {
      return;
    }
    setLanguage(nextValue);
  };

  return (
    <DropdownMenu>
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
        {SUPPORTED_LANGUAGES.map((option) => (
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
        <DropdownMenuSeparator />
        {UPCOMING_LANGUAGES.map((option) => (
          <DropdownMenuItem key={option.value} disabled className="cursor-not-allowed rounded-lg px-3 py-2 text-sm font-medium opacity-60">
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
