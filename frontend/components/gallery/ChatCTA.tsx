import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ChatCTAState =
  | { kind: "visitor"; characterId: string }
  | { kind: "needsAgeGate"; characterId: string }
  | { kind: "needsAgeGateMature"; characterId: string }
  | { kind: "eligible"; characterId: string };

const primaryButtonClass = cn(
  "w-full bg-gradient-to-r from-rose-500 to-violet-500 text-white shadow-md",
  "hover:from-rose-400 hover:to-violet-400",
);

export function ChatCTA({ state }: { state: ChatCTAState }) {
  switch (state.kind) {
    case "visitor":
      return (
        <div data-testid="chat-cta" data-cta-state="visitor" className="flex flex-col gap-2">
          <Link href={`/signup?next=/characters/${state.characterId}`}>
            <Button size="lg" className={primaryButtonClass}>
              Sign up to chat
            </Button>
          </Link>
          <p className="text-xs opacity-80">Free to try. 18+ only.</p>
        </div>
      );
    case "needsAgeGate":
      return (
        <div data-testid="chat-cta" data-cta-state="needsAgeGate" className="flex flex-col gap-2">
          <Link href="/age-gate">
            <Button size="lg" className={primaryButtonClass}>
              Verify age to chat
            </Button>
          </Link>
          <p className="text-xs opacity-80">
            Confirm your date of birth and accept the terms to continue.
          </p>
        </div>
      );
    case "needsAgeGateMature":
      return (
        <div
          data-testid="chat-cta"
          data-cta-state="needsAgeGateMature"
          className="flex flex-col gap-2"
        >
          <Link href="/age-gate">
            <Button size="lg" className={primaryButtonClass}>
              Verify age to view
            </Button>
          </Link>
          <p className="text-xs opacity-80">
            This character is 18+ only. Verify to unlock.
          </p>
        </div>
      );
    case "eligible":
      return (
        <div data-testid="chat-cta" data-cta-state="eligible">
          <Link href={`/chat/${state.characterId}`}>
            <Button size="lg" className={primaryButtonClass} data-testid="start-chat">
              Start chat
            </Button>
          </Link>
        </div>
      );
  }
}
