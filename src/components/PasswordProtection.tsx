import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { useNavigate } from 'react-router-dom';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { Lock } from 'lucide-react';
import { LanguageToggle } from '@/components/LanguageToggle';
import { BrandWordmark } from '@/components/BrandWordmark';
import { supabase } from '@/integrations/supabase/client';

interface PasswordProtectionProps {
  fanmark: {
    id: string;
    user_input_fanmark: string;
  };
  onSuccess: () => void;
}

export const PasswordProtection = ({ fanmark, onSuccess }: PasswordProtectionProps) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [isShaking, setIsShaking] = useState(false);
  const otpRef = useRef<HTMLInputElement>(null);
  const slotClassName =
    "h-14 w-14 sm:h-20 sm:w-20 text-2xl sm:text-3xl font-bold border-2 border-border/40 focus:border-primary focus:ring-2 focus:ring-primary/20 hover:border-primary/40 bg-gradient-to-br from-background to-background/90 rounded-xl sm:rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 focus:scale-105 hover:scale-[1.02] first:rounded-l-xl sm:first:rounded-l-2xl last:rounded-r-xl sm:last:rounded-r-2xl first:border-l-2";

  useEffect(() => {
    if (password.length === 4) {
      // Use secure password verification function
      const verifyPassword = async () => {
        try {
          const { data: isValid, error } = await supabase.rpc('verify_fanmark_password', {
            fanmark_uuid: fanmark.id,
            provided_password: password
          });

          if (error) {
            console.error('Password verification error:', error);
            setIsShaking(true);
            setPassword('');
            setTimeout(() => setIsShaking(false), 500);
            return;
          }

          if (isValid) {
            onSuccess();
          } else {
            setIsShaking(true);
            setPassword('');
            setTimeout(() => setIsShaking(false), 500);
          }
        } catch (error) {
          console.error('Password verification failed:', error);
          setIsShaking(true);
          setPassword('');
          setTimeout(() => setIsShaking(false), 500);
        }
      };

      verifyPassword();
    }
  }, [password, fanmark.id, onSuccess]);

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
            <BrandWordmark className="text-2xl" />
          </button>

          <LanguageToggle />
        </div>
      </header>

      <div className="container mx-auto px-4 flex-1 flex items-center justify-center">
        <div className="max-w-4xl mx-auto w-full">
          {/* Password Protection Section */}
          <Card className="overflow-hidden bg-gradient-to-br from-background/90 to-background/70 border border-primary/20 shadow-xl backdrop-blur-sm mx-4 sm:mx-0">
            <CardContent className="p-0">
              {/* Password Input */}
              <div className="px-4 sm:px-8 py-8 sm:py-12">
                <div className="max-w-md mx-auto text-center space-y-6 sm:space-y-8">
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

                  <div className="flex justify-center px-4">
                    <div className={`${isShaking ? 'animate-shake' : ''} w-full max-w-xs`}>
                      <InputOTP
                        ref={otpRef}
                        value={password}
                        onChange={setPassword}
                        maxLength={4}
                        pattern="[0-9]*"
                        className="gap-3 sm:gap-6"
                      >
                        <InputOTPGroup className="gap-3 sm:gap-6 w-full justify-center">
                          <InputOTPSlot index={0} className={slotClassName} />
                          <InputOTPSlot index={1} className={slotClassName} />
                          <InputOTPSlot index={2} className={slotClassName} />
                          <InputOTPSlot index={3} className={slotClassName} />
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
            <span className="text-3xl">✨</span> <BrandWordmark />
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