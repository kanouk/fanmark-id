import { ReactNode } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { BrandWordmark } from '@/components/BrandWordmark';
import { BrandIcon } from '@/components/BrandIcon';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';

type SiteFooterProps = {
  className?: string;
  containerClassName?: string;
  hideBrand?: boolean;
  rightSlot?: ReactNode;
  leftSlot?: ReactNode;
};

export const SiteFooter = ({
  className,
  containerClassName,
  hideBrand = false,
  rightSlot,
  leftSlot,
}: SiteFooterProps) => {
  const { t } = useTranslation();

  return (
    <footer className={cn('border-t border-primary/10 bg-background/60 backdrop-blur-sm', className)}>
      <div className={cn('container mx-auto px-4 py-5', containerClassName)}>
        {/* Main row */}
        <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:justify-between sm:text-left">
          {/* Brand */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {!hideBrand && (
              <Link to="/" className="group flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground whitespace-nowrap">
                <BrandIcon size="xs" />
                <BrandWordmark className="text-sm" />
              </Link>
            )}
            {leftSlot}
          </div>

          {/* Links */}
          <nav className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground sm:gap-x-4">
            <Link to="/about" className="transition-colors hover:text-primary whitespace-nowrap">
              {t('legalPages.footerLinks.about')}
            </Link>
            <span className="text-border/50">·</span>
            <Link to="/contact" className="transition-colors hover:text-primary whitespace-nowrap">
              {t('legalPages.footerLinks.contactUs')}
            </Link>
            <span className="text-border/50">·</span>
            <Link to="/privacy" className="transition-colors hover:text-primary whitespace-nowrap">
              {t('legalPages.footerLinks.privacyPolicy')}
            </Link>
            <span className="text-border/50">·</span>
            <Link to="/terms" className="transition-colors hover:text-primary whitespace-nowrap">
              {t('legalPages.footerLinks.termsOfService')}
            </Link>
            <span className="text-border/50">·</span>
            <Link to="/commercial-transactions" className="transition-colors hover:text-primary whitespace-nowrap">
              {t('legalPages.footerLinks.commercialTransactions')}
            </Link>
          </nav>

          {rightSlot}
        </div>

        {/* Copyright */}
        <div className="mt-3 text-center">
          <p className="text-[10px] text-muted-foreground/60">
            © {new Date().getFullYear()} fanmark.id All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};
