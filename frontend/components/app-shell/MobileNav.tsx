"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu,
  X,
  MessageCircle,
  Compass,
  Clapperboard,
  Sparkles,
  User as UserIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAV, type NavIcon } from "@/components/app-shell/nav-items";
import { ProfileMenu, type ProfileUser } from "@/components/app-shell/ProfileMenu";
import type { RecentEntry } from "@/components/app-shell/SideNav";

const ICONS: Record<NavIcon, React.ComponentType<{ className?: string }>> = {
  chats: MessageCircle,
  discover: Compass,
  reels: Clapperboard,
  create: Sparkles,
  settings: UserIcon,
};

interface DrawerProps {
  user: ProfileUser;
  recents: RecentEntry[];
}

export function MobileNav({ user, recents }: DrawerProps) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname() ?? "/";
  const firstLinkRef = React.useRef<HTMLAnchorElement>(null);

  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    firstLinkRef.current?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        data-testid="mobile-nav-trigger"
        className="rounded-md p-2 text-white md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside
            data-testid="mobile-nav-drawer"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r"
            style={{
              backgroundColor: "hsl(var(--buttercupp-bg))",
              borderColor: "hsl(var(--buttercupp-border))",
            }}
          >
            <div className="flex items-center justify-between px-4 py-4">
              <span className="font-display text-xl">ButterCupp</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="rounded-md p-1 text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav aria-label="Primary mobile" className="flex flex-col gap-0.5 px-2">
              {APP_NAV.map((item, i) => {
                const Icon = ICONS[item.icon];
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    ref={i === 0 ? firstLinkRef : undefined}
                    data-testid={`${item.testid}-mobile`}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm",
                      active ? "text-white" : "text-slate-300",
                    )}
                    style={{
                      backgroundColor: active ? "hsl(var(--buttercupp-surface-2))" : "transparent",
                    }}
                  >
                    <Icon className="h-5 w-5" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
            {recents.length > 0 ? (
              <div className="mt-4 flex-1 overflow-y-auto px-3">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Recent
                </div>
                <ul className="flex flex-col gap-1">
                  {recents.slice(0, 6).map((r) => (
                    <li key={r.characterId}>
                      <Link
                        href={`/chat/${r.characterId}`}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-300 hover:bg-white/5 hover:text-white"
                      >
                        <div
                          className="h-6 w-6 shrink-0 overflow-hidden rounded-full"
                          style={{ backgroundColor: "hsl(var(--buttercupp-surface-2))" }}
                        >
                          {r.avatarUrl ? (
                            <img src={r.avatarUrl} alt={r.characterName} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold">
                              {r.characterName[0]?.toUpperCase()}
                            </div>
                          )}
                        </div>
                        <span className="truncate">{r.characterName}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="flex-1" />
            )}
            <div className="border-t p-2" style={{ borderColor: "hsl(var(--buttercupp-border))" }}>
              <ProfileMenu user={user} />
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

export function MobileBottomBar() {
  const pathname = usePathname() ?? "/";
  const items = [
    { href: "/chats", label: "Chats", icon: MessageCircle, testid: "bottom-chats" },
    { href: "/discover", label: "Discover", icon: Compass, testid: "bottom-discover" },
    { href: "/reels", label: "Reels", icon: Clapperboard, testid: "bottom-reels" },
    { href: "/create", label: "Create", icon: Sparkles, testid: "bottom-create" },
    { href: "/settings", label: "Profile", icon: UserIcon, testid: "bottom-profile" },
  ];
  return (
    <nav
      aria-label="Primary mobile bottom"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t md:hidden"
      style={{
        backgroundColor: "hsl(var(--buttercupp-bg))",
        borderColor: "hsl(var(--buttercupp-border))",
      }}
    >
      {items.map((it) => {
        const Icon = it.icon;
        const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
        return (
          <Link
            key={it.href}
            href={it.href}
            data-testid={it.testid}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 px-2 py-2 text-[10px]",
              active ? "text-white" : "text-slate-500",
            )}
            style={active ? { color: "hsl(var(--buttercupp-accent-rose))" } : undefined}
          >
            <Icon className="h-5 w-5" />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
