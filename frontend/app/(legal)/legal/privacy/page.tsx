import { LegalPage } from "@/components/legal/LegalPage";
import { LEGAL } from "@/lib/legal/config";

export const dynamic = "force-static";
export const metadata = { title: "Privacy Policy | ButterCupp" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        This Privacy Policy explains what data {LEGAL.COMPANY} collects when
        you use ButterCupp, how we use it, and the rights you have over it.
      </p>

      <h2>1. Data we collect</h2>
      <ul>
        <li>Account: email, hashed password, sign-in provider (if Google).</li>
        <li>Age and compliance: date of birth, jurisdiction, terms/privacy acceptance timestamps, and, when applicable, the age-verification vendor result.</li>
        <li>Product use: characters you interact with, messages you send, memory records extracted from those conversations, subscription/token history, and audit logs required for safety review.</li>
        <li>Device and network metadata used for abuse prevention and analytics.</li>
      </ul>

      <h2>2. How we use it</h2>
      <ul>
        <li>Operate the service (chat, voice, image, memory).</li>
        <li>Enforce our Terms and Content Policy, including crisis-detection under California SB 243.</li>
        <li>Bill you and reconcile with our payment processors.</li>
        <li>Detect fraud and abuse.</li>
        <li>Communicate service and legal notices.</li>
      </ul>

      <h2>3. Processors we share data with</h2>
      <ul>
        <li>LLM providers (OpenRouter, Anthropic, OpenAI) receive your prompts and character context to generate replies.</li>
        <li>Voice providers (ElevenLabs, Cartesia, Google) receive text for TTS.</li>
        <li>Image providers (Fal, Replicate) receive prompts and appearance references.</li>
        <li>Mature-friendly payment processors (CCBill, Verotel, SegPay, crypto) receive billing data. We do NOT use Stripe or PayPal.</li>
        <li>Age-verification vendor (when required by jurisdiction).</li>
        <li>Hosting: AWS (RDS, ECS, S3, CloudFront, Amplify).</li>
        <li>Error monitoring: Sentry.</li>
      </ul>

      <h2>4. Retention</h2>
      <p>
        We retain account data for the life of your account. Messages and
        memory records persist until you delete them from Settings or delete
        the account. Audit logs required for SB 243 or DMCA obligations are
        anonymized on account deletion but not erased.
      </p>

      <h2>5. Your rights</h2>
      <p>
        You may export your data (Settings &rarr; Export data) or delete
        your account (Settings &rarr; Delete account). If you are in a
        jurisdiction with GDPR or CCPA rights, contact us at
        {" "}
        <a href={`mailto:${LEGAL.CONTACT_EMAIL}`}>{LEGAL.CONTACT_EMAIL}</a>{" "}
        to exercise them.
      </p>

      <h2>6. Contact</h2>
      <p>
        Data controller: {LEGAL.COMPANY}, {LEGAL.JURISDICTION}.{" "}
        <a href={`mailto:${LEGAL.CONTACT_EMAIL}`}>{LEGAL.CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
