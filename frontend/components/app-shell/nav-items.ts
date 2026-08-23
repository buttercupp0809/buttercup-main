// Primary in-app navigation. Discover renders inside the protected dark shell
// at /discover (so it never bounces to the light public /gallery); Create maps
// to the wizard; Settings maps to the existing surface. Chats maps to /chats.

export type NavIcon =
  | "chats"
  | "discover"
  | "reels"
  | "create"
  | "create-video"
  | "companions"
  | "billing"
  | "settings";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  testid: string;
}

export const APP_NAV: NavItem[] = [
  { href: "/chats", label: "Chats", icon: "chats", testid: "nav-chats" },
  { href: "/discover", label: "Discover", icon: "discover", testid: "nav-discover" },
  { href: "/reels", label: "Reels", icon: "reels", testid: "nav-reels" },
  { href: "/create", label: "Create", icon: "create", testid: "nav-create" },
  // Create Video nav is hidden until the video pipeline ships to production.
  // The /create-video route still exists; this only removes the sidebar/mobile
  // tab so it is not discoverable. Re-add this entry to expose it again.
  // { href: "/create-video", label: "Create Video", icon: "create-video", testid: "nav-create-video" },
  { href: "/companions", label: "Your Companions", icon: "companions", testid: "nav-companions" },
  { href: "/billing", label: "Subscription", icon: "billing", testid: "nav-billing" },
  { href: "/settings", label: "Settings", icon: "settings", testid: "nav-settings" },
];
