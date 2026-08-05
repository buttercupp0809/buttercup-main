import { LegalPage } from "@/components/legal/LegalPage";
import { LEGAL } from "@/lib/legal/config";

export const dynamic = "force-static";
export const metadata = { title: "DMCA Policy | ButterCupp" };

export default function DmcaPage() {
  return (
    <LegalPage title="DMCA Policy">
      <p>
        {LEGAL.COMPANY} respects the intellectual property rights of others
        and expects users of ButterCupp to do the same. We respond to notices of
        alleged copyright infringement under the U.S. Digital Millennium
        Copyright Act (DMCA).
      </p>

      <h2>1. Filing a takedown notice</h2>
      <p>
        Send a written notice to our designated agent at{" "}
        <a href={`mailto:${LEGAL.CONTACT_EMAIL}`}>{LEGAL.CONTACT_EMAIL}</a>{" "}
        containing:
      </p>
      <ol>
        <li>Your physical or electronic signature.</li>
        <li>Identification of the copyrighted work claimed to be infringed.</li>
        <li>The URL of the material on ButterCupp you are asking us to remove.</li>
        <li>Your contact information (address, telephone, email).</li>
        <li>A statement of good-faith belief that the disputed use is not authorized by the copyright owner, its agent, or the law.</li>
        <li>A statement, under penalty of perjury, that the information is accurate and that you are authorized to act on behalf of the rights holder.</li>
      </ol>

      <h2>2. Counter-notice</h2>
      <p>
        If material of yours was removed and you believe the removal was in
        error, send a counter-notice to the same address containing the
        elements required by 17 U.S.C. &sect; 512(g)(3).
      </p>

      <h2>3. Designated agent</h2>
      <p>
        <strong>Designated agent:</strong> {LEGAL.COMPANY} DMCA Agent,
        {" "}
        {LEGAL.JURISDICTION}. Email:{" "}
        <a href={`mailto:${LEGAL.CONTACT_EMAIL}`}>{LEGAL.CONTACT_EMAIL}</a>.
        The agent is registered with the U.S. Copyright Office.
      </p>

      <h2>4. Repeat infringers</h2>
      <p>
        We terminate the accounts of users we determine to be repeat
        infringers.
      </p>
    </LegalPage>
  );
}
