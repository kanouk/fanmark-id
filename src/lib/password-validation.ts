export interface PasswordRequirement {
  met: boolean;
  text: string;
}

export const checkPasswordRequirements = (password: string): PasswordRequirement[] => [
  { met: password.length >= 8, text: "8文字以上" },
  { met: /[a-z]/.test(password), text: "小文字を含む" },
  { met: /[A-Z]/.test(password), text: "大文字を含む" },
  { met: /\d/.test(password), text: "数字を含む" },
  { met: /[!@#$%^&*(),.?":{}|<>]/.test(password), text: "記号を含む" }
];

export const isPasswordValid = (password: string): boolean => {
  return checkPasswordRequirements(password).every(req => req.met);
};