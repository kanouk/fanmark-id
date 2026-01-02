import { useEffect, useState } from 'react';
import { useAuth } from "@/hooks/useAuth";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "@/hooks/useTranslation";
import { AppHeader } from '@/components/layout/AppHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { BrandIcon } from '@/components/BrandIcon';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FanmarkAcquisition } from '@/components/FanmarkAcquisition';
import { supabase } from '@/integrations/supabase/client';
import { useFanmarkLimit } from '@/hooks/useFanmarkLimit';
import { RecentFanmarksScroll } from '@/components/RecentFanmarksScroll';
import { Sparkles } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
const Index = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, tWithBreaks } = useTranslation();
  const [fanmarkCount, setFanmarkCount] = useState(0);
  const { limit: fanmarkLimit, loading: limitLoading } = useFanmarkLimit();
  const [prefilledEmoji, setPrefilledEmoji] = useState<string | undefined>();
  const exampleCards = [
    {
      key: 'influencer',
      emoji: '👑🪽',
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
      key: 'friends',
      emoji: '⚽️🍻📍',
      gradient: 'from-secondary/20 via-primary/10 to-secondary/5',
      badgeClass: 'border-secondary/20 bg-secondary text-secondary-foreground shadow-[0_8px_18px_hsl(var(--secondary)_/_0.25)]',
    },
    {
      key: 'gameStreamer',
      emoji: '🍉📞',
      gradient: 'from-destructive/25 via-accent/10 to-primary/10',
      badgeClass: 'border-destructive/20 bg-destructive text-destructive-foreground shadow-[0_8px_18px_hsl(var(--destructive)_/_0.25)]',
    },
  ] as const;
  const handleSignupPrompt = () => {
    navigate("/auth");
  };

  const handleScrollToSearch = () => {
    const searchSection = document.getElementById('search');
    if (searchSection) {
      searchSection.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  };

  const handleCopyExampleFanmark = (emoji: string) => {
    navigator.clipboard.writeText(emoji);
    toast({
      title: t('dashboard.emojiCopiedTitle'),
      description: emoji,
    });
  };

  useEffect(() => {
    let isMounted = true;

    const fetchFanmarkCount = async () => {
      if (!user) {
        if (isMounted) {
          setFanmarkCount(0);
        }
        return;
      }

      try {
        const { count, error } = await supabase
          .from('fanmark_licenses')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('status', 'active')
          .gt('license_end', new Date().toISOString());

        if (!isMounted) return;

        if (error) {
          console.error('Failed to fetch fanmark count:', error);
          setFanmarkCount(0);
          return;
        }

        setFanmarkCount(count ?? 0);
      } catch (error) {
        if (!isMounted) return;
        console.error('Unexpected error fetching fanmark count:', error);
        setFanmarkCount(0);
      }
    };

    fetchFanmarkCount();

    return () => {
      isMounted = false;
    };
  }, [user]);

  const handleRequireAuth = (emoji: string) => {
    try {
      localStorage.setItem('fanmark.prefill', emoji);
    } catch (error) {
      console.warn('Failed to persist fanmark prefill before auth redirect:', error);
    }
    navigate('/auth', { state: { prefillFanmark: emoji } });
  };

  useEffect(() => {
    const state = location.state as { prefillFanmark?: string; scrollToSearch?: boolean } | null;
    let nextPrefill = state?.prefillFanmark;
    const shouldScrollToSearch = Boolean(state?.scrollToSearch);
    let shouldClearState = Boolean(nextPrefill || shouldScrollToSearch);

    if (!nextPrefill) {
      try {
        const stored = localStorage.getItem('fanmark.prefill');
        if (stored) {
          nextPrefill = stored;
          localStorage.removeItem('fanmark.prefill');
        }
      } catch (error) {
        console.warn('Failed to access localStorage for fanmark prefill:', error);
      }
    }

    if (nextPrefill) {
      setPrefilledEmoji(nextPrefill);
    }

    if (shouldScrollToSearch) {
      setTimeout(() => {
        const searchSection = document.getElementById('search');
        if (searchSection) {
          searchSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 0);
    }

    if (shouldClearState) {
      navigate(location.pathname, { replace: true });
    }
  }, [location, navigate]);

  // prefilledEmoji のクリアは不要
  // - location.state は navigate(..., { replace: true }) で既にクリアされている
  // - 次回アクセス時には自動的に undefined になる
  // - FanmarkAcquisition は prefilledEmoji の変更を監視しているので、undefined も正しく処理される

  useEffect(() => {
    if (!prefilledEmoji) return;

    const searchSection = document.getElementById('search');
    if (searchSection) {
      setTimeout(() => {
        searchSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    }
  }, [prefilledEmoji]);

  return <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <AppHeader />

      {/* Hero Section */}
      <section
        id="home"
        className="relative overflow-hidden hero-gradient-animated"
      >
        {/* 装飾用のブロブ（浮遊する円） */}
        <div className="hero-decorative-blob top-10 left-10 w-96 h-96 bg-pink-400/30" style={{animationDelay: '0s'}} />
        <div className="hero-decorative-blob top-32 right-20 w-80 h-80 bg-purple-400/30" style={{animationDelay: '3s'}} />
        <div className="hero-decorative-blob bottom-20 left-32 w-72 h-72 bg-blue-400/30" style={{animationDelay: '6s'}} />
        
        <div className="absolute inset-0 bg-gradient-to-t from-white/20 to-transparent" />
        <div className="container relative mx-auto px-4 py-16 sm:py-20 pb-32 sm:pb-36">
          <div className="mx-auto max-w-3xl text-center">
            <div className="backdrop-blur-md bg-white/80 rounded-2xl p-6 sm:p-10 shadow-[0_20px_60px_rgba(0,0,0,0.15)]">
              <div className="mb-6 flex justify-center">
                <span className="inline-flex h-28 w-28 sm:h-32 sm:w-32 items-center justify-center rounded-full bg-white/90 backdrop-blur-sm shadow-[0_20px_50px_rgba(0,0,0,0.2)] animate-float">
                  <BrandIcon size="xl" />
                </span>
              </div>
              <h1 className="text-balance text-3xl font-bold tracking-tight bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 bg-clip-text text-transparent sm:text-4xl md:text-5xl">
                {tWithBreaks('hero.subtitle')}
              </h1>
              <p className="mt-6 text-base leading-relaxed text-foreground/90 sm:text-lg font-medium">
                {tWithBreaks('hero.description')}
              </p>

              <div className="mt-8 flex flex-col items-center justify-center">
                <Button size="default" className="w-full sm:w-auto px-6 shadow-[0_10px_30px_rgba(0,0,0,0.2)] hover:shadow-[0_15px_40px_rgba(0,0,0,0.25)] transition-all" onClick={handleScrollToSearch}>
                  {t('hero.tryButton')}
                </Button>
              </div>
            </div>
          </div>
        </div>
        
        {/* 最近取得されたファンマーク */}
        <RecentFanmarksScroll />
      </section>

      {/* Fanmark Search Section - Always show for search functionality */}
      <div id="search" className="py-16 bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50">
        <div className="container mx-auto px-4">
          <FanmarkAcquisition
            fanmarkLimit={fanmarkLimit}
            currentCount={fanmarkCount}
            prefilledEmoji={prefilledEmoji}
            rememberSearch
            onRequireAuth={handleRequireAuth}
            onObtain={() => setFanmarkCount((count) => count + 1)}
          />
        </div>
      </div>

      {/* Examples Section */}
      <section
        id="examples"
        className="relative overflow-hidden py-24"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-primary/15 via-accent/10 to-transparent" aria-hidden />
        <div className="container relative mx-auto px-4">
          <h2 className="text-center text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t('sections.howUsed')} 🚀
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-base text-muted-foreground sm:text-lg">
            {t('search.joinThousands')}
          </p>

          <div className="mt-14 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {exampleCards.map(({ key, emoji, gradient, badgeClass }) => (
              <Card
                key={key}
                className={`group relative flex h-full flex-col overflow-hidden border border-border/60 bg-background/95 shadow-[0_20px_45px_rgba(239,159,188,0.18)] transition-transform duration-300 hover:-translate-y-2 hover:shadow-[0_28px_60px_rgba(101,195,200,0.22)]`}
              >
                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${gradient} opacity-0 transition-opacity duration-300 group-hover:opacity-100`} aria-hidden />
                <CardHeader className="relative flex flex-1 flex-col items-center gap-5 px-6 pt-10 pb-6 text-center">
                  <button
                    type="button"
                    className="text-4xl cursor-pointer transition-transform duration-200 hover:scale-110"
                    onClick={() => handleCopyExampleFanmark(emoji)}
                    title={t('dashboard.clickToCopyEmoji')}
                    aria-label={t('dashboard.clickToCopyEmoji')}
                  >
                    {emoji}
                  </button>
                  <CardTitle className="text-lg font-semibold text-foreground">
                    {t(`sections.examples.${key}.title`)}
                  </CardTitle>
                  <CardDescription className="text-sm text-muted-foreground">
                    {t(`sections.examples.${key}.description`)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="relative mt-auto flex justify-center px-6 pb-10">
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
          <h2 className="text-center text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t('sections.howItWorks')} 🛠️
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-base text-muted-foreground sm:text-lg">
            {t('sections.howItWorksDescription')}
          </p>

          <div className="mt-16 grid gap-8 md:grid-cols-3">
            {[
              { emoji: '🪪', title: t('sections.step1'), description: t('sections.step1Description'), gradient: 'from-primary/10 to-transparent' },
              { emoji: '🎯', title: t('sections.step2'), description: t('sections.step2Description'), gradient: 'from-accent/10 to-transparent' },
              { emoji: '🎉', title: t('sections.step3'), description: t('sections.step3Description'), gradient: 'from-secondary/10 to-transparent' },
            ].map(({ emoji, title, description, gradient }, index) => (
              <Card key={title} className="relative overflow-hidden border border-border/60 bg-background/95 shadow-[0_18px_38px_rgba(101,195,200,0.18)]">
                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-b ${gradient} opacity-0 transition-opacity duration-300 hover:opacity-100`} aria-hidden />
                <CardHeader className="relative flex flex-col items-center gap-4 px-8 pt-12 pb-8 text-center">
                  <span className="text-5xl">{emoji}</span>
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
      <section className="relative overflow-hidden bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 py-16">
        {/* Decorative background elements */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute -bottom-24 -left-24 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
        </div>
        
        <div className="container relative mx-auto px-4">
          <div className="mx-auto max-w-xl">
            <div className="rounded-3xl border border-primary/20 bg-white/80 px-8 py-10 shadow-[0_25px_60px_rgba(101,195,200,0.2)] backdrop-blur-sm sm:px-10">
              <div className="text-center">
                <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                  {t('sections.cta')}
                </h2>
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                  {t('sections.ctaDescription')}
                </p>
                <div className="mt-6">
                  <Button 
                    className="gap-2 rounded-full px-6 shadow-lg transition-all duration-300 hover:shadow-xl hover:-translate-y-0.5" 
                    onClick={handleSignupPrompt}
                  >
                    <Sparkles className="h-4 w-4" />
                    {t('hero.tryButton')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <SiteFooter />
    </div>;
};
export default Index;
