import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { BrandWordmark } from '@/components/BrandWordmark';
import { BrandIcon } from '@/components/BrandIcon';
import { LanguageToggle } from '@/components/LanguageToggle';

type SimpleHeaderProps = {
  className?: string;
  containerClassName?: string;
  showLanguageToggle?: boolean;
  rightSlot?: ReactNode;
  leftSlot?: ReactNode;
};

export const SimpleHeader = ({
  className,
  containerClassName,
  showLanguageToggle = true,
  rightSlot,
  leftSlot,
}: SimpleHeaderProps) => {
  const navigate = useNavigate();

  return (
    <header className={cn('border-b border-border/40 bg-background/80 backdrop-blur', className)}>
      <div className={cn('container mx-auto flex items-center justify-between px-4 py-4 md:px-6', containerClassName)}>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="group flex items-center gap-2 text-lg font-semibold text-foreground transition-transform hover:translate-y-[-1px]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 transition-all group-hover:scale-105">
              <BrandIcon size="sm" />
            </span>
            <BrandWordmark className="text-2xl" />
          </button>
          {leftSlot}
        </div>

        <div className="flex items-center gap-2">
          {showLanguageToggle && <LanguageToggle />}
          {rightSlot}
        </div>
      </div>
    </header>
  );
};

