import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { useNavigate } from 'react-router-dom';
import { toast } from '@/hooks/use-toast';

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
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <div className="container mx-auto px-4 py-8 max-w-md">
        {/* Title */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-foreground">ミニ伝言板</h1>
        </div>

        {/* Fanmark */}
        <div className="text-center mb-8">
          <div className="text-8xl mb-4">{fanmark.emoji_combination}</div>
        </div>

        {/* Password Input */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-center">🔒 パスワードを入力してください</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex justify-center">
              <InputOTP
                value={password}
                onChange={setPassword}
                maxLength={4}
                pattern="[0-9]*"
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                </InputOTPGroup>
              </InputOTP>
            </div>
            
            <div className="flex justify-center">
              <Button 
                onClick={handlePasswordSubmit}
                disabled={isVerifying || password.length !== 4}
                className="w-full max-w-xs"
              >
                {isVerifying ? '認証中...' : '確認'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* fanmark.id Logo with Tagline */}
        <div className="flex flex-col items-center justify-center">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="group flex items-center gap-2 text-lg font-semibold text-foreground transition-transform hover:translate-y-[-1px] mb-2"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-2xl transition-all group-hover:scale-105">
              ✨
            </span>
            <span className="text-gradient text-2xl">fanmark.id</span>
          </button>
          <p className="text-sm text-muted-foreground">あなたもファンマを手に入れよう</p>
        </div>
      </div>
    </div>
  );
};