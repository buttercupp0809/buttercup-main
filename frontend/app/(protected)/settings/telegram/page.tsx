import Link from "next/link";
import { ArrowLeft, Send } from "lucide-react";

// Telegram settings page. Server Component.
// Shows connection instructions and a link back to settings.

export default function TelegramSettingsPage() {
  return (
    <section className="mx-auto max-w-xl px-6 px-safe py-10 pb-safe sm:py-12">
      {/* Back link */}
      <Link
        href="/settings"
        className="mb-6 inline-flex items-center gap-1.5 text-sm"
        style={{ color: "hsl(var(--bc-muted))" }}
      >
        <ArrowLeft className="h-4 w-4" />
        Back to settings
      </Link>

      {/* Heading */}
      <div className="mb-6 flex items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--bc-radius)] ring-1 ring-[hsl(var(--bc-border))]"
          style={{
            background: "linear-gradient(135deg, hsl(210 80% 40% / 0.2), hsl(210 80% 55% / 0.2))",
            color: "hsl(210 80% 65%)",
          }}
        >
          <Send className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Telegram</h1>
          <p className="mt-0.5 text-sm" style={{ color: "hsl(var(--bc-muted))" }}>
            Chat with your AI companions in Telegram.
          </p>
        </div>
      </div>

      {/* Description */}
      <p className="mb-6 text-sm leading-relaxed" style={{ color: "hsl(var(--bc-muted))" }}>
        Connect any AI companion to Telegram for a native messaging experience.
        Each companion has its own dedicated Telegram bot. Images you generate
        and private photos are delivered directly to your Telegram chat.
      </p>

      {/* How to connect card */}
      <div
        className="buttercupp-glass rounded-[var(--bc-radius-lg)] p-5 sm:p-6"
      >
        <h2 className="mb-4 font-display text-lg font-semibold tracking-tight">How to connect</h2>
        <ol className="flex flex-col gap-4">
          {[
            {
              step: 1,
              text: "Open any companion chat in the app.",
            },
            {
              step: 2,
              text: 'Click the "Connect on Telegram" banner at the top of the chat.',
            },
            {
              step: 3,
              text: 'Tap "Open in Telegram" to launch the bot and complete the link.',
            },
            {
              step: 4,
              text: "You're connected. Messages and images sync both ways from this point on.",
            },
          ].map(({ step, text }) => (
            <li key={step} className="flex items-start gap-3">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                style={{
                  background: "hsl(210 80% 55% / 0.15)",
                  color: "hsl(210 80% 65%)",
                  border: "1px solid hsl(210 80% 55% / 0.3)",
                }}
              >
                {step}
              </span>
              <span className="pt-0.5 text-sm" style={{ color: "hsl(var(--bc-fg))" }}>
                {text}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* Go to chats CTA */}
      <div className="mt-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-[var(--bc-radius-sm)] px-4 py-2.5 text-sm font-semibold text-white transition-[filter] duration-200 ease-[var(--ease-out)] hover:brightness-110"
          style={{
            background: "linear-gradient(180deg, hsl(210 80% 55%), hsl(210 80% 42%))",
          }}
        >
          Open a companion chat
          <Send className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}
