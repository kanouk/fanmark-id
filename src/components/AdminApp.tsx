import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TranslationProvider } from "@/hooks/useTranslation";
import { AuthProvider } from "@/hooks/useAuth";
import AdminDashboard from "@/pages/AdminDashboard";
import AdminAuth from "@/pages/AdminAuth";
import { useAuth } from "@/hooks/useAuth";

const queryClient = new QueryClient();

const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  
  // 管理者チェック（kanouk@gmail.com のみ）
  if (!user || user.email !== 'kanouk@gmail.com') {
    return <AdminAuth />;
  }
  
  return <>{children}</>;
};

const AdminApp = () => (
  <QueryClientProvider client={queryClient}>
    <TranslationProvider>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
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
      </AuthProvider>
    </TranslationProvider>
  </QueryClientProvider>
);

export default AdminApp;