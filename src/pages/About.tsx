import React from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles, Heart, Shield, Globe } from "lucide-react";

export const About: React.FC = () => {
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
            <span className="text-sm">{t("legalPages.about.backToHome")}</span>
          </button>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-2">
            {t("legalPages.about.title")}
          </h1>
          <p className="text-gray-600">{t("legalPages.about.subtitle")}</p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Introduction */}
        <div className="mb-12">
          <p className="text-lg text-gray-700 leading-relaxed whitespace-pre-wrap">
            {t("legalPages.about.introduction")}
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 gap-8 mb-12">
          {/* Feature 1: Memorable IDs */}
          <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-2xl p-6 border border-gray-100">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-purple-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">
                {t("legalPages.about.features.memorable.title")}
              </h2>
            </div>
            <p className="text-gray-700 leading-relaxed">
              {t("legalPages.about.features.memorable.description")}
            </p>
          </div>

          {/* Feature 2: Easy to Share */}
          <div className="bg-gradient-to-br from-pink-50 to-purple-50 rounded-2xl p-6 border border-gray-100">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center">
                <Heart className="w-5 h-5 text-pink-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">
                {t("legalPages.about.features.easyShare.title")}
              </h2>
            </div>
            <p className="text-gray-700 leading-relaxed">
              {t("legalPages.about.features.easyShare.description")}
            </p>
          </div>

          {/* Feature 3: Flexible */}
          <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-2xl p-6 border border-gray-100">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center">
                <Shield className="w-5 h-5 text-blue-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">
                {t("legalPages.about.features.flexible.title")}
              </h2>
            </div>
            <p className="text-gray-700 leading-relaxed">
              {t("legalPages.about.features.flexible.description")}
            </p>
          </div>

          {/* Feature 4: Multilingual */}
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-6 border border-gray-100">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center">
                <Globe className="w-5 h-5 text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">
                {t("legalPages.about.features.multilingual.title")}
              </h2>
            </div>
            <p className="text-gray-700 leading-relaxed">
              {t("legalPages.about.features.multilingual.description")}
            </p>
          </div>
        </div>

        {/* How It Works */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">
            {t("legalPages.about.howItWorks.title")}
          </h2>
          <div className="space-y-6">
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-br from-purple-500 to-blue-500 text-white rounded-full flex items-center justify-center font-bold">
                1
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">
                  {t("legalPages.about.howItWorks.step1.title")}
                </h3>
                <p className="text-gray-700 leading-relaxed">
                  {t("legalPages.about.howItWorks.step1.description")}
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-br from-purple-500 to-blue-500 text-white rounded-full flex items-center justify-center font-bold">
                2
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">
                  {t("legalPages.about.howItWorks.step2.title")}
                </h3>
                <p className="text-gray-700 leading-relaxed">
                  {t("legalPages.about.howItWorks.step2.description")}
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-br from-purple-500 to-blue-500 text-white rounded-full flex items-center justify-center font-bold">
                3
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">
                  {t("legalPages.about.howItWorks.step3.title")}
                </h3>
                <p className="text-gray-700 leading-relaxed">
                  {t("legalPages.about.howItWorks.step3.description")}
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-br from-purple-500 to-blue-500 text-white rounded-full flex items-center justify-center font-bold">
                4
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">
                  {t("legalPages.about.howItWorks.step4.title")}
                </h3>
                <p className="text-gray-700 leading-relaxed">
                  {t("legalPages.about.howItWorks.step4.description")}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Use Cases */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">
            {t("legalPages.about.useCases.title")}
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-gray-50 rounded-xl p-6 border border-gray-100">
              <div className="text-3xl mb-3">🎨</div>
              <h3 className="font-semibold text-gray-900 mb-2">
                {t("legalPages.about.useCases.creators.title")}
              </h3>
              <p className="text-gray-700 text-sm leading-relaxed">
                {t("legalPages.about.useCases.creators.description")}
              </p>
            </div>

            <div className="bg-gray-50 rounded-xl p-6 border border-gray-100">
              <div className="text-3xl mb-3">🏪</div>
              <h3 className="font-semibold text-gray-900 mb-2">
                {t("legalPages.about.useCases.businesses.title")}
              </h3>
              <p className="text-gray-700 text-sm leading-relaxed">
                {t("legalPages.about.useCases.businesses.description")}
              </p>
            </div>

            <div className="bg-gray-50 rounded-xl p-6 border border-gray-100">
              <div className="text-3xl mb-3">🎮</div>
              <h3 className="font-semibold text-gray-900 mb-2">
                {t("legalPages.about.useCases.communities.title")}
              </h3>
              <p className="text-gray-700 text-sm leading-relaxed">
                {t("legalPages.about.useCases.communities.description")}
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-2xl p-8 text-center border border-gray-100">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">
            {t("legalPages.about.cta.title")}
          </h2>
          <p className="text-gray-700 mb-6 leading-relaxed">
            {t("legalPages.about.cta.description")}
          </p>
          <button
            onClick={() => navigate("/")}
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all shadow-md hover:shadow-lg"
          >
            {t("legalPages.about.cta.button")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default About;
