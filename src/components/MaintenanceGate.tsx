import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useMaintenanceSettings } from "@/hooks/useMaintenanceSettings";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { betterAuthClient, isBetterAuthEnabled } from "@/lib/auth-backend";
import Maintenance from "@/pages/Maintenance";

const MaintenanceGate = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const { settings, loading, error } = useMaintenanceSettings();
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
        if (isBetterAuthEnabled()) {
          const result = await betterAuthClient.getAdminSession();
          if (!isMounted) return;
          setIsAdmin(result.authorized);
        } else {
          const { data, error: authError } = await supabase.rpc("is_admin");
          if (!isMounted) return;
          if (authError) {
            console.error("Failed to verify admin role for maintenance gate:", authError);
            setIsAdmin(false);
          } else {
            setIsAdmin(Boolean(data));
          }
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
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if ((settings.maintenance_mode || error) && !shouldBypass) {
    return <Maintenance />;
  }

  return <>{children}</>;
};

export default MaintenanceGate;
