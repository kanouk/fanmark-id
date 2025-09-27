import { useEffect, useState } from 'react';
import { Sparkles, Star } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

interface FanmarkAcquisitionLoadingProps {
  emoji?: string;
}

export const FanmarkAcquisitionLoading = ({ emoji }: FanmarkAcquisitionLoadingProps) => {
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(0);

  const steps = [
    t('acquisition.processing'),
    t('acquisition.validating'),
    t('acquisition.registering'),
    t('acquisition.finalizing'),
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentStep((prev) => (prev + 1) % steps.length);
    }, 800);

    return () => clearInterval(interval);
  }, [steps.length]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="mx-4 max-w-sm w-full">
        <div className="rounded-3xl border border-primary/20 bg-background/95 p-8 shadow-[0_25px_60px_rgba(101,195,200,0.2)] backdrop-blur">
          {/* アニメーション部分 */}
          <div className="relative mb-6 flex h-32 items-center justify-center">
            {/* 背景の光るリング */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-24 w-24 rounded-full border-2 border-primary/20 animate-pulse" />
              <div className="absolute h-20 w-20 rounded-full border border-primary/30 animate-spin"
                   style={{ animationDuration: '3s' }} />
              <div className="absolute h-16 w-16 rounded-full border border-accent/30 animate-spin"
                   style={{ animationDuration: '2s', animationDirection: 'reverse' }} />
            </div>

            {/* 中央の絵文字 */}
            <div className="relative z-10 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-primary/10 to-accent/10 text-4xl animate-bounce"
                 style={{ animationDuration: '1.5s' }}>
              {emoji || '✨'}
            </div>

            {/* 飛び回るスパークル */}
            <div className="absolute inset-0">
              <Sparkles className="absolute top-2 left-8 h-4 w-4 text-primary animate-pulse"
                        style={{ animationDelay: '0s' }} />
              <Star className="absolute top-6 right-6 h-3 w-3 text-accent animate-pulse"
                    style={{ animationDelay: '0.5s' }} />
              <Sparkles className="absolute bottom-4 left-4 h-3 w-3 text-primary animate-pulse"
                        style={{ animationDelay: '1s' }} />
              <Star className="absolute bottom-8 right-8 h-4 w-4 text-accent animate-pulse"
                    style={{ animationDelay: '1.5s' }} />
            </div>
          </div>

          {/* メッセージ部分 */}
          <div className="text-center space-y-4">
            <h3 className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              {t('acquisition.title')}
            </h3>

            <div className="space-y-2">
              <p className="text-sm text-muted-foreground min-h-[1.25rem] transition-all duration-300">
                {steps[currentStep]}
              </p>

              {/* プログレスドット */}
              <div className="flex justify-center gap-1.5">
                {steps.map((_, index) => (
                  <div
                    key={index}
                    className={`h-1.5 w-1.5 rounded-full transition-all duration-300 ${
                      index === currentStep
                        ? 'bg-primary scale-125'
                        : index < currentStep
                          ? 'bg-primary/50'
                          : 'bg-muted'
                    }`}
                  />
                ))}
              </div>
            </div>

            <p className="text-xs text-muted-foreground/70">
              {t('acquisition.pleaseWait')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};