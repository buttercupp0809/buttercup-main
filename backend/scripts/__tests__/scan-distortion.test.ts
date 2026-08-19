import { describe, expect, it, vi } from "vitest";
import {
  extractJsonBlob,
  parseHaikuResponse,
  shouldFlag,
  flattenManifest,
  inferPngKey,
  runScanDistortion,
  sniffImageMediaType,
  type AnthropicVisionClient,
  type FsOps,
  type Logger,
  type ManifestFile,
  type RunOptions,
  type S3Fetcher,
} from "../scan-distortion";

function makeOptions(overrides: Partial<RunOptions> = {}): RunOptions {
  return {
    manifestPath: "/tmp/manifest.json",
    reportJsonPath: "/tmp/report.json",
    reportTxtPath: "/tmp/report.txt",
    target: "local",
    minConfidence: 0.75,
    concurrency: 2,
    limit: null,
    onlyCharacters: null,
    probePngKey: true,
    maxRetries: 0,
    ...overrides,
  };
}

function makeLogger(): Logger {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function makeFs(manifest: ManifestFile): {
  fs: FsOps;
  writes: Map<string, string>;
} {
  const writes = new Map<string, string>();
  const fs: FsOps = {
    readFile: () => Buffer.from(JSON.stringify(manifest)),
    writeFile: (p, contents) => {
      writes.set(p, contents);
    },
  };
  return { fs, writes };
}

function makeAnthropicReturning(
  responses: Array<{ text: string } | { throwError: string }>,
): { client: AnthropicVisionClient; calls: number } {
  let idx = 0;
  const state = { calls: 0 };
  const client: AnthropicVisionClient = {
    messages: {
      create: async () => {
        state.calls++;
        const r = responses[Math.min(idx, responses.length - 1)];
        idx++;
        if ("throwError" in r) throw new Error(r.throwError);
        return { content: [{ type: "text", text: r.text }] };
      },
    },
  };
  return { client, calls: state.calls };
}

function makeS3(existingKeys: Record<string, Buffer>): S3Fetcher {
  return {
    fetch: async (_bucket, key) => existingKeys[key] ?? null,
  };
}

describe("extractJsonBlob", () => {
  it("returns null for empty input", () => {
    expect(extractJsonBlob("")).toBeNull();
  });
  it("strips a ```json fence", () => {
    const raw = '```json\n{"a": 1}\n```';
    expect(extractJsonBlob(raw)).toBe('{"a": 1}');
  });
  it("extracts the outermost {..} block from mixed prose", () => {
    const raw = 'Here is my judgement: {"a": {"b": 2}} thanks!';
    expect(extractJsonBlob(raw)).toBe('{"a": {"b": 2}}');
  });
});

describe("parseHaikuResponse", () => {
  it("returns null on non-JSON", () => {
    expect(parseHaikuResponse("not json at all")).toBeNull();
  });
  it("returns null when required fields are missing", () => {
    expect(parseHaikuResponse('{"distorted": true}')).toBeNull();
  });
  it("parses a complete strict JSON response", () => {
    const raw =
      '{"distorted":true,"blurry":false,"anatomy_ok":false,"confidence":0.92,"reason":"broken hand"}';
    const j = parseHaikuResponse(raw);
    expect(j).not.toBeNull();
    expect(j?.distorted).toBe(true);
    expect(j?.confidence).toBe(0.92);
  });
});

describe("shouldFlag", () => {
  const clean = {
    distorted: false,
    blurry: false,
    anatomy_ok: true,
    confidence: 0.9,
    reason: "ok",
  };
  it("does not flag clean high-confidence output", () => {
    expect(shouldFlag(clean, 0.75)).toBe(false);
  });
  it("flags distorted above threshold", () => {
    expect(shouldFlag({ ...clean, distorted: true }, 0.75)).toBe(true);
  });
  it("does not flag under the confidence threshold", () => {
    expect(shouldFlag({ ...clean, distorted: true, confidence: 0.7 }, 0.75)).toBe(false);
  });
});

describe("inferPngKey", () => {
  it("swaps .webp for .png", () => {
    expect(inferPngKey("images/personas/x/p1.webp")).toBe("images/personas/x/p1.png");
  });
  it("returns null for non-webp keys", () => {
    expect(inferPngKey("images/personas/x/p1.jpg")).toBeNull();
  });
});

describe("flattenManifest", () => {
  it("flattens the characters map into scan items", () => {
    const manifest: ManifestFile = {
      characters: {
        "char-a": [
          { variant: 1, pngPath: "/tmp/a1.png", s3Key: "images/personas/char-a/p1.webp", characterMediaId: "cm-a1" },
          { variant: 2, pngPath: "/tmp/a2.png", s3Key: "images/personas/char-a/p2.webp", characterMediaId: null },
        ],
      },
    };
    const items = flattenManifest(manifest);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ characterId: "char-a", variant: 1, webpKey: "images/personas/char-a/p1.webp" });
  });
});

