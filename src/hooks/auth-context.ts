import { createContext } from "react";

export interface AuthUser {
  id: string;
  email?: string;
}

export interface AuthSession {
  user: AuthUser;
}

interface AuthContextType {
  user: AuthUser | null;
  session: AuthSession | null;
  loading: boolean;
  emailConfirmed: boolean;
  requiresPasswordSetup: boolean;
  profileGateError: boolean;
  setRequiresPasswordSetup: (value: boolean) => void;
  refreshSession: () => Promise<boolean>;
  signOut: () => Promise<void>;
  signingOut: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

