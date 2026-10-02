import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { corsHeaders, requireAdminContext } from "../_shared/admin-auth.ts";

interface ExpiredGraceLicense {
  id: string;
  fanmark_id: string;
  user_id: string;
  grace_expires_at: string;
}

const PAGE_SIZE = 200;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const context = await requireAdminContext(req, { requireMfa: true });
    if (context instanceof Response) return context;

    const cutoff = new Date().toISOString();
    const results: Array<Record<string, unknown>> = [];
    let afterId: string | null = null;
    while (true) {
      let pageQuery = context.supabase
        .from("fanmark_licenses")
        .select("id, fanmark_id, user_id, grace_expires_at")
        .eq("status", "grace")
        .lt("grace_expires_at", cutoff)
        .order("id", { ascending: true })
        .limit(PAGE_SIZE);
      if (afterId) pageQuery = pageQuery.gt("id", afterId);

      const { data: licenses, error: fetchError } = await pageQuery;
      if (fetchError) {
        console.error("Failed to fetch expired grace licenses:", fetchError);
        return jsonResponse(
          { error: "Failed to fetch expired grace licenses" },
          500,
        );
      }

      const page = (licenses ?? []) as ExpiredGraceLicense[];
      if (page.length === 0) break;

      for (const license of page) {
        afterId = license.id;
        const { data: updated, error: updateError } = await context.supabase
          .from("fanmark_licenses")
          .update({ status: "expired", updated_at: new Date().toISOString() })
          .eq("id", license.id)
          .eq("status", "grace")
          .lt("grace_expires_at", cutoff)
          .select("id")
          .maybeSingle();

        if (updateError) {
          console.error(
            "Failed to expire grace license:",
            license.id,
            updateError,
          );
          results.push({
            license_id: license.id,
            fanmark_id: license.fanmark_id,
            success: false,
            error: "license_update_failed",
          });
          continue;
        }
        if (!updated) {
          results.push({
            license_id: license.id,
            fanmark_id: license.fanmark_id,
            success: true,
            skipped: true,
          });
          continue;
        }

        const configDeleteErrors: Record<string, string | null> = {};
        for (
          const [configType, table] of [
            ["basic", "fanmark_basic_configs"],
            ["redirect", "fanmark_redirect_configs"],
            ["messageboard", "fanmark_messageboard_configs"],
            ["password", "fanmark_password_configs"],
          ] as const
        ) {
          const { error } = await context.supabase.from(table).delete().eq(
            "license_id",
            license.id,
          );
          configDeleteErrors[configType] = error?.message ?? null;
        }

        const { error: auditError } = await context.supabase.from("audit_logs")
          .insert({
            user_id: license.user_id,
            action: "MANUAL_LICENSE_EXPIRATION",
            resource_type: "fanmark_license",
            resource_id: license.id,
            metadata: {
              fanmark_id: license.fanmark_id,
              grace_expires_at: license.grace_expires_at,
              expired_by: "manual_admin_action",
              admin_user_id: context.adminUser.id,
            },
          });

        const success = !auditError &&
          Object.values(configDeleteErrors).every((error) => error === null);
        results.push({
          license_id: license.id,
          fanmark_id: license.fanmark_id,
          success,
          config_deletion_errors: configDeleteErrors,
          audit_error: auditError?.message ?? null,
        });
      }

      if (page.length < PAGE_SIZE) break;
    }

    const successCount = results.filter((result) => result.success).length;
    const failureCount = results.length - successCount;
    return jsonResponse({
      success: failureCount === 0,
      message: "Processed expired grace licenses",
      count: results.length,
      successCount,
      failureCount,
      results,
    });
  } catch (error) {
    console.error("Unexpected error in manual-expire-grace-licenses:", error);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});
