import { useState, useEffect } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { parseDateString } from '@/lib/utils';

interface LicenseCountdownProps {
  expirationDate: Date | string | null;
  className?: string;
}

export const LicenseCountdown = ({ expirationDate, className }: LicenseCountdownProps) => {
  const { t } = useTranslation();
  const [timeRemaining, setTimeRemaining] = useState<string>('');

  useEffect(() => {
    const targetDate = expirationDate instanceof Date ? expirationDate : parseDateString(expirationDate);
    if (!targetDate) {
      setTimeRemaining('00:00:00');
      return;
    }

    const updateCountdown = () => {
      const now = new Date();
      const diff = targetDate.getTime() - now.getTime();

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
  }, [expirationDate]);

  return (
    <span className={className}>
      {t('dashboard.countdown', { time: timeRemaining })}
    </span>
  );
};

