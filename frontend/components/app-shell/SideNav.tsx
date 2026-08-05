"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MessageCircle,
  Compass,
  Sparkles,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAV, type NavIcon } from "@/components/app-shell/nav-items";
import { ProfileMenu, type ProfileUser } from "@/components/app-shell/ProfileMenu";

const ICONS: Record<NavIcon, React.ComponentType<{ className?: string }>> = {
  chats: MessageCircle,
  discover: Compass,
  create: Sparkles,
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

const STORAGE_KEY = "poppy.sidenav.collapsed";

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
        collapsed ? "w-16" : "w-64",
      )}
      style={{ borderColor: "hsl(var(--poppy-border))" }}
    >
      <div className={cn("flex items-center px-4 py-5", collapsed ? "justify-center" : "justify-between")}>
        {!collapsed ? (
          <Link
            href="/dashboard"
            className="font-display text-2xl font-semibold tracking-tight"
            style={{ color: "hsl(var(--poppy-fg))" }}
          >
            Poppy
          </Link>
        ) : null}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={collapsed}
          className="rounded-md p-1 text-slate-400 hover:text-white focus:outline-none focus-visible:ring-2"
          style={{ outlineColor: "hsl(var(--poppy-accent-rose))" }}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <nav
        aria-label="Primary"
        className={cn("flex flex-col gap-1.5", collapsed ? "items-center px-0" : "px-2")}
      >
        {APP_NAV.map((item) => {
          const Icon = ICONS[item.icon];
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              data-testid={item.testid}
              aria-current={active ? "page" : undefined}
              title={collapsed ? item.label : undefined}
              className={cn(
                "relative flex items-center text-sm transition focus:outline-none focus-visible:ring-2",
                collapsed
                  ? // Collapsed: each icon lives in its own boxed square so the
                    // rail stays legible and tappable when narrow.
                    "h-10 w-10 justify-center rounded-xl border"
                  : "gap-3 rounded-md border border-transparent px-3 py-2",
                active ? "text-white" : "text-slate-300 hover:text-white",
              )}
              style={{
                backgroundColor: active
                  ? collapsed
                    ? "hsl(var(--poppy-accent-rose) / 0.15)"
                    : "hsl(var(--poppy-surface-2))"
                  : collapsed
                    ? "hsl(var(--poppy-surface-2))"
                    : "transparent",
                borderColor: active
                  ? "hsl(var(--poppy-accent-rose))"
                  : collapsed
                    ? "hsl(var(--poppy-border))"
                    : "transparent",
                outlineColor: "hsl(var(--poppy-accent-rose))",
              }}
            >
              {active && !collapsed ? (
                <span
                  aria-hidden
                  className="absolute inset-y-1 left-0 w-0.5 rounded-full"
                  style={{ backgroundColor: "hsl(var(--poppy-accent-rose))" }}
                />
              ) : null}
              <Icon className="h-5 w-5 shrink-0" />
              {!collapsed ? <span>{item.label}</span> : null}
            </Link>
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

      <div className="border-t p-2" style={{ borderColor: "hsl(var(--poppy-border))" }}>
        <ProfileMenu user={user} collapsed={collapsed} />
      </div>
    </aside>
  );
}

function Avatar({ src, name }: { src: string | null; name: string }) {
  return (
    <div
      className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold"
      style={{ backgroundColor: "hsl(var(--poppy-surface-2))" }}
    >
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span>{name[0]?.toUpperCase() ?? "?"}</span>
      )}
    </div>
  );
}
