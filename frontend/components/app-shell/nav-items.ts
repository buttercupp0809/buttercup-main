// Primary in-app navigation. Discover renders inside the protected dark shell
// at /discover (so it never bounces to the light public /gallery); Create maps
// to the wizard; Settings maps to the existing surface. Chats maps to /chats.

export type NavIcon = "chats" | "discover" | "reels" | "create" | "settings";

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
  { href: "/settings", label: "Settings", icon: "settings", testid: "nav-settings" },
];
