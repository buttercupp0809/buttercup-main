import { logWarn } from "../utils/log";

const TELEGRAM_API = "https://api.telegram.org";

export function buildApiUrl(botToken: string, method: string): string {
  return `${TELEGRAM_API}/bot${botToken}/${method}`;
}

async function callApi(
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
    logWarn("telegram", `fetch failed method=${method}`, {
      err: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logWarn("telegram", `api error method=${method} status=${res.status}`, { body: text });
  }
}

export async function sendMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<void> {
  await callApi(botToken, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  });
}

export async function sendPhoto(
  botToken: string,
  chatId: string,
  photoUrl: string,
  caption?: string,
): Promise<void> {
  await callApi(botToken, "sendPhoto", {
    chat_id: chatId,
    photo: photoUrl,
    ...(caption ? { caption } : {}),
  });
}

export async function sendChatAction(
  botToken: string,
  chatId: string,
  action: "typing" | "upload_photo",
): Promise<void> {
  await callApi(botToken, "sendChatAction", { chat_id: chatId, action });
}

export async function setWebhook(
  botToken: string,
  webhookUrl: string,
  secretToken: string,
): Promise<void> {
  await callApi(botToken, "setWebhook", {
    url: webhookUrl,
    secret_token: secretToken,
    allowed_updates: ["message"],
  });
}

// Sets the bot's profile photo from a publicly accessible URL.
// Telegram requires the photo to be downloaded first, then uploaded as multipart.
// This is a best-effort call; failures are logged but not thrown.
export async function setMyPhoto(botToken: string, photoUrl: string): Promise<void> {
  try {
    const imgRes = await fetch(photoUrl);
    if (!imgRes.ok) {
      logWarn("telegram", `setMyPhoto fetch failed status=${imgRes.status}`);
      return;
    }
    const blob = await imgRes.blob();
    const form = new FormData();
    form.append("photo", blob, "photo.jpg");
    const apiRes = await fetch(buildApiUrl(botToken, "setMyPhoto"), {
      method: "POST",
      body: form,
    });
    if (!apiRes.ok) {
      const text = await apiRes.text().catch(() => "");
      logWarn("telegram", `setMyPhoto api error status=${apiRes.status}`, { body: text });
    }
  } catch (err) {
    logWarn("telegram", `setMyPhoto error`, {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
