import React from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export const CommercialTransactions: React.FC = () => {
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
            <span className="text-sm">ホームに戻る</span>
          </button>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-2">
            {t("legalPages.commercialTransactions.title")}
          </h1>
          <p className="text-gray-600">{t("legalPages.commercialTransactions.lastUpdated")}</p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Introduction */}
        <p className="text-gray-700 mb-8 leading-relaxed whitespace-pre-wrap">
          {t("legalPages.commercialTransactions.introduction")}
        </p>

        {/* Sections */}
        <div className="space-y-10">
          <section className="scroll-mt-20" id="businessOperator">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.commercialTransactions.sections.businessOperator.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.commercialTransactions.sections.businessOperator.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="servicePricing">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.commercialTransactions.sections.servicePricing.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.commercialTransactions.sections.servicePricing.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="paymentMethod">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.commercialTransactions.sections.paymentMethod.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.commercialTransactions.sections.paymentMethod.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="paymentTiming">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.commercialTransactions.sections.paymentTiming.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.commercialTransactions.sections.paymentTiming.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="serviceProvision">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.commercialTransactions.sections.serviceProvision.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.commercialTransactions.sections.serviceProvision.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="cancellationPolicy">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.commercialTransactions.sections.cancellationPolicy.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.commercialTransactions.sections.cancellationPolicy.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="refundPolicy">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.commercialTransactions.sections.refundPolicy.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.commercialTransactions.sections.refundPolicy.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="contactInformation">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.commercialTransactions.sections.contactInformation.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.commercialTransactions.sections.contactInformation.content")}
            </p>
          </section>
        </div>

        {/* Last Updated */}
        <div className="mt-12 pt-8 border-t border-gray-200">
          <p className="text-sm text-gray-600">
            {t("legalPages.commercialTransactions.lastUpdated")}
          </p>
        </div>
      </div>
    </div>
  );
};

export default CommercialTransactions;
