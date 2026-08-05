// SB 243 crisis gate orchestrator. This is the SINGLE chokepoint the chat
// pipeline calls. Everything below is deliberately verbose in its logging:
// SB 243 creates a $1,000-per-violation private right of action, so a
// silently dropped intervention is legally risky. Every crisis event
// writes both a CrisisEvent and an AuditLog row.

import { checkCrisis, logCrisisEvent, type CrisisLevel } from "./crisis-detector";
import { confirmCrisisWithLLM } from "./crisis-confirm";
import { writeAuditLog } from "../utils/audit";

export interface CrisisGateInput {
  userId: string;
  conversationId: string | null;
  text: string;
  ip?: string;
  userAgent?: string;
}

export interface CrisisGateResult {
  intervene: boolean;
  interventionMessage: string | null;
  promptOverride: string | null;
  responseAppend: string | null;
  level: CrisisLevel;
}

export async function runCrisisGate(input: CrisisGateInput): Promise<CrisisGateResult> {
  const fast = checkCrisis(input.text);
  if (fast.level === 0) {
    return {
      intervene: false,
      interventionMessage: null,
      promptOverride: null,
      responseAppend: null,
      level: 0,
    };
  }

  // Confirm with the LLM (max fastLevel). Skip confirmation for level 3
  // to shave latency on an unambiguous flag.
  const finalLevel: CrisisLevel =
    fast.level === 3 ? 3 : await confirmCrisisWithLLM(input.text, fast.level);
  const result = fast.level === finalLevel ? fast : checkCrisisFinal(finalLevel);

  // Persist. Both writes are fire-and-forget so a DB blip does not block
  // the intervention.
  void logCrisisEvent(
    input.userId,
    finalLevel,
    input.text.slice(0, 500),
    result.flagMessage ?? "unknown",
  );
  void writeAuditLog({
    action: "crisis.detected",
    userId: input.userId,
    resource: input.conversationId ? `conversation:${input.conversationId}` : undefined,
    metadata: { level: finalLevel, action: result.flagMessage },
    ip: input.ip,
    userAgent: input.userAgent,
  });

  const intervene = finalLevel === 3;
  return {
    intervene,
    interventionMessage: intervene ? result.immediateResponse : null,
    promptOverride: result.promptOverride,
    responseAppend: result.responseAppend,
    level: finalLevel,
  };
}

// Helper: re-run getCrisisResult logic when the LLM escalates.
import { getCrisisResult } from "./crisis-detector";
function checkCrisisFinal(level: CrisisLevel) {
  return getCrisisResult(level);
}
