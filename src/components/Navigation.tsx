import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { LanguageToggle } from '@/components/LanguageToggle';
import { ThemeToggle } from '@/components/ThemeToggle';
import { supabase } from '@/integrations/supabase/client';
import { LogOut, Home, User } from 'lucide-react';

export const Navigation = () => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  return (
    <nav className="bg-white shadow-sm border-b">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-2">
            <div className="text-2xl font-bold bg-gradient-to-r from-pink-500 to-purple-600 bg-clip-text text-transparent">
              fanmark.id
            </div>
          </Link>

          {/* Navigation Links */}
          <div className="hidden md:flex items-center space-x-6">
            <Link 
              to="/" 
              className="flex items-center space-x-1 text-gray-600 hover:text-gray-900 transition-colors"
            >
              <Home className="h-4 w-4" />
              <span>{t('navigation.home')}</span>
            </Link>
            
            {user && (
              <>
                <Link 
                  to="/dashboard" 
                  className="flex items-center space-x-1 text-gray-600 hover:text-gray-900 transition-colors"
                >
                  <span>📊</span>
                  <span>{t('navigation.dashboard')}</span>
                </Link>
                
                <Link 
                  to="/profile" 
                  className="flex items-center space-x-1 text-gray-600 hover:text-gray-900 transition-colors"
                >
                  <User className="h-4 w-4" />
                  <span>{t('navigation.profile')}</span>
                </Link>
              </>
            )}
          </div>

          {/* Right side actions */}
          <div className="flex items-center space-x-4">
            <LanguageToggle />
            <ThemeToggle />
            
            {user ? (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleLogout}
                className="flex items-center space-x-1"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">{t('navigation.logout')}</span>
              </Button>
            ) : (
              <Button asChild variant="default" size="sm">
                <Link to="/auth">{t('auth.login')}</Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};