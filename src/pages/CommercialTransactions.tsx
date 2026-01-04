import React from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { AppHeader } from "@/components/layout/AppHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Card, CardContent } from "@/components/ui/card";

export const CommercialTransactions: React.FC = () => {
  const { t, tWithBreaks } = useTranslation();
  const contactLinkText = t("legalPages.footerLinks.contactUs");

  const renderContactLinkContent = (text: string) => {
    const token = "{contactLink}";
    const link = (
      <a
        href="/contact"
        className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
      >
        {contactLinkText}
      </a>
    );

    return text.split("\n").map((line, lineIndex) => {
      const parts = line.split(token);
      return (
        <span key={`contact-line-${lineIndex}`}>
          {lineIndex > 0 && <br />}
          {parts.map((part, partIndex) => (
            <React.Fragment key={`contact-part-${lineIndex}-${partIndex}`}>
              {part}
              {partIndex < parts.length - 1 && link}
            </React.Fragment>
          ))}
        </span>
      );
    });
  };

  const sections = [
    { id: "seller", title: t("legalPages.commercialTransactions.sections.seller.title"), content: tWithBreaks("legalPages.commercialTransactions.sections.seller.content") },
    { id: "administrator", title: t("legalPages.commercialTransactions.sections.administrator.title"), content: tWithBreaks("legalPages.commercialTransactions.sections.administrator.content") },
    { id: "location", title: t("legalPages.commercialTransactions.sections.location.title"), content: tWithBreaks("legalPages.commercialTransactions.sections.location.content") },
    { id: "phone", title: t("legalPages.commercialTransactions.sections.phone.title"), content: renderContactLinkContent(t("legalPages.commercialTransactions.sections.phone.content")) },
    { id: "email", title: t("legalPages.commercialTransactions.sections.email.title"), content: tWithBreaks("legalPages.commercialTransactions.sections.email.content") },
    { id: "pricing", title: t("legalPages.commercialTransactions.sections.pricing.title"), content: tWithBreaks("legalPages.commercialTransactions.sections.pricing.content") },
    { id: "additionalFees", title: t("legalPages.commercialTransactions.sections.additionalFees.title"), content: tWithBreaks("legalPages.commercialTransactions.sections.additionalFees.content") },
    { id: "paymentMethod", title: t("legalPages.commercialTransactions.sections.paymentMethod.title"), content: tWithBreaks("legalPages.commercialTransactions.sections.paymentMethod.content") },
    { id: "paymentTiming", title: t("legalPages.commercialTransactions.sections.paymentTiming.title"), content: tWithBreaks("legalPages.commercialTransactions.sections.paymentTiming.content") },
    { id: "deliveryTiming", title: t("legalPages.commercialTransactions.sections.deliveryTiming.title"), content: tWithBreaks("legalPages.commercialTransactions.sections.deliveryTiming.content") },
    { id: "cancellationPolicy", title: t("legalPages.commercialTransactions.sections.cancellationPolicy.title"), content: tWithBreaks("legalPages.commercialTransactions.sections.cancellationPolicy.content") },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <AppHeader className="border-border/30 bg-white/80" />
      
      <main className="flex-1">
        <div className="container mx-auto max-w-3xl px-4 py-12 sm:px-6">
          {/* Page Header */}
          <div className="space-y-2 text-center mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              {t("legalPages.commercialTransactions.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("legalPages.commercialTransactions.lastUpdated")}
            </p>
          </div>

          <Card className="rounded-3xl border border-primary/20 bg-white/90 shadow-[0_20px_45px_rgba(101,195,200,0.15)]">
            <CardContent className="p-6 sm:p-8">
              <div className="space-y-5">
                {sections.map((section) => (
                  <div key={section.id} id={section.id} className="border-b border-border/30 pb-5 last:border-b-0 last:pb-0">
                    <dt className="text-sm font-semibold text-foreground mb-1">
                      {section.title}
                    </dt>
                    <dd className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {section.content}
                    </dd>
                  </div>
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

export default CommercialTransactions;