describe("sniffImageMediaType", () => {
  it("detects PNG from the 8-byte signature", () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    expect(sniffImageMediaType(buf)).toBe("image/png");
  });
  it("detects WebP from the RIFF ... WEBP signature", () => {
    const buf = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
    ]);
    expect(sniffImageMediaType(buf)).toBe("image/webp");
  });
  it("detects JPEG from the SOI marker", () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(sniffImageMediaType(buf)).toBe("image/jpeg");
  });
  it("returns null for a garbage buffer", () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);
    expect(sniffImageMediaType(buf)).toBeNull();
  });
});

describe("runScanDistortion with unsupported magic bytes", () => {
  it("records an error and does not flag when magic bytes are unrecognized", async () => {
    const manifest: ManifestFile = {
      characters: {
        "char-a": [
          {
            variant: 1,
            pngPath: "/tmp/a1.png",
            s3Key: "images/personas/char-a/p1.webp",
            characterMediaId: "cm-a1",
          },
        ],
      },
    };
    const garbage = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);
    const s3: S3Fetcher = { fetch: async () => garbage };
    const anthropicCalls = vi.fn();
    const client: AnthropicVisionClient = { messages: { create: anthropicCalls } };
    const writes = new Map<string, string>();
    const fs: FsOps = {
      readFile: () => Buffer.from(JSON.stringify(manifest)),
      writeFile: (p, contents) => {
        writes.set(p, contents);
      },
    };
    const report = await runScanDistortion(
      {
        manifestPath: "/tmp/m.json",
        reportJsonPath: "/tmp/r.json",
        reportTxtPath: "/tmp/r.txt",
        target: "local",
        minConfidence: 0.75,
        concurrency: 1,
        limit: null,
        onlyCharacters: null,
        probePngKey: false,
        maxRetries: 0,
      },
      { anthropic: client, s3, fs, logger: makeLogger() },
    );
    expect(report.totals.flagged).toBe(0);
    expect(report.totals.errors).toBe(1);
    expect(report.errors[0].error).toBe("unsupported image magic bytes");
    expect(anthropicCalls).not.toHaveBeenCalled();
  });
});

