// Local dev helper: grant a user an active paid plan (default "monthly" = 38
// videos / 200 images) + top up tokens, so plan-gated + token-gated media
// (video/image) can be tested. LOCAL DB ONLY. Not for production.
//
// Usage:
//   npx tsx backend/scripts/grant-plan.ts <email> [plan]
//   plan in: daily | weekly | monthly | sub_monthly | sub_yearly  (default monthly)
import path from "node:path";
import { config } from "dotenv";
config({ path: path.resolve(__dirname, "..", ".env") });
import { prisma } from "@buttercupp/database";

async function main() {
  const email = process.argv[2];
  const plan = process.argv[3] ?? "monthly";
  if (!email) {
    console.error("usage: npx tsx backend/scripts/grant-plan.ts <email> [plan]");
    console.error("  (run: npx tsx backend/scripts/list-users.ts  to see emails)");
    process.exit(1);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`no user with email ${email}`);
    process.exit(1);
  }
  const currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await prisma.subscription.upsert({
    where: { userId: user.id },
    create: { userId: user.id, provider: "dev-grant", plan, status: "active", currentPeriodEnd },
    update: { plan, status: "active", currentPeriodEnd },
  });
  const tokenBalance = Math.max((user as { tokenBalance?: number }).tokenBalance ?? 0, 5000);
  await prisma.user.update({ where: { id: user.id }, data: { tokenBalance } });
  console.log(`Granted "${plan}" (active until ${currentPeriodEnd.toISOString()}) + ${tokenBalance} tokens to ${email}.`);
  console.log("Video generation is now unblocked for this account.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
