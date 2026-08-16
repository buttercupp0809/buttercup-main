"use client";

// Client card for the Your Companions grid. Responsibilities:
//   1. "Regenerate images": POST to the existing enqueue route. If the
//      route returns { status: "unavailable" } (Redis / backend down),
//      surface a soft, retryable message; the character stays usable in
//      chat.
//   2. Poll the gallery route while generation is in flight (bounded to
//      ~90s) so many cards on one page cannot self-DoS the API.
//   3. "Edit": deep-link into the existing create wizard in EDIT mode
//      (frontend/app/(protected)/create/context.tsx already seeds the
//      draft from GET /api/characters/:id when the URL carries
//      ?editCharacterId=). No new page needed.
//   4. "Delete": destructive-confirm dialog, then DELETE /api/characters
//      /:id (owner-only) which cascades the character rows and best-
//      effort deletes the backing S3 objects.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageCircle, RefreshCcw, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  deriveBadge,
  type CompanionCardVM,
  type CompanionGenSummary,
} from "@/lib/companions-shared";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

const POLL_INTERVAL_MS = 2500;
const POLL_CAP_MS = 90_000;

interface GalleryItem {
  id: string;
  url: string | null;
  s3Key: string | null;
  createdAt: string;
}

interface GalleryResponse {
  items: GalleryItem[];
  nextCursor: string | null;
}

export interface CompanionCardProps {
  companion: CompanionCardVM;
}

