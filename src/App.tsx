import React from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { TranslationProvider } from "@/hooks/useTranslation";
import { useSubdomain } from "@/hooks/useSubdomain";
import AdminApp, { AdminRoute } from "./components/AdminApp";
import AdminDashboard from "./pages/AdminDashboard";
import { LanguagePreferenceSync } from "@/components/LanguagePreferenceSync";
import { DocumentTitleSync } from "@/components/DocumentTitleSync";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import PasswordSetup from "./pages/PasswordSetup";
import Profile from "./pages/Profile";
import Dashboard from "./pages/Dashboard";
import FanmarkSettingsPage from "./pages/FanmarkSettingsPage";
import EmojiProfileEdit from "./pages/EmojiProfileEdit";
import FanmarkProfilePreview from "./pages/FanmarkProfilePreview";
import FanmarkMessageboardPreview from "./pages/FanmarkMessageboardPreview";
import NotFound from "./pages/NotFound";
import { FanmarkAccess } from "./components/FanmarkAccess";
import { FanmarkAccessByShortId } from "./components/FanmarkAccessByShortId";
import FanmarkDetailsPage from "./pages/FanmarkDetailsPage";
import PlanSelection from "./pages/PlanSelection";
import FanmarkPublicQR from "./pages/FanmarkPublicQR";
import Favorites from "./pages/Favorites";
import Notifications from "./pages/Notifications";
import PWAApp from "./pages/PWAApp";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import TermsOfService from "./pages/TermsOfService";
import ContactUs from "./pages/ContactUs";
import CommercialTransactions from "./pages/CommercialTransactions";
import About from "./pages/About";
import Analytics from "./pages/Analytics";
import Maintenance from "./pages/Maintenance";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LotteryActionOverlayProvider } from "@/providers/LotteryActionOverlayProvider";
import { PasswordSetupGate } from "@/components/PasswordSetupGate";
import { ScrollToTop } from "@/components/ScrollToTop";
import MaintenanceGate from "@/components/MaintenanceGate";

const queryClient = new QueryClient();

const MainApp = () => (
  <QueryClientProvider client={queryClient}>
    <TranslationProvider>
      <AuthProvider>
        <LotteryActionOverlayProvider>
          <LanguagePreferenceSync />
          <DocumentTitleSync />
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <ScrollToTop />
              <PasswordSetupGate />
              <MaintenanceGate>
                <Routes>
                  <Route path="/" element={<Index />} />
                  <Route path="/auth" element={<Auth />} />
                  <Route path="/forgot-password" element={<ForgotPassword />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/password-setup" element={<ProtectedRoute><PasswordSetup /></ProtectedRoute>} />
                  <Route path="/favorites" element={<ProtectedRoute><Favorites /></ProtectedRoute>} />
                  <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
                  <Route path="/analytics" element={<ProtectedRoute><Analytics /></ProtectedRoute>} />
                  <Route path="/plans" element={<PlanSelection />} />
                  <Route path="/plan" element={<PlanSelection />} />
                  <Route path="/pwa" element={<PWAApp />} />
                  <Route path="/pwa/search" element={<PWAApp />} />
                  <Route path="/pwa/history" element={<PWAApp />} />
                  <Route path="/fanmarks/:fanmarkId/settings" element={<FanmarkSettingsPage />} />
                  <Route path="/fanmarks/:fanmarkId/profile/edit" element={<EmojiProfileEdit />} />
                  <Route path="/fanmarks/:fanmarkId/profile/preview" element={<FanmarkProfilePreview />} />
                  <Route path="/fanmarks/:fanmarkId/messageboard/preview" element={<FanmarkMessageboardPreview />} />
                  <Route path="/q/:shortId" element={<FanmarkPublicQR />} />
                  <Route path="/maintenance" element={<Maintenance />} />
                  {/* Short ID route for clean URLs */}
                  <Route path="/a/:shortId" element={<FanmarkAccessByShortId />} />
                  {/* Fanmark details route - must come before emojiPath */}
                  <Route path="/f/:shortId" element={<FanmarkDetailsPage />} />
                  {/* Legal and support pages */}
                  <Route path="/about" element={<About />} />
                  <Route path="/contact" element={<ContactUs />} />
                  <Route path="/privacy" element={<PrivacyPolicy />} />
                  <Route path="/terms" element={<TermsOfService />} />
                  <Route path="/commercial-transactions" element={<CommercialTransactions />} />
                  {/* Admin route - accessible via /admin path on main domain */}
                  <Route path="/admin/*" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
                  {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                  <Route path="/:emojiPath" element={<FanmarkAccess />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </MaintenanceGate>
            </BrowserRouter>
          </TooltipProvider>
        </LotteryActionOverlayProvider>
      </AuthProvider>
    </TranslationProvider>
  </QueryClientProvider>
);

const App = () => {
  const { isAdmin, subdomain } = useSubdomain();
  
  // デバッグ用ログ（本番環境では削除可能）
  if (typeof window !== 'undefined') {
    console.log('[App] Subdomain detection:', { subdomain, isAdmin, hostname: window.location.hostname });
  }
  
  // 管理画面サブドメインの場合は管理画面アプリを表示
  if (isAdmin) {
    return <AdminApp />;
  }
  
  // 通常のファンマークアプリを表示
  return <MainApp />;
};

export default App;
