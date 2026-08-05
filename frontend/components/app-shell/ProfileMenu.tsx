"use client";

import * as React from "react";
import Link from "next/link";
import { LogOut, User as UserIcon, CreditCard } from "lucide-react";
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
}

export function ProfileMenu({
  user,
  collapsed = false,
  placement = "up",
  align = "left",
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
        data-testid="profile-menu-trigger"
        className={cn(
          "flex w-full items-center gap-2 rounded-md p-2 text-left hover:bg-white/5 focus:outline-none focus-visible:ring-2",
          collapsed && "justify-center",
        )}
        style={{ outlineColor: "hsl(var(--buttercupp-accent-rose))" }}
      >
        <Avatar src={user.avatarUrl ?? null} name={name} />
        {!collapsed ? (
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium text-white">{name}</span>
            <TierBadge tier={user.tier} />
          </div>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          data-testid="profile-menu"
          className={cn(
            "absolute z-30 w-56 overflow-hidden rounded-lg border shadow-xl",
            placement === "down" ? "top-full mt-2" : "bottom-full mb-2",
            align === "right" ? "right-0" : "left-0",
          )}
          style={{
            backgroundColor: "hsl(var(--buttercupp-surface))",
            borderColor: "hsl(var(--buttercupp-border))",
          }}
        >
          <div className="border-b px-3 py-2 text-xs text-slate-400" style={{ borderColor: "hsl(var(--buttercupp-border))" }}>
            {user.email}
          </div>
          <MenuLink href="/settings" icon={<UserIcon className="h-4 w-4" />} onClick={() => setOpen(false)}>
            Profile
          </MenuLink>
          <MenuLink href="/billing" icon={<CreditCard className="h-4 w-4" />} onClick={() => setOpen(false)}>
            Billing
          </MenuLink>
          <button
            type="button"
            onClick={logout}
            disabled={busy}
            data-testid="logout-button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-300 hover:bg-white/5 disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
            {busy ? "Signing out..." : "Log out"}
          </button>
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
      className="flex items-center gap-2 px-3 py-2 text-sm text-slate-200 hover:bg-white/5"
    >
      {icon}
      {children}
    </Link>
  );
}

function Avatar({ src, name }: { src: string | null; name: string }) {
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold text-white"
      style={{ backgroundColor: "hsl(var(--buttercupp-accent-violet) / 0.4)" }}
    >
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span>{name[0]?.toUpperCase() ?? "?"}</span>
      )}
    </div>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const key = tier.toLowerCase();
  const isPaid = key !== "free";
  return (
    <span
      className="mt-0.5 inline-flex w-fit items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
      style={
        isPaid
          ? {
              backgroundColor: "hsl(var(--buttercupp-accent-rose) / 0.18)",
              color: "hsl(var(--buttercupp-accent-rose))",
            }
          : {
              backgroundColor: "hsl(var(--buttercupp-surface-2))",
              color: "hsl(var(--buttercupp-muted))",
            }
      }
    >
      {tier}
    </span>
  );
}
