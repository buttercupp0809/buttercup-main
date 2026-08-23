"use client";

// Interactive Create Video form. Picks a companion, collects a prompt and
// render options, enqueues an image-to-video job on the backend, then polls
// the media-asset status endpoint until the clip is ready (or fails).
//
// Backend contract (owned by another agent, treated as fixed):
//   POST ${NEXT_PUBLIC_BACKEND_URL}/media/video  credentials:"include"
//     body: { characterId, payload: { userRequest, mode:"i2v", seconds,
//             aspectRatio, quality, sceneMode } }
//     -> { jobId, mediaAssetId, status:"queued" }
//   GET  ${NEXT_PUBLIC_BACKEND_URL}/media/:mediaAssetId  credentials:"include"
//     -> { id, kind, status, url, createdAt }  (status: queued|processing|
//        ready|failed; url present when ready)
// The returned url is signed S3; we render it through the same-origin proxy
// /api/media?k=<s3Key> so the <video> tag stays same-origin (mirrors how the
// media worker builds URLs). We fall back to the direct url if no s3Key is
// present.

import * as React from "react";
import Link from "next/link";
import { Film, Loader2, AlertTriangle, ArrowRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";
const POLL_MS = 2500;
const MAX_POLLS = 480; // ~20 minutes; "max" quality can take 8-15 min

type AspectRatio = "portrait" | "landscape" | "square";
type Seconds = 3 | 5 | 8;
type Quality = "fast" | "balanced" | "max";
type SceneMode = "transform" | "keep";

type Phase = "idle" | "generating" | "ready" | "failed";

export interface CreateVideoCharacter {
  id: string;
  name: string;
  avatarUrl: string | null;
}

interface EnqueueResponse {
  jobId: string;
  mediaAssetId: string;
  status: string;
}

interface MediaAsset {
  id: string;
  kind: string;
  status: "queued" | "processing" | "ready" | "failed" | string;
  url: string | null;
  s3Key?: string | null;
  createdAt: string;
}

const ASPECTS: { value: AspectRatio; label: string; ratio: string; box: string }[] = [
  { value: "portrait", label: "Portrait", ratio: "9:16", box: "aspect-[9/16] w-4" },
  { value: "landscape", label: "Landscape", ratio: "16:9", box: "aspect-[16/9] w-7" },
  { value: "square", label: "Square", ratio: "1:1", box: "aspect-square w-5" },
];

const DURATIONS: { value: Seconds; label: string }[] = [
  { value: 3, label: "3s" },
  { value: 5, label: "5s" },
  { value: 8, label: "8s" },
];

const SCENE_MODES: { value: SceneMode; label: string; hint: string }[] = [
  { value: "transform", label: "Transform scene", hint: "New outfit/scene from your prompt" },
  { value: "keep", label: "Keep my photo", hint: "Animate your exact photo" },
];

const QUALITIES: { value: Quality; label: string; hint: string }[] = [
  { value: "fast", label: "Fast", hint: "~1 min" },
  { value: "balanced", label: "Balanced", hint: "recommended, ~2-4 min" },
  { value: "max", label: "Max", hint: "~8-15 min" },
];

// Same-origin proxy form for the media URL. Prefer the s3Key (stable,
// same-origin) and fall back to whatever url the backend signed.
function toMediaSrc(asset: MediaAsset): string | null {
  if (asset.s3Key) return `/api/media?k=${encodeURIComponent(asset.s3Key)}`;
  return asset.url ?? null;
}

export function CreateVideoForm({ characters }: { characters: CreateVideoCharacter[] }) {
  const [characterId, setCharacterId] = React.useState<string | null>(
    characters.length === 1 ? characters[0]!.id : null,
  );
  const [prompt, setPrompt] = React.useState("");
  const [aspectRatio, setAspectRatio] = React.useState<AspectRatio>("portrait");
  const [seconds, setSeconds] = React.useState<Seconds>(3);
  const [quality, setQuality] = React.useState<Quality>("balanced");
  const [sceneMode, setSceneMode] = React.useState<SceneMode>("transform");

  const [phase, setPhase] = React.useState<Phase>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [upgradeHref, setUpgradeHref] = React.useState<string | null>(null);
  const [videoSrc, setVideoSrc] = React.useState<string | null>(null);

  // Track the active poll loop so we can cancel it on unmount / retry.
  const cancelRef = React.useRef(false);
  React.useEffect(() => {
    return () => {
      cancelRef.current = true;
    };
  }, []);

  const canGenerate =
    phase !== "generating" && Boolean(characterId) && prompt.trim().length > 0;

  async function pollUntilSettled(mediaAssetId: string) {
    let polls = 0;
    while (!cancelRef.current && polls < MAX_POLLS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (cancelRef.current) return;
      polls += 1;
      let asset: MediaAsset;
      try {
        const res = await fetch(`${BACKEND_URL}/media/${mediaAssetId}`, {
          credentials: "include",
        });
        if (!res.ok) continue; // transient; keep polling within the budget
        asset = (await res.json()) as MediaAsset;
      } catch {
        continue;
      }
      if (cancelRef.current) return;
      if (asset.status === "ready") {
        const src = toMediaSrc(asset);
        if (src) {
          setVideoSrc(src);
          setPhase("ready");
        } else {
          setError("The video finished but no playable file was returned.");
          setPhase("failed");
        }
        return;
      }
      if (asset.status === "failed") {
        setError("Generation failed. Please try again.");
        setPhase("failed");
        return;
      }
      // queued | processing -> keep waiting
    }
    if (!cancelRef.current) {
      setError("This is taking longer than expected. Check Reels in a bit.");
      setPhase("failed");
    }
  }

  async function handleGenerate() {
    if (!characterId || prompt.trim().length === 0) return;
    cancelRef.current = false;
    setError(null);
    setUpgradeHref(null);
    setVideoSrc(null);
    setPhase("generating");
    try {
      const res = await fetch(`${BACKEND_URL}/media/video`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          characterId,
          payload: {
            userRequest: prompt.trim(),
            mode: "i2v",
            seconds,
            aspectRatio,
            quality,
            sceneMode,
          },
        }),
      });
      if (!res.ok) {
        // Surface the real reason instead of a generic message. 402 covers both
        // the plan paywall (video needs an active plan / quota) and running out
        // of tokens; the backend body distinguishes them.
        let msg = "Could not start the video. Please try again.";
        let upgrade: string | null = null;
        if (res.status === 401) {
          msg = "Your session expired. Please sign in again.";
        } else {
          const body = (await res.json().catch(() => null)) as
            | { error?: string; message?: string; required?: number; balance?: number }
            | null;
          if (res.status === 402 && body?.error === "insufficient_tokens") {
            msg = `Not enough tokens. Video needs ${body.required ?? 60}; you have ${body.balance ?? 0}.`;
            upgrade = "/billing/tokens";
          } else if (res.status === 402) {
            msg = "Video generation needs an active plan. Upgrade to start creating videos.";
            upgrade = "/billing";
          } else if (body?.message) {
            msg = body.message;
          }
        }
        setError(msg);
        setUpgradeHref(upgrade);
        setPhase("failed");
        return;
      }
      const body = (await res.json()) as EnqueueResponse;
      if (!body.mediaAssetId) {
        setError("The server did not return a job id.");
        setPhase("failed");
        return;
      }
      await pollUntilSettled(body.mediaAssetId);
    } catch {
      setError("Network error. Please check your connection and try again.");
      setPhase("failed");
    }
  }

  const selected = characters.find((c) => c.id === characterId) ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      {/* Form column */}
      <div className="flex flex-col gap-6">
        {characters.length === 0 ? (
          <Panel>
            <p className="text-sm" style={{ color: "hsl(var(--bc-muted))" }}>
              You need a companion first.{" "}
              <Link href="/create" className="font-semibold text-[hsl(var(--bc-amber))] hover:underline">
                Create one
              </Link>{" "}
              to start making videos.
            </p>
          </Panel>
        ) : (
          <>
            <Panel>
              <FieldLabel>Companion</FieldLabel>
              <CharacterSelect
                characters={characters}
                value={characterId}
                onChange={setCharacterId}
              />
            </Panel>

            <Panel>
              <FieldLabel>Describe the video</FieldLabel>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                maxLength={1000}
                placeholder="Describe the video... e.g. she smiles softly and tucks a strand of hair behind her ear, warm afternoon light"
                className="w-full resize-y rounded-[var(--bc-radius-sm)] border bg-[hsl(var(--bc-surface-2)/0.5)] px-3.5 py-3 text-sm text-[hsl(var(--bc-fg))] placeholder:text-[hsl(var(--bc-subtle))] focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bc-amber))]"
                style={{ borderColor: "hsl(var(--bc-border))" }}
              />
              <p className="mt-1.5 text-right text-[11px]" style={{ color: "hsl(var(--bc-subtle))" }}>
                {prompt.trim().length}/1000
              </p>
            </Panel>

            <Panel>
              <FieldLabel>Aspect ratio</FieldLabel>
              <div className="grid grid-cols-3 gap-2">
                {ASPECTS.map((a) => (
                  <OptionCard
                    key={a.value}
                    selected={aspectRatio === a.value}
                    onSelect={() => setAspectRatio(a.value)}
                  >
                    <span className="flex flex-col items-center gap-2">
                      <span
                        className={cn("rounded-sm border", a.box)}
                        style={{ borderColor: "hsl(var(--bc-border-strong))" }}
                        aria-hidden
                      />
                      <span className="text-[0.8125rem] font-semibold">{a.label}</span>
                      <span className="text-[11px]" style={{ color: "hsl(var(--bc-subtle))" }}>
                        {a.ratio}
                      </span>
                    </span>
                  </OptionCard>
                ))}
              </div>
            </Panel>

            <div className="grid gap-6 sm:grid-cols-2">
              <Panel>
                <FieldLabel>Duration</FieldLabel>
                <div className="grid grid-cols-3 gap-2">
                  {DURATIONS.map((d) => (
                    <OptionCard
                      key={d.value}
                      selected={seconds === d.value}
                      onSelect={() => setSeconds(d.value)}
                    >
                      <span className="text-sm font-semibold">{d.label}</span>
                    </OptionCard>
                  ))}
                </div>
              </Panel>

              <Panel>
                <FieldLabel>Quality</FieldLabel>
                <div className="flex flex-col gap-2">
                  {QUALITIES.map((q) => (
                    <OptionCard
                      key={q.value}
                      selected={quality === q.value}
                      onSelect={() => setQuality(q.value)}
                      align="row"
                    >
                      <span className="text-sm font-semibold">{q.label}</span>
                      <span className="text-[11px]" style={{ color: "hsl(var(--bc-subtle))" }}>
                        {q.hint}
                      </span>
                    </OptionCard>
                  ))}
                </div>
              </Panel>
            </div>

            <Panel>
              <FieldLabel>Scene</FieldLabel>
              <p className="mb-3 text-xs" style={{ color: "hsl(var(--bc-subtle))" }}>
                Transform changes the outfit/scene from your prompt; Keep animates your photo as-is.
              </p>
              <div className="flex flex-col gap-2">
                {SCENE_MODES.map((s) => (
                  <OptionCard
                    key={s.value}
                    selected={sceneMode === s.value}
                    onSelect={() => setSceneMode(s.value)}
                    align="row"
                  >
                    <span className="text-sm font-semibold">{s.label}</span>
                    <span className="text-[11px]" style={{ color: "hsl(var(--bc-subtle))" }}>
                      {s.hint}
                    </span>
                  </OptionCard>
                ))}
              </div>
            </Panel>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="brand"
                size="lg"
                onClick={handleGenerate}
                disabled={!canGenerate}
                data-testid="create-video-generate"
              >
                {phase === "generating" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Film className="h-4 w-4" />
                    Generate video
                  </>
                )}
              </Button>
              {!characterId ? (
                <span className="text-xs" style={{ color: "hsl(var(--bc-subtle))" }}>
                  Pick a companion to begin.
                </span>
              ) : prompt.trim().length === 0 ? (
                <span className="text-xs" style={{ color: "hsl(var(--bc-subtle))" }}>
                  Describe the video to begin.
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>

      {/* Preview column */}
      <div className="lg:sticky lg:top-6 lg:self-start">
        <Panel className="flex flex-col gap-4">
          <FieldLabel>Preview</FieldLabel>
          <PreviewStage
            phase={phase}
            aspectRatio={aspectRatio}
            videoSrc={videoSrc}
            error={error}
            upgradeHref={upgradeHref}
            selectedName={selected?.name ?? null}
            onRetry={handleGenerate}
          />
        </Panel>
      </div>
    </div>
  );
}

function PreviewStage({
  phase,
  aspectRatio,
  videoSrc,
  error,
  upgradeHref,
  selectedName,
  onRetry,
}: {
  phase: Phase;
  aspectRatio: AspectRatio;
  videoSrc: string | null;
  error: string | null;
  upgradeHref: string | null;
  selectedName: string | null;
  onRetry: () => void;
}) {
  const aspectClass =
    aspectRatio === "portrait"
      ? "aspect-[9/16]"
      : aspectRatio === "landscape"
        ? "aspect-[16/9]"
        : "aspect-square";

  const stage = cn(
    "relative mx-auto w-full max-w-xs overflow-hidden rounded-[var(--bc-radius)] border",
    aspectClass,
  );

  if (phase === "ready" && videoSrc) {
    return (
      <div className="flex flex-col gap-4">
        <div className={stage} style={{ borderColor: "hsl(var(--bc-amber) / 0.4)" }}>
          <video
            src={videoSrc}
            controls
            autoPlay
            loop
            playsInline
            className="h-full w-full bg-black object-cover"
          />
        </div>
        <Link href="/reels" className="inline-flex">
          <Button variant="outline" size="sm">
            View in Reels
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <div className="flex flex-col gap-4">
        <div
          className={stage}
          style={{ borderColor: "hsl(var(--bc-danger) / 0.4)", backgroundColor: "hsl(var(--bc-danger) / 0.06)" }}
        >
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
            <AlertTriangle className="h-6 w-6" style={{ color: "hsl(var(--bc-danger))" }} aria-hidden />
            <p className="text-sm" style={{ color: "hsl(var(--bc-muted))" }}>
              {error ?? "Something went wrong."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {upgradeHref ? (
            <Link href={upgradeHref} className="inline-flex">
              <Button variant="brand" size="sm">
                Upgrade
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          ) : null}
          <Button variant="outline" size="sm" onClick={onRetry} data-testid="create-video-retry">
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "generating") {
    return (
      <div
        className={cn(stage, "animate-pulse")}
        style={{ borderColor: "hsl(var(--bc-border))", backgroundColor: "hsl(var(--bc-surface-2))" }}
      >
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: "hsl(var(--bc-amber))" }} aria-hidden />
          <p className="text-sm font-medium">Generating your video</p>
          <p className="text-xs" style={{ color: "hsl(var(--bc-subtle))" }}>
            This can take a few minutes. You can keep this tab open.
          </p>
        </div>
      </div>
    );
  }

  // idle
  return (
    <div
      className={stage}
      style={{ borderColor: "hsl(var(--bc-border))", backgroundColor: "hsl(var(--bc-surface-2) / 0.5)" }}
    >
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
        <Film className="h-6 w-6" style={{ color: "hsl(var(--bc-subtle))" }} aria-hidden />
        <p className="text-xs" style={{ color: "hsl(var(--bc-subtle))" }}>
          {selectedName
            ? `Your clip of ${selectedName} will play here.`
            : "Your generated clip will play here."}
        </p>
      </div>
    </div>
  );
}

function CharacterAvatar({ character, size = 9 }: { character: CreateVideoCharacter; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold"
      style={{ height: `${size * 0.25}rem`, width: `${size * 0.25}rem`, backgroundColor: "hsl(var(--bc-surface-3))" }}
    >
      {character.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={character.avatarUrl} alt={character.name} className="h-full w-full object-cover object-top" />
      ) : (
        <span>{character.name[0]?.toUpperCase() ?? "?"}</span>
      )}
    </span>
  );
}

