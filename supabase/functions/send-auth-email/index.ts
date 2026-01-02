import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import { Resend } from "npm:resend@4.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const hookSecret = Deno.env.get("SEND_EMAIL_HOOK_SECRET") as string;

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type SupportedLanguage = "ja" | "en" | "ko" | "id";

interface EmailTranslations {
  subject: string;
  heading: string;
  buttonText: string;
  description: string;
  footer: string;
  expiryNote?: string;
}

const translations: Record<string, Record<SupportedLanguage, EmailTranslations>> = {
  signup: {
    ja: {
      subject: "メールアドレスの確認",
      heading: "メールアドレスを確認してください",
      buttonText: "メールアドレスを確認",
      description: "Fanmarkへのご登録ありがとうございます。以下のボタンをクリックして、メールアドレスを確認してください。",
      footer: "このメールに心当たりがない場合は、無視してください。",
      expiryNote: "このリンクは24時間有効です。",
    },
    en: {
      subject: "Confirm your email",
      heading: "Confirm your email address",
      buttonText: "Confirm Email",
      description: "Thank you for signing up for Fanmark. Click the button below to confirm your email address.",
      footer: "If you didn't sign up for this account, you can ignore this email.",
      expiryNote: "This link expires in 24 hours.",
    },
    ko: {
      subject: "이메일 주소 확인",
      heading: "이메일 주소를 확인해 주세요",
      buttonText: "이메일 확인",
      description: "Fanmark에 가입해 주셔서 감사합니다. 아래 버튼을 클릭하여 이메일 주소를 확인해 주세요.",
      footer: "이 계정에 가입한 적이 없다면 이 이메일을 무시해도 됩니다.",
      expiryNote: "이 링크는 24시간 동안 유효합니다.",
    },
    id: {
      subject: "Konfirmasi alamat email Anda",
      heading: "Konfirmasi alamat email Anda",
      buttonText: "Konfirmasi Email",
      description: "Terima kasih telah mendaftar di Fanmark. Klik tombol di bawah untuk mengonfirmasi alamat email Anda.",
      footer: "Jika Anda tidak mendaftar akun ini, Anda dapat mengabaikan email ini.",
      expiryNote: "Tautan ini berlaku selama 24 jam.",
    },
  },
  recovery: {
    ja: {
      subject: "パスワードのリセット",
      heading: "パスワードをリセット",
      buttonText: "パスワードをリセット",
      description: "パスワードリセットのリクエストを受け付けました。以下のボタンをクリックして、新しいパスワードを設定してください。",
      footer: "このリクエストに心当たりがない場合は、無視してください。パスワードは変更されません。",
      expiryNote: "このリンクは1時間有効です。",
    },
    en: {
      subject: "Reset your password",
      heading: "Reset your password",
      buttonText: "Reset Password",
      description: "We received a request to reset your password. Click the button below to set a new password.",
      footer: "If you didn't request this, you can ignore this email. Your password won't be changed.",
      expiryNote: "This link expires in 1 hour.",
    },
    ko: {
      subject: "비밀번호 재설정",
      heading: "비밀번호 재설정",
      buttonText: "비밀번호 재설정",
      description: "비밀번호 재설정 요청을 받았습니다. 아래 버튼을 클릭하여 새 비밀번호를 설정하세요.",
      footer: "이 요청을 하지 않았다면 이 이메일을 무시해도 됩니다. 비밀번호는 변경되지 않습니다.",
      expiryNote: "이 링크는 1시간 동안 유효합니다.",
    },
    id: {
      subject: "Reset kata sandi Anda",
      heading: "Reset kata sandi Anda",
      buttonText: "Reset Kata Sandi",
      description: "Kami menerima permintaan untuk mereset kata sandi Anda. Klik tombol di bawah untuk mengatur kata sandi baru.",
      footer: "Jika Anda tidak meminta ini, Anda dapat mengabaikan email ini. Kata sandi Anda tidak akan diubah.",
      expiryNote: "Tautan ini berlaku selama 1 jam.",
    },
  },
  magiclink: {
    ja: {
      subject: "ログインリンク",
      heading: "ログインリンク",
      buttonText: "ログイン",
      description: "Fanmarkへのログインリンクです。以下のボタンをクリックしてログインしてください。",
      footer: "このリンクを要求していない場合は、無視してください。",
      expiryNote: "このリンクは1時間有効です。",
    },
    en: {
      subject: "Your login link",
      heading: "Your login link",
      buttonText: "Log In",
      description: "Here's your login link for Fanmark. Click the button below to log in.",
      footer: "If you didn't request this link, you can ignore this email.",
      expiryNote: "This link expires in 1 hour.",
    },
    ko: {
      subject: "로그인 링크",
      heading: "로그인 링크",
      buttonText: "로그인",
      description: "Fanmark 로그인 링크입니다. 아래 버튼을 클릭하여 로그인하세요.",
      footer: "이 링크를 요청하지 않았다면 이 이메일을 무시해도 됩니다.",
      expiryNote: "이 링크는 1시간 동안 유효합니다.",
    },
    id: {
      subject: "Tautan login Anda",
      heading: "Tautan login Anda",
      buttonText: "Masuk",
      description: "Berikut tautan login Anda untuk Fanmark. Klik tombol di bawah untuk masuk.",
      footer: "Jika Anda tidak meminta tautan ini, Anda dapat mengabaikan email ini.",
      expiryNote: "Tautan ini berlaku selama 1 jam.",
    },
  },
  email_change: {
    ja: {
      subject: "メールアドレス変更の確認",
      heading: "新しいメールアドレスを確認",
      buttonText: "メールアドレスを確認",
      description: "メールアドレスの変更リクエストを受け付けました。以下のボタンをクリックして、新しいメールアドレスを確認してください。",
      footer: "このリクエストに心当たりがない場合は、すぐにアカウントを確認してください。",
      expiryNote: "このリンクは24時間有効です。",
    },
    en: {
      subject: "Confirm your new email",
      heading: "Confirm your new email address",
      buttonText: "Confirm Email",
      description: "We received a request to change your email address. Click the button below to confirm your new email.",
      footer: "If you didn't request this change, please check your account immediately.",
      expiryNote: "This link expires in 24 hours.",
    },
    ko: {
      subject: "새 이메일 주소 확인",
      heading: "새 이메일 주소를 확인해 주세요",
      buttonText: "이메일 확인",
      description: "이메일 주소 변경 요청을 받았습니다. 아래 버튼을 클릭하여 새 이메일 주소를 확인해 주세요.",
      footer: "이 변경을 요청하지 않았다면 즉시 계정을 확인해 주세요.",
      expiryNote: "이 링크는 24시간 동안 유효합니다.",
    },
    id: {
      subject: "Konfirmasi email baru Anda",
      heading: "Konfirmasi alamat email baru Anda",
      buttonText: "Konfirmasi Email",
      description: "Kami menerima permintaan untuk mengubah alamat email Anda. Klik tombol di bawah untuk mengonfirmasi email baru Anda.",
      footer: "Jika Anda tidak meminta perubahan ini, segera periksa akun Anda.",
      expiryNote: "Tautan ini berlaku selama 24 jam.",
    },
  },
};

