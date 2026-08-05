import { LegalPage } from "@/components/legal/LegalPage";
import { LEGAL } from "@/lib/legal/config";

export const dynamic = "force-static";
export const metadata = { title: "About | Poppy" };

export default function AboutPage() {
  return (
    <LegalPage title="About Poppy">
      <p>
        Poppy is built by {LEGAL.COMPANY} to give adults the AI companion
        experience they actually want: honest, expressive, mature-friendly,
        and free of the corporate hedging that makes other chatbots feel
        like customer support.
      </p>

      <h2>Who it is for</h2>
      <p>
        Poppy is a mature-content platform limited to users aged 18 and
        older. It is not a substitute for a therapist, doctor, lawyer, or
        emergency service. Every companion is an AI; the app displays a
        persistent disclosure to make that clear.
      </p>

      <h2>How to reach us</h2>
      <p>
        See our{" "}
        <a href="/legal/contact" target="_blank" rel="noopener noreferrer">
          Contact
        </a>{" "}
        page.
      </p>
    </LegalPage>
  );
}
