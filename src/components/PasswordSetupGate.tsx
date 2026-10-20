import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

const PASSWORD_SETUP_PATH = '/password-setup';

export const PasswordSetupGate = () => {
  const { user, requiresPasswordSetup, loading, profileGateError } = useAuth();
  const userId = user?.id;
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (loading || profileGateError || !userId) {
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
  }, [loading, profileGateError, userId, requiresPasswordSetup, location.pathname, location.search, navigate]);

  return null;
};
