import React from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export const PrivacyPolicy: React.FC = () => {
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
            {t("legalPages.privacyPolicy.title")}
          </h1>
          <p className="text-gray-600">{t("legalPages.privacyPolicy.lastUpdated")}</p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Introduction */}
        <p className="text-gray-700 mb-8 leading-relaxed whitespace-pre-wrap">
          {t("legalPages.privacyPolicy.introduction")}
        </p>

        {/* Sections */}
        <div className="space-y-10">
          <section className="scroll-mt-20" id="informationWeCollect">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.privacyPolicy.sections.informationWeCollect.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.privacyPolicy.sections.informationWeCollect.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="howWeUseYourInformation">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.privacyPolicy.sections.howWeUseYourInformation.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.privacyPolicy.sections.howWeUseYourInformation.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="dataSharing">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.privacyPolicy.sections.dataSharing.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.privacyPolicy.sections.dataSharing.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="dataRetention">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.privacyPolicy.sections.dataRetention.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.privacyPolicy.sections.dataRetention.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="security">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.privacyPolicy.sections.security.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.privacyPolicy.sections.security.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="cookies">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.privacyPolicy.sections.cookies.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.privacyPolicy.sections.cookies.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="childrenPrivacy">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.privacyPolicy.sections.childrenPrivacy.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.privacyPolicy.sections.childrenPrivacy.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="yourRights">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.privacyPolicy.sections.yourRights.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.privacyPolicy.sections.yourRights.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="thirdPartyLinks">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.privacyPolicy.sections.thirdPartyLinks.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.privacyPolicy.sections.thirdPartyLinks.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="changesTopolicy">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.privacyPolicy.sections.changesTopolicy.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.privacyPolicy.sections.changesTopolicy.content")}
            </p>
          </section>

          <section className="scroll-mt-20" id="contactUs">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t("legalPages.privacyPolicy.sections.contactUs.title")}
            </h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
              {t("legalPages.privacyPolicy.sections.contactUs.content")}
            </p>
          </section>
        </div>

        {/* Last Updated */}
        <div className="mt-12 pt-8 border-t border-gray-200">
          <p className="text-sm text-gray-600">
            {t("legalPages.privacyPolicy.lastUpdated")}
          </p>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
