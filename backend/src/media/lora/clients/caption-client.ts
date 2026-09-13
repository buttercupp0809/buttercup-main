// VLM captioner HTTP client.
//
// POSTs an S3 image key to a vision-language model captioner endpoint running
// on the GPU box (or a separate captioning service). The endpoint URL comes
// from POPPY_CAPTION_URL.
//
// Expected request body:  { image_key: string }
// Expected response body: { caption: string }
//
// If POPPY_CAPTION_URL is not set, throws a clear "not configured" error.
// Never invents a fake caption: a fake caption would poison the LoRA training
// dataset with wrong trigger-token associations.
//
// The captioner service is box-dependent and must be brought up separately.
// This client implements the documented HTTP contract; the service itself is
// a Flask/FastAPI endpoint wrapping a VLM (e.g. LLaVA or CogVLM).

function getCaptionBase(): string {
  const url = process.env.POPPY_CAPTION_URL;
  if (!url) {
    throw new Error(
      "VLM captioner not configured: set POPPY_CAPTION_URL to the captioning endpoint (http://<box-ip>:<port>)",
    );
  }
  return url.replace(/\/$/, "");
}

/**
 * Generate a VLM caption for an S3-keyed image.
 * Returns the raw caption string (the caller prepends the trigger token).
 * Throws if POPPY_CAPTION_URL is unset or the endpoint returns a non-2xx status.
 */
export async function vlmCaption(imageKey: string): Promise<string> {
  const base = getCaptionBase();
  const res = await fetch(`${base}/caption`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image_key: imageKey }),
  });
  if (!res.ok) {
    throw new Error(`caption /caption returned ${res.status} for key ${imageKey}`);
  }
  const body = (await res.json()) as { caption?: string };
  const caption = body.caption;
  if (typeof caption !== "string" || caption.trim() === "") {
    throw new Error(`caption /caption response missing 'caption' field: ${JSON.stringify(body)}`);
  }
  return caption.trim();
}
