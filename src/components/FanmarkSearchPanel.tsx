import { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface FanmarkSearchPanelProps {
  title: ReactNode;
  label?: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function FanmarkSearchPanel({
  title,
  label,
  icon,
  badge,
  meta,
  children,
  className,
  contentClassName,
}: FanmarkSearchPanelProps) {
  return (
    <Card
      className={cn(
        "rounded-3xl border border-primary/15 bg-background/90 shadow-[0_15px_35px_rgba(101,195,200,0.12)] backdrop-blur transition-colors duration-300",
        className,
      )}
    >
      <CardHeader className="space-y-3 px-6 pt-6 pb-2">
        <CardTitle className="flex flex-col gap-3 text-lg font-semibold">
          {label && (
            <span className="text-xs uppercase tracking-[0.4em] text-muted-foreground">
              {label}
            </span>
          )}
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              {icon}
              {title}
            </span>
            {badge}
          </div>
          {meta}
        </CardTitle>
      </CardHeader>
      <CardContent className={cn(contentClassName || "px-6 pb-6")}>{children}</CardContent>
    </Card>
  );
}
