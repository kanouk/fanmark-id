import React from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { useNavigate } from "react-router-dom";
import { Sparkles, Heart, Shield, Globe, ArrowRight } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const About: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const features = [
    {
      icon: Sparkles,
      key: "memorable",
      gradient: "from-primary/10 to-cyan-100/50",
      iconColor: "text-primary",
    },
    {
      icon: Heart,
      key: "easyShare",
      gradient: "from-pink-100/50 to-primary/10",
      iconColor: "text-pink-500",
    },
    {
      icon: Shield,
      key: "flexible",
      gradient: "from-blue-100/50 to-primary/10",
      iconColor: "text-blue-500",
    },
    {
      icon: Globe,
      key: "multilingual",
      gradient: "from-emerald-100/50 to-primary/10",
      iconColor: "text-emerald-500",
    },
  ];

  const useCases = [
    { emoji: "🎨", key: "creators" },
    { emoji: "🏪", key: "businesses" },
    { emoji: "🎮", key: "communities" },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <AppHeader className="border-border/30 bg-white/80" />
      
      <main className="flex-1">
        <div className="container mx-auto max-w-4xl px-4 py-12 sm:px-6">
          {/* Page Header */}
          <div className="space-y-3 text-center mb-12">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              {t("legalPages.about.title")}
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              {t("legalPages.about.subtitle")}
            </p>
          </div>

          {/* Introduction */}
          <Card className="rounded-3xl border border-primary/20 bg-white/90 shadow-[0_20px_45px_rgba(101,195,200,0.15)] mb-10">
            <CardContent className="p-6 sm:p-8">
              <p className="text-base text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {t("legalPages.about.introduction")}
              </p>
            </CardContent>
          </Card>

          {/* Features Grid */}
          <div className="grid sm:grid-cols-2 gap-5 mb-10">
            {features.map((feature) => (
              <Card
                key={feature.key}
                className={`rounded-3xl border border-primary/20 bg-gradient-to-br ${feature.gradient} shadow-[0_10px_30px_rgba(101,195,200,0.1)] overflow-hidden`}
              >
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 bg-white/80 rounded-xl flex items-center justify-center shadow-sm">
                      <feature.icon className={`w-5 h-5 ${feature.iconColor}`} />
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

          {/* How It Works */}
          <Card className="rounded-3xl border border-primary/20 bg-white/90 shadow-[0_20px_45px_rgba(101,195,200,0.15)] mb-10">
            <CardContent className="p-6 sm:p-8">
              <h2 className="text-xl font-bold text-foreground mb-6">
                {t("legalPages.about.howItWorks.title")}
              </h2>
              <div className="space-y-5">
                {[1, 2, 3, 4].map((step) => (
                  <div key={step} className="flex gap-4">
                    <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-br from-primary to-cyan-400 text-white rounded-full flex items-center justify-center font-bold text-sm shadow-md">
                      {step}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground mb-1">
                        {t(`legalPages.about.howItWorks.step${step}.title`)}
                      </h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {t(`legalPages.about.howItWorks.step${step}.description`)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Use Cases */}
          <div className="mb-10">
            <h2 className="text-xl font-bold text-foreground text-center mb-6">
              {t("legalPages.about.useCases.title")}
            </h2>
            <div className="grid sm:grid-cols-3 gap-5">
              {useCases.map((useCase) => (
                <Card
                  key={useCase.key}
                  className="rounded-3xl border border-primary/20 bg-white/90 shadow-[0_10px_30px_rgba(101,195,200,0.1)]"
                >
                  <CardContent className="p-6 text-center">
                    <div className="text-4xl mb-3">{useCase.emoji}</div>
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

          {/* CTA */}
          <Card className="rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/10 via-white to-cyan-50/50 shadow-[0_20px_45px_rgba(101,195,200,0.2)]">
            <CardContent className="p-8 text-center">
              <h2 className="text-xl font-bold text-foreground mb-3">
                {t("legalPages.about.cta.title")}
              </h2>
              <p className="text-muted-foreground mb-6 leading-relaxed max-w-lg mx-auto">
                {t("legalPages.about.cta.description")}
              </p>
              <Button
                onClick={() => navigate("/")}
                className="bg-gradient-to-r from-primary to-cyan-500 hover:from-primary/90 hover:to-cyan-500/90 text-white font-semibold px-6 py-3 rounded-xl shadow-md hover:shadow-lg transition-all"
              >
                {t("legalPages.about.cta.button")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>

      <SiteFooter className="border-primary/20 bg-white/80 backdrop-blur" />
    </div>
  );
};

export default About;
