"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MessageCircle,
  Compass,
  Clapperboard,
  Sparkles,
  Users,
  Gem,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAV, type NavIcon, type NavItem } from "@/components/app-shell/nav-items";
import { ProfileMenu, type ProfileUser } from "@/components/app-shell/ProfileMenu";
import { NavGradientDefs, NavItemLink } from "@/components/app-shell/NavItemLink";

const ICONS: Record<NavIcon, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  chats: MessageCircle,
  discover: Compass,
  reels: Clapperboard,
  create: Sparkles,
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
      style={{ borderColor: "hsl(var(--buttercupp-border))" }}
    >
      <NavGradientDefs />
      <div className={cn("flex items-center px-4 py-5", collapsed ? "justify-center" : "justify-between")}>
        {!collapsed ? (
          <Link
            href="/dashboard"
            className="font-display text-2xl font-semibold tracking-tight"
            style={{ color: "hsl(var(--buttercupp-fg))" }}
          >
            ButterCupp
          </Link>
        ) : null}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={collapsed}
          className="tap-target flex items-center justify-center rounded-md text-slate-400 hover:text-white focus:outline-none focus-visible:ring-2"
          style={{ outlineColor: "hsl(var(--buttercupp-accent-rose))" }}
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
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Recent
            </span>
            {recents.length > 0 ? (
              <Link
                href="/chats"
                className="text-[10px] uppercase tracking-wider text-slate-500 hover:text-white"
              >
                See all
              </Link>
            ) : null}
          </div>
          {recents.length === 0 ? (
            <p className="text-xs text-slate-500">No conversations yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {recents.slice(0, 6).map((r) => (
                <li key={r.characterId}>
                  <Link
                    href={`/chat/${r.characterId}`}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-300 hover:bg-white/5 hover:text-white"
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

      <div className="border-t p-2.5" style={{ borderColor: "hsl(var(--buttercupp-border))" }}>
        <ProfileMenu user={user} collapsed={collapsed} placement="up" align="left" />
      </div>
    </aside>
  );
}

function Avatar({ src, name }: { src: string | null; name: string }) {
  return (
    <div
      className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold"
      style={{ backgroundColor: "hsl(var(--buttercupp-surface-2))" }}
    >
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover object-top" />
      ) : (
        <span>{name[0]?.toUpperCase() ?? "?"}</span>
      )}
    </div>
  );
}
