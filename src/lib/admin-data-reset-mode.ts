export class AdminDataResetModeError extends Error {
  constructor() {
    super("admin data reset mode is not supported");
    this.name = "AdminDataResetModeError";
  }
}

export function getAdminDataResetMode(
  value: string | undefined = import.meta.env?.VITE_ADMIN_DATA_RESET_BACKEND,
): "supabase" | "disabled" {
  const mode = value?.trim();
  if (!mode || mode === "supabase") return "supabase";
  if (mode === "disabled") return "disabled";
  throw new AdminDataResetModeError();
}
