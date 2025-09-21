import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

interface AuthLayoutProps {
  title: string;
  description: string;
  children: ReactNode;
  showBackButton?: boolean;
  backTo?: string;
  backLabel?: string;
}

export const AuthLayout = ({
  title,
  description,
  children,
  showBackButton = false,
  backTo = '/',
  backLabel,
}: AuthLayoutProps) => {
  const { t } = useTranslation();

  const hasHeaderContent = Boolean(title) || Boolean(description);
  const resolvedBackLabel = backLabel ?? t('auth.homeButton');

  return (
    <div className="flex flex-col rounded-3xl border border-primary/20 bg-background/90 p-8 shadow-[0_26px_60px_rgba(101,195,200,0.18)] backdrop-blur">
      <Card className="border-none bg-transparent shadow-none">
        {hasHeaderContent && (
          <CardHeader className="space-y-2 text-center">
            {title && (
              <CardTitle className="text-2xl font-bold text-foreground">
                {title}
              </CardTitle>
            )}
            {description && (
              <CardDescription className="text-sm text-muted-foreground">
                {description}
              </CardDescription>
            )}
          </CardHeader>
        )}
        <CardContent className="p-0">
          {children}
        </CardContent>
      </Card>

      {showBackButton && (
        <div className="mt-6 flex justify-center">
          <Button variant="ghost" asChild className="gap-2 text-sm text-muted-foreground">
            <Link to={backTo}>
              <ArrowLeft className="h-4 w-4" />
              <span>{resolvedBackLabel}</span>
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
};
