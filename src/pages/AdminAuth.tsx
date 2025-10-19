import React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthLayout } from "@/components/AuthLayout";
import { LanguageToggle } from "@/components/LanguageToggle";
import { useTranslation } from "@/hooks/useTranslation";
import { useAuth } from "@/hooks/useAuth";

const AdminAuth = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const loginTarget = user ? "/dashboard" : "/auth";
  const loginLabel = user ? t('navigation.dashboard') : t('auth.login');

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur">
        <div className="container mx-auto flex items-center justify-between px-4 py-4 md:px-6">
          <Link
            to="/"
            className="group flex items-center gap-2 text-lg font-semibold text-foreground transition-transform hover:translate-y-[-1px]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-2xl transition-all group-hover:scale-105">
              ✨
            </span>
            <span className="text-gradient text-2xl">fanmark.id</span>
          </Link>
          <div className="flex items-center gap-3">
            <LanguageToggle />
            <Button size="sm" className="rounded-full px-4" variant={user ? "outline" : "default"} asChild>
              <Link to={loginTarget}>{loginLabel}</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12 md:py-20">
        <div className="w-full max-w-xl">
          <AuthLayout title="" description="">
            <div className="space-y-6 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/12 text-primary shadow-[0_10px_25px_rgba(101,195,200,0.25)]">
                <AlertTriangle className="h-7 w-7" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                指定されたページは現在ご利用いただけません
              </h2>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                <Button variant="outline" className="rounded-full border-primary/20 px-6" asChild>
                  <Link to="/">トップに戻る</Link>
                </Button>
                <Button className="rounded-full px-6 shadow-lg" variant="default" asChild>
                  <Link to="/auth">ログイン画面へ</Link>
                </Button>
              </div>
            </div>
          </AuthLayout>
        </div>
      </main>

      <footer className="border-t border-border/40 bg-background/80 backdrop-blur">
        <div className="container mx-auto px-4 py-10 text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-2xl font-bold text-primary">
            <span className="text-3xl">✨</span> <span className="text-gradient">fanmark.id</span>
          </div>
          <p className="text-sm text-muted-foreground">{t('sections.footer')}</p>
        </div>
      </footer>
    </div>
  );
};

export default AdminAuth;
