export interface PasswordRequirement {
  met: boolean;
  text: string;
}

export const checkPasswordRequirements = (password: string, t: (key: string) => string): PasswordRequirement[] => [
  { met: password.length >= 8, text: t('password.requirements.length') },
  { met: /[a-z]/.test(password), text: t('password.requirements.lowercase') },
  { met: /[A-Z]/.test(password), text: t('password.requirements.uppercase') },
  { met: /\d/.test(password), text: t('password.requirements.number') },
  { met: /[!@#$%^&*(),.?":{}|<>]/.test(password), text: t('password.requirements.special') }
];

export const isPasswordValid = (password: string): boolean => {
  // We need a dummy translation function for validation
  const dummyT = (key: string) => key;
  return checkPasswordRequirements(password, dummyT).every(req => req.met);
};