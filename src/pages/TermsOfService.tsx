import React from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export const TermsOfService: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-50 to-blue-50 border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Back to Home</span>
          </button>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-2">
            {t("legalPages.termsOfService.title")}
          </h1>
          <p className="text-gray-600">{t("legalPages.termsOfService.lastUpdated")}</p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Introduction */}
        <p className="text-gray-700 mb-8 leading-relaxed whitespace-pre-wrap">
          {t("legalPages.termsOfService.introduction")}
        </p>

        {/* Sections */}
        <div className="space-y-10">
          <section className="scroll-mt-20" id="useAgreement">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.termsOfService.sections.useAgreement.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.termsOfService.sections.useAgreement.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="accountResponsibility">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.termsOfService.sections.accountResponsibility.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.termsOfService.sections.accountResponsibility.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="fanmarkRights">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.termsOfService.sections.fanmarkRights.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.termsOfService.sections.fanmarkRights.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="fanmarkRetention">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.termsOfService.sections.fanmarkRetention.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.termsOfService.sections.fanmarkRetention.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="paymentTerms">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.termsOfService.sections.paymentTerms.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.termsOfService.sections.paymentTerms.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="userContent">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.termsOfService.sections.userContent.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.termsOfService.sections.userContent.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="intellectualProperty">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.termsOfService.sections.intellectualProperty.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.termsOfService.sections.intellectualProperty.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="limitationOfLiability">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.termsOfService.sections.limitationOfLiability.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.termsOfService.sections.limitationOfLiability.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="disclaimers">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.termsOfService.sections.disclaimers.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.termsOfService.sections.disclaimers.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="indemnification">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.termsOfService.sections.indemnification.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.termsOfService.sections.indemnification.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="suspensionTermination">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.termsOfService.sections.suspensionTermination.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.termsOfService.sections.suspensionTermination.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="governing">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.termsOfService.sections.governing.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.termsOfService.sections.governing.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="disputeResolution">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.termsOfService.sections.disputeResolution.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.termsOfService.sections.disputeResolution.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="changes">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.termsOfService.sections.changes.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.termsOfService.sections.changes.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="severability">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.termsOfService.sections.severability.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.termsOfService.sections.severability.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="entireAgreement">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.termsOfService.sections.entireAgreement.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.termsOfService.sections.entireAgreement.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="serviceTermination">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.termsOfService.sections.serviceTermination.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.termsOfService.sections.serviceTermination.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="contactUs">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.termsOfService.sections.contactUs.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.termsOfService.sections.contactUs.content")}
            </p>
          </section>
        </div>

        {/* Last Updated */}
        <div className="mt-12 pt-8 border-t border-gray-200">
          <p className="text-sm text-gray-600">
            {t("legalPages.termsOfService.lastUpdated")}
          </p>
        </div>
      </div>
    </div>
  );
};

export default TermsOfService;