export function CompanionCard({ companion }: CompanionCardProps) {
  const router = useRouter();
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(companion.avatarUrl);
  const [gen, setGen] = React.useState<CompanionGenSummary>(companion.gen);
  const [unavailable, setUnavailable] = React.useState(false);
  const [regenPending, setRegenPending] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [deletePending, setDeletePending] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [deleted, setDeleted] = React.useState(false);

  const pending = gen.queued + gen.processing > 0;
  const badge = deriveBadge(gen);

  React.useEffect(() => {
    if (!pending) return;
    const startedAt = Date.now();
    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      try {
        const res = await fetch(
          `/api/characters/${encodeURIComponent(companion.id)}/gallery?limit=1`,
          { cache: "no-store" },
        );
        if (res.ok) {
          const body = (await res.json()) as GalleryResponse;
          if (body.items.length > 0 && body.items[0].url) {
            setAvatarUrl(body.items[0].url);
            setGen((prev) => ({
              ...prev,
              queued: 0,
              processing: 0,
              ready: Math.max(prev.ready, 1),
              primaryReady: true,
            }));
            return;
          }
        }
      } catch {
        // Transient network error; keep polling until the cap.
      }
      if (Date.now() - startedAt > POLL_CAP_MS) return;
      if (!cancelled) window.setTimeout(tick, POLL_INTERVAL_MS);
    }

    const t = window.setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [pending, companion.id]);

  const onRegenerate = React.useCallback(async () => {
    if (regenPending) return;
    setRegenPending(true);
    setUnavailable(false);
    try {
      const res = await fetch(
        `/api/characters/${encodeURIComponent(companion.id)}/generate-images`,
        { method: "POST" },
      );
      if (!res.ok) {
        setUnavailable(true);
        return;
      }
      const body = (await res.json()) as { status?: string };
      if (body.status === "unavailable") {
        setUnavailable(true);
        return;
      }
      setGen((prev) => ({ ...prev, queued: prev.queued + 1, failed: 0 }));
    } catch {
      setUnavailable(true);
    } finally {
      setRegenPending(false);
    }
  }, [companion.id, regenPending]);

  const onConfirmDelete = React.useCallback(async () => {
    if (deletePending) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/characters/${encodeURIComponent(companion.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setDeleteError(body.error ?? `http_${res.status}`);
        return;
      }
      // Optimistic hide + refresh the server component so the grid re-
      // fetches without this row. router.refresh() re-runs the page's
      // server component with a fresh listCompanions().
      setDeleted(true);
      setConfirmOpen(false);
      router.refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "delete_failed");
    } finally {
      setDeletePending(false);
    }
  }, [companion.id, deletePending, router]);

  if (deleted) return null;

  return (
    <>
      <div
        data-testid="companion-card"
        data-companion-id={companion.id}
        className="group relative flex aspect-[9/16] flex-col overflow-hidden rounded-2xl shadow-md ring-1"
        style={{
          backgroundColor: "hsl(var(--buttercupp-surface))",
          borderColor: "hsl(var(--buttercupp-border))",
        }}
      >
        {avatarUrl ? (
           
          <img
            src={avatarUrl}
            alt={companion.name}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover object-top"
          />
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center text-4xl font-semibold"
            style={{ color: "hsl(var(--buttercupp-muted))" }}
          >
            {companion.name[0]?.toUpperCase() ?? "?"}
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/60 to-transparent" />

        {badge.kind !== "ready" ? (
          <span
            data-testid="companion-badge"
            data-badge-kind={badge.kind}
            className={cn(
              "absolute left-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-medium shadow ring-1 ring-black/40",
              badge.kind === "failed" && "bg-amber-500/90 text-black",
              badge.kind === "generating" && "bg-white/15 text-white backdrop-blur-sm motion-safe:animate-pulse",
              badge.kind === "empty" && "bg-white/15 text-white/90 backdrop-blur-sm",
            )}
          >
            {badge.label}
          </span>
        ) : null}

        <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
          <Link
            href={`/create/style?editCharacterId=${encodeURIComponent(companion.id)}`}
            data-testid="companion-edit"
            aria-label={`Edit ${companion.name}`}
            title="Edit"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white/90 ring-1 ring-white/20 backdrop-blur-sm transition-all duration-150 hover:scale-105 hover:bg-black/70 hover:text-white hover:ring-2 hover:ring-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={2.25} />
          </Link>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            data-testid="companion-delete"
            aria-label={`Delete ${companion.name}`}
            title="Delete"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white/90 ring-1 ring-white/20 backdrop-blur-sm transition-all duration-150 hover:scale-105 hover:bg-red-600/80 hover:text-white hover:ring-2 hover:ring-red-300/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300/80"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2.25} />
          </button>
        </div>

        <div className="relative z-10 mt-auto flex flex-col gap-2 p-4 text-white">
          <h3 className="font-display text-lg font-semibold leading-tight drop-shadow">
            {companion.name}
          </h3>
          {unavailable ? (
            <p
              data-testid="companion-unavailable"
              className="rounded-md bg-amber-500/20 px-2 py-1 text-[11px] text-amber-100 ring-1 ring-amber-500/40"
            >
              Image service is temporarily unavailable. Try again shortly.
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <Link
              href={`/chat/${companion.id}`}
              data-testid="companion-chat"
              className="tap-target inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white ring-1 ring-white/20 backdrop-blur-sm hover:bg-white/20"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Chat
            </Link>
            <button
              type="button"
              onClick={onRegenerate}
              disabled={regenPending}
              data-testid="companion-regenerate"
              aria-label="Regenerate images"
              className="tap-target inline-flex items-center justify-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white ring-1 ring-white/20 backdrop-blur-sm hover:bg-white/20 disabled:opacity-60"
            >
              <RefreshCcw className={cn("h-3.5 w-3.5", regenPending && "motion-safe:animate-spin")} />
              {badge.kind === "failed" ? "Retry" : "Regenerate"}
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={`Delete ${companion.name}?`}
        description={
          deleteError
            ? `Delete failed (${deleteError}). Try again or contact support if this keeps happening.`
            : `This permanently deletes ${companion.name}, every generated image, and every conversation you have had with them. This cannot be undone.`
        }
        confirmLabel="Delete forever"
        destructive
        busy={deletePending}
        onConfirm={onConfirmDelete}
        onCancel={() => {
          if (deletePending) return;
          setConfirmOpen(false);
          setDeleteError(null);
        }}
      />
    </>
  );
}
