"use client";

// Three bouncing dots shown after send + before the first streamed token.
// Once the transport emits its first `token`, ChatWindow hides this and
// falls back to the existing streaming bubble with the pulsing cursor.
export function TypingDots() {
  return (
    <div className="flex justify-start" data-testid="typing-dots">
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-1 rounded-2xl px-4 py-3 shadow-sm ring-1"
        style={{
          backgroundColor: "hsl(var(--buttercupp-surface))",
          borderColor: "hsl(var(--buttercupp-border))",
          color: "hsl(var(--buttercupp-fg))",
        }}
      >
        <span className="sr-only">Typing</span>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden
            className="motion-safe:animate-bounce inline-block h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: "hsl(var(--bc-amber))",
              animationDelay: `${i * 120}ms`,
              animationDuration: "900ms",
            }}
          />
        ))}
      </div>
    </div>
  );
}
