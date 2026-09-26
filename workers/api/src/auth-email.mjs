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

export async function sendResendAuthEmail(env, { kind, to, url }, fetchImpl = fetch) {
  const copy = AUTH_EMAIL_COPY[kind];
  const apiKey = cleanText(env.RESEND_API_KEY);
  const from = cleanText(env.RESEND_FROM_EMAIL);
  const recipient = cleanText(to);
  if (!copy || !isResendAuthEmailConfigured(env) || !recipient || containsWhitespace(recipient)) {
    throw new Error("auth_email_unavailable");
  }

  const safeUrl = validateAuthEmailLink(env, url, kind);
  const htmlUrl = escapeHtml(safeUrl);
  const html = `<p>${copy.intro}</p><p><a href="${htmlUrl}">${copy.action}</a></p>`;
  const text = `${copy.intro}\n\n${copy.action}: ${safeUrl}`;
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
