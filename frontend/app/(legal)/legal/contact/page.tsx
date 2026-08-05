import { LegalPage } from "@/components/legal/LegalPage";
import { LEGAL } from "@/lib/legal/config";

export const dynamic = "force-static";
export const metadata = { title: "Contact | ButterCupp" };

export default function ContactPage() {
  return (
    <LegalPage title="Contact">
      <p>
        The fastest way to reach {LEGAL.COMPANY} is by email. We do not have
        a phone support line. Response times are typically within 2 business
        days; legal, DMCA, and safety escalations are prioritized.
      </p>

      <h2>Email</h2>
      <p>
        <a href={`mailto:${LEGAL.CONTACT_EMAIL}`}>{LEGAL.CONTACT_EMAIL}</a>
      </p>

      <h2>Mailing address</h2>
      <p>
        {LEGAL.COMPANY}
        <br />
        {LEGAL.JURISDICTION}
      </p>

      <h2>Specialized channels</h2>
      <ul>
        <li>
          Copyright/DMCA: see the{" "}
          <a href="/legal/dmca" target="_blank" rel="noopener noreferrer">
            DMCA Policy
          </a>
          .
        </li>
        <li>
          Content reports: see the{" "}
          <a href="/legal/content-policy" target="_blank" rel="noopener noreferrer">
            Content and Community Policy
          </a>
          .
        </li>
        <li>
          Privacy / data rights: see the{" "}
          <a href="/legal/privacy" target="_blank" rel="noopener noreferrer">
            Privacy Policy
          </a>
          .
        </li>
      </ul>
    </LegalPage>
  );
}
