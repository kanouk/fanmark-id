import { useMemo } from 'react';
import { checkPasswordRequirements, isPasswordValid } from '@/lib/password-validation';
import { useTranslation } from '@/hooks/useTranslation';

export const usePasswordValidation = (password: string) => {
  const { t } = useTranslation();
  const requirements = useMemo(() => checkPasswordRequirements(password, t), [password, t]);
  const isValid = useMemo(() => isPasswordValid(password), [password]);
  
  return { requirements, isValid };
};