import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle } from 'lucide-react';

const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPasswordRequirements, setShowPasswordRequirements] = useState(false);
  const [isValidSession, setIsValidSession] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    // Check if we have a valid reset session
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session) {
        setIsValidSession(true);
      } else {
        // Check URL parameters for token
        const accessToken = searchParams.get('access_token');
        const refreshToken = searchParams.get('refresh_token');
        
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          });
          
          if (!error) {
            setIsValidSession(true);
          } else {
            toast({
              title: "無効なリセットリンク",
              description: "パスワードリセットリンクが無効か期限切れです。",
              variant: "destructive",
            });
            navigate('/forgot-password');
          }
        } else {
          toast({
            title: "無効なアクセス",
            description: "パスワードリセット用のリンクからアクセスしてください。",
            variant: "destructive",
          });
          navigate('/forgot-password');
        }
      }
    };

    checkSession();
  }, [searchParams, navigate, toast]);

  const checkPasswordRequirements = (password: string) => {
    return {
      length: password.length >= 8,
      lowercase: /[a-z]/.test(password),
      uppercase: /[A-Z]/.test(password),
      number: /[0-9]/.test(password),
      symbol: /[^A-Za-z0-9]/.test(password)
    };
  };

  const isPasswordValid = (password: string) => {
    const requirements = checkPasswordRequirements(password);
    return Object.values(requirements).every(Boolean);
  };

  const PasswordRequirement = ({ met, text }: { met: boolean; text: string }) => (
    <div className={`flex items-center gap-2 text-sm ${met ? 'text-green-600' : 'text-red-500'}`}>
      {met ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
      <span>{text}</span>
    </div>
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password !== confirmPassword) {
      toast({
        title: "パスワードが一致しません",
        description: "確認用パスワードが一致していません。",
        variant: "destructive",
      });
      return;
    }

    if (!isPasswordValid(password)) {
      toast({
        title: "パスワードの要件を満たしていません",
        description: "すべてのパスワード要件を満たしてください。",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: password
      });

      if (error) {
        toast({
          title: "パスワード更新エラー",
          description: error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "パスワードを更新しました",
          description: "新しいパスワードでログインできます。",
        });
        navigate('/');
      }
    } catch (error) {
      toast({
        title: "エラーが発生しました",
        description: "もう一度お試しください。",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!isValidSession) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-accent/10 to-primary/10 flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <div className="text-6xl">🔒</div>
          <h1 className="text-2xl font-bold">セッション確認中...</h1>
          <p className="text-muted-foreground">パスワードリセット権限を確認しています。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-accent/10 to-primary/10 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            <span className="text-4xl">✨</span> fanmark.id
          </h1>
          <p className="text-muted-foreground">新しいパスワードを設定</p>
        </div>

        <Card className="shadow-lg">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">パスワード再設定</CardTitle>
            <CardDescription>
              新しいパスワードを入力してください
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">新しいパスワード</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="8文字以上のパスワード"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setShowPasswordRequirements(e.target.value.length > 0);
                  }}
                  required
                  minLength={8}
                />
                {showPasswordRequirements && (
                  <div className="space-y-1 p-3 bg-muted/50 rounded-md">
                    <p className="text-sm font-medium text-muted-foreground mb-2">パスワード要件:</p>
                    <PasswordRequirement 
                      met={checkPasswordRequirements(password).length} 
                      text="8文字以上" 
                    />
                    <PasswordRequirement 
                      met={checkPasswordRequirements(password).lowercase} 
                      text="小文字を含む" 
                    />
                    <PasswordRequirement 
                      met={checkPasswordRequirements(password).uppercase} 
                      text="大文字を含む" 
                    />
                    <PasswordRequirement 
                      met={checkPasswordRequirements(password).number} 
                      text="数字を含む" 
                    />
                    <PasswordRequirement 
                      met={checkPasswordRequirements(password).symbol} 
                      text="記号を含む" 
                    />
                  </div>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">パスワード確認</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="パスワードを再入力"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
                {confirmPassword && password !== confirmPassword && (
                  <p className="text-sm text-destructive">パスワードが一致しません</p>
                )}
              </div>
              
              <Button 
                type="submit" 
                className="w-full" 
                disabled={isLoading || !isPasswordValid(password) || password !== confirmPassword}
              >
                {isLoading ? "更新中..." : "パスワードを更新"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="text-center mt-6">
          <Button 
            variant="ghost" 
            onClick={() => navigate("/auth")}
            className="text-muted-foreground hover:text-foreground"
          >
            ← ログイン画面に戻る
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;