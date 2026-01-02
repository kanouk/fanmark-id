import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";
import {
  corsHeaders,
  requireAdminContext,
  logAdminAction,
  type AdminContext,
} from "../_shared/admin-auth.ts";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

// Batch size for Resend API (max 100 per batch)
const BATCH_SIZE = 50;
// Delay between batches to respect rate limits (ms)
const BATCH_DELAY_MS = 1000;

interface BroadcastRequest {
  broadcastId: string;
}

interface UserWithEmail {
  user_id: string;
  preferred_language: string;
  email: string;
}

interface EmailTemplate {
  subject: string;
  body_text: string;
  button_text: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getEmailTemplate(
  ctx: AdminContext,
  emailType: string,
  language: string
): Promise<EmailTemplate | null> {
  const { data, error } = await ctx.supabase
    .from("email_templates")
    .select("subject, body_text, button_text")
    .eq("email_type", emailType)
    .eq("language", language)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error(`Failed to get template for ${emailType}/${language}:`, error);
    return null;
  }

  return data;
}

function buildEmailHtml(
  template: EmailTemplate,
  customBody: string,
  customSubject: string
): string {
  // Use custom subject/body if provided, otherwise use template
  const body = customBody || template.body_text;
  const subject = customSubject || template.subject;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .card { background: white; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .logo { text-align: center; margin-bottom: 24px; font-size: 24px; font-weight: bold; color: #6366f1; }
    .content { white-space: pre-wrap; margin-bottom: 24px; }
    .footer { text-align: center; margin-top: 32px; padding-top: 24px; border-top: 1px solid #eee; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="logo">✨ Fanmark</div>
      <div class="content">${body.replace(/\n/g, "<br>")}</div>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Fanmark. All rights reserved.</p>
      <p>このメールは重要なサービス通知のため、配信停止はできません。</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

async function sendBatch(
  emails: Array<{ from: string; to: string; subject: string; html: string }>
): Promise<{ success: number; failed: number; errors: string[] }> {
  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  // Send emails one by one (Resend batch API has limitations)
  for (const email of emails) {
    try {
      const result = await resend.emails.send(email);
      if (result.error) {
        failed++;
        errors.push(`${email.to}: ${result.error.message}`);
        console.error(`Failed to send to ${email.to}:`, result.error);
      } else {
        success++;
        console.log(`Sent to ${email.to}`);
      }
    } catch (err) {
      failed++;
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push(`${email.to}: ${errorMsg}`);
      console.error(`Exception sending to ${email.to}:`, err);
    }
  }

  return { success, failed, errors };
}

async function processBroadcast(
  ctx: AdminContext,
  broadcastId: string
): Promise<{ success: boolean; message: string }> {
  console.log(`Processing broadcast: ${broadcastId}`);

  // Get broadcast details
  const { data: broadcast, error: broadcastError } = await ctx.supabase
    .from("broadcast_emails")
    .select("*")
    .eq("id", broadcastId)
    .single();

  if (broadcastError || !broadcast) {
    console.error("Failed to get broadcast:", broadcastError);
    return { success: false, message: "Broadcast not found" };
  }

  if (broadcast.status !== "draft" && broadcast.status !== "scheduled") {
    return { success: false, message: `Invalid status: ${broadcast.status}` };
  }

  // Update status to sending
  await ctx.supabase
    .from("broadcast_emails")
    .update({ status: "sending", started_at: new Date().toISOString() })
    .eq("id", broadcastId);

  // Get all users with their emails from auth.users via admin API
  const { data: authData, error: authError } = await ctx.supabase.auth.admin.listUsers({
    perPage: 10000,
  });

  if (authError) {
    console.error("Failed to get users:", authError);
    await ctx.supabase
      .from("broadcast_emails")
      .update({
        status: "failed",
        error_details: { message: authError.message },
        completed_at: new Date().toISOString(),
      })
      .eq("id", broadcastId);
    return { success: false, message: "Failed to get users" };
  }

  // Get user settings for language preferences
  const { data: userSettings, error: settingsError } = await ctx.supabase
    .from("user_settings")
    .select("user_id, preferred_language");

  if (settingsError) {
    console.error("Failed to get user settings:", settingsError);
  }

  const languageMap = new Map<string, string>();
  userSettings?.forEach((setting) => {
    languageMap.set(setting.user_id, setting.preferred_language);
  });

  // Build user list with emails
  const users: UserWithEmail[] = authData.users
    .filter((user) => user.email)
    .map((user) => ({
      user_id: user.id,
      email: user.email!,
      preferred_language: languageMap.get(user.id) || "ja",
    }));

  console.log(`Found ${users.length} users to email`);

  // Update total recipients
  await ctx.supabase
    .from("broadcast_emails")
    .update({ total_recipients: users.length })
    .eq("id", broadcastId);

  // Group users by language
  const usersByLanguage = new Map<string, UserWithEmail[]>();
  users.forEach((user) => {
    const lang = user.preferred_language;
    if (!usersByLanguage.has(lang)) {
      usersByLanguage.set(lang, []);
    }
    usersByLanguage.get(lang)!.push(user);
  });

  // Get templates for each language
  const templateCache = new Map<string, EmailTemplate>();
  const languages = ["ja", "en", "ko", "id"];

  for (const lang of languages) {
    const template = await getEmailTemplate(ctx, broadcast.email_type, lang);
    if (template) {
      templateCache.set(lang, template);
    }
  }

  // Fallback to Japanese if no template found
  const fallbackTemplate = templateCache.get("ja");
  if (!fallbackTemplate) {
    await ctx.supabase
      .from("broadcast_emails")
      .update({
        status: "failed",
        error_details: { message: "No template found for broadcast" },
        completed_at: new Date().toISOString(),
      })
      .eq("id", broadcastId);
    return { success: false, message: "No template found" };
  }

  let totalSuccess = 0;
  let totalFailed = 0;
  const allErrors: string[] = [];

  // Process users in batches
  const fromEmail = "Fanmark <noreply@fanmark.me>";

  for (const [lang, langUsers] of usersByLanguage) {
    const template = templateCache.get(lang) || fallbackTemplate;
    const subject = broadcast.subject || template.subject;
    const html = buildEmailHtml(template, broadcast.body_text, broadcast.subject);

    // Split into batches
    for (let i = 0; i < langUsers.length; i += BATCH_SIZE) {
      const batch = langUsers.slice(i, i + BATCH_SIZE);
      const emails = batch.map((user) => ({
        from: fromEmail,
        to: user.email,
        subject,
        html,
      }));

      console.log(`Sending batch ${Math.floor(i / BATCH_SIZE) + 1} for ${lang} (${batch.length} emails)`);

      const result = await sendBatch(emails);
      totalSuccess += result.success;
      totalFailed += result.failed;
      allErrors.push(...result.errors);

      // Update progress
      await ctx.supabase
        .from("broadcast_emails")
        .update({
          sent_count: totalSuccess,
          failed_count: totalFailed,
        })
        .eq("id", broadcastId);

      // Delay between batches
      if (i + BATCH_SIZE < langUsers.length) {
        await sleep(BATCH_DELAY_MS);
      }
    }
  }

  // Final update
  const finalStatus = totalFailed === 0 ? "completed" : totalSuccess > 0 ? "completed" : "failed";

  await ctx.supabase
    .from("broadcast_emails")
    .update({
      status: finalStatus,
      sent_count: totalSuccess,
      failed_count: totalFailed,
      error_details: allErrors.length > 0 ? { errors: allErrors.slice(0, 100) } : null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", broadcastId);

  // Log admin action
  await logAdminAction(
    ctx.supabase,
    ctx.adminUser,
    "BROADCAST_EMAIL_SENT",
    "broadcast_emails",
    broadcastId,
    {
      total_recipients: users.length,
      sent_count: totalSuccess,
      failed_count: totalFailed,
      email_type: broadcast.email_type,
    }
  );

  console.log(`Broadcast complete: ${totalSuccess} sent, ${totalFailed} failed`);

  return {
    success: true,
    message: `Sent ${totalSuccess} emails, ${totalFailed} failed`,
  };
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Require admin authentication
    const ctxOrResponse = await requireAdminContext(req);
    if (ctxOrResponse instanceof Response) {
      return ctxOrResponse;
    }
    const ctx = ctxOrResponse;

    // Parse request
    const body: BroadcastRequest = await req.json();
    const { broadcastId } = body;

    if (!broadcastId) {
      return new Response(
        JSON.stringify({ error: "broadcastId is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Process broadcast
    const result = await processBroadcast(ctx, broadcastId);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in send-broadcast-email:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
};

serve(handler);
