// Local dev helper: list accounts + their token balance and plan, so you can
// pick which one to grant a plan to (grant-plan.ts). LOCAL DB ONLY.
import path from "node:path";
import { config } from "dotenv";
config({ path: path.resolve(__dirname, "..", ".env") });
import { prisma } from "@buttercupp/database";

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, email: true, tokenBalance: true }, take: 30 });
  const subs = await prisma.subscription.findMany({ select: { userId: true, plan: true, status: true } });
  const byUser = new Map(subs.map((s) => [s.userId, s]));
  for (const u of users) {
    const s = byUser.get(u.id);
    console.log(
      `${u.email ?? "(no email)"}  tokens=${u.tokenBalance ?? 0}  plan=${s?.plan ?? "free"}  status=${s?.status ?? "-"}`,
    );
  }
  if (users.length === 0) console.log("(no users)");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
