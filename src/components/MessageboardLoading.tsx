import { useEffect, useState } from 'react';
import { MessageSquare, ArrowRight } from 'lucide-react';
import { FiMessageSquare, FiArrowRight } from 'react-icons/fi';

interface MessageboardLoadingProps {
  fanmarkEmoji?: string;
}

export const MessageboardLoading = ({ fanmarkEmoji }: MessageboardLoadingProps) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);

  const steps = [
    'メッセージを準備中...',
    'ページを読み込み中...',
    '表示しています...',
  ];

  useEffect(() => {
    // Step progression
    const stepInterval = setInterval(() => {
      setCurrentStep((prev) => (prev + 1) % steps.length);
    }, 600);

    // Progress bar animation
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) return 100;
        return prev + 3;
      });
    }, 50);

    return () => {
      clearInterval(stepInterval);
      clearInterval(progressInterval);
    };
  }, [steps.length]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="mx-4 max-w-lg w-full">
        <div className="rounded-3xl border border-primary/20 bg-background/95 p-8 shadow-[0_25px_60px_rgba(101,195,200,0.2)] backdrop-blur">
          {/* アニメーション部分 */}
          <div className="relative mb-8 flex h-32 items-center justify-center">
            {/* 背景の光るリング */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-24 w-24 rounded-full border-2 border-primary/20 animate-pulse" />
              <div className="absolute h-20 w-20 rounded-full border border-primary/30 animate-spin"
                   style={{ animationDuration: '3s' }} />
              <div className="absolute h-16 w-16 rounded-full border border-accent/30 animate-spin"
                   style={{ animationDuration: '2s', animationDirection: 'reverse' }} />
            </div>

            {/* 中央のアイコンと絵文字 */}
            <div className="relative z-10 flex items-center gap-3">
              {fanmarkEmoji && (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-primary/10 to-accent/10 text-3xl animate-bounce"
                     style={{ animationDuration: '1.5s' }}>
                  {fanmarkEmoji}
                </div>
              )}

              <div className="flex items-center gap-2 text-primary animate-pulse">
                <FiArrowRight className="h-6 w-6" />
              </div>

              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-amber-100 to-orange-100 text-primary animate-bounce"
                   style={{ animationDuration: '1.5s', animationDelay: '0.3s' }}>
                <FiMessageSquare className="h-8 w-8" />
              </div>
            </div>

            {/* 飛び回るアイコン */}
            <div className="absolute inset-0">
              <MessageSquare className="absolute top-2 left-8 h-4 w-4 text-primary animate-pulse"
                            style={{ animationDelay: '0s' }} />
              <ArrowRight className="absolute top-6 right-6 h-3 w-3 text-accent animate-pulse"
                          style={{ animationDelay: '0.5s' }} />
              <MessageSquare className="absolute bottom-4 left-4 h-3 w-3 text-primary animate-pulse"
                            style={{ animationDelay: '1s' }} />
              <ArrowRight className="absolute bottom-8 right-8 h-4 w-4 text-accent animate-pulse"
                          style={{ animationDelay: '1.5s' }} />
            </div>
          </div>

          {/* メッセージ部分 */}
          <div className="text-center space-y-6">
            <h3 className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              伝言板を表示中
            </h3>

            {/* プログレスバー */}
            <div className="space-y-3">
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-primary to-accent h-2 rounded-full transition-all duration-100 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>

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
            </div>

            <p className="text-xs text-muted-foreground/70">
              まもなく表示されます
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};