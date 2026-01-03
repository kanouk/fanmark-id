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
  testMode?: boolean;
  testEmail?: string;
  testLanguage?: string;
}

interface RecipientFilter {
  plan_types?: string[];
  languages?: string[];
  registered_after?: string;
  registered_before?: string;
}

interface UserWithEmail {
  user_id: string;
  preferred_language: string;
  email: string;
}

interface UserSettings {
  user_id: string;
  preferred_language: string;
  plan_type: string;
  created_at: string;
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

// Send emails one by one with rate limiting (Resend allows 2 requests/second)
  const SEND_DELAY_MS = 600; // 600ms between each email to stay under 2/sec limit
  
  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
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
    
    // Add delay between emails to respect rate limit
    if (i < emails.length - 1) {
      await sleep(SEND_DELAY_MS);
    }
  }

  return { success, failed, errors };
}

async function processTestSend(
  ctx: AdminContext,
  broadcastId: string,
  testEmail: string,
  testLanguage: string
): Promise<{ success: boolean; message: string }> {
  console.log(`Processing test send for broadcast: ${broadcastId} to ${testEmail}`);

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

  // Get template for the specified language
  const template = await getEmailTemplate(ctx, broadcast.email_type, testLanguage);
  const fallbackTemplate = await getEmailTemplate(ctx, broadcast.email_type, "ja");
  const finalTemplate = template || fallbackTemplate;

  if (!finalTemplate) {
    return { success: false, message: "No template found for broadcast" };
  }

  const fromEmail = "Fanmark <noreply@fanmark.me>";
  const subject = broadcast.subject || finalTemplate.subject;
  const html = buildEmailHtml(finalTemplate, broadcast.body_text, broadcast.subject);

  try {
    const result = await resend.emails.send({
      from: fromEmail,
      to: testEmail,
      subject: `[テスト] ${subject}`,
      html,
    });

    if (result.error) {
      console.error("Test send failed:", result.error);
      return { success: false, message: `送信失敗: ${result.error.message}` };
    }

    console.log(`Test email sent to ${testEmail}`);

    // Log admin action
    await logAdminAction(
      ctx.supabase,
      ctx.adminUser,
      "BROADCAST_EMAIL_TEST_SENT",
      "broadcast_emails",
      broadcastId,
      {
        test_email: testEmail,
        test_language: testLanguage,
        email_type: broadcast.email_type,
      }
    );

    return { success: true, message: `テストメールを ${testEmail} に送信しました` };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Test send exception:", err);
    return { success: false, message: `送信失敗: ${errorMsg}` };
  }
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

  // Parse recipient filter
  const recipientFilter = broadcast.recipient_filter as RecipientFilter | null;
  const hasFilter = recipientFilter && Object.keys(recipientFilter).length > 0;

  // Get user settings for language preferences and apply filters
  let settingsQuery = ctx.supabase
    .from("user_settings")
    .select("user_id, preferred_language, plan_type, created_at");

  if (hasFilter) {
    if (recipientFilter.plan_types && recipientFilter.plan_types.length > 0) {
      settingsQuery = settingsQuery.in("plan_type", recipientFilter.plan_types);
    }
    if (recipientFilter.languages && recipientFilter.languages.length > 0) {
      settingsQuery = settingsQuery.in("preferred_language", recipientFilter.languages);
    }
    if (recipientFilter.registered_after) {
      settingsQuery = settingsQuery.gte("created_at", recipientFilter.registered_after);
    }
    if (recipientFilter.registered_before) {
      settingsQuery = settingsQuery.lte("created_at", recipientFilter.registered_before);
    }
  }

  const { data: userSettings, error: settingsError } = await settingsQuery;

  if (settingsError) {
    console.error("Failed to get user settings:", settingsError);
  }

  // Build a map of user_id -> settings for filtered users
  const userSettingsMap = new Map<string, UserSettings>();
  userSettings?.forEach((setting) => {
    userSettingsMap.set(setting.user_id, {
      user_id: setting.user_id,
      preferred_language: setting.preferred_language,
      plan_type: setting.plan_type,
      created_at: setting.created_at,
    });
  });

  // Build user list with emails (only include users that match the filter)
  const users: UserWithEmail[] = authData.users
    .filter((user) => {
      if (!user.email) return false;
      // If there's a filter, only include users who are in the filtered settings
      if (hasFilter) {
        return userSettingsMap.has(user.id);
      }
      return true;
    })
    .map((user) => ({
      user_id: user.id,
      email: user.email!,
      preferred_language: userSettingsMap.get(user.id)?.preferred_language || "ja",
    }));

  console.log(`Found ${users.length} users to email (filter applied: ${hasFilter})`);
  if (hasFilter) {
    console.log(`Filter: ${JSON.stringify(recipientFilter)}`);
  }

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
      recipient_filter: hasFilter ? recipientFilter : null,
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
    const { broadcastId, testMode, testEmail, testLanguage } = body;

    if (!broadcastId) {
      return new Response(
        JSON.stringify({ error: "broadcastId is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let result: { success: boolean; message: string };

    if (testMode && testEmail) {
      // Test send mode
      result = await processTestSend(ctx, broadcastId, testEmail, testLanguage || "ja");
    } else {
      // Normal broadcast mode
      result = await processBroadcast(ctx, broadcastId);
    }

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
