import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import Maintenance from "@/pages/Maintenance";

const MaintenanceGate = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const { settings, loading } = useSystemSettings();
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(false);

  const isAdminPath = useMemo(() => location.pathname.startsWith("/admin"), [location.pathname]);
  const isMaintenancePreview = useMemo(() => location.pathname === "/maintenance", [location.pathname]);

  useEffect(() => {
    let isMounted = true;

    if (!settings.maintenance_mode || isAdminPath) {
      setIsAdmin(false);
      setCheckingAdmin(false);
      return () => {
        isMounted = false;
      };
    }

    if (!user) {
      setIsAdmin(false);
      setCheckingAdmin(false);
      return () => {
        isMounted = false;
      };
    }

    const verifyAdmin = async () => {
      setCheckingAdmin(true);
      try {
        const { data, error } = await supabase.rpc("is_admin");
        if (!isMounted) return;
        if (error) {
          console.error("Failed to verify admin role for maintenance gate:", error);
          setIsAdmin(false);
        } else {
          setIsAdmin(Boolean(data));
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
  }, [settings.maintenance_mode, isAdminPath, user?.id]);

  const shouldBypass = isAdminPath || isMaintenancePreview || isAdmin;

  if (loading || checkingAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (settings.maintenance_mode && !shouldBypass) {
    return <Maintenance />;
  }

  return <>{children}</>;
};

export default MaintenanceGate;
