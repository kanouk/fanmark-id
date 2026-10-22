import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { AppStartupSkeleton } from '@/components/AppStartupSkeleton';
import { useMaintenanceSettings } from "@/hooks/useMaintenanceSettings";
import { useAuth } from "@/hooks/useAuth";

import { betterAuthClient } from "@/lib/auth-backend";
import Maintenance from "@/pages/Maintenance";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";

const MaintenanceGate = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const { settings, loading, error, refetch } = useMaintenanceSettings();
  const { t } = useTranslation();
  const { user } = useAuth();
  const userId = user?.id;
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(false);

  const isAdminPath = useMemo(() => location.pathname.startsWith("/admin"), [location.pathname]);
  const isMaintenancePreview = useMemo(() => location.pathname === "/maintenance", [location.pathname]);

  useEffect(() => {
    let isMounted = true;

    if ((!settings.maintenance_mode && !error) || isAdminPath) {
      setIsAdmin(false);
      setCheckingAdmin(false);
      return () => {
        isMounted = false;
      };
    }

    if (!userId) {
      setIsAdmin(false);
      setCheckingAdmin(false);
      return () => {
        isMounted = false;
      };
    }

    const verifyAdmin = async () => {
      setCheckingAdmin(true);
      try {
        {
          const result = await betterAuthClient.getAdminSession();
          if (!isMounted) return;
          setIsAdmin(result.authorized);
        }
      } catch (err) {
        if (!isMounted) return;
        console.error("Unexpected error verifying admin role for maintenance gate:", err);
        setIsAdmin(false);
      } finally {
        if (isMounted) {
          setCheckingAdmin(false);
        }
      }
    };

    verifyAdmin();

    return () => {
      isMounted = false;
    };
  }, [settings.maintenance_mode, error, isAdminPath, userId]);

  const shouldBypass = isAdminPath || isMaintenancePreview || isAdmin;

  if (loading || checkingAdmin) {
    return <AppStartupSkeleton />;
  }

  if (error && !shouldBypass) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div role="alert" className="max-w-md space-y-4 text-center">
          <h1 className="text-xl font-semibold">{t('maintenance.settingsCheckFailed')}</h1>
          <p className="text-muted-foreground">{t('maintenance.settingsCheckRetry')}</p>
          <Button onClick={() => { void refetch().catch(() => undefined); }}>{t('common.tryAgain')}</Button>
        </div>
      </div>
    );
  }

  if (settings.maintenance_mode && !shouldBypass) {
    return <Maintenance />;
  }

  return <>{children}</>;
};

export default MaintenanceGate;
