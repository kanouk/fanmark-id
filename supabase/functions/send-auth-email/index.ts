import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import { Resend } from "npm:resend@4.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const hookSecret = Deno.env.get("SEND_EMAIL_HOOK_SECRET") as string;

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type SupportedLanguage = "ja" | "en" | "ko" | "id";

interface EmailTemplate {
  subject: string;
  body_text: string;
  button_text: string;
}

// Fallback translations (used if DB lookup fails)
const fallbackTranslations: Record<string, Record<SupportedLanguage, EmailTemplate>> = {
  signup: {
    ja: {
      subject: "Fanmark へようこそ！メールアドレスを確認してください",
      body_text: "Fanmark へのご登録ありがとうございます。以下のボタンをクリックして、メールアドレスを確認してください。",
      button_text: "確認する",
    },
    en: {
      subject: "Welcome to Fanmark! Please verify your email",
      body_text: "Thank you for signing up for Fanmark. Please click the button below to verify your email address.",
      button_text: "Verify Email",
    },
    ko: {
      subject: "Fanmark에 오신 것을 환영합니다! 이메일을 인증해 주세요",
      body_text: "Fanmark에 가입해 주셔서 감사합니다. 아래 버튼을 클릭하여 이메일 주소를 인증해 주세요.",
      button_text: "인증하기",
    },
    id: {
      subject: "Selamat Datang di Fanmark! Silakan verifikasi email Anda",
      body_text: "Terima kasih telah mendaftar di Fanmark. Silakan klik tombol di bawah untuk memverifikasi alamat email Anda.",
      button_text: "Verifikasi",
    },
  },
  recovery: {
    ja: {
      subject: "パスワードをリセット",
      body_text: "パスワードリセットのリクエストを受け付けました。以下のボタンをクリックして、新しいパスワードを設定してください。",
      button_text: "パスワードをリセット",
    },
    en: {
      subject: "Reset Your Password",
      body_text: "We received a password reset request. Click the button below to set a new password.",
      button_text: "Reset Password",
    },
    ko: {
      subject: "비밀번호 재설정",
      body_text: "비밀번호 재설정 요청을 받았습니다. 아래 버튼을 클릭하여 새 비밀번호를 설정하세요.",
      button_text: "비밀번호 재설정",
    },
    id: {
      subject: "Reset Kata Sandi",
      body_text: "Kami menerima permintaan reset kata sandi. Klik tombol di bawah untuk mengatur kata sandi baru.",
      button_text: "Reset Kata Sandi",
    },
  },
  magiclink: {
    ja: {
      subject: "ログインリンク",
      body_text: "ログインリンクをリクエストしました。以下のボタンをクリックしてログインしてください。",
      button_text: "ログイン",
    },
    en: {
      subject: "Your Login Link",
      body_text: "You requested a login link. Click the button below to log in.",
      button_text: "Log In",
    },
    ko: {
      subject: "로그인 링크",
      body_text: "로그인 링크를 요청하셨습니다. 아래 버튼을 클릭하여 로그인하세요.",
      button_text: "로그인",
    },
    id: {
      subject: "Tautan Masuk Anda",
      body_text: "Anda meminta tautan masuk. Klik tombol di bawah untuk masuk.",
      button_text: "Masuk",
    },
  },
  email_change: {
    ja: {
      subject: "メールアドレスの変更を確認",
      body_text: "メールアドレスの変更リクエストを受け付けました。以下のボタンをクリックして確認してください。",
      button_text: "確認する",
    },
    en: {
      subject: "Confirm Email Change",
      body_text: "We received a request to change your email address. Click the button below to confirm.",
      button_text: "Confirm",
    },
    ko: {
      subject: "이메일 변경 확인",
      body_text: "이메일 주소 변경 요청을 받았습니다. 아래 버튼을 클릭하여 확인해 주세요.",
      button_text: "확인",
    },
    id: {
      subject: "Konfirmasi Perubahan Email",
      body_text: "Kami menerima permintaan untuk mengubah alamat email Anda. Klik tombol di bawah untuk mengonfirmasi.",
      button_text: "Konfirmasi",
    },
  },
};

