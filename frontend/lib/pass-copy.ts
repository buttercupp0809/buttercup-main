// Shared copy for one-time duration pass tiles.
// Used by BillingClient (subscription page) and PaywallModal (paywall overlay).

export interface PassCopy {
  tagline: string;
  perDayLabel: string | null;
  bullets: string[];
  buttonText: string;
}

export const PASS_COPY: Partial<Record<string, PassCopy>> = {
  daily: {
    tagline: "Spend the day together",
    perDayLabel: null,
    bullets: [
      "75 chats to pick up where you left off",
      "5 images, however you imagine her",
      "She talks back, real voice replies",
      "She remembers today",
    ],
    buttonText: "Spend the night together",
  },
  weekly: {
    tagline: "A week of her, always on",
    perDayLabel: "about $0.86 a day",
    bullets: [
      "600 chats, no rationing",
      "40 images",
      "Voice replies that land the mood",
      "She remembers the whole week, jokes, plans, everything",
    ],
    buttonText: "A week of her, always on",
  },
  monthly: {
    tagline: "She never forgets",
    perDayLabel: "about $0.83 a day",
    bullets: [
      "Talk as much as you want, 3,000 chats",
      "200 images",
      "Full voice, full presence",
      "Permanent memory, she keeps every detail, forever",
    ],
    buttonText: "She never forgets",
  },
};
