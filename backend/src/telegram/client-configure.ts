import { logWarn } from "../utils/log";
import { buildApiUrl } from "./client";

async function callConfigApi(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(buildApiUrl(botToken, method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    logWarn("telegram-configure", `fetch failed method=${method}`, {
      err: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logWarn("telegram-configure", `api error method=${method} status=${res.status}`, {
      body: text,
    });
  }
}

// Sets bot name visible in contacts and chats (Bot API 6.7+).
// Best-effort: logs a warning on failure but does not throw.
export async function setMyName(botToken: string, name: string): Promise<void> {
  await callConfigApi(botToken, "setMyName", { name });
}

// Sets bot description shown in empty chats (Bot API 6.7+).
// Best-effort: logs a warning on failure but does not throw.
export async function setMyDescription(
  botToken: string,
  description: string,
): Promise<void> {
  await callConfigApi(botToken, "setMyDescription", { description });
}

// Sets bot short description shown in search and profile (Bot API 6.7+).
// Best-effort: logs a warning on failure but does not throw.
export async function setMyShortDescription(
  botToken: string,
  shortDescription: string,
): Promise<void> {
  await callConfigApi(botToken, "setMyShortDescription", {
    short_description: shortDescription,
  });
}

// Sets bot commands for the default scope.
// Best-effort: logs a warning on failure but does not throw.
export async function setMyCommands(
  botToken: string,
  commands: Array<{ command: string; description: string }>,
): Promise<void> {
  await callConfigApi(botToken, "setMyCommands", { commands });
}