// Compact character picker: a collapsed button showing the current selection
// that opens a scrollable, searchable popover. Keeps the field to one row
// instead of a full-page grid when the whole catalog is listed.
function CharacterSelect({
  characters,
  value,
  onChange,
}: {
  characters: CreateVideoCharacter[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const selected = characters.find((c) => c.id === value) ?? null;

  React.useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q ? characters.filter((c) => c.name.toLowerCase().includes(q)) : characters;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="create-video-character-select"
        className="flex w-full items-center justify-between gap-3 rounded-[var(--bc-radius-sm)] border px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bc-amber))]"
        style={{
          borderColor: open ? "hsl(var(--bc-amber) / 0.6)" : "hsl(var(--bc-border))",
          background: "hsl(var(--bc-surface-2) / 0.5)",
        }}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {selected ? (
            <CharacterAvatar character={selected} size={8} />
          ) : (
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: "hsl(var(--bc-surface-3))" }}
              aria-hidden
            />
          )}
          <span
            className={cn("truncate text-sm", selected ? "font-medium text-[hsl(var(--bc-fg))]" : "")}
            style={selected ? undefined : { color: "hsl(var(--bc-subtle))" }}
          >
            {selected ? selected.name : "Select a character"}
          </span>
        </span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")}
          style={{ color: "hsl(var(--bc-subtle))" }}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-[var(--bc-radius-sm)] border shadow-lg"
          style={{ borderColor: "hsl(var(--bc-border))", background: "hsl(var(--bc-surface))" }}
        >
          {characters.length > 8 ? (
            <div className="p-2" style={{ borderBottom: "1px solid hsl(var(--bc-border))" }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search characters..."
                autoFocus
                className="w-full rounded-[var(--bc-radius-sm)] border bg-[hsl(var(--bc-surface-2)/0.5)] px-3 py-2 text-sm text-[hsl(var(--bc-fg))] placeholder:text-[hsl(var(--bc-subtle))] focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bc-amber))]"
                style={{ borderColor: "hsl(var(--bc-border))" }}
              />
            </div>
          ) : null}
          <ul className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-sm" style={{ color: "hsl(var(--bc-subtle))" }}>
                No characters match.
              </li>
            ) : (
              filtered.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={value === c.id}
                    onClick={() => {
                      onChange(c.id);
                      setOpen(false);
                      setQuery("");
                    }}
                    className="flex w-full items-center gap-2.5 rounded-[var(--bc-radius-sm)] px-2 py-2 text-left transition-colors hover:bg-[hsl(var(--bc-cream)/0.06)]"
                    style={value === c.id ? { background: "hsl(var(--bc-amber) / 0.12)" } : undefined}
                  >
                    <CharacterAvatar character={c} size={8} />
                    <span className="min-w-0 flex-1 truncate text-sm text-[hsl(var(--bc-fg))]">{c.name}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function OptionCard({
  selected,
  onSelect,
  children,
  align = "col",
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
  align?: "col" | "row";
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex rounded-[var(--bc-radius-sm)] border px-3 py-3 transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bc-amber))]",
        align === "row"
          ? "items-center justify-between gap-3"
          : "flex-col items-center justify-center gap-1 text-center",
      )}
      style={{
        borderColor: selected ? "hsl(var(--bc-amber) / 0.6)" : "hsl(var(--bc-border))",
        background: selected
          ? "linear-gradient(135deg, hsl(var(--bc-honey) / 0.12), hsl(var(--bc-amber) / 0.12))"
          : "hsl(var(--bc-surface-2) / 0.5)",
        color: "hsl(var(--bc-fg))",
      }}
    >
      {children}
    </button>
  );
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn("rounded-[var(--bc-radius-lg)] border p-5", className)}
      style={{
        borderColor: "hsl(var(--bc-border))",
        backgroundColor: "hsl(var(--bc-surface) / 0.6)",
      }}
    >
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "hsl(var(--bc-subtle))" }}>
      {children}
    </p>
  );
}
