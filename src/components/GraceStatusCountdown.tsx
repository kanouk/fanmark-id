import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { toZonedTime, formatInTimeZone } from 'date-fns-tz';
import { Clock } from 'lucide-react';

interface GraceStatusCountdownProps {
  licenseEnd: string;
  className?: string;
}

export const GraceStatusCountdown = ({ licenseEnd, className }: GraceStatusCountdownProps) => {
  const { t } = useTranslation();
  const [timeRemaining, setTimeRemaining] = useState<string>('');

  useEffect(() => {
    const updateCountdown = () => {
      // Parse license_end as UTC and add 24 hours for grace period
      const endTimeUTC = new Date(licenseEnd + 'Z'); // Ensure UTC parsing
      const graceEndTimeUTC = new Date(endTimeUTC.getTime() + 24 * 60 * 60 * 1000);
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
  }, [licenseEnd]);

  return (
    <div className={`flex flex-col items-start gap-2 ${className}`}>
      <Button
        size="sm"
        variant="outline"
        disabled={true}
        className="h-7 px-2 text-xs opacity-60 cursor-not-allowed w-fit"
      >
        {t('dashboard.extendButton')}
      </Button>
      <div className="text-xs text-destructive font-medium">
        <span>{t('dashboard.graceTimeRemaining', { time: timeRemaining })}</span>
      </div>
    </div>
  );
};