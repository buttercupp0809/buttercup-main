// Phase 34 Feature C: verify-email transactional template.
//
// Email HTML is NOT a web page. Constraints baked into this builder:
//   * Inline styles only (Gmail strips <style> blocks in many contexts).
//   * Table-based layout for cross-client rendering (Outlook 2016+ still uses
//     a Word rendering engine that ignores modern flexbox/grid).
//   * No Tailwind classes and no CSS variables. The ButterCupp design tokens
//     (see frontend/app/globals.css) are translated to hex/rgb here.
//   * A bulletproof CTA link (padded, rounded, solid rose background, white
//     text, comfortably >44px tall).
//   * A hidden preheader so inbox previews carry a one-line summary.
//   * A plain-text version that reads well on its own (Resend sends both when
//     `text` is provided).
//
// The builder is shared by the signup route (issues the first token) and the
// resend route, so the two paths cannot drift apart.

export interface VerifyEmailContent {
  subject: string;
  html: string;
  text: string;
}

// ButterCupp brand palette, translated from the app design tokens in
// frontend/app/globals.css to hex (email cannot use CSS variables). The app is
// amber/honey/cream: primary amber #fc9908 with DARK ink text on amber buttons
// (--buttercupp-primary-fg is near-black), not white. A light, warm cream email
// keeps deliverability high while reading as the current brand.
const BRAND = {
  bg: "#faf6ee",        // warm cream canvas
  card: "#ffffff",
  cardBorder: "#efe7d6", // warm hairline
  ink: "#231a10",       // warm near-black, headings + body
  muted: "#8a7d6b",     // warm gray, secondary text
  amber: "#fc9908",     // brand primary (--bc-amber)
  amberHot: "#f6812a",  // gradient end (--bc-amber-hot)
  honey: "#ffd68f",     // soft accent (--bc-honey)
  ctaText: "#231a10",   // dark ink on the amber button, matches the app
  tileBg: "#fdefd6",    // honey-tinted icon tile
  urlBg: "#f7f1e6",     // warm cream copy-link box
  urlBorder: "#efe7d6",
} as const;

// Minimal HTML escape for values interpolated into the template. We only
// interpolate the verification URL today, but centralising this keeps the
// builder safe if a caller later interpolates a user-supplied string.
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildVerifyEmail(link: string): VerifyEmailContent {
  const safeLink = escapeHtml(link);
  const preheader = "Confirm your email to unlock ButterCupp. This link expires in 24 hours.";

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>Verify your ButterCupp email</title>
  </head>
  <body style="margin:0;padding:0;background:${BRAND.bg};">
    <div style="display:none;font-size:1px;color:${BRAND.bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bg};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
            <tr>
              <td align="center" style="padding:0 0 24px 0;font-family:'Fraunces',Georgia,'Times New Roman',serif;">
                <span style="font-size:26px;font-weight:600;letter-spacing:-0.01em;color:${BRAND.amber};">ButterCupp</span>
              </td>
            </tr>
            <tr>
              <td style="background:${BRAND.card};border:1px solid ${BRAND.cardBorder};border-radius:20px;padding:40px 36px;box-shadow:0 12px 40px rgba(30, 20, 60, 0.06);">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding:0 0 20px 0;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td width="44" height="44" align="center" valign="middle" style="background:${BRAND.tileBg};border-radius:12px;font-family:Arial,Helvetica,sans-serif;color:${BRAND.amber};font-size:20px;line-height:44px;">&#9993;</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="font-family:'Fraunces',Georgia,'Times New Roman',serif;color:${BRAND.ink};font-size:28px;line-height:1.2;font-weight:600;letter-spacing:-0.01em;padding:0 0 12px 0;">
                      Verify your email
                    </td>
                  </tr>
                  <tr>
                    <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${BRAND.muted};font-size:15px;line-height:1.55;padding:0 0 28px 0;">
                      Welcome to ButterCupp. Tap the button below to confirm this address and unlock the app. This link expires in 24 hours.
                    </td>
                  </tr>
                  <tr>
                    <td align="left" style="padding:0 0 24px 0;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td align="center" style="background:${BRAND.amber};border-radius:12px;">
                            <a href="${safeLink}" style="display:inline-block;padding:14px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;line-height:1;color:${BRAND.ctaText};text-decoration:none;border-radius:12px;background:${BRAND.amber};background-image:linear-gradient(135deg, ${BRAND.amber} 0%, ${BRAND.amberHot} 100%);mso-padding-alt:14px 28px;">
                              Verify email
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${BRAND.muted};font-size:13px;line-height:1.5;padding:0 0 10px 0;">
                      Or copy this link into your browser:
                    </td>
                  </tr>
                  <tr>
                    <td style="background:${BRAND.urlBg};border:1px solid ${BRAND.urlBorder};border-radius:10px;padding:12px 14px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.45;color:${BRAND.ink};word-break:break-all;">
                      <a href="${safeLink}" style="color:${BRAND.ink};text-decoration:none;">${safeLink}</a>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:28px 0 0 0;border-top:1px solid ${BRAND.cardBorder};margin-top:28px;">
                      <div style="height:1px;background:${BRAND.cardBorder};margin:0 0 20px 0;line-height:1px;font-size:1px;">&nbsp;</div>
                      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${BRAND.muted};font-size:12px;line-height:1.55;">
                        Didn't sign up? You can safely ignore this email.
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:20px 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${BRAND.muted};font-size:11px;line-height:1.5;">
                ButterCupp is for adults 18+.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    "Verify your ButterCupp email",
    "",
    "Welcome to ButterCupp. Confirm this address to unlock the app.",
    "This link expires in 24 hours.",
    "",
    "Verify: " + link,
    "",
    "Didn't sign up? You can safely ignore this email.",
    "ButterCupp is for adults 18+.",
  ].join("\n");

  return {
    subject: "Verify your ButterCupp email",
    html,
    text,
  };
}
