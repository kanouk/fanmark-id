import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
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
      const endTime = new Date(licenseEnd);
      // Grace period is 24 hours from license end
      const graceEndTime = new Date(endTime.getTime() + 24 * 60 * 60 * 1000);
      const now = new Date();
      const diff = graceEndTime.getTime() - now.getTime();

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
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        <span>{t('dashboard.timeRemaining')}: {timeRemaining}</span>
      </div>
      <Button 
        size="sm" 
        variant="outline"
        disabled={true}
        className="h-7 px-2 text-xs opacity-60 cursor-not-allowed"
      >
        {t('dashboard.extendDisabled')}
      </Button>
    </div>
  );
};