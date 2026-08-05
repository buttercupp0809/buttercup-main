"use client";

import * as React from "react";
import { parseGestures } from "@/lib/gesture-format";

export interface GestureTextProps {
  content: string;
}

// Renders assistant text with `*gesture*` runs styled as muted italic spans.
// Memoized on `content` so the parser only re-runs when the streaming string
// actually grew, which matters when tokens arrive many times per second.
export const GestureText = React.memo(function GestureText({ content }: GestureTextProps) {
  const segments = React.useMemo(() => parseGestures(content), [content]);
  return (
    <span className="whitespace-pre-wrap" data-testid="gesture-text">
      {segments.map((seg, i) =>
        seg.kind === "gesture" ? (
          <span
            key={i}
            className="italic"
            data-testid="gesture"
            style={{ color: "hsl(var(--buttercupp-accent-rose) / 0.85)" }}
          >
            {seg.value}
          </span>
        ) : (
          <span key={i}>{seg.value}</span>
        ),
      )}
    </span>
  );
});
