import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { useNavigate } from 'react-router-dom';
import { toast } from '@/hooks/use-toast';
import { Lock, Unlock } from 'lucide-react';

interface PasswordProtectionProps {
  fanmark: {
    emoji_combination: string;
    access_password?: string;
  };
  onSuccess: () => void;
}

export const PasswordProtection = ({ fanmark, onSuccess }: PasswordProtectionProps) => {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  const handlePasswordSubmit = async () => {
    if (password.length !== 4) {
      toast({
        title: 'エラー',
        description: '4桁の数字を入力してください。',
        variant: 'destructive',
      });
      return;
    }

    setIsVerifying(true);
    
    // Verify password
    if (password === fanmark.access_password) {
      toast({
        title: '認証成功',
        description: 'パスワードが正しく入力されました。',
      });
      onSuccess();
    } else {
      toast({
        title: '認証失敗',
        description: 'パスワードが間違っています。',
        variant: 'destructive',
      });
      setPassword('');
    }
    
    setIsVerifying(false);
  };

  return (
    <div className="min-h-screen bg-gradient-hero">
      <div className="container mx-auto px-4 py-8 max-w-md">
        {/* Animated title with icon */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4 animate-float">
            <div className="p-3 rounded-full bg-primary/20 backdrop-blur-sm">
              <Lock className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-3xl font-bold text-gradient">ミニ伝言板</h1>
          </div>
          <p className="text-muted-foreground">この伝言板はパスワードで保護されています</p>
        </div>

        {/* Fanmark Display */}
        <div className="text-center mb-10">
          <div className="relative inline-block">
            <div className="absolute inset-0 bg-gradient-pop rounded-full blur-xl opacity-30 animate-pulse-slow"></div>
            <div className="relative text-8xl mb-4 p-4 rounded-full bg-card/50 backdrop-blur-sm border border-border/50 shadow-lg animate-bounce-soft">
              {fanmark.emoji_combination}
            </div>
          </div>
        </div>

        {/* Password Input Card */}
        <Card className="mb-10 card-pop border-0 bg-card/80 backdrop-blur-sm shadow-xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-center flex items-center justify-center gap-2 text-xl">
              <Lock className="h-5 w-5 text-primary" />
              パスワードを入力してください
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-8">
            <div className="flex justify-center">
              <div className="relative">
                <InputOTP
                  value={password}
                  onChange={setPassword}
                  maxLength={4}
                  pattern="[0-9]*"
                  className="gap-3"
                >
                  <InputOTPGroup className="gap-3">
                    <InputOTPSlot 
                      index={0} 
                      className="h-14 w-14 text-xl font-bold border-2 border-primary/20 focus:border-primary bg-background/50 backdrop-blur-sm rounded-xl transition-all duration-200 hover:scale-105 focus:scale-105"
                    />
                    <InputOTPSlot 
                      index={1}
                      className="h-14 w-14 text-xl font-bold border-2 border-primary/20 focus:border-primary bg-background/50 backdrop-blur-sm rounded-xl transition-all duration-200 hover:scale-105 focus:scale-105"
                    />
                    <InputOTPSlot 
                      index={2}
                      className="h-14 w-14 text-xl font-bold border-2 border-primary/20 focus:border-primary bg-background/50 backdrop-blur-sm rounded-xl transition-all duration-200 hover:scale-105 focus:scale-105"
                    />
                    <InputOTPSlot 
                      index={3}
                      className="h-14 w-14 text-xl font-bold border-2 border-primary/20 focus:border-primary bg-background/50 backdrop-blur-sm rounded-xl transition-all duration-200 hover:scale-105 focus:scale-105"
                    />
                  </InputOTPGroup>
                </InputOTP>
                {password.length === 4 && (
                  <div className="absolute -top-2 -right-2">
                    <div className="h-6 w-6 bg-primary rounded-full flex items-center justify-center animate-bounce">
                      <Unlock className="h-3 w-3 text-primary-foreground" />
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex justify-center">
              <Button 
                onClick={handlePasswordSubmit}
                disabled={isVerifying || password.length !== 4}
                className="w-full max-w-xs h-12 text-lg font-semibold btn-pop bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:transform-none disabled:shadow-none"
              >
                {isVerifying ? (
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin"></div>
                    認証中...
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Unlock className="h-4 w-4" />
                    確認する
                  </div>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* fanmark.id Logo with Enhanced Styling */}
        <div className="flex flex-col items-center justify-center space-y-3">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="group flex items-center gap-3 text-lg font-semibold text-foreground transition-all duration-300 hover:translate-y-[-2px] p-3 rounded-2xl hover:bg-card/50 backdrop-blur-sm"
          >
            <div className="relative">
              <div className="absolute inset-0 bg-primary/20 rounded-full blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-2xl transition-all duration-300 group-hover:scale-110 group-hover:bg-primary/25">
                ✨
              </span>
            </div>
            <span className="text-gradient text-2xl font-bold">fanmark.id</span>
          </button>
          <p className="text-sm text-muted-foreground font-medium px-4 py-2 rounded-full bg-muted/50 backdrop-blur-sm">
            あなたもファンマを手に入れよう
          </p>
        </div>
      </div>
    </div>
  );
};