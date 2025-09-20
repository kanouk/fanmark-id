export interface AuthFormData {
  email: string;
  password: string;
  confirmPassword?: string;
}

export interface AuthError {
  message: string;
  field?: string;
}

export interface AuthState {
  loading: boolean;
  error: string;
  awaitingConfirmation: boolean;
}