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
  backTo = "/",
  backLabel
}: AuthLayoutProps) => {
  const { t, tWithBreaks } = useTranslation();
  
  return (
    <div className="min-h-screen bg-muted/20 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-foreground">{t('hero.title')}</h1>
          <p className="text-muted-foreground">{tWithBreaks('hero.subtitle')}</p>
        </div>
        
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl text-center">{title}</CardTitle>
            <CardDescription className="text-center">
              {description}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {children}
          </CardContent>
        </Card>

        {showBackButton && (
          <div className="text-center">
            <Button variant="ghost" asChild>
              <Link to={backTo} className="flex items-center space-x-2">
                <ArrowLeft className="h-4 w-4" />
                <span>{backLabel || t('auth.homeButton')}</span>
              </Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
