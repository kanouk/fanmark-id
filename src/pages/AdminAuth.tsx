import React, { useMemo, useState } from "react";
import { Home, Lock, Mail, ShieldAlert, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

// Get the main site URL (user-facing site, not admin subdomain)
const getMainSiteUrl = (): string => {
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  const port = window.location.port;

  // Development environment
  if (hostname === "localhost" || hostname.includes("127.0.0.1")) {
    // Remove ?admin=true param and return to main site
    return `${protocol}//${hostname}${port ? `:${port}` : ""}/`;
  }

  // Production environment - remove subdomain (e.g., admin.fanmark.id -> fanmark.id)
  const parts = hostname.split(".");
  if (parts.length > 2) {
    // Remove first part (subdomain)
    const mainDomain = parts.slice(1).join(".");
    return `${protocol}//${mainDomain}/`;
  }

  // Fallback
  return `${protocol}//${hostname}/`;
};

const AdminAuth = () => {
  const mainSiteUrl = useMemo(() => getMainSiteUrl(), []);
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setError(error.message);
        toast({
          title: "ログインに失敗しました",
          description: error.message,
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "ログインしました",
        description: "管理者権限を確認しています…",
      });
      // Auth state will update and AdminRoute will re-render automatically.
    } catch (err) {
      const message = err instanceof Error ? err.message : "ログインに失敗しました";
      setError(message);
      toast({
        title: "ログインに失敗しました",
        description: message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <SimpleHeader className="border-border/40 bg-background/80 backdrop-blur-xl" />

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-xl">
          <Card className="overflow-hidden rounded-3xl border border-primary/15 bg-background/90 shadow-[0_28px_70px_rgba(101,195,200,0.18)] backdrop-blur-md">
            <div className="relative bg-gradient-to-r from-primary/20 via-accent/20 to-primary/10 px-8 py-10">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.4),transparent_50%)]" />
              <div className="relative text-center">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-background/80 shadow-lg">
                  <ShieldAlert className="h-10 w-10 text-primary" />
                </div>
              </div>
            </div>

            <CardContent className="px-8 py-10">
              <h1 className="text-center text-2xl font-semibold tracking-tight text-foreground">管理者ログイン</h1>
              <p className="mt-2 text-center text-sm text-muted-foreground">
                admin サブドメインは通常サイトと別オリジンのため、管理画面側でもログインが必要です。
              </p>

              <form onSubmit={handleSignIn} className="mt-8 space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="admin-email" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                    <Mail className="h-4 w-4" /> メール
                  </Label>
                  <Input
                    id="admin-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                    className="h-11 rounded-2xl border border-primary/15 bg-background/80"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="admin-password" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                    <Lock className="h-4 w-4" /> パスワード
                  </Label>
                  <Input
                    id="admin-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    className="h-11 rounded-2xl border border-primary/15 bg-background/80"
                  />
                </div>

                {error && (
                  <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {error}
                  </div>
                )}

                <Button type="submit" disabled={loading} className="w-full gap-2 rounded-full">
                  <LogIn className="h-4 w-4" />
                  {loading ? "ログイン中…" : "ログイン"}
                </Button>

                <div className="flex justify-center pt-2">
                  <Button variant="outline" className="gap-2 rounded-full" asChild>
                    <a href={mainSiteUrl}>
                      <Home className="h-4 w-4" /> トップに戻る
                    </a>
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>

      <SiteFooter className="border-primary/20 bg-background/80 backdrop-blur" />
    </div>
  );
};

export default AdminAuth;

