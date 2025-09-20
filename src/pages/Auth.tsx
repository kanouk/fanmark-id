import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { User, Session } from '@supabase/supabase-js';

const Auth = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [activeTab, setActiveTab] = useState("signin");
  const [emailError, setEmailError] = useState("");
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        
        // Redirect authenticated and confirmed users to home page
        if (session?.user?.email_confirmed_at) {
          navigate("/");
        }
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      // Redirect if already authenticated and confirmed
      if (session?.user?.email_confirmed_at) {
        navigate("/");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const checkEmailExists = async (email: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase.functions.invoke('check-email-exists', {
        body: { email }
      });

      if (error) {
        console.error('Error checking email:', error);
        return false; // Fallback to allow signup if check fails
      }

      return data?.exists || false;
    } catch (error) {
      console.error('Error calling check-email-exists:', error);
      return false; // Fallback to allow signup if check fails
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError("");
    setIsLoading(true);

    try {
      // First check if email already exists
      const emailExists = await checkEmailExists(email);
      
      if (emailExists) {
        setEmailError("このメールアドレスは既に登録されています");
        toast({
          title: "アカウントが既に存在します",
          description: "このメールアドレスは既に登録されています。ログインしますか？",
          variant: "destructive",
        });
        // Switch to login tab
        setActiveTab("signin");
        setIsLoading(false);
        return;
      }

      // Proceed with signup if email doesn't exist
      const redirectUrl = `${window.location.origin}/`;
      
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl
        }
      });

      if (error) {
        toast({
          title: "登録エラー",
          description: error.message,
          variant: "destructive",
        });
      } else {
        setAwaitingConfirmation(true);
        toast({
          title: "確認メールを送信しました",
          description: "メールアドレスに送られた確認リンクをクリックしてください。",
        });
      }
    } catch (error) {
      console.error('Signup error:', error);
      toast({
        title: "エラーが発生しました",
        description: "もう一度お試しください。",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError("");
    setIsLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        if (error.message.includes("Invalid login credentials")) {
          toast({
            title: "ログインに失敗しました",
            description: "メールアドレスまたはパスワードが正しくありません。",
            variant: "destructive",
          });
        } else if (error.message.includes("Email not confirmed")) {
          toast({
            title: "メール認証が必要です",
            description: "アカウントを使用する前にメールアドレスの確認をしてください。",
            variant: "destructive",
          });
          setAwaitingConfirmation(true);
        } else {
          toast({
            title: "ログインエラー",
            description: error.message,
            variant: "destructive",
          });
        }
      } else {
        toast({
          title: "ログインしました",
          description: "ようこそ！",
        });
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

  const handleForgotPassword = async () => {
    if (!email) {
      toast({
        title: "メールアドレスを入力してください",
        description: "パスワードリセット用のメールアドレスを入力してください。",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth`
      });

      if (error) {
        toast({
          title: "エラーが発生しました",
          description: error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "パスワードリセットメールを送信しました",
          description: "メールに記載されたリンクからパスワードを再設定してください。",
        });
      }
    } catch (error) {
      toast({
        title: "エラーが発生しました",
        description: "もう一度お試しください。",
        variant: "destructive",
      });
    }
  };

  const handleResendConfirmation = async () => {
    if (!email) {
      toast({
        title: "メールアドレスを入力してください",
        description: "確認メールの再送信にはメールアドレスが必要です。",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email,
        options: {
          emailRedirectTo: `${window.location.origin}/`
        }
      });

      if (error) {
        toast({
          title: "エラーが発生しました",
          description: error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "確認メールを再送信しました",
          description: "メールアドレスに送られた確認リンクをクリックしてください。",
        });
      }
    } catch (error) {
      toast({
        title: "エラーが発生しました",
        description: "もう一度お試しください。",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-accent/10 to-primary/10 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            <span className="text-4xl">✨</span> fanmark.id
          </h1>
          <p className="text-muted-foreground">絵文字アドレスを作ろう</p>
        </div>

        <Card className="shadow-lg">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">認証</CardTitle>
            <CardDescription>
              アカウントにログインまたは新規登録
            </CardDescription>
          </CardHeader>
          <CardContent>
            {awaitingConfirmation ? (
              <div className="text-center space-y-4">
                <div className="text-6xl">📧</div>
                <h3 className="text-lg font-semibold">メール認証待ち</h3>
                <p className="text-sm text-muted-foreground">
                  {email} に確認メールを送信しました。<br />
                  メール内のリンクをクリックしてアカウントを有効化してください。
                </p>
                <div className="space-y-2">
                  <Button 
                    variant="outline" 
                    onClick={handleResendConfirmation}
                    className="w-full"
                  >
                    確認メールを再送信
                  </Button>
                  <Button 
                    variant="ghost" 
                    onClick={() => setAwaitingConfirmation(false)}
                    className="w-full text-sm"
                  >
                    ← 認証画面に戻る
                  </Button>
                </div>
              </div>
            ) : (
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="signin">ログイン</TabsTrigger>
                  <TabsTrigger value="signup">新規登録</TabsTrigger>
                </TabsList>
              
              <TabsContent value="signin">
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signin-email">メールアドレス</Label>
                    <Input
                      id="signin-email"
                      type="email"
                      placeholder="your@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signin-password">パスワード</Label>
                    <Input
                      id="signin-password"
                      type="password"
                      placeholder="パスワード"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                   <Button 
                    type="submit" 
                    className="w-full" 
                    disabled={isLoading}
                  >
                    {isLoading ? "ログイン中..." : "ログイン"}
                  </Button>
                  <Button 
                    type="button" 
                    variant="link" 
                    className="w-full text-sm"
                    onClick={handleForgotPassword}
                    disabled={isLoading}
                  >
                    パスワードをお忘れですか？
                  </Button>
                </form>
              </TabsContent>
              
              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">メールアドレス</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="your@email.com"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setEmailError("");
                      }}
                      required
                      className={emailError ? "border-destructive" : ""}
                    />
                    {emailError && (
                      <p className="text-sm text-destructive mt-1">{emailError}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">パスワード</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      placeholder="6文字以上のパスワード"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                    />
                  </div>
                  <Button 
                    type="submit" 
                    className="w-full" 
                    disabled={isLoading}
                  >
                    {isLoading ? "登録中..." : "新規登録"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
            )}
          </CardContent>
        </Card>

        <div className="text-center mt-6">
          <Button 
            variant="ghost" 
            onClick={() => navigate("/")}
            className="text-muted-foreground hover:text-foreground"
          >
            ← ホームに戻る
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Auth;