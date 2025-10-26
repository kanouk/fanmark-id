import { useEffect, useState } from 'react';
import { Undo2, RotateCcw, ShieldCheck } from 'lucide-react';
import { FiArrowLeftCircle } from 'react-icons/fi';
import { useTranslation } from '@/hooks/useTranslation';
import { FanmarkEmojiBadge } from '@/components/FanmarkEmojiBadge';

interface FanmarkReturnLoadingProps {
  fanmark?: string;
}

export const FanmarkReturnLoading = ({ fanmark }: FanmarkReturnLoadingProps) => {
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(0);

  const steps = [
    t('returnProcess.initiating'),
    t('returnProcess.releasing'),
    t('returnProcess.finalizing'),
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentStep((prev) => (prev + 1) % steps.length);
    }, 900);

    return () => clearInterval(interval);
  }, [steps.length]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm">
        <div className="rounded-3xl border border-primary/20 bg-background/95 p-8 shadow-[0_25px_60px_rgba(101,195,200,0.2)] backdrop-blur">
          {/* アニメーション部分 */}
          <div className="relative mb-6 flex h-32 items-center justify-center">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-24 w-24 rounded-full border-2 border-primary/20 animate-spin" style={{ animationDuration: '5s' }} />
              <div className="absolute h-20 w-20 rounded-full border border-primary/30 animate-spin" style={{ animationDuration: '3s' }} />
              <div
                className="absolute h-16 w-16 rounded-full border border-accent/30 animate-spin"
                style={{ animationDuration: '2s', animationDirection: 'reverse' }}
              />
            </div>

            <div className="relative z-10 flex flex-col items-center gap-3">
              <div
                className="flex h-20 min-w-[5rem] items-center justify-center rounded-full bg-gradient-to-br from-primary/10 to-accent/10 px-6 animate-bounce"
                style={{ animationDuration: '1.6s' }}
              >
                <FanmarkEmojiBadge emoji={fanmark || '🔁'} className="text-4xl leading-none" />
              </div>
              <div className="flex items-center gap-2 text-primary">
                <FiArrowLeftCircle className="h-5 w-5 animate-pulse" />
                <Undo2 className="h-5 w-5 animate-pulse" />
                <RotateCcw className="h-5 w-5 animate-pulse" />
              </div>
            </div>

            <div className="absolute inset-0">
              <ShieldCheck className="absolute top-3 left-10 h-4 w-4 text-primary animate-pulse" style={{ animationDelay: '0s' }} />
              <Undo2 className="absolute top-5 right-8 h-3.5 w-3.5 text-accent animate-pulse" style={{ animationDelay: '0.4s' }} />
              <RotateCcw className="absolute bottom-6 left-6 h-3 w-3 text-primary animate-pulse" style={{ animationDelay: '0.8s' }} />
              <ShieldCheck className="absolute bottom-8 right-10 h-4 w-4 text-accent animate-pulse" style={{ animationDelay: '1.2s' }} />
            </div>
          </div>

          <div className="space-y-4 text-center">
            <h3 className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              {t('returnProcess.title')}
            </h3>

            <div className="space-y-2">
              <p className="min-h-[1.25rem] text-sm text-muted-foreground transition-all duration-300">
                {steps[currentStep]}
              </p>

              <div className="flex justify-center gap-1.5">
                {steps.map((_, index) => (
                  <div
                    key={index}
                    className={`h-1.5 w-1.5 rounded-full transition-all duration-300 ${
                      index === currentStep ? 'scale-125 bg-primary' : index < currentStep ? 'bg-primary/50' : 'bg-muted'
                    }`}
                  />
                ))}
              </div>
            </div>

            <p className="text-xs text-muted-foreground/70">{t('returnProcess.pleaseWait')}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
