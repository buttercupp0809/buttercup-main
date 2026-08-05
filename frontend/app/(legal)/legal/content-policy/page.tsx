import { LegalPage } from "@/components/legal/LegalPage";
import { LEGAL } from "@/lib/legal/config";

export const dynamic = "force-static";
export const metadata = { title: "Content and Community Policy | Poppy" };

export default function ContentPolicyPage() {
  return (
    <LegalPage title="Content and Community Policy">
      <p>
        Poppy is a mature-content platform for adults. We allow a wide range
        of creative, romantic, and sexual content between fictional adult
        characters. The following categories are always prohibited, on both
        user prompts and AI-generated output.
      </p>

      <h2>1. Zero tolerance</h2>
      <ul>
        <li>
          Any sexual content depicting minors (CSAM) or characters that appear
          to be under 18, including fictional and AI-generated depictions.
          Our systems refuse to generate such content and we report offenders
          to the applicable authorities.
        </li>
        <li>Non-consensual sexual content involving real, identifiable people.</li>
        <li>Content that sexualizes real minors or attempts to age-regress a character.</li>
        <li>Content depicting real people without their consent (deepfake-style impersonation).</li>
        <li>Bestiality, incest between family members, or other categories prohibited by our payment processors.</li>
        <li>Instructions to commit real-world violence, terrorism, or the creation of weapons capable of mass harm.</li>
        <li>Content encouraging self-harm or suicide. Crisis signals are detected before generation per California SB 243 and route to human-safety resources.</li>
      </ul>

      <h2>2. Allowed with limits</h2>
      <ul>
        <li>Explicit sexual content between adult fictional characters.</li>
        <li>Violence and dark themes framed as fiction.</li>
        <li>Roleplay of professions and public personas that are not real named individuals.</li>
      </ul>

      <h2>3. Reporting</h2>
      <p>
        Report a violation by emailing{" "}
        <a href={`mailto:${LEGAL.CONTACT_EMAIL}`}>{LEGAL.CONTACT_EMAIL}</a>{" "}
        with the character URL and a description. We review reports promptly.
      </p>

      <h2>4. Enforcement</h2>
      <p>
        Violations may result in content removal, character delisting,
        account suspension, or termination. Repeat or severe violations may
        be referred to law enforcement.
      </p>

      <h2>5. Appeals</h2>
      <p>
        You may appeal an enforcement action by replying to the enforcement
        notice email within 30 days.
      </p>
    </LegalPage>
  );
}
