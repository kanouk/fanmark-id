import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "@/hooks/useTranslation";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { LanguageToggle } from "@/components/LanguageToggle";
import { FanmarkSearchWithRegistration } from "@/components/FanmarkSearchWithRegistration";
import { InvitationSystem } from "@/components/InvitationSystem";
import { Button } from "@/components/ui/button";
import { User, LogOut } from 'lucide-react';
import { useProfile } from '@/hooks/useProfile';
const Index = () => {
  const { user, signOut } = useAuth();
  const { profile } = useProfile();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { settings, loading: settingsLoading } = useSystemSettings();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleAuthAction = () => {
    if (user) {
      signOut();
    } else {
      navigate("/auth");
    }
  };

  const handleSignupPrompt = () => {
    navigate("/auth");
  };

  const handleValidInvitationCode = (code: string, perks?: any) => {
    // Store invitation code for signup process
    localStorage.setItem('invitation_code', code);
    if (perks) {
      localStorage.setItem('invitation_perks', JSON.stringify(perks));
    }
    navigate("/auth");
  };
  return <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      {/* Navigation */}
      <div className="navbar bg-base-100/80 backdrop-blur-sm shadow-lg sticky top-0 z-50">
        <div className="navbar-start">
          <div className="text-xl font-bold text-primary">
            <span className="text-2xl">✨</span> fanmark.id
          </div>
        </div>
        <div className="navbar-end">
          <div className="flex items-center gap-2">
            <LanguageToggle />
            {user ? (
              <div ref={menuRef} className={`dropdown dropdown-end ${userMenuOpen ? 'dropdown-open' : ''}`}>
                <button 
                  className="btn btn-ghost btn-circle avatar"
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  aria-label="User menu"
                  aria-haspopup="true"
                  aria-expanded={userMenuOpen}
                >
                  <div className="relative w-8 h-8 rounded-full bg-primary/10 overflow-hidden">
                    {profile?.avatar_url ? (
                      <img src={profile.avatar_url} alt="Avatar" className="absolute inset-0 w-full h-full object-cover" />
                    ) : (
                      <User className="text-primary w-4 h-4 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
                    )}
                  </div>
                </button>
                <ul className="menu menu-sm dropdown-content mt-3 z-50 p-2 shadow bg-base-100 rounded-box w-52">
                  <li>
                    <span className="text-xs text-base-content/60 px-3 py-1 pointer-events-none">{user.email}</span>
                  </li>
                  <li><a onClick={() => { navigate('/dashboard'); setUserMenuOpen(false); }} className="gap-2 active:bg-primary/20">
                    <span className="text-sm">🎯</span> Dashboard
                  </a></li>
                  <li><a onClick={() => { navigate('/profile'); setUserMenuOpen(false); }} className="gap-2 active:bg-primary/20">
                    <User className="w-4 h-4" /> {t('navigation.profile')}
                  </a></li>
                  <li><a onClick={() => { handleAuthAction(); setUserMenuOpen(false); }} className="gap-2 active:bg-primary/20">
                    <LogOut className="w-4 h-4" /> {t('navigation.logout')}
                  </a></li>
                </ul>
              </div>
            ) : (
              <Button variant="default" size="sm" onClick={handleAuthAction}>
                {t('hero.signInButton')}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Hero Section */}
      <div className="hero min-h-[60vh] bg-gradient-to-br from-pink-100 via-purple-100 to-blue-100">
        <div className="hero-content text-center">
          <div className="max-w-4xl">
            <div className="animate-float mb-8 pointer-events-none">
              <span className="text-8xl">✨</span>
            </div>
            <h1 className="text-6xl font-bold bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 bg-clip-text text-transparent mb-6">
              {t('hero.subtitle')}
            </h1>
            <p className="text-xl mb-8 text-base-content/80">
              {t('hero.description')}
            </p>

            <div className="flex flex-wrap gap-4 justify-center">
              <Button size="lg" className="hover:scale-105 transition-transform" onClick={handleSignupPrompt}>
                {t('hero.tryButton')} ✨
              </Button>
              <Button variant="outline" size="lg" className="hover:scale-105 transition-transform">
                {t('navigation.seeHowUsed')} 👀
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Fanmark Search Section - Always show for search functionality */}
      <div className="py-16 bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50">
        <div className="container mx-auto px-4">
          <FanmarkSearchWithRegistration onSignupPrompt={handleSignupPrompt} />
        </div>
      </div>

      {/* Examples Section */}
      <div className="py-20 bg-base-100">
        <div className="container mx-auto px-4">
          <h2 className="text-4xl font-bold text-center mb-4">{t('sections.howUsed')} 🚀</h2>
          <p className="text-center text-base-content/70 mb-12 text-lg">
            {t('search.joinThousands')}
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="card bg-gradient-to-br from-pink-100 to-purple-100 shadow-xl hover:scale-105 transition-transform">
              <div className="card-body text-center">
                <div className="text-4xl mb-4">🎵🎤🎸</div>
                <h3 className="card-title justify-center text-lg">{t('sections.examples.musician.title')}</h3>
                <p className="text-sm text-base-content/70">{t('sections.examples.musician.description')}</p>
                <div className="badge badge-secondary px-[10px]">{t('sections.examples.musician.badge')}</div>
              </div>
            </div>

            <div className="card bg-gradient-to-br from-orange-100 to-red-100 shadow-xl hover:scale-105 transition-transform">
              <div className="card-body text-center">
                <div className="text-4xl mb-4">🍔🍟</div>
                <h3 className="card-title justify-center text-lg">{t('sections.examples.shop.title')}</h3>
                <p className="text-sm text-base-content/70">{t('sections.examples.shop.description')}</p>
                <div className="badge badge-accent px-[10px]">{t('sections.examples.shop.badge')}</div>
              </div>
            </div>

            <div className="card bg-gradient-to-br from-blue-100 to-cyan-100 shadow-xl hover:scale-105 transition-transform">
              <div className="card-body text-center">
                <div className="text-4xl mb-4">💼📊⚡</div>
                <h3 className="card-title justify-center text-lg">{t('sections.examples.business.title')}</h3>
                <p className="text-sm text-base-content/70">{t('sections.examples.business.description')}</p>
                <div className="badge badge-info px-[10px]">{t('sections.examples.business.badge')}</div>
              </div>
            </div>

            <div className="card bg-gradient-to-br from-purple-100 to-pink-100 shadow-xl hover:scale-105 transition-transform">
              <div className="card-body text-center">
                <div className="text-4xl mb-4">🔥🔥🔥</div>
                <h3 className="card-title justify-center text-lg">{t('sections.examples.streamer.title')}</h3>
                <p className="text-sm text-base-content/70">{t('sections.examples.streamer.description')}</p>
                <div className="badge badge-error px-[10px]">{t('sections.examples.streamer.badge')}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* How It Works */}
      <div className="py-20 bg-gradient-to-br from-purple-50 to-pink-50">
        <div className="container mx-auto px-4">
          <h2 className="text-4xl font-bold text-center mb-12">{t('sections.howItWorks')} 🛠️</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="card bg-base-100 shadow-xl">
              <div className="card-body text-center">
                <div className="text-5xl mb-4 animate-bounce-soft">🎯</div>
                <h3 className="card-title justify-center text-xl mb-4">1. {t('sections.step1')}</h3>
                <p className="text-base-content/70">
                  {t('sections.step1Description')}
                </p>
              </div>
            </div>

            <div className="card bg-base-100 shadow-xl">
              <div className="card-body text-center">
                <div className="text-5xl mb-4 animate-pulse-slow">📝</div>
                <h3 className="card-title justify-center text-xl mb-4">2. {t('sections.step2')}</h3>
                <p className="text-base-content/70">
                  {t('sections.step2Description')}
                </p>
              </div>
            </div>

            <div className="card bg-base-100 shadow-xl">
              <div className="card-body text-center">
                <div className="text-5xl mb-4 animate-float">🚀</div>
                <h3 className="card-title justify-center text-xl mb-4">3. {t('sections.step3')}</h3>
                <p className="text-base-content/70">
                  {t('sections.step3Description')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pricing Hint */}
      <div className="py-16 bg-base-100">
        <div className="container mx-auto px-4 text-center">
          <div className="max-w-2xl mx-auto">
            <h2 className="text-3xl font-bold mb-6">{t('sections.pricing')} 💖</h2>
            <div className="card bg-gradient-to-r from-pink-100 to-purple-100 shadow-xl">
              <div className="card-body">
                <p className="text-lg mb-4">
                  <span className="badge badge-primary badge-lg px-[10px]">{t('sections.pricingDetails.shortPremium')}</span>
                </p>
                <p className="text-lg mb-4">
                  <span className="badge badge-secondary badge-lg px-[10px]">{t('sections.pricingDetails.longFree')}</span>
                </p>
                <p className="text-base-content/70 whitespace-pre-line">
                  {t('sections.pricingDetails.description')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Comparison */}
      <div className="py-16 bg-gradient-to-br from-blue-50 to-purple-50">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-8">{t('sections.comparison')} 💝</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            <div className="card bg-base-100 shadow-lg">
              <div className="card-body">
                <h3 className="card-title text-error justify-center">{t('sections.comparisonDetails.oldWay.title')}</h3>
                <p className="text-sm font-mono bg-base-200 p-3 rounded">
                  linktr.ee/my_awesome_musician_profile_2024
                </p>
                <p className="text-base-content/70 whitespace-pre-line">
                  {t('sections.comparisonDetails.oldWay.problems')}
                </p>
              </div>
            </div>
            
            <div className="card bg-gradient-to-br from-green-100 to-blue-100 shadow-lg">
              <div className="card-body">
                <h3 className="card-title text-success justify-center">{t('sections.comparisonDetails.fanmarkWay.title')}</h3>
                <p className="text-2xl p-3">🎵🎤🎸</p>
                <p className="text-base-content/70 whitespace-pre-line">
                  {t('sections.comparisonDetails.fanmarkWay.benefits')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="py-20 bg-primary text-primary-content">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-4xl font-bold mb-6">{t('sections.cta')} ✨</h2>
          <p className="text-xl mb-8 opacity-90">
            {t('sections.ctaDescription')}
          </p>
          <Button variant="secondary" size="lg" className="hover:scale-105 transition-transform" onClick={handleSignupPrompt}>
            {t('hero.tryButton')} 🚀
          </Button>
        </div>
      </div>

      {/* Footer */}
      <footer className="footer footer-center p-10 bg-base-200 text-base-content">
        <div>
          <div className="text-2xl font-bold text-primary mb-4">
            <span className="text-3xl">✨</span> fanmark.id
          </div>
          <p className="text-base-content/70">{t('sections.footer')}</p>
        </div>
      </footer>
    </div>;
};
export default Index;