import { ReactNode } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { BrandWordmark } from '@/components/BrandWordmark';
import { BrandIcon } from '@/components/BrandIcon';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';

type SiteFooterProps = {
  className?: string;
  containerClassName?: string;
  descriptionKey?: string | null;
  description?: ReactNode;
  hideBrand?: boolean;
  rightSlot?: ReactNode;
  leftSlot?: ReactNode;
};

export const SiteFooter = ({
  className,
  containerClassName,
  descriptionKey = 'layout.footer.description',
  description,
  hideBrand = false,
  rightSlot,
  leftSlot,
}: SiteFooterProps) => {
  const { t } = useTranslation();
  const resolvedDescription = description ?? (descriptionKey ? t(descriptionKey) : null);

  return (
    <footer className={cn('border-t border-border/40 bg-background/80 backdrop-blur', className)}>
      <div className={cn('container mx-auto px-4 py-10 text-center space-y-4', containerClassName)}>
        <div className="flex items-center justify-center gap-2 text-2xl font-bold text-primary">
          {!hideBrand && (
            <>
              <BrandIcon size="md" />
              <BrandWordmark />
            </>
          )}
          {leftSlot}
          {rightSlot}
        </div>
        {resolvedDescription && (
          <p className="text-sm text-muted-foreground">{resolvedDescription}</p>
        )}

        {/* Links */}
        <div className="flex items-center justify-center gap-4 pt-2">
          <Link
            to="/contact"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("legalPages.footerLinks.contactUs")}
          </Link>
          <span className="text-muted-foreground/30">•</span>
          <Link
            to="/privacy"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("legalPages.footerLinks.privacyPolicy")}
          </Link>
          <span className="text-muted-foreground/30">•</span>
          <Link
            to="/terms"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("legalPages.footerLinks.termsOfService")}
          </Link>
        </div>
      </div>
    </footer>
  );
};

