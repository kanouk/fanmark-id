import React from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { Link } from "react-router-dom";

export const Footer: React.FC = () => {
  const { t } = useTranslation();
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-gray-50 border-t border-gray-200 mt-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Copyright */}
          <p className="text-sm text-gray-600">
            © {currentYear} fanmark.id {t("common.footer") ? t("common.footer").replace("© 2025 fanmark.id", "").trim() : "All rights reserved."}
          </p>

          {/* Links */}
          <div className="flex gap-6">
            <Link
              to="/contact"
              className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              {t("legalPages.footerLinks.contactUs")}
            </Link>
            <Link
              to="/privacy"
              className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              {t("legalPages.footerLinks.privacyPolicy")}
            </Link>
            <Link
              to="/terms"
              className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              {t("legalPages.footerLinks.termsOfService")}
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
