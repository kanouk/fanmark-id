import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchLifecycleSettingsFromWorker,
  getLifecycleSettingsBackend,
  type LifecycleSettings,
  LifecycleSettingsApiError,
  updateGracePeriodInWorker,
} from "@/lib/lifecycle-settings-api";

const DEFAULT_SETTINGS: LifecycleSettings = { grace_period_days: 1 };

function parseDays(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9]\d{0,2}$/u.test(value)) throw new Error("invalid grace_period_days setting");
  const days = Number(value);
  if (!Number.isSafeInteger(days) || days > 365) throw new Error("invalid grace_period_days setting");
  return days;
}

async function readSupabaseSettings(): Promise<LifecycleSettings> {
  const { data, error } = await supabase
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", "grace_period_days")
    .eq("is_public", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ...DEFAULT_SETTINGS };
  return { grace_period_days: parseDays(data.setting_value) };
}

async function updateSupabaseGracePeriod(days: number): Promise<LifecycleSettings> {
  const { data, error } = await supabase
    .from("system_settings")
    .update({ setting_value: String(days) })
    .eq("setting_key", "grace_period_days")
    .eq("is_public", true)
    .select("setting_key")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("grace_period_days setting was not updated");
  const readback = await readSupabaseSettings();
  if (readback.grace_period_days !== days) throw new Error("grace_period_days readback mismatch");
  return readback;
}

export function useLifecycleSettings() {
  const [settings, setSettings] = useState<LifecycleSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const backend = getLifecycleSettingsBackend();
      const next = backend === "worker"
        ? await fetchLifecycleSettingsFromWorker()
        : await readSupabaseSettings();
      setSettings(next);
      return next;
    } catch (cause) {
      const nextError = cause instanceof Error ? cause : new LifecycleSettingsApiError("network");
      setError(nextError);
      throw nextError;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch().catch((loadError) => {
      console.error("Failed to load lifecycle settings:", loadError);
    });
  }, [refetch]);

  const updateGracePeriod = useCallback(async (days: number) => {
    if (!Number.isSafeInteger(days) || days < 1 || days > 365) {
      throw new LifecycleSettingsApiError("configuration");
    }
    const backend = getLifecycleSettingsBackend();
    const next = backend === "worker"
      ? await updateGracePeriodInWorker(days)
      : await updateSupabaseGracePeriod(days);
    setSettings(next);
    setError(null);
    return next;
  }, []);

  return { settings, loading, error, refetch, updateGracePeriod };
}
