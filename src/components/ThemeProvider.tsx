import { ThemeContext, type Theme } from "@/hooks/useTheme";
import React, { useEffect, useState } from 'react';

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
}

export const ThemeProvider = ({ children, defaultTheme = 'pastel' }: ThemeProviderProps) => {
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = localStorage.getItem('fanmark-theme') as Theme;
    return savedTheme || defaultTheme;
  });

  useEffect(() => {
    // Apply theme to document element and save to localStorage
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('fanmark-theme', theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};