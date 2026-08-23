"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MessageCircle,
  Compass,
  Clapperboard,
  Film,
  Sparkles,
  Users,
  Gem,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAV, type NavIcon, type NavItem } from "@/components/app-shell/nav-items";
import { BrandMark, BrandRow } from "@/components/brand/Logo";
import { ProfileMenu, type ProfileUser } from "@/components/app-shell/ProfileMenu";
import { NavGradientDefs, NavItemLink } from "@/components/app-shell/NavItemLink";

const ICONS: Record<NavIcon, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  chats: MessageCircle,
  discover: Compass,
  reels: Clapperboard,
  create: Sparkles,
  "create-video": Film,
  companions: Users,
  billing: Gem,
  settings: SettingsIcon,
};

export interface RecentEntry {
  characterId: string;
  characterName: string;
  avatarUrl: string | null;
}

export interface SideNavProps {
  user: ProfileUser;
  recents: RecentEntry[];
}

const STORAGE_KEY = "buttercupp.sidenav.collapsed";

export function SideNav({ user, recents }: SideNavProps) {
  const pathname = usePathname() ?? "/";
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "1") setCollapsed(true);
    } catch {
      // localStorage disabled, keep expanded
    }
  }, []);

  const toggle = React.useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r md:flex",
        "sticky top-0 h-screen",
        collapsed ? "w-16" : "w-48",
      )}
      style={{ borderColor: "hsl(var(--bc-border))" }}
    >
      <NavGradientDefs />
      {/* Collapsed rail is 64px wide, so the mark and the toggle stack rather
          than sitting side by side and overflowing. */}
      <div
        className={cn(
          "flex px-4 py-5",
          collapsed ? "flex-col items-center gap-3" : "items-center justify-between",
        )}
      >
        {collapsed ? (
          <Link href="/dashboard" className="bc-press" aria-label="ButterCupp home">
            <BrandMark size={26} priority />
          </Link>
        ) : (
          <Link href="/dashboard" className="bc-press -m-1 rounded-lg p-1" aria-label="ButterCupp home">
            <BrandRow markSize={24} className="[&>span:last-child]:text-[1.15rem]" />
          </Link>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={collapsed}
          className="tap-target flex items-center justify-center rounded-md text-[hsl(var(--bc-muted))] hover:text-[hsl(var(--bc-fg))] focus:outline-none focus-visible:ring-2"
          style={{ outlineColor: "hsl(var(--bc-amber))" }}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <nav
        aria-label="Primary"
        className={cn("flex flex-col gap-1", collapsed ? "items-center px-2" : "px-2")}
      >
        {APP_NAV.map((item: NavItem) => {
          const Icon = ICONS[item.icon];
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <NavItemLink
              key={item.href}
              href={item.href}
              label={item.label}
              testid={item.testid}
              icon={Icon}
              active={active}
              collapsed={collapsed}
            />
          );
        })}
      </nav>

      {!collapsed ? (
        <div className="mt-6 flex-1 overflow-y-auto px-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--bc-subtle))]">
              Recent
            </span>
            {recents.length > 0 ? (
              <Link
                href="/chats"
                className="text-[10px] uppercase tracking-wider text-[hsl(var(--bc-subtle))] hover:text-[hsl(var(--bc-fg))]"
              >
                See all
              </Link>
            ) : null}
          </div>
          {recents.length === 0 ? (
            <p className="text-xs text-[hsl(var(--bc-subtle))]">No conversations yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {recents.slice(0, 6).map((r) => (
                <li key={r.characterId}>
                  <Link
                    href={`/chat/${r.characterId}`}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[hsl(var(--bc-muted))] hover:bg-[hsl(var(--bc-cream)/0.06)] hover:text-[hsl(var(--bc-fg))]"
                  >
                    <Avatar src={r.avatarUrl} name={r.characterName} />
                    <span className="truncate">{r.characterName}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex-1" />
      )}

      <div className="border-t p-2.5" style={{ borderColor: "hsl(var(--bc-border))" }}>
        <ProfileMenu user={user} collapsed={collapsed} placement="up" align="left" />
      </div>
    </aside>
  );
}

function Avatar({ src, name }: { src: string | null; name: string }) {
  return (
    <div
      className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold"
      style={{ backgroundColor: "hsl(var(--bc-surface-2))" }}
    >
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover object-top" />
      ) : (
        <span>{name[0]?.toUpperCase() ?? "?"}</span>
      )}
    </div>
  );
}