function generateEmailHtml(
  t: EmailTranslations,
  actionUrl: string
): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.subject}</title>
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
              <h2 style="margin: 0 0 20px; font-size: 24px; font-weight: 600; color: #18181b;">${t.heading}</h2>
              <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #52525b;">${t.description}</p>
              <!-- Button -->
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="${actionUrl}" target="_blank" style="display: inline-block; padding: 16px 32px; font-size: 16px; font-weight: 600; color: #ffffff; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); text-decoration: none; border-radius: 8px;">${t.buttonText}</a>
                  </td>
                </tr>
              </table>
              ${t.expiryNote ? `<p style="margin: 24px 0 0; font-size: 14px; color: #71717a; text-align: center;">${t.expiryNote}</p>` : ""}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 40px 40px; border-top: 1px solid #e4e4e7;">
              <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #a1a1aa; text-align: center;">${t.footer}</p>
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

    // Map email type and get translations
    const emailType = mapEmailType(email_action_type);
    const t = translations[emailType]?.[language] || translations.signup.ja;

    // Build action URL
    const actionUrl = `${supabaseUrl}/auth/v1/verify?token=${token_hash}&type=${email_action_type}&redirect_to=${encodeURIComponent(redirect_to)}`;

    // Generate HTML
    const html = generateEmailHtml(t, actionUrl);

    // Send email
    const { error } = await resend.emails.send({
      from: "Fanmark <noreply@fanmark.id>",
      to: [user.email],
      subject: t.subject,
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
