import { useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

interface LotteryActionLoadingProps {
  action: 'applying' | 'cancelling';
  emoji?: string;
}

export default function LotteryActionLoading({ action, emoji }: LotteryActionLoadingProps) {
  const { t } = useTranslation();
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setRotation((prev) => (prev + 1) % 360);
    }, 10);
    return () => clearInterval(interval);
  }, []);

  const titleKey = action === 'applying' ? 'lottery.applyingTitle' : 'lottery.cancellingTitle';
  const messageKey = action === 'applying' ? 'lottery.applyingMessage' : 'lottery.cancellingMessage';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-md">
      <div className="relative flex flex-col items-center gap-8 rounded-[2.75rem] border border-primary/20 bg-card/60 px-12 py-14 shadow-[0_28px_70px_rgba(101,195,200,0.25)] backdrop-blur-sm">
        {/* Animated rings */}
        <div className="relative flex h-36 w-36 items-center justify-center">
          {/* Outer rotating ring */}
          <div
            className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-primary/40 border-r-primary/20"
            style={{ animationDuration: '3s' }}
          />
          
          {/* Middle rotating ring */}
          <div
            className="absolute inset-4 animate-spin rounded-full border-4 border-transparent border-t-primary/60 border-l-primary/30"
            style={{ animationDuration: '2s', animationDirection: 'reverse' }}
          />
          
          {/* Inner pulsing circle */}
          <div className="absolute inset-8 animate-pulse rounded-full bg-primary/10" />
          
          {/* Emoji or icon in center */}
          {emoji ? (
            <div className="relative z-10 animate-bounce text-5xl">
              {emoji}
            </div>
          ) : (
            <div
              className="relative z-10 h-12 w-12 rounded-full bg-gradient-to-br from-primary to-primary/60"
              style={{ transform: `rotate(${rotation}deg)` }}
            />
          )}
        </div>

        {/* Text content */}
        <div className="flex flex-col items-center gap-3 text-center">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            {t(titleKey)}
          </h2>
          <p className="text-base text-muted-foreground">
            {t(messageKey)}
          </p>
          <p className="mt-2 text-sm text-muted-foreground/70">
            {t('lottery.pleaseWait')}
          </p>
        </div>

        {/* Animated sparkles */}
        <div className="absolute -right-2 -top-2 animate-pulse text-2xl opacity-70">✨</div>
        <div className="absolute -bottom-2 -left-2 animate-pulse text-2xl opacity-70" style={{ animationDelay: '0.5s' }}>✨</div>
        <div className="absolute -left-2 top-1/3 animate-pulse text-xl opacity-60" style={{ animationDelay: '1s' }}>💫</div>
        <div className="absolute -right-2 bottom-1/3 animate-pulse text-xl opacity-60" style={{ animationDelay: '1.5s' }}>💫</div>
      </div>
    </div>
  );
}
