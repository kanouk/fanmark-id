import React from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { TranslationProvider } from "@/hooks/useTranslation";
import { useSubdomain } from "@/hooks/useSubdomain";
import AdminApp from "./components/AdminApp";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
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

const queryClient = new QueryClient();

const MainApp = () => (
  <QueryClientProvider client={queryClient}>
    <TranslationProvider>
      <AuthProvider>
        <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/plans" element={<PlanSelection />} />
            <Route path="/fanmarks/:fanmarkId/settings" element={<FanmarkSettingsPage />} />
            <Route path="/fanmarks/:fanmarkId/profile/edit" element={<EmojiProfileEdit />} />
            <Route path="/fanmarks/:fanmarkId/profile/preview" element={<FanmarkProfilePreview />} />
            <Route path="/fanmarks/:fanmarkId/messageboard/preview" element={<FanmarkMessageboardPreview />} />
            {/* Short ID route for clean URLs */}
            <Route path="/a/:shortId" element={<FanmarkAccessByShortId />} />
            {/* Fanmark details route - must come before emojiPath */}
            <Route path="/f/:shortId" element={<FanmarkDetailsPage />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="/:emojiPath" element={<FanmarkAccess />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </TranslationProvider>
  </QueryClientProvider>
);

const App = () => {
  const { isAdmin } = useSubdomain();
  
  // 管理画面サブドメインの場合は管理画面アプリを表示
  if (isAdmin) {
    return <AdminApp />;
  }
  
  // 通常のファンマークアプリを表示
  return <MainApp />;
};

export default App;
