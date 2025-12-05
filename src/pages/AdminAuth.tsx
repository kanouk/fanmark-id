import React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Home, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SimpleHeader } from '@/components/layout/SimpleHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';

const AdminAuth = () => {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <SimpleHeader className="border-border/40 bg-background/80 backdrop-blur-xl" />

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-xl">
          <Card className="border border-primary/15 bg-background/90 shadow-[0_28px_70px_rgba(101,195,200,0.18)] backdrop-blur-md rounded-3xl overflow-hidden">
            {/* Decorative gradient header */}
            <div className="relative bg-gradient-to-r from-primary/20 via-accent/20 to-primary/10 px-8 py-10">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.4),transparent_50%)]" />
              <div className="relative text-center">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-background/80 shadow-lg">
                  <AlertTriangle className="h-10 w-10 text-primary" />
                </div>
              </div>
            </div>

            <CardContent className="px-8 py-12 text-center">
              <h1 className="text-lg font-medium text-muted-foreground leading-relaxed">
                指定されたページは現在ご利用いただけません
              </h1>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-8">
                <Button
                  variant="outline"
                  className="gap-2 rounded-full px-6 border-primary/20 bg-primary/5 text-primary hover:bg-primary/10"
                  asChild
                >
                  <Link to="/">
                    <Home className="h-4 w-4" />
                    トップに戻る
                  </Link>
                </Button>
                <Button
                  className="gap-2 rounded-full px-6 shadow-lg transition-all duration-300 hover:shadow-xl hover:-translate-y-0.5"
                  asChild
                >
                  <Link to="/auth">
                    <LogIn className="h-4 w-4" />
                    ログイン画面へ
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      <SiteFooter className="border-primary/20 bg-background/80 backdrop-blur" />
    </div>
  );
};

export default AdminAuth;
