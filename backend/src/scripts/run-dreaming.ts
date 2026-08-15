// Phase 30: local/manual invocation of nightly memory dreaming. Never runs
// on the hot chat-turn path (see backend/src/chat/engine.ts); this script is
// the only caller of runDreamingForAllPairs() until a real scheduler
// (BullMQ repeatable job, cron) is wired up in a later phase.
//
// Usage (local Postgres only):
//   MEMORY_DREAMING_ENABLED=true npx tsx backend/src/scripts/run-dreaming.ts

import { runDreamingForAllPairs } from "../memory/dreaming";
import { memoryDreamingEnabled } from "../config/flags";
import { logInfo, logWarn } from "../utils/log";

async function main() {
  if (!memoryDreamingEnabled()) {
    logWarn("dreaming", "MEMORY_DREAMING_ENABLED is not \"true\"; nothing to do");
    return;
  }
  const t0 = Date.now();
  const summary = await runDreamingForAllPairs();
  logInfo("dreaming", `run complete in ${Date.now() - t0}ms`, {
    pairsProcessed: summary.pairsProcessed,
    failures: summary.failures,
    edges: summary.edges,
    insights: summary.insights,
    supersessions: summary.supersessions,
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logWarn("dreaming", "run-dreaming script failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
