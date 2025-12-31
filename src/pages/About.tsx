import React from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { useNavigate } from "react-router-dom";
import { Fingerprint, Layers, Clock, ArrowLeftRight, ExternalLink, User, MessageSquare, ArrowRight } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BrandIcon } from "@/components/BrandIcon";

export const About: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const features = [
    {
      icon: Fingerprint,
      key: "uniqueId",
      gradient: "from-primary/20 via-primary/10 to-accent/10",
      iconColor: "text-primary",
    },
    {
      icon: Layers,
      key: "threeWays",
      gradient: "from-accent/25 via-accent/10 to-primary/10",
      iconColor: "text-accent",
    },
    {
      icon: Clock,
      key: "tierSystem",
      gradient: "from-secondary/20 via-primary/10 to-secondary/5",
      iconColor: "text-secondary",
    },
    {
      icon: ArrowLeftRight,
      key: "transfer",
      gradient: "from-pink-100/50 via-primary/10 to-pink-50/30",
      iconColor: "text-pink-500",
    },
  ];

  const accessTypes = [
    { icon: ExternalLink, key: "redirect", emoji: "🔗" },
    { icon: User, key: "profile", emoji: "👤" },
    { icon: MessageSquare, key: "messageboard", emoji: "💬" },
  ];

  const useCases = [
    { emoji: "🎨", key: "creators" },
    { emoji: "🏪", key: "businesses" },
    { emoji: "🎮", key: "communities" },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <AppHeader />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative overflow-hidden py-16 sm:py-20">
          <div className="hero-decorative-blob top-10 left-10 w-72 h-72 bg-pink-400/20" style={{animationDelay: '0s'}} />
          <div className="hero-decorative-blob top-32 right-20 w-64 h-64 bg-purple-400/20" style={{animationDelay: '3s'}} />

          <div className="container relative mx-auto max-w-4xl px-4 sm:px-6">
            <div className="backdrop-blur-md bg-white/80 rounded-3xl p-8 sm:p-12 shadow-[0_20px_60px_rgba(0,0,0,0.1)] text-center">
              <div className="mb-6 flex justify-center">
                <span className="inline-flex h-20 w-20 sm:h-24 sm:w-24 items-center justify-center rounded-full bg-white/90 backdrop-blur-sm shadow-[0_15px_40px_rgba(0,0,0,0.15)]">
                  <BrandIcon size="lg" />
                </span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 bg-clip-text text-transparent">
                {t("legalPages.about.title")}
              </h1>
              <p className="mt-3 text-lg text-muted-foreground">
                {t("legalPages.about.subtitle")}
              </p>
              <p className="mt-6 text-base text-foreground/80 leading-relaxed whitespace-pre-wrap max-w-2xl mx-auto">
                {t("legalPages.about.introduction")}
              </p>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section className="relative py-16">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-primary/10 via-accent/5 to-transparent" aria-hidden />
          <div className="container relative mx-auto max-w-4xl px-4 sm:px-6">
            <div className="grid sm:grid-cols-2 gap-6">
              {features.map((feature) => (
                <Card
                  key={feature.key}
                  className={`group relative overflow-hidden border border-border/60 bg-background/95 shadow-[0_18px_38px_rgba(101,195,200,0.15)] transition-transform duration-300 hover:-translate-y-1`}
                >
                  <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${feature.gradient} opacity-0 transition-opacity duration-300 group-hover:opacity-100`} aria-hidden />
                  <CardContent className="relative p-6">
                    <div className="flex items-center gap-4 mb-3">
                      <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-sm border border-border/40">
                        <feature.icon className={`w-6 h-6 ${feature.iconColor}`} />
                      </div>
                      <h2 className="text-lg font-bold text-foreground">
                        {t(`legalPages.about.features.${feature.key}.title`)}
                      </h2>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {t(`legalPages.about.features.${feature.key}.description`)}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Access Types */}
        <section className="relative py-16">
          <div className="container relative mx-auto max-w-4xl px-4 sm:px-6">
            <h2 className="text-center text-2xl font-bold tracking-tight text-foreground mb-8">
              {t("legalPages.about.accessTypes.title")}
            </h2>
            <div className="grid sm:grid-cols-3 gap-5">
              {accessTypes.map((type) => (
                <Card
                  key={type.key}
                  className="border border-border/60 bg-white/90 shadow-[0_12px_30px_rgba(101,195,200,0.12)] hover:shadow-[0_18px_40px_rgba(101,195,200,0.18)] transition-all duration-300"
                >
                  <CardContent className="p-6 text-center">
                    <div className="text-3xl mb-3">{type.emoji}</div>
                    <h3 className="font-semibold text-foreground mb-2">
                      {t(`legalPages.about.accessTypes.${type.key}.title`)}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {t(`legalPages.about.accessTypes.${type.key}.description`)}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="relative overflow-hidden py-16">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-accent/15 via-primary/10 to-transparent" aria-hidden />
          <div className="container relative mx-auto max-w-4xl px-4 sm:px-6">
            <h2 className="text-center text-2xl font-bold tracking-tight text-foreground mb-10">
              {t("legalPages.about.howItWorks.title")}
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[1, 2, 3, 4].map((step) => (
                <Card
                  key={step}
                  className="border border-border/60 bg-background/95 shadow-[0_15px_35px_rgba(101,195,200,0.12)]"
                >
                  <CardHeader className="flex flex-col items-center gap-3 px-5 pt-8 pb-4 text-center">
                    <div className="w-10 h-10 bg-gradient-to-br from-primary to-cyan-400 text-white rounded-full flex items-center justify-center font-bold text-lg shadow-md">
                      {step}
                    </div>
                    <CardTitle className="text-base font-semibold text-foreground">
                      {t(`legalPages.about.howItWorks.step${step}.title`)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-5 pb-6">
                    <CardDescription className="text-sm text-muted-foreground leading-relaxed text-center">
                      {t(`legalPages.about.howItWorks.step${step}.description`)}
                    </CardDescription>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Tiers */}
        <section className="relative py-16">
          <div className="container relative mx-auto max-w-4xl px-4 sm:px-6">
            <Card className="border border-primary/20 bg-white/90 shadow-[0_20px_50px_rgba(101,195,200,0.15)]">
              <CardContent className="p-6 sm:p-8">
                <h2 className="text-xl font-bold text-foreground mb-3">
                  {t("legalPages.about.tiers.title")}
                </h2>
                <p className="text-sm text-muted-foreground mb-5">
                  {t("legalPages.about.tiers.description")}
                </p>
                <div className="grid sm:grid-cols-2 gap-3">
                  {["tierS", "tierA", "tierB", "tierC"].map((tier, index) => (
                    <div
                      key={tier}
                      className={`flex items-center gap-3 p-3 rounded-xl ${
                        index === 3
                          ? "bg-gradient-to-r from-primary/10 to-cyan-100/50 border border-primary/20"
                          : "bg-muted/30"
                      }`}
                    >
                      <span className="text-lg">
                        {index === 0 && "🥇"}
                        {index === 1 && "🥈"}
                        {index === 2 && "🥉"}
                        {index === 3 && "✨"}
                      </span>
                      <span className={`text-sm ${index === 3 ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                        {t(`legalPages.about.tiers.${tier}`)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Use Cases */}
        <section className="relative py-16">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-secondary/10 via-primary/5 to-transparent" aria-hidden />
          <div className="container relative mx-auto max-w-4xl px-4 sm:px-6">
            <h2 className="text-center text-2xl font-bold tracking-tight text-foreground mb-8">
              {t("legalPages.about.useCases.title")}
            </h2>
            <div className="grid sm:grid-cols-3 gap-6">
              {useCases.map((useCase) => (
                <Card
                  key={useCase.key}
                  className="group border border-border/60 bg-background/95 shadow-[0_15px_35px_rgba(239,159,188,0.12)] hover:shadow-[0_22px_50px_rgba(101,195,200,0.18)] transition-all duration-300 hover:-translate-y-1"
                >
                  <CardContent className="p-6 text-center">
                    <div className="text-4xl mb-4 transform group-hover:scale-110 transition-transform duration-300">
                      {useCase.emoji}
                    </div>
                    <h3 className="font-semibold text-foreground mb-2">
                      {t(`legalPages.about.useCases.${useCase.key}.title`)}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {t(`legalPages.about.useCases.${useCase.key}.description`)}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="relative overflow-hidden py-16">
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute -top-24 -right-24 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />
            <div className="absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-accent/10 blur-3xl" />
          </div>

          <div className="container relative mx-auto max-w-xl px-4 sm:px-6">
            <Card className="border border-primary/20 bg-white/80 shadow-[0_25px_60px_rgba(101,195,200,0.2)] backdrop-blur-sm">
              <CardContent className="p-8 text-center">
                <h2 className="text-xl font-bold text-foreground mb-3">
                  {t("legalPages.about.cta.title")}
                </h2>
                <p className="text-muted-foreground mb-6 leading-relaxed">
                  {t("legalPages.about.cta.description")}
                </p>
                <Button
                  onClick={() => navigate("/")}
                  className="gap-2 rounded-full px-6 shadow-lg transition-all duration-300 hover:shadow-xl hover:-translate-y-0.5"
                >
                  {t("legalPages.about.cta.button")}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
};

export default About;
