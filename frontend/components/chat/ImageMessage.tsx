"use client";

// Inline image bubble. Loading skeleton while the job is queued/processing,
// full image with tap-to-expand once the signed URL arrives.

import * as React from "react";

interface Props {
  mediaAssetId: string;
  url: string | null;
  caption?: string;
  error?: string | null;
}

export function ImageMessage({ mediaAssetId, url, caption, error }: Props) {
  const [expanded, setExpanded] = React.useState(false);
  if (error) {
    return (
      <div className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700">
        Image failed ({error}).
      </div>
    );
  }
  if (!url) {
    return (
      <div
        data-media-id={mediaAssetId}
        className="flex aspect-square w-56 animate-pulse items-center justify-center rounded-lg bg-slate-200 text-xs text-slate-500 dark:bg-slate-800"
      >
        Generating image...
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1" data-media-id={mediaAssetId}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800"
      >
        <img
          src={url}
          alt={caption ?? "generated"}
          loading="lazy"
          className={expanded ? "max-h-[80vh] w-auto" : "aspect-square w-56 object-cover"}
        />
      </button>
      {caption ? <span className="text-xs text-slate-500">{caption}</span> : null}
    </div>
  );
}
