import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Skeleton } from '@/components/ui/skeleton';

interface ProtectedRouteProps {
  children: ReactNode;
}

export const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { user, loading, emailConfirmed } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-base-200 flex items-center justify-center p-4">
        <div className="space-y-4 w-full max-w-md">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-8 w-1/2" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (!emailConfirmed) {
    return (
      <div className="min-h-screen bg-base-200 flex items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-md">
          <div className="text-6xl">📧</div>
          <h1 className="text-2xl font-bold text-base-content">メール認証が必要です</h1>
          <p className="text-base-content/70">
            登録時に送信されたメールの確認リンクをクリックしてアカウントを有効化してください。
          </p>
          <Navigate to="/auth" replace />
        </div>
      </div>
    );
  }

  return <>{children}</>;
};