describe("runScanDistortion", () => {
  const manifest: ManifestFile = {
    characters: {
      "char-a": [
        {
          variant: 1,
          pngPath: "/tmp/a1.png",
          s3Key: "images/personas/char-a/p1.webp",
          characterMediaId: "cm-a1",
        },
      ],
    },
  };

  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  const s3 = makeS3({
    "images/personas/char-a/p1.webp": bytes,
    "images/personas/char-a/p1.png": bytes,
  });

  const prevBucket = process.env.POPPY_S3_BUCKET_GENERATED;
  process.env.POPPY_S3_BUCKET_GENERATED = "test-generated";
  // Restore after tests via a Vitest afterAll hook would be nicer, but this
  // file runs in isolation and other tests already set the same env var when
  // they need it. Reset to prev if it was defined.
  if (prevBucket === undefined) {
    // leave the assignment; other tests do the same.
  }

  it("flags a distorted high-confidence response", async () => {
    const { fs, writes } = makeFs(manifest);
    const { client } = makeAnthropicReturning([
      {
        text: '{"distorted":true,"blurry":false,"anatomy_ok":false,"confidence":0.9,"reason":"melted fingers"}',
      },
    ]);
    const report = await runScanDistortion(makeOptions(), {
      anthropic: client,
      s3,
      fs,
      logger: makeLogger(),
    });
    expect(report.totals.flagged).toBe(1);
    expect(report.flagged[0].webpKey).toBe("images/personas/char-a/p1.webp");
    // Report should include both webpKey and (probed) pngKey.
    expect(report.flagged[0].pngKey).toBe("images/personas/char-a/p1.png");
    expect(report.flagged[0].confidence).toBe(0.9);
    // Files are written.
    expect(writes.has("/tmp/report.json")).toBe(true);
    expect(writes.has("/tmp/report.txt")).toBe(true);
  });

  it("does not flag a clean high-confidence response", async () => {
    const { fs } = makeFs(manifest);
    const { client } = makeAnthropicReturning([
      {
        text: '{"distorted":false,"blurry":false,"anatomy_ok":true,"confidence":0.95,"reason":"ok"}',
      },
    ]);
    const report = await runScanDistortion(makeOptions(), {
      anthropic: client,
      s3,
      fs,
      logger: makeLogger(),
    });
    expect(report.totals.flagged).toBe(0);
    expect(report.totals.clean).toBe(1);
  });

  it("marks non-JSON output as needs_review, not flagged", async () => {
    const { fs } = makeFs(manifest);
    const { client } = makeAnthropicReturning([{ text: "I cannot answer that." }]);
    const report = await runScanDistortion(makeOptions(), {
      anthropic: client,
      s3,
      fs,
      logger: makeLogger(),
    });
    expect(report.totals.flagged).toBe(0);
    expect(report.totals.needsReview).toBe(1);
    expect(report.needsReview[0].errorMessage).toMatch(/strict JSON/i);
  });

  it("respects DISTORTION_MIN_CONFIDENCE (0.7 does not flag at default 0.75)", async () => {
    const { fs } = makeFs(manifest);
    const { client } = makeAnthropicReturning([
      {
        text: '{"distorted":true,"blurry":false,"anatomy_ok":false,"confidence":0.7,"reason":"maybe"}',
      },
    ]);
    const report = await runScanDistortion(makeOptions(), {
      anthropic: client,
      s3,
      fs,
      logger: makeLogger(),
    });
    expect(report.totals.flagged).toBe(0);
    expect(report.totals.clean).toBe(1);
  });

  it("respects the LIMIT option", async () => {
    const bigManifest: ManifestFile = {
      characters: {
        "char-a": [
          { variant: 1, pngPath: "/a1.png", s3Key: "images/personas/char-a/p1.webp", characterMediaId: null },
          { variant: 2, pngPath: "/a2.png", s3Key: "images/personas/char-a/p2.webp", characterMediaId: null },
          { variant: 3, pngPath: "/a3.png", s3Key: "images/personas/char-a/p3.webp", characterMediaId: null },
        ],
      },
    };
    const { fs } = makeFs(bigManifest);
    const s3All: S3Fetcher = {
      fetch: async () => bytes,
    };
    const anthropicCalls = vi.fn(async () => ({
      content: [
        {
          type: "text",
          text: '{"distorted":false,"blurry":false,"anatomy_ok":true,"confidence":0.9,"reason":"ok"}',
        },
      ],
    }));
    const client: AnthropicVisionClient = { messages: { create: anthropicCalls } };
    const report = await runScanDistortion(makeOptions({ limit: 2 }), {
      anthropic: client,
      s3: s3All,
      fs,
      logger: makeLogger(),
    });
    expect(report.totals.scanned).toBe(2);
    expect(anthropicCalls).toHaveBeenCalledTimes(2);
  });
});
