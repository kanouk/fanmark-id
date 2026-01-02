import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import { Resend } from "npm:resend@4.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
// Handle v1, prefix that Supabase generates with webhook secrets
const rawHookSecret = Deno.env.get("SEND_EMAIL_HOOK_SECRET") as string;
const hookSecret = rawHookSecret?.startsWith("v1,") 
  ? rawHookSecret.slice(3) 
  : rawHookSecret;

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
      subject: "【ファンマID】メールアドレスの確認をお願いいたします",
      body_text: "この度はファンマIDにご登録いただき、誠にありがとうございます。\n\nアカウントの作成を完了するには、下記のボタンをクリックしてメールアドレスの確認を行ってください。\n\nこのリンクは24時間有効です。期限が切れた場合は、再度登録手続きを行ってください。",
      button_text: "メールアドレスを確認する",
    },
    en: {
      subject: "[Fanmark] Please verify your email address",
      body_text: "Thank you for signing up for Fanmark!\n\nTo complete your account registration, please click the button below to verify your email address.\n\nThis link is valid for 24 hours. If it expires, please restart the registration process.",
      button_text: "Verify Email Address",
    },
    ko: {
      subject: "[Fanmark] 이메일 주소 인증을 부탁드립니다",
      body_text: "Fanmark에 가입해 주셔서 감사합니다!\n\n계정 등록을 완료하려면 아래 버튼을 클릭하여 이메일 주소를 인증해 주세요.\n\n이 링크는 24시간 동안 유효합니다. 만료된 경우 다시 등록 절차를 진행해 주세요.",
      button_text: "이메일 주소 인증하기",
    },
    id: {
      subject: "[Fanmark] Silakan verifikasi alamat email Anda",
      body_text: "Terima kasih telah mendaftar di Fanmark!\n\nUntuk menyelesaikan pendaftaran akun Anda, silakan klik tombol di bawah untuk memverifikasi alamat email Anda.\n\nTautan ini berlaku selama 24 jam. Jika sudah kedaluwarsa, silakan ulangi proses pendaftaran.",
      button_text: "Verifikasi Alamat Email",
    },
  },
  recovery: {
    ja: {
      subject: "【ファンマID】パスワード再設定のご案内",
      body_text: "パスワード再設定のリクエストを承りました。\n\n下記のボタンをクリックして、新しいパスワードを設定してください。\n\nこのリンクは1時間有効です。期限が切れた場合は、再度パスワード再設定をリクエストしてください。\n\n※ このリクエストに心当たりがない場合は、このメールを無視してください。アカウントは安全な状態で保護されています。",
      button_text: "パスワードを再設定する",
    },
    en: {
      subject: "[Fanmark] Password Reset Request",
      body_text: "We received a request to reset your password.\n\nPlease click the button below to set a new password.\n\nThis link is valid for 1 hour. If it expires, please request a new password reset.\n\nIf you didn't request this, you can safely ignore this email. Your account remains secure.",
      button_text: "Reset Password",
    },
    ko: {
      subject: "[Fanmark] 비밀번호 재설정 안내",
      body_text: "비밀번호 재설정 요청을 받았습니다.\n\n아래 버튼을 클릭하여 새 비밀번호를 설정해 주세요.\n\n이 링크는 1시간 동안 유효합니다. 만료된 경우 다시 비밀번호 재설정을 요청해 주세요.\n\n※ 이 요청을 하지 않으셨다면 이 이메일을 무시하셔도 됩니다. 계정은 안전하게 보호되고 있습니다.",
      button_text: "비밀번호 재설정하기",
    },
    id: {
      subject: "[Fanmark] Permintaan Reset Kata Sandi",
      body_text: "Kami menerima permintaan untuk mereset kata sandi Anda.\n\nSilakan klik tombol di bawah untuk mengatur kata sandi baru.\n\nTautan ini berlaku selama 1 jam. Jika sudah kedaluwarsa, silakan minta reset kata sandi baru.\n\nJika Anda tidak meminta ini, Anda dapat mengabaikan email ini. Akun Anda tetap aman.",
      button_text: "Reset Kata Sandi",
    },
  },
  magiclink: {
    ja: {
      subject: "【ファンマID】ログインリンクのご案内",
      body_text: "ログインリンクをリクエストいただきありがとうございます。\n\n下記のボタンをクリックして、ファンマIDにログインしてください。\n\nこのリンクは15分間有効です。期限が切れた場合は、再度ログインをリクエストしてください。\n\n※ セキュリティ上の理由により、このリンクは一度のみ使用可能です。",
      button_text: "ログインする",
    },
    en: {
      subject: "[Fanmark] Your Login Link",
      body_text: "Thank you for requesting a login link.\n\nPlease click the button below to log in to Fanmark.\n\nThis link is valid for 15 minutes. If it expires, please request a new login link.\n\nFor security reasons, this link can only be used once.",
      button_text: "Log In",
    },
    ko: {
      subject: "[Fanmark] 로그인 링크 안내",
      body_text: "로그인 링크를 요청해 주셔서 감사합니다.\n\n아래 버튼을 클릭하여 Fanmark에 로그인하세요.\n\n이 링크는 15분 동안 유효합니다. 만료된 경우 다시 로그인 링크를 요청해 주세요.\n\n※ 보안상의 이유로 이 링크는 한 번만 사용할 수 있습니다.",
      button_text: "로그인하기",
    },
    id: {
      subject: "[Fanmark] Tautan Masuk Anda",
      body_text: "Terima kasih telah meminta tautan masuk.\n\nSilakan klik tombol di bawah untuk masuk ke Fanmark.\n\nTautan ini berlaku selama 15 menit. Jika sudah kedaluwarsa, silakan minta tautan masuk baru.\n\nDemi keamanan, tautan ini hanya dapat digunakan sekali.",
      button_text: "Masuk",
    },
  },
  email_change: {
    ja: {
      subject: "【ファンマID】メールアドレス変更の確認",
      body_text: "メールアドレス変更のリクエストを承りました。\n\n下記のボタンをクリックして、新しいメールアドレスを確認してください。\n\nこのリンクは24時間有効です。\n\n※ このリクエストに心当たりがない場合は、アカウントのセキュリティを確認してください。",
      button_text: "メールアドレスを確認する",
    },
    en: {
      subject: "[Fanmark] Confirm Your Email Change",
      body_text: "We received a request to change your email address.\n\nPlease click the button below to confirm your new email address.\n\nThis link is valid for 24 hours.\n\nIf you didn't request this, please check your account security.",
      button_text: "Confirm Email Address",
    },
    ko: {
      subject: "[Fanmark] 이메일 주소 변경 확인",
      body_text: "이메일 주소 변경 요청을 받았습니다.\n\n아래 버튼을 클릭하여 새 이메일 주소를 확인해 주세요.\n\n이 링크는 24시간 동안 유효합니다.\n\n※ 이 요청을 하지 않으셨다면 계정 보안을 확인해 주세요.",
      button_text: "이메일 주소 확인하기",
    },
    id: {
      subject: "[Fanmark] Konfirmasi Perubahan Email Anda",
      body_text: "Kami menerima permintaan untuk mengubah alamat email Anda.\n\nSilakan klik tombol di bawah untuk mengonfirmasi alamat email baru Anda.\n\nTautan ini berlaku selama 24 jam.\n\nJika Anda tidak meminta ini, silakan periksa keamanan akun Anda.",
      button_text: "Konfirmasi Alamat Email",
    },
  },
};

