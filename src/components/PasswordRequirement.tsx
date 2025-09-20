import { Check, X } from "lucide-react";

interface PasswordRequirementProps {
  met: boolean;
  text: string;
}

export const PasswordRequirement = ({ met, text }: PasswordRequirementProps) => (
  <div className={`flex items-center space-x-2 text-sm ${met ? 'text-success' : 'text-base-content/60'}`}>
    {met ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
    <span>{text}</span>
  </div>
);