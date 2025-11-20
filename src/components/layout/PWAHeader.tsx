import { LanguageToggle } from "@/components/LanguageToggle";

export function PWAHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border/20 bg-background/60 backdrop-blur-2xl shadow-sm">
      <div className="w-full px-4 py-3 relative flex items-center justify-between">
        {/* Left: Empty space for balance */}
        <div className="w-24" />
        
        {/* Center: Logo icon */}
        <div className="absolute left-1/2 -translate-x-1/2">
          <button
            type="button"
            onClick={() => window.location.href = '/'}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-2xl transition-all hover:scale-105"
          >
            ✨
          </button>
        </div>
        
        {/* Right: Language toggle */}
        <div className="flex items-center ml-auto">
          <LanguageToggle />
        </div>
      </div>
    </header>
  );
}

