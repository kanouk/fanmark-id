import { useMemo } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { Wrench } from "lucide-react";
import { LanguageToggle } from "@/components/LanguageToggle";

const formatMaintenanceTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const Maintenance = () => {
  const { t } = useTranslation();
  const { settings } = useSystemSettings();

  const scheduledEnd = useMemo(() => {
    if (!settings.maintenance_end_time) return t("maintenance.scheduledEndTbd");
    return formatMaintenanceTime(settings.maintenance_end_time);
  }, [settings.maintenance_end_time, t]);

  const message = settings.maintenance_message?.trim() || t("maintenance.description");

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-background via-background to-muted/40 px-6 py-12 text-center">
      <div className="absolute right-6 top-6">
        <LanguageToggle />
      </div>
      <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-6 rounded-3xl border border-border/60 bg-card/80 p-10 shadow-lg">
        <div className="rounded-full bg-primary/10 p-4 text-primary">
          <Wrench className="h-6 w-6" />
        </div>
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">
            {t("maintenance.title")}
          </h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            {t("maintenance.subtitle")}
          </p>
        </div>
        <div className="w-full rounded-2xl border border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
          {message}
        </div>
        <div className="w-full rounded-2xl bg-muted/40 p-4 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("maintenance.scheduledEndLabel")}
          </div>
          <div className="mt-2 text-base font-medium text-foreground">
            {scheduledEnd}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Maintenance;
