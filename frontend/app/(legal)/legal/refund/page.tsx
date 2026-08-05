import { LegalPage } from "@/components/legal/LegalPage";
import { LEGAL } from "@/lib/legal/config";

export const dynamic = "force-static";
export const metadata = { title: "Refund Policy | ButterCupp" };

export default function RefundPage() {
  return (
    <LegalPage title="Refund Policy">
      <p>
        ButterCupp sells time-boxed access via duration passes and token packs.
        This policy explains when purchases are refundable.
      </p>

      <h2>1. Duration passes</h2>
      <p>
        Daily, Weekly, and Monthly passes are digital services delivered
        immediately on purchase. They are non-refundable once activated. If
        activation failed (for example, the pass never applied to your
        account despite a completed charge), contact us and we will
        remediate.
      </p>

      <h2>2. Token packs</h2>
      <p>
        Tokens are consumable credits used for voice notes, images, and
        premium-model messages. Unused tokens are non-refundable. If tokens
        were debited but the underlying job failed for a reason on our side,
        the system automatically refunds the ledger; if you notice a
        discrepancy, contact us.
      </p>

      <h2>3. Chargebacks</h2>
      <p>
        Filing a chargeback without first contacting us may result in
        account termination. We would much rather solve the issue directly.
      </p>

      <h2>4. Free chats</h2>
      <p>
        The 10 free chats are complimentary; they are not a purchased good
        and are not eligible for refund or cash equivalent.
      </p>

      <h2>5. How to request</h2>
      <p>
        Email{" "}
        <a href={`mailto:${LEGAL.CONTACT_EMAIL}`}>{LEGAL.CONTACT_EMAIL}</a>{" "}
        from the address on your account, including the order id and a
        description. We reply within 5 business days.
      </p>

      <h2>6. Statutory rights</h2>
      <p>
        Nothing in this policy limits any non-waivable rights you have under
        the consumer-protection laws of {LEGAL.JURISDICTION} or your local
        jurisdiction.
      </p>
    </LegalPage>
  );
}
