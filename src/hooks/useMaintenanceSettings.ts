import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  defaultMaintenanceSettings,
  fetchMaintenanceSettingsFromWorker,
  getMaintenanceSettingsBackend,
  parseMaintenanceSettingsPatch,
  type MaintenanceSettings,
  type MaintenanceSettingsPatch,
  updateMaintenanceSettingsInWorker,
} from "@/lib/maintenance-settings-api";

const SETTING_KEYS = ["maintenance_mode", "maintenance_message", "maintenance_end_time"] as const;

function parseSupabaseSettings(rows: Array<{ setting_key: string; setting_value: string }>): MaintenanceSettings {
  const result = defaultMaintenanceSettings();
  for (const row of rows) {
    if (!SETTING_KEYS.includes(row.setting_key as typeof SETTING_KEYS[number])) continue;
    if (row.setting_key === "maintenance_mode") {
      if (row.setting_value !== "true" && row.setting_value !== "false") throw new Error("invalid maintenance_mode setting");
      result.maintenance_mode = row.setting_value === "true";
    } else if (row.setting_key === "maintenance_message") {
      if (row.setting_value.length > 2_000) throw new Error("invalid maintenance_message setting");
      result.maintenance_message = row.setting_value;
    } else if (row.setting_key === "maintenance_end_time") {
      if (row.setting_value && (!Number.isFinite(Date.parse(row.setting_value)) || row.setting_value.length > 64)) {
        throw new Error("invalid maintenance_end_time setting");
      }
      result.maintenance_end_time = row.setting_value || null;
    }
  }
  return result;
}

async function readSupabaseSettings(): Promise<MaintenanceSettings> {
  const { data, error } = await supabase
    .from("system_settings")
    .select("setting_key, setting_value")
    .eq("is_public", true)
    .in("setting_key", [...SETTING_KEYS]);
  if (error) throw error;
  return parseSupabaseSettings(data ?? []);
}

async function updateSupabaseSettings(patch: MaintenanceSettingsPatch): Promise<void> {
  for (const [key, value] of Object.entries(patch) as Array<[keyof MaintenanceSettingsPatch, MaintenanceSettingsPatch[keyof MaintenanceSettingsPatch]]>) {
    const settingValue = key === "maintenance_mode"
      ? (value ? "true" : "false")
      : value ?? "";
    const { error } = await supabase
      .from("system_settings")
      .update({ setting_value: String(settingValue) })
      .eq("setting_key", key)
      .eq("is_public", true);
    if (error) throw error;
  }
}

async function saveSupabaseSettings(patch: MaintenanceSettingsPatch): Promise<MaintenanceSettings> {
  await updateSupabaseSettings(patch);
  const readback = await readSupabaseSettings();
  for (const key of Object.keys(patch) as Array<keyof MaintenanceSettingsPatch>) {
    if (readback[key] !== patch[key]) throw new Error("maintenance settings readback mismatch");
  }
  return readback;
}

export function useMaintenanceSettings() {
  const [settings, setSettings] = useState<MaintenanceSettings>(defaultMaintenanceSettings);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const backend = getMaintenanceSettingsBackend();
      const next = backend === "worker"
        ? await fetchMaintenanceSettingsFromWorker()
        : await readSupabaseSettings();
      setSettings(next);
      return next;
    } catch (cause) {
      const nextError = cause instanceof Error ? cause : new Error("Failed to load maintenance settings");
      setError(nextError);
      throw nextError;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch().catch((loadError) => {
      console.error("Failed to load maintenance settings:", loadError);
    });
  }, [refetch]);

  const updateSettings = useCallback(async (rawPatch: MaintenanceSettingsPatch) => {
    const patch = parseMaintenanceSettingsPatch(rawPatch);
    const backend = getMaintenanceSettingsBackend();
    const next = backend === "worker"
      ? await updateMaintenanceSettingsInWorker(patch)
      : await saveSupabaseSettings(patch);
    setSettings(next);
    setError(null);
    return next;
  }, []);

  return { settings, loading, error, refetch, updateSettings };
}
