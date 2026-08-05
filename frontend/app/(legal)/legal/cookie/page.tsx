import { LegalPage } from "@/components/legal/LegalPage";
import { LEGAL } from "@/lib/legal/config";

export const dynamic = "force-static";
export const metadata = { title: "Cookie Policy | ButterCupp" };

export default function CookiePage() {
  return (
    <LegalPage title="Cookie Policy">
      <p>
        This policy explains the cookies ButterCupp sets and how to control them.
      </p>

      <h2>1. Strictly necessary</h2>
      <ul>
        <li>
          <strong>buttercupp_auth</strong> &mdash; HTTP-only session cookie holding
          the signed JWT that keeps you logged in. Removing it logs you out.
        </li>
      </ul>

      <h2>2. Preferences</h2>
      <p>
        We use browser <code>localStorage</code> for a small number of UI
        preferences such as the character-creation wizard draft and the theme
        toggle. Clearing site data removes them.
      </p>

      <h2>3. Analytics</h2>
      <p>
        We may set analytics cookies to measure feature usage. These are
        described further in our{" "}
        <a href="/legal/privacy" target="_blank" rel="noopener noreferrer">
          Privacy Policy
        </a>
        .
      </p>

      <h2>4. Controls</h2>
      <p>
        You can clear cookies at any time from your browser settings. Doing
        so will sign you out of ButterCupp.
      </p>

      <h2>5. Contact</h2>
      <p>
        <a href={`mailto:${LEGAL.CONTACT_EMAIL}`}>{LEGAL.CONTACT_EMAIL}</a>
      </p>
    </LegalPage>
  );
}
