import { Badge } from "@/components/ui/badge";
import { useTranslation } from "@/hooks/useTranslation";
import { cn } from "@/lib/utils";
import { Eye, Lock, Sparkles } from "lucide-react";

export type FanmarkStatus = "available" | "taken" | "unavailable";

interface FanmarkStatusBadgeProps {
  status: FanmarkStatus;
  className?: string;
}

export const FanmarkStatusBadge = ({ status, className }: FanmarkStatusBadgeProps) => {
  const { t } = useTranslation();

  const styles: Record<FanmarkStatus, { className: string; icon: JSX.Element; label: string }> = {
    available: {
      className: "border-emerald-200 bg-emerald-50 text-emerald-600",
      icon: <Sparkles className="h-4 w-4" />,
      label: t("search.available"),
    },
    taken: {
      className: "border-sky-200 bg-sky-50 text-sky-600",
      icon: <Eye className="h-4 w-4" />,
      label: t("search.taken"),
    },
    unavailable: {
      className: "border-rose-200 bg-rose-50 text-rose-600",
      icon: <Lock className="h-4 w-4" />,
      label: t("search.unavailable"),
    },
  };

  const config = styles[status];

  return (
    <Badge
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-semibold tracking-wide shadow-sm",
        "ml-auto",
        config.className,
        className,
      )}
    >
      {config.icon}
      <span>{config.label}</span>
    </Badge>
  );
};
