// Transactional email. Uses Resend when RESEND_API_KEY is set; otherwise it
// logs the message to the server console (dev fallback) so flows like password
// reset and the signup welcome work locally WITHOUT email credentials. In dev,
// grab the reset link straight from the terminal running the frontend.
//
// Env:
//   RESEND_API_KEY  - enables real sending via https://resend.com
//   EMAIL_FROM      - e.g. "Poppy <noreply@yourdomain.com>"

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

const FROM = process.env.EMAIL_FROM ?? "Poppy <onboarding@resend.dev>";

export async function sendEmail({ to, subject, html, text }: SendArgs): Promise<{ ok: boolean }> {
  const key = process.env.RESEND_API_KEY;

  // Dev fallback: no provider configured -> log and succeed so the flow works.
  if (!key) {
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
      console.error("[email] resend send failed", res.status, await res.text().catch(() => ""));
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.error("[email] send error", err);
    return { ok: false };
  }
}

// Shared brand shell so every Poppy email looks consistent.
export function emailShell(title: string, bodyHtml: string): string {
  return `<div style="font-family:ui-sans-serif,system-ui,sans-serif;background:#0b0b0f;color:#f5f5f7;padding:32px">
    <div style="max-width:480px;margin:0 auto;background:#141419;border:1px solid #26262e;border-radius:16px;padding:32px">
      <h1 style="font-size:20px;margin:0 0 8px">Poppy</h1>
      <h2 style="font-size:16px;font-weight:600;margin:16px 0 8px">${title}</h2>
      ${bodyHtml}
      <p style="color:#8a8a99;font-size:12px;margin-top:24px">Poppy is for adults 18+.</p>
    </div>
  </div>`;
}
