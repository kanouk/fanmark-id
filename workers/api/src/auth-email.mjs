const RESEND_API_URL = "https://api.resend.com/emails";
const AUTH_BASE_PATH = "/api/auth";

const AUTH_EMAIL_COPY = {
  verification: {
    subject: "fanmark.id メールアドレスの確認",
    intro: "メールアドレスを確認するには、次のリンクを開いてください。",
    action: "メールアドレスを確認",
  },
  passwordReset: {
    subject: "fanmark.id パスワードの再設定",
    intro: "パスワードを再設定するには、次のリンクを開いてください。",
    action: "パスワードを再設定",
  },
};
const AUTH_TEMPLATE_TYPES = Object.freeze({ verification: "signup", passwordReset: "recovery" });
const TEMPLATE_LANGUAGES = new Set(["en", "ja", "ko", "id"]);

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function containsLineBreak(value) {
  return value.includes("\r") || value.includes("\n");
}

function containsWhitespace(value) {
  for (const character of value) {
    if (character.trim() === "") return true;
  }
  return false;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function validateAuthEmailLink(env, rawUrl, kind) {
  let target;
  let base;
  try {
    base = new URL(cleanText(env.BETTER_AUTH_URL));
    target = new URL(rawUrl);
  } catch {
    throw new Error("auth_email_link_invalid");
  }
  if (base.protocol !== "https:" || target.origin !== base.origin) {
    throw new Error("auth_email_link_invalid");
  }
  if (kind === "verification" && target.pathname !== `${AUTH_BASE_PATH}/verify-email`) {
    throw new Error("auth_email_link_invalid");
  }
  if (
    kind === "passwordReset" &&
    !/^\/api\/auth\/reset-password\/[A-Za-z0-9._~-]{16,512}$/u.test(target.pathname)
  ) {
    throw new Error("auth_email_link_invalid");
  }
  const callbackURL = target.searchParams.get("callbackURL");
  if (callbackURL) {
    let callback;
    try {
      callback = new URL(callbackURL, base.origin);
    } catch {
      throw new Error("auth_email_link_invalid");
    }
    if (callback.origin !== base.origin) throw new Error("auth_email_link_invalid");
  }
  return target.href;
}

export function isResendAuthEmailConfigured(env) {
  return env.AUTH_EMAIL_BACKEND?.trim() === "resend" &&
    cleanText(env.RESEND_API_KEY).length >= 16 &&
    cleanText(env.RESEND_FROM_EMAIL).length > 0 &&
    !containsLineBreak(env.RESEND_FROM_EMAIL);
}

async function resolveAuthEmailCopy(env, kind, userId) {
  const selector = cleanText(env.AUTH_EMAIL_TEMPLATE_BACKEND);
  if (!selector) {
    const copy = AUTH_EMAIL_COPY[kind];
    return copy ? { subject: copy.subject, bodyText: copy.intro, action: copy.action } : null;
  }
  if (selector !== "d1" || env.D1_TOPOLOGY?.trim() !== "split" || !env.FANMARK_DB) {
    throw new Error("auth_email_template_unavailable");
  }

  const emailType = AUTH_TEMPLATE_TYPES[kind];
  const normalizedUserId = cleanText(userId);
  if (!emailType || !normalizedUserId || normalizedUserId.length > 128) {
    throw new Error("auth_email_template_unavailable");
  }

  try {
    const settings = await env.FANMARK_DB.prepare(`
      SELECT preferred_language FROM user_settings WHERE user_id = ? LIMIT 1
    `).bind(normalizedUserId).first();
    const preferredLanguage = settings?.preferred_language;
    const language = TEMPLATE_LANGUAGES.has(preferredLanguage) ? preferredLanguage : "ja";
    const row = await env.FANMARK_DB.prepare(`
      SELECT subject, body_text, button_text, is_active
      FROM email_templates
      WHERE email_type = ? AND language = ?
      LIMIT 1
    `).bind(emailType, language).first();
    if (!row || Number(row.is_active) !== 1 || typeof row.subject !== "string" ||
        row.subject.trim().length === 0 || row.subject.length > 256 || containsLineBreak(row.subject) ||
        typeof row.body_text !== "string" || row.body_text.length === 0 || row.body_text.length > 10_000 ||
        typeof row.button_text !== "string" || row.button_text.trim().length === 0 || row.button_text.length > 128) {
      throw new Error("auth_email_template_unavailable");
    }
    return { subject: row.subject, bodyText: row.body_text, action: row.button_text };
  } catch {
    throw new Error("auth_email_template_unavailable");
  }
}

export async function sendResendAuthEmail(env, { kind, to, url, userId }, fetchImpl = fetch) {
  const apiKey = cleanText(env.RESEND_API_KEY);
  const from = cleanText(env.RESEND_FROM_EMAIL);
  const recipient = cleanText(to);
  if (!AUTH_EMAIL_COPY[kind] || !isResendAuthEmailConfigured(env) || !recipient || containsWhitespace(recipient)) {
    throw new Error("auth_email_unavailable");
  }

  const copy = await resolveAuthEmailCopy(env, kind, userId);
  if (!copy) throw new Error("auth_email_unavailable");
  const safeUrl = validateAuthEmailLink(env, url, kind);
  const htmlUrl = escapeHtml(safeUrl);
  const htmlBody = escapeHtml(copy.bodyText).replace(/\r\n?/gu, "\n").replace(/\n/gu, "<br>");
  const html = `<p>${htmlBody}</p><p><a href="${htmlUrl}">${escapeHtml(copy.action)}</a></p>`;
  const text = `${copy.bodyText}\n\n${copy.action}: ${safeUrl}`;
  const response = await fetchImpl(RESEND_API_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from, to: [recipient], subject: copy.subject, html, text }),
  });
  if (!response.ok) throw new Error(`auth_email_provider_failed_${response.status}`);
}
