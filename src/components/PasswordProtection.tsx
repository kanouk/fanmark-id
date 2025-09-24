import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { useNavigate } from 'react-router-dom';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { Lock } from 'lucide-react';
import { LanguageToggle } from '@/components/LanguageToggle';

interface PasswordProtectionProps {
  fanmark: {
    emoji_combination: string;
    access_password?: string;
  };
  onSuccess: () => void;
}

export const PasswordProtection = ({ fanmark, onSuccess }: PasswordProtectionProps) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [isShaking, setIsShaking] = useState(false);
  const otpRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (password.length === 4) {
      if (password === fanmark.access_password) {
        onSuccess();
      } else {
        setIsShaking(true);
        setPassword('');
        setTimeout(() => setIsShaking(false), 500);
      }
    }
  }, [password, fanmark.access_password, onSuccess]);

  useEffect(() => {
    // コンポーネントがマウントされた時にOTP入力にフォーカスを当てる
    const timer = setTimeout(() => {
      if (otpRef.current) {
        otpRef.current.focus();
      }
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 flex flex-col">
      {/* Header Navigation */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto flex items-center justify-between px-4 py-4 md:px-6">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="group flex items-center gap-2 text-lg font-semibold text-foreground transition-transform hover:translate-y-[-1px]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-2xl transition-all group-hover:scale-105">
              ✨
            </span>
            <span className="text-gradient text-2xl">fanmark.id</span>
          </button>

          <LanguageToggle />
        </div>
      </header>

      <div className="container mx-auto px-4 flex-1 flex items-center justify-center">
        <div className="max-w-4xl mx-auto">
          {/* Password Protection Section */}
          <Card className="overflow-hidden bg-gradient-to-br from-background/90 to-background/70 border border-primary/20 shadow-xl backdrop-blur-sm">
            <CardContent className="p-0">
              {/* Password Input */}
              <div className="px-8 py-12">
                <div className="max-w-md mx-auto text-center space-y-8">
                  <div className="space-y-4">
                    <div className="inline-flex items-center gap-3 mb-4">
                      <div className="p-3 rounded-full bg-primary/20 backdrop-blur-sm">
                        <Lock className="h-6 w-6 text-primary" />
                      </div>
                       <h2 className="text-xl font-semibold text-foreground">{t('passwordProtection.title')}</h2>
                     </div>
                     <p className="text-muted-foreground">{t('passwordProtection.description')}</p>
                     <p className="text-muted-foreground text-sm">{t('passwordProtection.enterPassword')}</p>
                  </div>

                  <div className="flex justify-center">
                    <div className={`${isShaking ? 'animate-shake' : ''}`}>
                      <InputOTP
                        ref={otpRef}
                        value={password}
                        onChange={setPassword}
                        maxLength={4}
                        pattern="[0-9]*"
                        className="gap-6"
                      >
                        <InputOTPGroup className="gap-6">
                          <InputOTPSlot
                            index={0}
                            className="h-20 w-20 text-3xl font-bold border-2 border-border/40 focus:border-primary/60 hover:border-primary/40 bg-gradient-to-br from-background to-background/90 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 focus:scale-105 hover:scale-102 !rounded-2xl"
                          />
                          <InputOTPSlot
                            index={1}
                            className="h-20 w-20 text-3xl font-bold border-2 border-border/40 focus:border-primary/60 hover:border-primary/40 bg-gradient-to-br from-background to-background/90 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 focus:scale-105 hover:scale-102"
                          />
                          <InputOTPSlot
                            index={2}
                            className="h-20 w-20 text-3xl font-bold border-2 border-border/40 focus:border-primary/60 hover:border-primary/40 bg-gradient-to-br from-background to-background/90 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 focus:scale-105 hover:scale-102"
                          />
                          <InputOTPSlot
                            index={3}
                            className="h-20 w-20 text-3xl font-bold border-2 border-border/40 focus:border-primary/60 hover:border-primary/40 bg-gradient-to-br from-background to-background/90 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 focus:scale-105 hover:scale-102 !rounded-2xl"
                          />
                        </InputOTPGroup>
                      </InputOTP>
                    </div>
                  </div>

                </div>
              </div>
            </CardContent>
          </Card>

        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border/40 bg-background/80 backdrop-blur">
        <div className="container mx-auto px-4 py-10 text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-2xl font-bold text-primary">
            <span className="text-3xl">✨</span> <span className="text-gradient">fanmark.id</span>
          </div>
          <p className="text-sm text-muted-foreground">{t('sections.footer')}</p>
        </div>
      </footer>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
          20%, 40%, 60%, 80% { transform: translateX(4px); }
        }

        .animate-shake {
          animation: shake 0.5s ease-in-out;
        }
      `}</style>
    </div>
  );
};