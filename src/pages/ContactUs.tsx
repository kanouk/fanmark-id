import React from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { Mail, ExternalLink } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Card, CardContent } from "@/components/ui/card";

// X (Twitter) icon
const XIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

export const ContactUs: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <AppHeader className="border-border/30 bg-white/80" />
      
      <main className="flex-1">
        <div className="container mx-auto max-w-3xl px-4 py-12 sm:px-6">
          {/* Page Header */}
          <div className="space-y-3 text-center mb-10">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              {t("contactUs.title")}
            </h1>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto">
              {t("contactUs.subtitle")}
            </p>
          </div>

          {/* Introduction */}
          <Card className="rounded-3xl border border-primary/20 bg-white/90 shadow-[0_20px_45px_rgba(101,195,200,0.15)] mb-8">
            <CardContent className="p-6 sm:p-8">
              <p className="text-base text-muted-foreground leading-relaxed">
                {t("contactUs.introduction")}
              </p>
            </CardContent>
          </Card>

          {/* Contact Methods */}
          <div className="space-y-5">
            {/* Email */}
            <Card className="rounded-3xl border border-primary/20 bg-white/90 shadow-[0_10px_30px_rgba(101,195,200,0.1)] hover:shadow-[0_15px_40px_rgba(101,195,200,0.15)] transition-shadow">
              <CardContent className="p-6 sm:p-8">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 bg-gradient-to-br from-primary/20 to-cyan-100 rounded-xl flex items-center justify-center shadow-sm">
                      <Mail className="h-6 w-6 text-primary" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      {t("contactUs.email.title")}
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                      {t("contactUs.email.description")}
                    </p>
                    <a
                      href="mailto:legal@fanmark.id"
                      className="inline-flex items-center gap-2 text-primary hover:text-primary/80 font-medium transition-colors"
                    >
                      legal@fanmark.id
                    </a>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* X (Twitter) */}
            <Card className="rounded-3xl border border-primary/20 bg-white/90 shadow-[0_10px_30px_rgba(101,195,200,0.1)] hover:shadow-[0_15px_40px_rgba(101,195,200,0.15)] transition-shadow">
              <CardContent className="p-6 sm:p-8">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl flex items-center justify-center shadow-sm">
                      <XIcon className="h-5 w-5 text-foreground" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      {t("contactUs.twitter.title")}
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                      {t("contactUs.twitter.description")}
                    </p>
                    <a
                      href="https://twitter.com/fanmark_id"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-foreground hover:text-primary font-medium transition-colors"
                    >
                      @fanmark_id
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <SiteFooter className="border-primary/20 bg-white/80 backdrop-blur" />
    </div>
  );
};

export default ContactUs;
