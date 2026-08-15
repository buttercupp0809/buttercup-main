"use client";

import * as React from "react";
import Link from "next/link";
import { LogOut, Settings as SettingsIcon, Gem, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ProfileUser {
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  tier: string;
}

export interface ProfileMenuProps {
  user: ProfileUser;
  collapsed?: boolean;
  // "up" = open above the trigger (sidebar footer). "down" = open below it
  // (top header). "align" controls which edge the panel sticks to.
  placement?: "up" | "down";
  align?: "left" | "right";
  // The same component renders at two independent sites (sidebar footer and
  // the desktop top-right header icon), both mounted at once on desktop.
  // Distinct testids keep Playwright's strict-mode locator resolution
  // unambiguous; defaults preserve the original sidebar/mobile-drawer ids.
  triggerTestId?: string;
  menuTestId?: string;
}

export function ProfileMenu({
  user,
  collapsed = false,
  placement = "up",
  align = "left",
  triggerTestId = "profile-menu-trigger",
  menuTestId = "profile-menu",
}: ProfileMenuProps) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  async function logout() {
    setBusy(true);
    setError(null);
    try {
      // Middleware rejects POSTs without a JSON content-type (415), which
      // silently broke logout. Send the header (and an empty JSON body).
      const res = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        setError("Logout failed. Try again.");
        setBusy(false);
        return;
      }
      // Hard nav so the server re-reads the cleared cookie before rendering.
      window.location.assign("/");
    } catch {
      setError("Logout failed. Try again.");
      setBusy(false);
    }
  }

  const name = user.displayName || user.email.split("@")[0];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={triggerTestId}
        className={cn(
          "tap-target flex w-full items-center gap-2.5 rounded-xl border border-transparent p-2 text-left transition hover:border-[hsl(var(--buttercupp-border))] hover:bg-white/5 focus:outline-none focus-visible:ring-2",
          open && "border-[hsl(var(--buttercupp-border))] bg-white/5",
          collapsed && "justify-center",
        )}
        style={{ outlineColor: "hsl(var(--buttercupp-accent-rose))" }}
      >
        <Avatar src={user.avatarUrl ?? null} name={name} />
        {!collapsed ? (
          <>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-semibold leading-tight text-white">{name}</span>
              <TierBadge tier={user.tier} />
            </div>
            <ChevronsUpDown
              aria-hidden
              className="h-3.5 w-3.5 shrink-0 text-slate-500"
            />
          </>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          data-testid={menuTestId}
          className={cn(
            "buttercupp-glass absolute z-30 w-60 overflow-hidden rounded-xl shadow-xl",
            placement === "down" ? "top-full mt-2" : "bottom-full mb-2",
            align === "right" ? "right-0" : "left-0",
          )}
          style={{
            backgroundColor: "hsl(var(--buttercupp-surface))",
            borderColor: "hsl(var(--buttercupp-border))",
          }}
        >
          <div
            className="flex items-center gap-2.5 border-b px-3 py-3"
            style={{ borderColor: "hsl(var(--buttercupp-border))" }}
          >
            <Avatar src={user.avatarUrl ?? null} name={name} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm font-semibold text-white">{name}</span>
              <span className="truncate text-xs text-slate-400">{user.email}</span>
            </div>
          </div>
          <div className="p-1.5">
            <MenuLink href="/billing" icon={<Gem className="h-4 w-4" />} onClick={() => setOpen(false)}>
              Subscription
            </MenuLink>
            <MenuLink href="/settings" icon={<SettingsIcon className="h-4 w-4" />} onClick={() => setOpen(false)}>
              Account &amp; email settings
            </MenuLink>
          </div>
          <div className="border-t p-1.5" style={{ borderColor: "hsl(var(--buttercupp-border))" }}>
            <button
              type="button"
              onClick={logout}
              disabled={busy}
              data-testid="logout-button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition hover:bg-white/5 disabled:opacity-50"
              style={{ color: "hsl(var(--buttercupp-accent-rose))" }}
            >
              <LogOut className="h-4 w-4" />
              {busy ? "Signing out..." : "Sign out"}
            </button>
          </div>
          {error ? <p className="px-3 pb-2 text-xs text-red-400">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({
  href,
  icon,
  onClick,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      role="menuitem"
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-200 transition hover:bg-white/5 hover:text-white"
    >
      {icon}
      {children}
    </Link>
  );
}

// Gradient ring (rose -> violet, matching PremiumPill) wraps a flat-filled
// disc so the avatar reads as a deliberate brand mark rather than a plain
// circle.
function Avatar({ src, name }: { src: string | null; name: string }) {
  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full p-[1.5px]"
      style={{
        background: "linear-gradient(135deg, hsl(var(--buttercupp-accent-rose)), hsl(var(--buttercupp-accent-violet)))",
      }}
    >
      <div
        className="flex h-full w-full items-center justify-center overflow-hidden rounded-full text-sm font-semibold text-white"
        style={{ backgroundColor: "hsl(var(--buttercupp-surface-2))" }}
      >
        {src ? (
          <img src={src} alt={name} className="h-full w-full object-cover" />
        ) : (
          <span>{name[0]?.toUpperCase() ?? "?"}</span>
        )}
      </div>
    </div>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const key = tier.toLowerCase();
  const isPaid = key !== "free";
  return (
    <span
      className="inline-flex w-fit items-center gap-1 rounded-full px-1.5 py-[1px] text-[10px] font-bold uppercase tracking-wider"
      style={
        isPaid
          ? {
              backgroundColor: "hsl(var(--buttercupp-accent-rose) / 0.16)",
              color: "hsl(var(--buttercupp-accent-rose))",
              border: "1px solid hsl(var(--buttercupp-accent-rose) / 0.35)",
            }
          : {
              backgroundColor: "hsl(var(--buttercupp-surface-2))",
              color: "hsl(var(--buttercupp-muted))",
              border: "1px solid hsl(var(--buttercupp-border))",
            }
      }
    >
      <span
        aria-hidden
        className="h-1 w-1 rounded-full"
        style={{
          backgroundColor: isPaid
            ? "hsl(var(--buttercupp-accent-rose))"
            : "hsl(var(--buttercupp-muted))",
        }}
      />
      {tier}
    </span>
  );
}
