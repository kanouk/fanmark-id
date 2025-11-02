import React from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

type BrandWordmarkProps = React.HTMLAttributes<HTMLSpanElement>;

export const BrandWordmark: React.FC<BrandWordmarkProps> = ({ className, ...props }) => {
  const { language } = useTranslation();
  const label = language === 'ja' ? 'ファンマID' : 'Fanmark';

  return (
    <span className={cn('text-gradient', className)} {...props}>
      {label}
    </span>
  );
};

