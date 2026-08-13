import Link from "next/link";

export type ChatCTAState =
  | { kind: "visitor"; characterId: string }
  | { kind: "needsAgeGate"; characterId: string }
  | { kind: "needsAgeGateMature"; characterId: string }
  | { kind: "eligible"; characterId: string };

const btnBase =
  "flex w-full items-center justify-center rounded-2xl py-4 text-sm font-semibold text-white shadow-lg transition-opacity hover:opacity-90";

const gradientStyle = {
  background:
    "linear-gradient(135deg, hsl(344 84% 60%), hsl(262 72% 60%))",
  boxShadow: "0 4px 24px hsl(344 84% 60% / 0.35)",
} as const;

export function ChatCTA({ state }: { state: ChatCTAState }) {
  switch (state.kind) {
    case "visitor":
      return (
        <div data-testid="chat-cta" data-cta-state="visitor">
          <Link
            href={`/signup?next=/characters/${state.characterId}`}
            className={btnBase}
            style={gradientStyle}
          >
            Sign up to chat
          </Link>
        </div>
      );
    case "needsAgeGate":
      return (
        <div data-testid="chat-cta" data-cta-state="needsAgeGate">
          <Link href="/age-gate" className={btnBase} style={gradientStyle}>
            Verify age to chat
          </Link>
        </div>
      );
    case "needsAgeGateMature":
      return (
        <div data-testid="chat-cta" data-cta-state="needsAgeGateMature">
          <Link href="/age-gate" className={btnBase} style={gradientStyle}>
            Verify age to view
          </Link>
        </div>
      );
    case "eligible":
      return (
        <div data-testid="chat-cta" data-cta-state="eligible">
          <Link
            href={`/chat/${state.characterId}`}
            className={btnBase}
            style={gradientStyle}
            data-testid="start-chat"
          >
            Start chat
          </Link>
        </div>
      );
  }
}
