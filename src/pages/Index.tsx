import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "@/hooks/useTranslation";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { LanguageToggle } from "@/components/LanguageToggle";
import FanmarkSearch from "@/components/FanmarkSearch";
import { InvitationSystem } from "@/components/InvitationSystem";
import { Button } from "@/components/ui/button";
const Index = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { settings, loading: settingsLoading } = useSystemSettings();
  const [showInvitationMode, setShowInvitationMode] = useState(false);

  useEffect(() => {
    if (!settingsLoading) {
      setShowInvitationMode(settings.invitation_mode);
    }
  }, [settings.invitation_mode, settingsLoading]);

  const handleAuthAction = () => {
    if (user) {
      signOut();
    } else {
      navigate("/auth");
    }
  };

  const handleSignupPrompt = () => {
    if (settings.invitation_mode) {
      setShowInvitationMode(true);
    } else {
      navigate("/auth");
    }
  };

  const handleValidInvitationCode = (code: string, perks?: any) => {
    // Store invitation code for signup process
    localStorage.setItem('invitation_code', code);
    if (perks) {
      localStorage.setItem('invitation_perks', JSON.stringify(perks));
    }
    navigate("/auth");
  };
  return <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50" data-theme="cupcake">
      {/* Navigation */}
      <div className="navbar bg-base-100/80 backdrop-blur-sm shadow-lg">
        <div className="navbar-start">
          <div className="text-xl font-bold text-primary">
            <span className="text-2xl">✨</span> fanmark.id
          </div>
        </div>
        <div className="navbar-end">
          <div className="flex items-center gap-2">
            <LanguageToggle />
            {user ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {user.email}
                </span>
                <Button variant="outline" size="sm" onClick={handleAuthAction}>
                  {t('navigation.logout')}
                </Button>
              </div>
            ) : !showInvitationMode ? (
              <Button variant="default" size="sm" onClick={handleAuthAction}>
                {t('hero.signInButton')}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Hero Section */}
      <div className="hero min-h-[60vh] bg-gradient-to-br from-pink-100 via-purple-100 to-blue-100">
        <div className="hero-content text-center">
          <div className="max-w-4xl">
            <div className="animate-float mb-8">
              <span className="text-8xl">✨</span>
            </div>
            <h1 className="text-6xl font-bold bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 bg-clip-text text-transparent mb-6">
              {t('hero.subtitle')}
            </h1>
            <p className="text-xl mb-8 text-base-content/80">
              {t('hero.description')}
            </p>

            {/* Show invitation system or regular buttons based on mode */}
            {showInvitationMode ? (
              <div className="max-w-md mx-auto">
                <InvitationSystem onValidCode={handleValidInvitationCode} />
              </div>
            ) : (
              <div className="flex flex-wrap gap-4 justify-center">
                <Button size="lg" className="hover:scale-105 transition-transform" onClick={handleSignupPrompt}>
                  {t('hero.tryButton')} ✨
                </Button>
                <Button variant="outline" size="lg" className="hover:scale-105 transition-transform">
                  {t('navigation.seeHowUsed')} 👀
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Fanmark Search Section */}
      {!showInvitationMode && (
        <div className="py-16 bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50">
          <div className="container mx-auto px-4">
            <FanmarkSearch onSignupPrompt={handleSignupPrompt} />
          </div>
        </div>
      )}

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