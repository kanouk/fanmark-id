import React, { useEffect, useState, useCallback } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TranslationProvider } from "@/hooks/useTranslation";
import { AuthProvider } from "@/hooks/useAuth";
import { LotteryActionOverlayProvider } from "@/providers/LotteryActionOverlayProvider";

import { betterAuthClient } from "@/lib/auth-backend";
import AdminDashboard from "@/pages/AdminDashboard";
import AdminAuth from "@/pages/AdminAuth";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, ShieldAlert } from "lucide-react";
import { ScrollToTop } from "@/components/ScrollToTop";

const queryClient = new QueryClient();

const CloudflareAdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  const [checking, setChecking] = useState(true);
  const [authorization, setAuthorization] = useState<
    "pending" | "login" | "not-admin" | "mfa" | "authorized" | "unavailable"
  >("pending");

  const verifyAdmin = useCallback(async () => {
    if (!user) {
      setAuthorization("login");
      setChecking(false);
      return;
    }

    setChecking(true);
    try {
      const result = await betterAuthClient.getAdminSession();
      if (result.authorized) {
        setAuthorization("authorized");
      } else if ("reason" in result && (result.reason === "mfa_required" || result.reason === "mfa_enrollment_required")) {
        setAuthorization("mfa");
      } else if ("reason" in result && result.reason === "admin_required") {
        setAuthorization("not-admin");
      } else {
        setAuthorization("login");
      }
    } catch (error) {
      console.error("Failed to verify Cloudflare admin session:", error);
      setAuthorization("unavailable");
    } finally {
      setChecking(false);
    }
  }, [user]);

  const handleMfaComplete = useCallback(() => {
    void verifyAdmin();
  }, [verifyAdmin]);

  useEffect(() => {
    if (!loading) void verifyAdmin();
  }, [loading, verifyAdmin]);

  if (loading || checking || authorization === "pending") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p>管理者権限を確認しています…</p>
      </div>
    );
  }

  if (authorization === "login" || authorization === "mfa") {
    return <AdminAuth onMFAComplete={handleMfaComplete} />;
  }

  if (authorization === "not-admin") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
        <div className="max-w-md rounded-2xl border border-destructive/30 bg-destructive/10 p-8 text-center">
          <ShieldAlert className="mx-auto mb-4 h-7 w-7 text-destructive" />
          <h2 className="text-xl font-semibold text-destructive">Admin access required</h2>
          <p className="mt-3 text-sm text-destructive/80">このアカウントには管理者権限がありません。</p>
        </div>
      </div>
    );
  }

  if (authorization === "unavailable") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
        <div className="max-w-md rounded-2xl border border-destructive/30 bg-destructive/10 p-8 text-center">
          <ShieldAlert className="mx-auto mb-4 h-7 w-7 text-destructive" />
          <h2 className="text-xl font-semibold text-destructive">管理者認証を確認できません</h2>
          <p className="mt-3 text-sm text-destructive/80">時間をおいて再読み込みしてください。</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

const AdminRoute = ({ children }: { children: React.ReactNode }) => (
  <CloudflareAdminRoute>{children}</CloudflareAdminRoute>
);

const AdminApp = () => {
  // デバッグ用ログ
  if (typeof window !== 'undefined') {
    console.log('[AdminApp] Rendering admin app', { pathname: window.location.pathname });
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TranslationProvider>
        <AuthProvider>
          <LotteryActionOverlayProvider>
            <TooltipProvider>
              <Toaster />
              <Sonner />
              <BrowserRouter>
                <ScrollToTop />
                <Routes>
                  <Route path="/" element={
                    <AdminRoute>
                      <AdminDashboard />
                    </AdminRoute>
                  } />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </BrowserRouter>
            </TooltipProvider>
          </LotteryActionOverlayProvider>
        </AuthProvider>
      </TranslationProvider>
    </QueryClientProvider>
  );
};

// Named export for use in MainApp's /admin route
export { AdminRoute };

export default AdminApp;
