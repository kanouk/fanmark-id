import React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthLayout } from "@/components/AuthLayout";
import { LanguageToggle } from "@/components/LanguageToggle";
import { SimpleHeader } from '@/components/layout/SimpleHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { useTranslation } from "@/hooks/useTranslation";
import { useAuth } from "@/hooks/useAuth";

const AdminAuth = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const loginTarget = user ? "/dashboard" : "/auth";
  const loginLabel = user ? t('navigation.dashboard') : t('auth.login');

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <SimpleHeader
        showLanguageToggle={false}
        rightSlot={
          <div className="flex items-center gap-3">
            <LanguageToggle />
            <Button size="sm" className="rounded-full px-4" variant={user ? "outline" : "default"} asChild>
              <Link to={loginTarget}>{loginLabel}</Link>
            </Button>
          </div>
        }
      />

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

      <SiteFooter />
    </div>
  );
};

export default AdminAuth;
