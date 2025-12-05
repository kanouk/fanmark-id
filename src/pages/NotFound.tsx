import { useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Home } from "lucide-react";

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <SimpleHeader className="border-border/40 bg-background/80 backdrop-blur-xl" />

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-xl">
          <Card className="border border-primary/15 bg-background/90 shadow-[0_28px_70px_rgba(101,195,200,0.18)] backdrop-blur-md rounded-3xl overflow-hidden">
            {/* Decorative gradient header */}
            <div className="relative bg-gradient-to-r from-primary/20 via-accent/20 to-primary/10 px-8 py-10">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.4),transparent_50%)]" />
              <div className="relative text-center">
                <div className="text-8xl mb-4 animate-bounce" style={{ animationDuration: '2s' }}>
                  🔍
                </div>
                <div className="text-6xl font-bold text-primary/80 tracking-tight">
                  404
                </div>
              </div>
            </div>

            <CardContent className="px-8 py-12 text-center">
              <h1 className="text-lg font-medium text-muted-foreground leading-relaxed">
                {t('errorPages.notFound.title')}
              </h1>

              <div className="flex justify-center mt-8">
                <Button
                  onClick={() => navigate('/')}
                  className="gap-2 rounded-full px-8 py-2.5 shadow-lg transition-all duration-300 hover:shadow-xl hover:-translate-y-0.5"
                >
                  <Home className="h-4 w-4" />
                  {t('errorPages.notFound.goHome')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      <SiteFooter className="border-primary/20 bg-background/80 backdrop-blur" />
    </div>
  );
};

export default NotFound;