function generateEmailHtml(
  template: EmailTemplate,
  actionUrl: string
): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${template.subject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 12px 12px 0 0;">
              <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: #ffffff;">Fanmark</h1>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 20px; font-size: 24px; font-weight: 600; color: #18181b;">${template.subject}</h2>
              <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #52525b;">${template.body_text}</p>
              <!-- Button -->
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="${actionUrl}" target="_blank" style="display: inline-block; padding: 16px 32px; font-size: 16px; font-weight: 600; color: #ffffff; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); text-decoration: none; border-radius: 8px;">${template.button_text}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 40px 40px; border-top: 1px solid #e4e4e7;">
              <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #a1a1aa; text-align: center;">このメールに心当たりがない場合は、無視してください。</p>
            </td>
          </tr>
        </table>
        <!-- Copyright -->
        <p style="margin: 24px 0 0; font-size: 12px; color: #a1a1aa;">© ${new Date().getFullYear()} Fanmark. All rights reserved.</p>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

async function getEmailTemplate(
  emailType: string,
  language: SupportedLanguage
): Promise<EmailTemplate> {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data, error } = await supabase
      .from("email_templates")
      .select("subject, body_text, button_text")
      .eq("email_type", emailType)
      .eq("language", language)
      .eq("is_active", true)
      .single();

    if (error || !data) {
      console.log(`[send-auth-email] No DB template found for ${emailType}/${language}, using fallback`);
      return fallbackTranslations[emailType]?.[language] || fallbackTranslations.signup.ja;
    }

    return {
      subject: data.subject,
      body_text: data.body_text,
      button_text: data.button_text,
    };
  } catch (error) {
    console.error("[send-auth-email] Error fetching template from DB:", error);
    return fallbackTranslations[emailType]?.[language] || fallbackTranslations.signup.ja;
  }
}

async function getUserLanguage(userId: string): Promise<SupportedLanguage> {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data, error } = await supabase
      .from("user_settings")
      .select("preferred_language")
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      console.log(`[send-auth-email] No user_settings found for ${userId}, using default language`);
      return "ja";
    }

    const lang = data.preferred_language as SupportedLanguage;
    if (["ja", "en", "ko", "id"].includes(lang)) {
      return lang;
    }
    return "ja";
  } catch (error) {
    console.error("[send-auth-email] Error fetching user language:", error);
    return "ja";
  }
}

function mapEmailType(emailActionType: string): string {
  const typeMap: Record<string, string> = {
    signup: "signup",
    recovery: "recovery",
    magiclink: "magiclink",
    email_change: "email_change",
    invite: "signup",
  };
  return typeMap[emailActionType] || "signup";
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);

  try {
    const wh = new Webhook(hookSecret);
    const {
      user,
      email_data: { token, token_hash, redirect_to, email_action_type },
    } = wh.verify(payload, headers) as {
      user: {
        id: string;
        email: string;
      };
      email_data: {
        token: string;
        token_hash: string;
        redirect_to: string;
        email_action_type: string;
        site_url: string;
        token_new: string;
        token_hash_new: string;
      };
    };

    console.log(`[send-auth-email] Processing ${email_action_type} email for user ${user.id}`);

    // Get user's preferred language
    const language = await getUserLanguage(user.id);
    console.log(`[send-auth-email] User language: ${language}`);

    // Map email type and get template from DB
    const emailType = mapEmailType(email_action_type);
    const template = await getEmailTemplate(emailType, language);

    // Build action URL
    const actionUrl = `${supabaseUrl}/auth/v1/verify?token=${token_hash}&type=${email_action_type}&redirect_to=${encodeURIComponent(redirect_to)}`;

    // Generate HTML
    const html = generateEmailHtml(template, actionUrl);

    // Send email
    const { error } = await resend.emails.send({
      from: "Fanmark <noreply@fanmark.id>",
      to: [user.email],
      subject: template.subject,
      html,
    });

    if (error) {
      console.error("[send-auth-email] Resend error:", error);
      throw error;
    }

    console.log(`[send-auth-email] Email sent successfully to ${user.email}`);

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("[send-auth-email] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const errorCode = (error as { code?: number })?.code || 500;
    
    return new Response(
      JSON.stringify({
        error: {
          http_code: errorCode,
          message: errorMessage,
        },
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
