import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { parseDateString } from '@/lib/utils';

interface GraceStatusCountdownProps {
  graceExpiresAt: string;
  className?: string;
}

export const GraceStatusCountdown = ({ graceExpiresAt, className }: GraceStatusCountdownProps) => {
  const { t } = useTranslation();
  const [timeRemaining, setTimeRemaining] = useState<string>('');

  useEffect(() => {
    const graceEndTimeUTC = parseDateString(graceExpiresAt);
    if (!graceEndTimeUTC) {
      setTimeRemaining('--:--:--');
      return;
    }

    const updateCountdown = () => {
      const nowUTC = new Date(); // Current time in UTC
      const diff = graceEndTimeUTC.getTime() - nowUTC.getTime();

      if (diff <= 0) {
        setTimeRemaining('00:00:00');
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeRemaining(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [graceExpiresAt]);

  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      <Button
        size="sm"
        variant="outline"
        disabled={true}
        className="h-7 px-3 text-xs opacity-60 cursor-not-allowed"
      >
        {t('dashboard.extendButton')}
      </Button>
      <div className="pointer-events-none absolute left-1/2 bottom-[115%] -translate-x-1/2">
        <div className="relative rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold shadow-md shadow-primary/30">
          <span className="font-mono tabular-nums tracking-[0.015em] whitespace-nowrap">
            {t('dashboard.countdown', { time: timeRemaining })}
          </span>
          <div className="absolute left-1/2 -bottom-[4px] h-2.5 w-2.5 -translate-x-1/2 rotate-45 bg-primary" />
        </div>
      </div>
    </div>
  );
};
