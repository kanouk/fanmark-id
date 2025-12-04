import { CheckCircle2, XCircle } from "lucide-react";

interface PasswordRequirementProps {
  met: boolean;
  text: string;
}

export const PasswordRequirement = ({ met, text }: PasswordRequirementProps) => (
  <div className={`flex items-center space-x-2 text-sm ${met ? 'text-foreground/90' : 'text-muted-foreground'}`}>
    {met ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" /> : <XCircle className="h-4 w-4 text-destructive shrink-0" />}
    <span>{text}</span>
  </div>
);