import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

const PASSWORD_SETUP_PATH = '/password-setup';

export const PasswordSetupGate = () => {
  const { user, requiresPasswordSetup, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (loading || !user) {
      return;
    }

    if (!requiresPasswordSetup) {
      return;
    }

    if (location.pathname === PASSWORD_SETUP_PATH) {
      return;
    }

    navigate(PASSWORD_SETUP_PATH, {
      replace: true,
      state: { from: location.pathname + location.search },
    });
  }, [loading, user?.id, requiresPasswordSetup, location.pathname, location.search, navigate]);

  return null;
};
