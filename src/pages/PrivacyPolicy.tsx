import React from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { AppHeader } from "@/components/layout/AppHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Card, CardContent } from "@/components/ui/card";

export const PrivacyPolicy: React.FC = () => {
  const { t } = useTranslation();

  const sections = [
    { id: "informationWeCollect", key: "informationWeCollect" },
    { id: "howWeUseYourInformation", key: "howWeUseYourInformation" },
    { id: "dataSharing", key: "dataSharing" },
    { id: "dataRetention", key: "dataRetention" },
    { id: "security", key: "security" },
    { id: "cookies", key: "cookies" },
    { id: "childrenPrivacy", key: "childrenPrivacy" },
    { id: "yourRights", key: "yourRights" },
    { id: "thirdPartyLinks", key: "thirdPartyLinks" },
    { id: "changesTopolicy", key: "changesTopolicy" },
    { id: "contactUs", key: "contactUs" },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <AppHeader className="border-border/30 bg-white/80" />
      
      <main className="flex-1">
        <div className="container mx-auto max-w-3xl px-4 py-12 sm:px-6">
          {/* Page Header */}
          <div className="space-y-2 text-center mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              {t("legalPages.privacyPolicy.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("legalPages.privacyPolicy.lastUpdated")}
            </p>
          </div>

          <Card className="rounded-3xl border border-primary/20 bg-white/90 shadow-[0_20px_45px_rgba(101,195,200,0.15)]">
            <CardContent className="p-6 sm:p-8">
              {/* Introduction */}
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap mb-8">
                {t("legalPages.privacyPolicy.introduction")}
              </p>

              {/* Sections */}
              <div className="space-y-6">
                {sections.map((section) => (
                  <section key={section.id} id={section.id} className="border-b border-border/30 pb-6 last:border-b-0 last:pb-0">
                    <h2 className="text-base font-semibold text-foreground mb-2">
                      {t(`legalPages.privacyPolicy.sections.${section.key}.title`)}
                    </h2>
                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                      {t(`legalPages.privacyPolicy.sections.${section.key}.content`)}
                    </p>
                  </section>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      <SiteFooter className="border-primary/20 bg-white/80 backdrop-blur" />
    </div>
  );
};

export default PrivacyPolicy;
