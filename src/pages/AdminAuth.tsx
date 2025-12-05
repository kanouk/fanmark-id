import React from "react";
import { AlertTriangle, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SimpleHeader } from '@/components/layout/SimpleHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';

// Get the main site URL (user-facing site, not admin subdomain)
const getMainSiteUrl = (): string => {
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  const port = window.location.port;

  // Development environment
  if (hostname === 'localhost' || hostname.includes('127.0.0.1')) {
    // Remove ?admin=true param and return to main site
    return `${protocol}//${hostname}${port ? `:${port}` : ''}/`;
  }

  // Production environment - remove subdomain (e.g., admin.fanmark.id -> fanmark.id)
  const parts = hostname.split('.');
  if (parts.length > 2) {
    // Remove first part (subdomain)
    const mainDomain = parts.slice(1).join('.');
    return `${protocol}//${mainDomain}/`;
  }

  // Fallback
  return `${protocol}//${hostname}/`;
};

const AdminAuth = () => {
  const mainSiteUrl = getMainSiteUrl();

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

              <div className="flex justify-center mt-8">
                <Button
                  className="gap-2 rounded-full px-8 shadow-lg transition-all duration-300 hover:shadow-xl hover:-translate-y-0.5"
                  asChild
                >
                  <a href={mainSiteUrl}>
                    <Home className="h-4 w-4" />
                    トップに戻る
                  </a>
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
