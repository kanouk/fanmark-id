import { useMemo } from 'react';
import { checkPasswordRequirements, isPasswordValid } from '@/lib/password-validation';

export const usePasswordValidation = (password: string) => {
  const requirements = useMemo(() => checkPasswordRequirements(password), [password]);
  const isValid = useMemo(() => isPasswordValid(password), [password]);
  
  return { requirements, isValid };
};