import { FanmarkDashboard } from '@/components/FanmarkDashboard';
import { AppHeader } from '@/components/layout/AppHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { SubscriptionStatus } from '@/components/SubscriptionStatus';
import { useAuth } from '@/hooks/useAuth';
import { Navigate } from 'react-router-dom';

export default function Dashboard() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <AppHeader />
      <main className="flex-1">
        <div className="container mx-auto px-4 py-6 space-y-6">
          <SubscriptionStatus />
          <FanmarkDashboard />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
