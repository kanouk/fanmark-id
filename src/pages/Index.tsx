import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "@/hooks/useTranslation";
import { LanguageToggle } from "@/components/LanguageToggle";
import { FanmarkSearchWithRegistration } from "@/components/FanmarkSearchWithRegistration";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User, LogOut } from 'lucide-react';
import { useProfile } from '@/hooks/useProfile';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
const Index = () => {
  const { user, signOut } = useAuth();
  const { profile } = useProfile();
  const navigate = useNavigate();
  const { t, tWithBreaks } = useTranslation();
  const exampleCards = [
    {
      key: 'musician',
      emoji: '🎵🎤🎸',
      gradient: 'from-primary/20 via-primary/10 to-accent/10',
      badgeClass: 'border-primary/20 bg-primary text-primary-foreground shadow-[0_8px_18px_hsl(var(--primary)_/_0.25)]',
    },
    {
      key: 'shop',
      emoji: '🍔🍟',
      gradient: 'from-accent/25 via-accent/10 to-primary/10',
      badgeClass: 'border-accent/20 bg-accent text-accent-foreground shadow-[0_8px_18px_hsl(var(--accent)_/_0.25)]',
    },
    {
      key: 'business',
      emoji: '💼📊⚡',
      gradient: 'from-secondary/20 via-primary/10 to-secondary/5',
      badgeClass: 'border-secondary/20 bg-secondary text-secondary-foreground shadow-[0_8px_18px_hsl(var(--secondary)_/_0.25)]',
    },
    {
      key: 'streamer',
      emoji: '🔥🎮✨',
      gradient: 'from-destructive/25 via-accent/10 to-primary/10',
      badgeClass: 'border-destructive/20 bg-destructive text-destructive-foreground shadow-[0_8px_18px_hsl(var(--destructive)_/_0.25)]',
    },
  ] as const;
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

  return <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      {/* Navigation */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto flex items-center justify-between px-4 py-4 md:px-6">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="group flex items-center gap-2 text-lg font-semibold text-foreground transition-transform hover:translate-y-[-1px]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-2xl transition-all group-hover:scale-105">
              ✨
            </span>
            <span className="text-gradient text-2xl">fanmark.id</span>
          </button>

          <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex" />

          <div className="flex items-center gap-2">
            <LanguageToggle />
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/30 bg-primary/10 shadow-[0_4px_12px_hsl(var(--primary)_/_0.15)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    aria-label="User menu"
                  >
                    <div className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-primary/10">
                      {profile?.avatar_url ? (
                        <img src={profile.avatar_url} alt="Avatar" className="absolute inset-0 h-full w-full object-cover" />
                      ) : (
                        <User className="h-4 w-4 text-primary" />
                      )}
                    </div>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    {user.email}
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      navigate('/dashboard');
                    }}
                    className="cursor-pointer"
                  >
                    <span className="mr-2 text-lg">🎯</span>
                    Dashboard
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      navigate('/profile');
                    }}
                    className="cursor-pointer"
                  >
                    <User className="mr-2 h-4 w-4" />
                    {t('navigation.profile')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      handleAuthAction();
                    }}
                    className="cursor-pointer"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    {t('navigation.logout')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button variant="accent" size="sm" onClick={handleAuthAction}>
                {t('hero.signInButton')}
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section
        id="home"
        className="relative overflow-hidden bg-gradient-to-br from-pink-100 via-purple-100 to-blue-100"
      >
        <div className="container mx-auto px-4 py-20 sm:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-10 flex justify-center">
              <span className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-primary/20 text-6xl shadow-[0_15px_40px_hsl(var(--primary)_/_0.25)] animate-float">
                ✨
              </span>
            </div>
            <h1 className="text-balance text-4xl font-bold tracking-tight text-transparent sm:text-5xl md:text-6xl bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 bg-clip-text">
              {tWithBreaks('hero.subtitle')}
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-base-content/80 sm:text-xl">
              {tWithBreaks('hero.description')}
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
              <Button size="lg" className="w-full sm:w-auto" onClick={handleSignupPrompt}>
                {t('hero.tryButton')} ✨
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="w-full sm:w-auto"
                onClick={() => {
                  const section = document.querySelector('#examples');
                  section?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                {t('navigation.seeHowUsed')} 👀
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Fanmark Search Section - Always show for search functionality */}
      <div id="search" className="py-16 bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50">
        <div className="container mx-auto px-4">
          <FanmarkSearchWithRegistration onSignupPrompt={handleSignupPrompt} />
        </div>
      </div>

      {/* Examples Section */}
      <section
        id="examples"
        className="relative overflow-hidden py-24"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-primary/15 via-accent/10 to-transparent" aria-hidden />
        <div className="container relative mx-auto px-4">
          <h2 className="text-center text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            {t('sections.howUsed')} 🚀
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-base text-muted-foreground sm:text-lg">
            {t('search.joinThousands')}
          </p>

          <div className="mt-14 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {exampleCards.map(({ key, emoji, gradient, badgeClass }) => (
              <Card
                key={key}
                className={`group relative overflow-hidden border border-border/60 bg-background/95 shadow-[0_20px_45px_rgba(239,159,188,0.18)] transition-transform duration-300 hover:-translate-y-2 hover:shadow-[0_28px_60px_rgba(101,195,200,0.22)]`}
              >
                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${gradient} opacity-0 transition-opacity duration-300 group-hover:opacity-100`} aria-hidden />
                <CardHeader className="relative flex flex-col items-center gap-5 px-6 pt-10 pb-6 text-center">
                  <span className="text-4xl">
                    {emoji}
                  </span>
                  <CardTitle className="text-lg font-semibold text-foreground">
                    {t(`sections.examples.${key}.title`)}
                  </CardTitle>
                  <CardDescription className="text-sm text-muted-foreground">
                    {t(`sections.examples.${key}.description`)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="relative flex justify-center px-6 pb-10">
                  <Badge
                    variant="outline"
                    className={`rounded-full px-4 py-1 text-xs font-semibold uppercase tracking-wide ${badgeClass}`}
                  >
                    {t(`sections.examples.${key}.badge`)}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="relative overflow-hidden py-24">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-accent/20 via-primary/15 to-transparent" aria-hidden />
        <div className="container relative mx-auto px-4">
          <h2 className="text-center text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            {t('sections.howItWorks')} 🛠️
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-base text-muted-foreground sm:text-lg">
            {t('hero.description')}
          </p>

          <div className="mt-16 grid gap-8 md:grid-cols-3">
            {[
              { emoji: '🎯', title: t('sections.step1'), description: t('sections.step1Description'), animation: 'animate-bounce-soft', gradient: 'from-primary/10 to-transparent' },
              { emoji: '📝', title: t('sections.step2'), description: t('sections.step2Description'), animation: 'animate-pulse-slow', gradient: 'from-accent/10 to-transparent' },
              { emoji: '🚀', title: t('sections.step3'), description: t('sections.step3Description'), animation: 'animate-float', gradient: 'from-secondary/10 to-transparent' },
            ].map(({ emoji, title, description, animation, gradient }, index) => (
              <Card key={title} className="relative overflow-hidden border border-border/60 bg-background/95 shadow-[0_18px_38px_rgba(101,195,200,0.18)]">
                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-b ${gradient} opacity-0 transition-opacity duration-300 hover:opacity-100`} aria-hidden />
                <CardHeader className="relative flex flex-col items-center gap-4 px-8 pt-12 pb-8 text-center">
                  <span className={`text-5xl ${animation}`}>{emoji}</span>
                  <CardTitle className="text-xl font-semibold text-foreground">{index + 1}. {title}</CardTitle>
                  <CardDescription className="text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>


      {/* CTA */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary via-accent to-primary py-24 text-primary-foreground">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-4xl font-bold tracking-tight sm:text-5xl">
              {t('sections.cta')} ✨
            </h2>
            <p className="mt-6 text-lg text-primary-foreground/90 sm:text-xl">
              {t('sections.ctaDescription')}
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button size="lg" variant="secondary" className="px-8 shadow-[0_20px_40px_rgba(0,0,0,0.18)]" onClick={handleSignupPrompt}>
                {t('hero.tryButton')} 🚀
              </Button>
              <Button
                size="lg"
                variant="ghost"
                className="border border-primary-foreground/40 px-8 text-primary-foreground hover:bg-primary-foreground/10"
                onClick={() => navigate('/pricing')}
              >
                {t('sections.pricing')} →
              </Button>
            </div>
          </div>
        </div>
      </section>

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
