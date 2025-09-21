import { FanmarkDashboard } from '@/components/FanmarkDashboard';
import { Navigation } from '@/components/Navigation';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Navigate } from 'react-router-dom';

export default function Dashboard() {
  const { user, loading } = useAuth();
  const { t } = useTranslation();

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
      <Navigation />
      <main className="flex-1">
        <FanmarkDashboard />
      </main>
      <footer className="border-t border-border/40 bg-background/80 backdrop-blur">
        <div className="container mx-auto px-4 py-10 text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-2xl font-bold text-primary">
            <span className="text-3xl">✨</span> <span className="text-gradient">fanmark.id</span>
          </div>
          <p className="text-sm text-muted-foreground">{t('sections.footer')}</p>
        </div>
      </footer>
    </div>
  );
}
