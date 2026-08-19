// Transactional email. Uses Resend when RESEND_API_KEY is set; otherwise it
// logs the message to the server console (dev fallback) so flows like password
// reset and the signup welcome work locally WITHOUT email credentials. In dev,
// grab the reset link straight from the terminal running the frontend.
//
// Env:
//   RESEND_API_KEY  - enables real sending via https://resend.com
//   EMAIL_FROM      - e.g. "ButterCupp <noreply@yourdomain.com>"

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

// Harden against shells/dotenv variants that preserve outer double quotes when
// a value contains angle brackets. Some email clients (and some MTAs) will pass
// the quotes straight through so the recipient sees `"ButterCupp" <...>` in the
// sender chip. Strip a single pair of surrounding quotes so both
//   EMAIL_FROM=ButterCupp <a@b>
// and
//   EMAIL_FROM="ButterCupp <a@b>"
// end up identical by the time we hand the string to Resend. The display name
// used in production is simple ASCII, so no RFC 2047 encoding is needed.
export function sanitizeEmailFrom(value: string | undefined): string {
  const raw = (value ?? "").trim();
  if (raw.length >= 2) {
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return raw.slice(1, -1).trim();
    }
  }
  return raw;
}

const FROM = sanitizeEmailFrom(process.env.EMAIL_FROM) || "ButterCupp <onboarding@resend.dev>";

export async function sendEmail({ to, subject, html, text }: SendArgs): Promise<{ ok: boolean }> {
  const key = process.env.RESEND_API_KEY;

  // No provider configured. In production this is a misconfiguration: the email
  // is silently dropped, so make it LOUD in the logs and fail the send. In dev
  // we keep the quiet log + success so local flows work without credentials.
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[email] RESEND_API_KEY missing at runtime; email NOT sent. Check Amplify console env for this branch + rebuild so it bakes into .next/server-env.json.",
        { to, subject },
      );
      return { ok: false };
    }
    console.log(
      `[email:dev] (no RESEND_API_KEY set)\n  to: ${to}\n  subject: ${subject}\n  ${text ?? html}`,
    );
    return { ok: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject, html, text: text ?? undefined }),
    });
    if (!res.ok) {
      // Surface the failure without leaking the API key or message body. We
      // pull the Resend request id + a compact {name,message} from the JSON
      // error envelope so a user hitting e.g. "from address is invalid" or
      // "domain not verified" sees it in the server log immediately.
      const requestId =
        res.headers.get("x-resend-request-id") ?? res.headers.get("x-request-id") ?? null;
      let errName: string | null = null;
      let errMessage: string | null = null;
      try {
        const body = (await res.json()) as { name?: unknown; message?: unknown };
        if (typeof body?.name === "string") errName = body.name;
        if (typeof body?.message === "string") errMessage = body.message.slice(0, 300);
      } catch {
        // non-JSON body; skip
      }
      console.error("[email] resend send failed", {
        status: res.status,
        requestId,
        errName,
        errMessage,
        fromConfigured: FROM,
      });
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    const e = err as { name?: string; message?: string };
    console.error("[email] send error", { name: e?.name, message: e?.message });
    return { ok: false };
  }
}

// Shared brand shell so every ButterCupp email looks consistent.
export function emailShell(title: string, bodyHtml: string): string {
  return `<div style="font-family:ui-sans-serif,system-ui,sans-serif;background:#0b0b0f;color:#f5f5f7;padding:32px">
    <div style="max-width:480px;margin:0 auto;background:#141419;border:1px solid #26262e;border-radius:16px;padding:32px">
      <h1 style="font-size:20px;margin:0 0 8px">ButterCupp</h1>
      <h2 style="font-size:16px;font-weight:600;margin:16px 0 8px">${title}</h2>
      ${bodyHtml}
      <p style="color:#8a8a99;font-size:12px;margin-top:24px">ButterCupp is for adults 18+.</p>
    </div>
  </div>`;
}
