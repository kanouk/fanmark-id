import React from 'react';
import { cn } from '@/lib/utils';

interface FanmarkEmojiBadgeProps {
  emoji: string;
  className?: string;
  style?: React.CSSProperties;
}

export const FanmarkEmojiBadge = ({ emoji, className, style }: FanmarkEmojiBadgeProps) => {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap tracking-[0.15em]',
        className
      )}
      style={style}
    >
      {emoji}
    </span>
  );
};
