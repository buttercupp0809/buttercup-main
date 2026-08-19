import Image from "next/image";
import { cn } from "@/lib/utils";

// The brand mark and lockup, exported from the Figma "Branding" board and
// committed under public/brand. These are the real vectors: never re-draw the
// mark by hand in JSX, and never substitute an icon-library glyph for it.
//
// `mark` is the gradient heart-bubble on its own (honey at the top stop, amber
// at the bottom) and works on any background. `lockup` is mark + wordmark and
// is the dark-background variant, so it needs a dark surface behind it.

const MARK_ASPECT = 210 / 210;
const LOCKUP_ASPECT = 1031 / 310;

export function BrandMark({
  size = 32,
  className,
  priority = false,
}: {
  size?: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/brand/mark.svg"
      alt=""
      width={size}
      height={Math.round(size / MARK_ASPECT)}
      priority={priority}
      aria-hidden="true"
      className={cn("block shrink-0 select-none", className)}
    />
  );
}

// Height-driven: the lockup is very wide, so callers think in terms of how tall
// the logo should sit in a header rather than how wide.
export function BrandLockup({
  height = 26,
  className,
  priority = false,
}: {
  height?: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/brand/lockup-dark.svg"
      alt="ButterCupp"
      width={Math.round(height * LOCKUP_ASPECT)}
      height={height}
      priority={priority}
      className={cn("block w-auto select-none", className)}
      style={{ height }}
    />
  );
}

// Header/nav usage. The mark keeps the brand present at small sizes where the
// full lockup would be illegible, and the wordmark is set in the display face
// so it still reads as the logo rather than as body copy.
export function BrandRow({
  className,
  markSize = 30,
  showWordmark = true,
}: {
  className?: string;
  markSize?: number;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark size={markSize} priority />
      {showWordmark ? (
        <span className="font-display text-[1.35rem] font-semibold leading-none tracking-[-0.02em] text-[hsl(var(--bc-cream))]">
          Butter<span className="text-[hsl(var(--bc-amber))]">Cupp</span>
        </span>
      ) : null}
    </span>
  );
}
