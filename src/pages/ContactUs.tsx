import React from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Mail, Twitter } from "lucide-react";

export const ContactUs: React.FC = () => {
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
            {t("contactUs.title")}
          </h1>
          <p className="text-gray-600">{t("contactUs.subtitle")}</p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="prose max-w-none">
          <p className="text-gray-700 mb-8 leading-relaxed">
            {t("contactUs.introduction")}
          </p>

          {/* Contact Methods */}
          <div className="space-y-8">
            {/* Email */}
            <div className="flex items-start gap-4 p-6 border border-gray-200 rounded-lg hover:shadow-md transition-shadow">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center h-10 w-10 rounded-md bg-purple-100">
                  <Mail className="h-6 w-6 text-purple-600" />
                </div>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  {t("contactUs.email.title")}
                </h3>
                <p className="text-gray-600 mb-3">{t("contactUs.email.description")}</p>
                <a
                  href="mailto:legal@fanmark.id"
                  className="inline-flex items-center gap-2 text-purple-600 hover:text-purple-700 font-medium transition-colors"
                >
                  legal@fanmark.id
                </a>
              </div>
            </div>

            {/* Twitter/X */}
            <div className="flex items-start gap-4 p-6 border border-gray-200 rounded-lg hover:shadow-md transition-shadow">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center h-10 w-10 rounded-md bg-blue-100">
                  <Twitter className="h-6 w-6 text-blue-600" />
                </div>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  {t("contactUs.twitter.title")}
                </h3>
                <p className="text-gray-600 mb-3">{t("contactUs.twitter.description")}</p>
                <a
                  href="https://twitter.com/fanmark_id"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium transition-colors"
                >
                  @fanmark_id
                  <span className="text-xs">↗</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContactUs;