interface FooterTranslations {
  securityNote: string;
  doNotReply: string;
  needHelp: string;
  copyright: string;
}

const footerTranslations: Record<SupportedLanguage, FooterTranslations> = {
  ja: {
    securityNote: "このメールに心当たりがない場合は、無視してください。アカウントへの影響はありません。",
    doNotReply: "※ このメールは自動送信されています。返信はできませんのでご了承ください。",
    needHelp: "お困りの場合は、サポートまでお問い合わせください。",
    copyright: `© ${new Date().getFullYear()} Fanmark. All rights reserved.`,
  },
  en: {
    securityNote: "If you didn't request this, please ignore this email. Your account will not be affected.",
    doNotReply: "This is an automated message. Please do not reply to this email.",
    needHelp: "Need help? Contact our support team.",
    copyright: `© ${new Date().getFullYear()} Fanmark. All rights reserved.`,
  },
  ko: {
    securityNote: "이 요청을 하지 않으셨다면 이 이메일을 무시해 주세요. 계정에는 영향이 없습니다.",
    doNotReply: "※ 이 이메일은 자동 발송되었습니다. 회신하실 수 없습니다.",
    needHelp: "도움이 필요하시면 고객센터에 문의해 주세요.",
    copyright: `© ${new Date().getFullYear()} Fanmark. All rights reserved.`,
  },
  id: {
    securityNote: "Jika Anda tidak meminta ini, abaikan email ini. Akun Anda tidak akan terpengaruh.",
    doNotReply: "Ini adalah pesan otomatis. Mohon jangan membalas email ini.",
    needHelp: "Butuh bantuan? Hubungi tim dukungan kami.",
    copyright: `© ${new Date().getFullYear()} Fanmark. All rights reserved.`,
  },
};

