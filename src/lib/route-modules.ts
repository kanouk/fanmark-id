// Route code can load alongside the session/maintenance checks, but its
// components and effects still mount only after the existing gates pass.
export const routeModules = {
  ForgotPassword: () => import('../pages/ForgotPassword'),
  ResetPassword: () => import('../pages/ResetPassword'),
  PasswordSetup: () => import('../pages/PasswordSetup'),
  Profile: () => import('../pages/Profile'),
  Dashboard: () => import('../pages/Dashboard'),
  FanmarkSettingsPage: () => import('../pages/FanmarkSettingsPage'),
  EmojiProfileEdit: () => import('../pages/EmojiProfileEdit'),
  FanmarkProfilePreview: () => import('../pages/FanmarkProfilePreview'),
  FanmarkMessageboardPreview: () => import('../pages/FanmarkMessageboardPreview'),
  FanmarkPublicQR: () => import('../pages/FanmarkPublicQR'),
  Favorites: () => import('../pages/Favorites'),
  Notifications: () => import('../pages/Notifications'),
  PWAApp: () => import('../pages/PWAApp'),
  PrivacyPolicy: () => import('../pages/PrivacyPolicy'),
  TermsOfService: () => import('../pages/TermsOfService'),
  ContactUs: () => import('../pages/ContactUs'),
  CommercialTransactions: () => import('../pages/CommercialTransactions'),
  About: () => import('../pages/About'),
};

const routes: Array<[RegExp, keyof typeof routeModules]> = [
  [/^\/forgot-password\/?$/i, 'ForgotPassword'],
  [/^\/reset-password\/?$/i, 'ResetPassword'],
  [/^\/password-setup\/?$/i, 'PasswordSetup'],
  [/^\/profile\/?$/i, 'Profile'],
  [/^\/dashboard\/?$/i, 'Dashboard'],
  [/^\/fanmarks\/[^/]+\/settings\/?$/i, 'FanmarkSettingsPage'],
  [/^\/fanmarks\/[^/]+\/profile\/edit\/?$/i, 'EmojiProfileEdit'],
  [/^\/fanmarks\/[^/]+\/profile\/preview\/?$/i, 'FanmarkProfilePreview'],
  [/^\/fanmarks\/[^/]+\/messageboard\/preview\/?$/i, 'FanmarkMessageboardPreview'],
  [/^\/q\/[^/]+\/?$/i, 'FanmarkPublicQR'],
  [/^\/favorites\/?$/i, 'Favorites'],
  [/^\/notifications\/?$/i, 'Notifications'],
  [/^\/pwa(?:\/(?:search|history))?\/?$/i, 'PWAApp'],
  [/^\/privacy\/?$/i, 'PrivacyPolicy'],
  [/^\/terms\/?$/i, 'TermsOfService'],
  [/^\/contact\/?$/i, 'ContactUs'],
  [/^\/commercial-transactions\/?$/i, 'CommercialTransactions'],
  [/^\/about\/?$/i, 'About'],
];

export function routeModuleForPath(pathname: string): keyof typeof routeModules | undefined {
  return routes.find(([pattern]) => pattern.test(pathname))?.[1];
}
