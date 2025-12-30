import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TranslationProvider } from "@/hooks/useTranslation";
import { AuthProvider } from "@/hooks/useAuth";
import { LotteryActionOverlayProvider } from "@/providers/LotteryActionOverlayProvider";
import { supabase } from "@/integrations/supabase/client";
import AdminDashboard from "@/pages/AdminDashboard";
import AdminAuth from "@/pages/AdminAuth";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, ShieldAlert } from "lucide-react";
import { ScrollToTop } from "@/components/ScrollToTop";

const queryClient = new QueryClient();

const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const verifyAdmin = async () => {
      if (!user) {
        if (isMounted) {
          setIsAdmin(false);
          setChecking(false);
        }
        return;
      }

      setChecking(true);
      try {
        const { data, error } = await supabase.rpc('is_admin');
        if (!isMounted) return;

        if (error) {
          console.error('Failed to verify admin role:', error);
          setCheckError('Failed to verify admin permissions.');
          setIsAdmin(false);
        } else {
          setIsAdmin(Boolean(data));
          setCheckError(null);
        }
      } catch (err) {
        if (!isMounted) return;
        console.error('Unexpected error verifying admin role:', err);
        setCheckError('Unexpected error verifying admin permissions.');
        setIsAdmin(false);
      } finally {
        if (isMounted) {
          setChecking(false);
        }
      }
    };

    verifyAdmin();

    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  if (loading || checking) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p>Verifying admin credentials…</p>
      </div>
    );
  }

  if (!user) {
    return <AdminAuth />;
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
        <div className="max-w-md rounded-2xl border border-destructive/30 bg-destructive/10 p-8 text-center shadow-lg shadow-destructive/10">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/20 text-destructive">
            <ShieldAlert className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-semibold text-destructive">Admin access required</h2>
          <p className="mt-3 text-sm text-destructive/80">
            {checkError ?? 'You do not have permission to access the admin dashboard. Please contact an administrator if you believe this is an error.'}
          </p>
        </div>
      </div>
    );
  }
  
  return <>{children}</>;
};

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