function generateEmailHtml(
  template: EmailTemplate,
  actionUrl: string,
  language: SupportedLanguage = "ja"
): string {
  const footer = footerTranslations[language];
  const bodyParagraphs = template.body_text.split('\n').filter(p => p.trim()).map(p => 
    `<p style="margin: 0 0 16px; font-size: 15px; line-height: 1.7; color: #374151;">${p}</p>`
  ).join('');

  return `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <title>${template.subject}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans JP', sans-serif; background-color: #f3f4f6; -webkit-font-smoothing: antialiased;">
  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f3f4f6;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <!-- Main Container -->
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse;">
          
          <!-- Logo Header -->
          <tr>
            <td align="center" style="padding: 0 0 32px;">
              <table role="presentation" style="border-collapse: collapse;">
                <tr>
                  <td style="padding: 12px 24px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 12px;">
                    <span style="font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">Fanmark</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Email Card -->
          <tr>
            <td>
              <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);">
                
                <!-- Content Section -->
                <tr>
                  <td style="padding: 48px 40px;">
                    <!-- Subject as heading -->
                    <h1 style="margin: 0 0 24px; font-size: 22px; font-weight: 700; color: #111827; line-height: 1.4;">${template.subject.replace(/^\[Fanmark\]\s*|^【Fanmark】/, '')}</h1>
                    
                    <!-- Body paragraphs -->
                    <div style="margin: 0 0 32px;">
                      ${bodyParagraphs}
                    </div>
                    
                    <!-- CTA Button -->
                    <table role="presentation" style="width: 100%; border-collapse: collapse;">
                      <tr>
                        <td align="center" style="padding: 8px 0 24px;">
                          <a href="${actionUrl}" target="_blank" style="display: inline-block; padding: 16px 40px; font-size: 16px; font-weight: 600; color: #ffffff; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); text-decoration: none; border-radius: 10px; box-shadow: 0 4px 14px 0 rgba(99, 102, 241, 0.4);">${template.button_text}</a>
                        </td>
                      </tr>
                    </table>

                    <!-- Link fallback -->
                    <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f9fafb; border-radius: 8px;">
                      <tr>
                        <td style="padding: 16px;">
                          <p style="margin: 0 0 8px; font-size: 12px; color: #6b7280;">${language === 'ja' ? 'ボタンが機能しない場合は、以下のURLをコピーしてブラウザに貼り付けてください：' : language === 'ko' ? '버튼이 작동하지 않는 경우 아래 URL을 복사하여 브라우저에 붙여넣으세요:' : language === 'id' ? 'Jika tombol tidak berfungsi, salin dan tempel URL berikut di browser:' : 'If the button doesn\'t work, copy and paste this URL into your browser:'}</p>
                          <p style="margin: 0; font-size: 12px; word-break: break-all;"><a href="${actionUrl}" style="color: #6366f1; text-decoration: none;">${actionUrl}</a></p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Divider -->
                <tr>
                  <td style="padding: 0 40px;">
                    <div style="height: 1px; background-color: #e5e7eb;"></div>
                  </td>
                </tr>

                <!-- Footer Section -->
                <tr>
                  <td style="padding: 32px 40px;">
                    <p style="margin: 0 0 12px; font-size: 13px; line-height: 1.6; color: #6b7280;">${footer.securityNote}</p>
                    <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #9ca3af;">${footer.doNotReply}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Bottom Info -->
          <tr>
            <td align="center" style="padding: 32px 0 0;">
              <p style="margin: 0 0 8px; font-size: 12px; color: #9ca3af;">${footer.needHelp}</p>
              <p style="margin: 0; font-size: 12px; color: #9ca3af;">${footer.copyright}</p>
            </td>
          </tr>

        </table>
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

    // Build action URL using custom auth domain
    const customAuthDomain = "https://auth.fanmark.id";
    const actionUrl = `${customAuthDomain}/auth/v1/verify?token=${token_hash}&type=${email_action_type}&redirect_to=${encodeURIComponent(redirect_to)}`;

    // Generate HTML
    const html = generateEmailHtml(template, actionUrl, language);

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
