import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { affectionPercent, clampAffection } from "@/lib/affection";

export interface AffectionMeterProps {
  affectionLevel: number;
  mood?: string | null;
  milestones?: string[];
  size?: "sm" | "md";
  showLabel?: boolean;
  className?: string;
}

export function AffectionMeter({
  affectionLevel,
  mood,
  milestones,
  size = "md",
  showLabel = false,
  className,
}: AffectionMeterProps) {
  const pct = affectionPercent(affectionLevel);
  const clamped = clampAffection(affectionLevel);
  const latest = milestones && milestones.length > 0 ? milestones[milestones.length - 1] : null;
  const tooltip = latest ? `Latest milestone: ${latest}` : `Affection ${pct}%`;
  const barW = size === "sm" ? "w-16" : "w-24";
  const barH = size === "sm" ? "h-1.5" : "h-2";

  return (
    <div
      data-testid="affection-meter"
      aria-label={`Affection ${pct}%`}
      title={tooltip}
      className={cn("inline-flex items-center gap-2", className)}
    >
      <Heart
        className={cn(size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4")}
        style={{
          color: "hsl(var(--poppy-accent-rose))",
          fill: clamped > 0 ? "hsl(var(--poppy-accent-rose) / 0.6)" : "transparent",
        }}
      />
      <div
        className={cn("overflow-hidden rounded-full", barW, barH)}
        style={{ backgroundColor: "hsl(var(--poppy-surface-2))" }}
      >
        <div
          className="h-full transition-all"
          style={{
            width: `${pct}%`,
            backgroundColor: "hsl(var(--poppy-accent-rose))",
          }}
          aria-hidden
        />
      </div>
      {mood ? (
        <span
          className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider"
          style={{
            backgroundColor: "hsl(var(--poppy-accent-violet) / 0.15)",
            color: "hsl(var(--poppy-accent-violet))",
          }}
        >
          {mood}
        </span>
      ) : null}
      {showLabel ? (
        <span className="text-xs" style={{ color: "hsl(var(--poppy-muted))" }}>
          {pct}%
        </span>
      ) : null}
    </div>
  );
}
