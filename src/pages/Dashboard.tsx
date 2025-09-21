import { FanmarkDashboard } from '@/components/FanmarkDashboard';
import { Navigation } from '@/components/Navigation';
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
    <div className="min-h-screen bg-background">
      <Navigation />
      <FanmarkDashboard />
    </div>
  );
}