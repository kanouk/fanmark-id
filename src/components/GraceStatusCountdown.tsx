import { useState, useEffect } from 'react';
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
    <div className={`inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary ${className ?? ''}`}>
      <span className="font-mono tabular-nums tracking-[0.015em] whitespace-nowrap">
        {t('dashboard.countdown', { time: timeRemaining })}
      </span>
    </div>
  );
};
