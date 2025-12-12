import { Sparkles, Star, Ticket } from 'lucide-react';
import { FanmarkEmojiBadge } from '@/components/FanmarkEmojiBadge';
import { useTranslation } from '@/hooks/useTranslation';

interface LotteryActionLoadingProps {
  action: 'applying' | 'cancelling';
  emoji?: string;
}

export default function LotteryActionLoading({ action, emoji }: LotteryActionLoadingProps) {
  const { t } = useTranslation();

  const titleKey = action === 'applying' ? 'lottery.applyingTitle' : 'lottery.cancellingTitle';
  const messageKey = action === 'applying' ? 'lottery.applyingMessage' : 'lottery.cancellingMessage';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm">
        <div className="rounded-3xl border border-primary/20 bg-background/95 p-8 shadow-[0_25px_60px_rgba(101,195,200,0.2)] backdrop-blur">
          <div className="relative mb-6 flex h-32 items-center justify-center">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-24 w-24 animate-pulse rounded-full border-2 border-primary/20" />
              <div
                className="absolute h-20 w-20 animate-spin rounded-full border border-primary/30"
                style={{ animationDuration: '3s' }}
              />
              <div
                className="absolute h-16 w-16 animate-spin rounded-full border border-accent/30"
                style={{ animationDuration: '2s', animationDirection: 'reverse' }}
              />
            </div>

            <div
              className="relative z-10 flex h-20 min-w-[5rem] items-center justify-center rounded-full bg-gradient-to-br from-primary/10 to-accent/10 px-6 animate-bounce"
              style={{ animationDuration: '1.5s' }}
            >
              <FanmarkEmojiBadge
                emoji={emoji || '🎟️'}
                className="text-4xl leading-none text-foreground"
              />
            </div>

            <div className="absolute inset-0">
              <Sparkles
                className="absolute left-8 top-2 h-4 w-4 animate-pulse text-primary"
                style={{ animationDelay: '0s' }}
              />
              <Star
                className="absolute right-6 top-6 h-3 w-3 animate-pulse text-accent"
                style={{ animationDelay: '0.5s' }}
              />
              <Sparkles
                className="absolute bottom-4 left-4 h-3 w-3 animate-pulse text-primary"
                style={{ animationDelay: '1s' }}
              />
              <Star
                className="absolute bottom-8 right-8 h-4 w-4 animate-pulse text-accent"
                style={{ animationDelay: '1.5s' }}
              />
            </div>
          </div>

          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Ticket className="h-5 w-5" />
            </div>
            <h3 className="text-xl font-bold text-foreground">
              {t(titleKey)}
            </h3>
            <p className="text-sm text-muted-foreground">{t(messageKey)}</p>
            <p className="text-xs text-muted-foreground/70">{t('lottery.pleaseWait')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
