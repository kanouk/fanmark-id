import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`
      });

      if (error) {
        toast({
          title: "エラーが発生しました",
          description: error.message,
          variant: "destructive",
        });
      } else {
        setIsSubmitted(true);
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
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-accent/10 to-primary/10 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            <span className="text-4xl">✨</span> fanmark.id
          </h1>
          <p className="text-muted-foreground">パスワードリセット</p>
        </div>

        <Card className="shadow-lg">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">パスワードを忘れた場合</CardTitle>
            <CardDescription>
              {isSubmitted 
                ? "リセットメールを送信しました"
                : "メールアドレスを入力してください"
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isSubmitted ? (
              <div className="text-center space-y-4">
                <div className="text-6xl">📧</div>
                <h3 className="text-lg font-semibold">メール送信完了</h3>
                <p className="text-sm text-muted-foreground">
                  {email} にパスワードリセット用のメールを送信しました。<br />
                  メール内のリンクをクリックして新しいパスワードを設定してください。
                </p>
                <div className="space-y-2">
                  <Button 
                    variant="outline" 
                    onClick={() => setIsSubmitted(false)}
                    className="w-full"
                  >
                    別のメールアドレスを試す
                  </Button>
                  <Button 
                    variant="ghost" 
                    asChild
                    className="w-full text-sm"
                  >
                    <Link to="/auth">← ログイン画面に戻る</Link>
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">メールアドレス</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <Button 
                  type="submit" 
                  className="w-full" 
                  disabled={isLoading}
                >
                  {isLoading ? "送信中..." : "リセットメールを送信"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <div className="text-center mt-6">
          <Button 
            variant="ghost" 
            asChild
            className="text-muted-foreground hover:text-foreground"
          >
            <Link to="/auth">← ログイン画面に戻る</Link>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;