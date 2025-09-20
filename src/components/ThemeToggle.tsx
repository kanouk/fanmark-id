import { Button } from '@/components/ui/button';
import { Palette } from 'lucide-react';
import { useTheme } from './ThemeProvider';

const themes = [
  { value: 'pastel', label: 'Pastel' },
  { value: 'cupcake', label: 'Cupcake' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

export const ThemeToggle = () => {
  const { theme, setTheme } = useTheme();

  const nextTheme = () => {
    const currentIndex = themes.findIndex(t => t.value === theme);
    const nextIndex = (currentIndex + 1) % themes.length;
    setTheme(themes[nextIndex].value);
  };

  const currentThemeLabel = themes.find(t => t.value === theme)?.label || 'Pastel';

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={nextTheme}
      className="gap-2"
    >
      <Palette className="h-4 w-4" />
      {currentThemeLabel}
    </Button>
  );
};