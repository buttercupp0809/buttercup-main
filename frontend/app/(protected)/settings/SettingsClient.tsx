"use client";

// Interactive settings surface. Handles password change, data export
// download, and account deletion with typed confirmation.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Mail,
  Globe2,
  Sparkles,
  Coins,
  ShieldCheck,
  KeyRound,
  Download,
  LogOut,
  Trash2,
  ArrowUpRight,
  Lock,
} from "lucide-react";
import { TRUST_CHIPS } from "@/components/trust/copy";
import { Button } from "@/components/ui/button";

interface Props {
  email: string;
  jurisdiction: string | null;
  tier: string;
  tokenBalance: number;
  ageVerified: boolean;
}

export function SettingsClient(props: Props) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [pwStatus, setPwStatus] = React.useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);
  const [loggingOut, setLoggingOut] = React.useState(false);

  function logout() {
    setLoggingOut(true);
    // Full-navigation to the canonical /logout endpoint (clears the auth
    // cookie server-side and 303-redirects to /login). See
    // frontend/app/logout/route.ts.
    window.location.assign("/logout");
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwStatus(null);
    const res = await fetch("/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (res.ok) {
      setPwStatus({ kind: "ok", text: "Password updated." });
      setCurrentPassword("");
      setNewPassword("");
    } else {
      const body = await res.json().catch(() => ({}));
      setPwStatus({ kind: "err", text: (body as { error?: string }).error ?? `Error ${res.status}` });
    }
  }

  async function exportData() {
    const res = await fetch("/api/me/export", { method: "POST" });
    if (!res.ok) return alert("Export failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "buttercupp-export.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function deleteAccount() {
    if (deleteConfirm !== "DELETE") return;
    setDeleting(true);
    const res = await fetch("/api/me", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "DELETE" }),
    });
    setDeleting(false);
    if (res.ok) {
      alert("Account deleted.");
      router.push("/");
    } else {
      alert("Delete failed");
    }
  }

  const inputCls =
    "tap-target w-full rounded-[var(--bc-radius-sm)] border px-3.5 py-2.5 text-sm outline-none transition-[border-color,background-color,box-shadow] duration-200 ease-[var(--ease-out)] placeholder:text-[hsl(var(--bc-muted))] hover:border-[hsl(var(--bc-border-strong))] focus-visible:border-[hsl(var(--bc-amber)/0.6)] focus-visible:ring-2 focus-visible:ring-[hsl(var(--bc-amber))]";
  const inputStyle = {
    borderColor: "hsl(var(--bc-border))",
    backgroundColor: "hsl(var(--bc-surface-2) / 0.6)",
    color: "hsl(var(--bc-fg))",
  } as const;

  const tierLabel = props.tier.charAt(0).toUpperCase() + props.tier.slice(1);
  const isPremium = props.tier !== "free";

  return (
    <div className="flex flex-col gap-6">
      {/* Profile summary */}
      <SectionCard
        index={0}
        title="Profile"
        subtitle="What ButterCupp knows about your account."
        icon={<ShieldCheck className="h-4 w-4" />}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <InfoRow icon={<Mail className="h-4 w-4" />} label="Email" value={props.email} />
          <InfoRow
            icon={<Globe2 className="h-4 w-4" />}
            label="Jurisdiction"
            value={props.jurisdiction ?? "Not set"}
          />
          <InfoRow
            icon={<Sparkles className="h-4 w-4" />}
            label="Plan"
            value={
              <span className="inline-flex items-center gap-2">
                <span className="capitalize">{tierLabel}</span>
                {isPremium ? (
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                    style={{
                      background: "var(--bc-gradient-brand-h)",
                      color: "hsl(28 45% 9%)",
                    }}
                  >
                    Premium
                  </span>
                ) : null}
              </span>
            }
            action={
              <Link href="/billing" aria-label="Manage subscription">
                <Button size="sm" variant="ghost" className="h-8 px-2 text-xs">
                  Manage <ArrowUpRight className="h-3 w-3" />
                </Button>
              </Link>
            }
          />
          <InfoRow
            icon={<Coins className="h-4 w-4" />}
            label="Tokens"
            value={<span className="font-semibold">{props.tokenBalance.toLocaleString()}</span>}
            action={
              <Link href="/billing#token-store">
                <Button size="sm" variant="ghost" className="h-8 px-2 text-xs">
                  Buy more <ArrowUpRight className="h-3 w-3" />
                </Button>
              </Link>
            }
          />
          <InfoRow
            icon={<Lock className="h-4 w-4" />}
            label="Age verified"
            value={
              <span
                className={
                  props.ageVerified
                    ? "inline-flex items-center gap-1.5 text-[hsl(var(--bc-success))]"
                    : "inline-flex items-center gap-1.5"
                }
                style={props.ageVerified ? undefined : { color: "hsl(var(--bc-muted))" }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    backgroundColor: props.ageVerified ? "hsl(var(--bc-success))" : "hsl(var(--bc-muted))",
                  }}
                />
                {props.ageVerified ? "Verified" : "Not verified"}
              </span>
            }
          />
        </div>
      </SectionCard>

      {/* Change password */}
      <SectionCard
        index={1}
        title="Change password"
        subtitle="Use a strong, unique password. We hash and salt it, never store it plain."
        icon={<KeyRound className="h-4 w-4" />}
      >
        <form onSubmit={changePassword} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              type="password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={inputCls}
              style={inputStyle}
              autoComplete="current-password"
            />
            <input
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputCls}
              style={inputStyle}
              autoComplete="new-password"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="sm">Update password</Button>
            {pwStatus ? (
              <span
                className="text-xs"
                style={{
                  color:
                    pwStatus.kind === "ok"
                      ? "hsl(var(--bc-success))"
                      : "hsl(var(--bc-danger))",
                }}
              >
                {pwStatus.text}
              </span>
            ) : null}
          </div>
        </form>
      </SectionCard>

      {/* Privacy promise */}
      <div
        className="bc-rise relative overflow-hidden rounded-[var(--bc-radius-lg)] border p-5 sm:p-6"
        style={
          {
            "--i": 2,
            borderColor: "hsl(var(--bc-amber) / 0.35)",
            background:
              "linear-gradient(135deg, hsl(var(--bc-amber) / 0.08), hsl(var(--bc-honey) / 0.08))",
          } as React.CSSProperties
        }
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-40 blur-3xl"
          style={{ backgroundColor: "hsl(var(--bc-amber) / 0.35)" }}
        />
        <div className="relative flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--bc-radius)] ring-1 ring-[hsl(var(--bc-amber)/0.25)]"
              style={{
                background:
                  "linear-gradient(135deg, hsl(var(--bc-honey) / 0.2), hsl(var(--bc-amber) / 0.2))",
                color: "hsl(var(--bc-amber))",
              }}
            >
              <ShieldCheck className="h-4 w-4" />
            </div>
            <h2 className="font-display text-lg font-semibold tracking-tight">Your privacy</h2>
          </div>
          <p className="max-w-prose text-pretty text-sm" style={{ color: "hsl(var(--bc-muted))" }}>
            Locked in transit, locked at rest, scoped to your account. Not sold, not used to train other AIs.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {TRUST_CHIPS.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-medium"
                style={{
                  borderColor: "hsl(var(--bc-border))",
                  color: "hsl(var(--bc-fg))",
                  background: "hsl(var(--bc-surface-2) / 0.65)",
                }}
              >
                {c.label}
              </span>
            ))}
          </div>
          <Link
            href="/legal/privacy-promise"
            className="inline-flex w-fit items-center gap-1 text-xs font-semibold underline-offset-2 hover:underline"
            style={{ color: "hsl(var(--bc-honey))" }}
          >
            Read our privacy promise <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Data + Session (side by side on desktop) */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <SectionCard
          index={3}
          title="Your data"
          subtitle="Download a JSON copy of your profile, messages, memories, characters, and ledger."
          icon={<Download className="h-4 w-4" />}
        >
          <Button variant="outline" size="sm" type="button" onClick={exportData}>
            <Download className="h-4 w-4" /> Export my data
          </Button>
        </SectionCard>
        <SectionCard
          index={4}
          title="Session"
          subtitle="Sign out of ButterCupp on this device. Other devices stay signed in."
          icon={<LogOut className="h-4 w-4" />}
        >
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={logout}
            disabled={loggingOut}
            data-testid="settings-logout"
          >
            <LogOut className="h-4 w-4" />
            {loggingOut ? "Signing out..." : "Log out"}
          </Button>
        </SectionCard>
      </div>

      {/* Danger zone */}
      <div
        className="bc-rise relative overflow-hidden rounded-[var(--bc-radius-lg)] border p-5 sm:p-6"
        style={
          {
            "--i": 5,
            borderColor: "hsl(var(--bc-danger) / 0.5)",
            background:
              "linear-gradient(135deg, hsl(var(--bc-danger) / 0.07), hsl(var(--bc-danger) / 0.03))",
          } as React.CSSProperties
        }
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-30 blur-3xl"
          style={{ backgroundColor: "hsl(var(--bc-danger) / 0.35)" }}
        />
        <div className="relative flex items-start gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--bc-radius)] ring-1 ring-[hsl(var(--bc-danger)/0.3)]"
            style={{
              background: "hsl(var(--bc-danger) / 0.15)",
              color: "hsl(var(--bc-danger))",
            }}
          >
            <Trash2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2
              className="font-display text-lg font-semibold tracking-tight"
              style={{ color: "hsl(var(--bc-danger))" }}
            >
              Delete account
            </h2>
            <p className="mt-0.5 text-xs" style={{ color: "hsl(var(--bc-muted))" }}>
              This wipes your messages, memories, and characters. It cannot be undone.
            </p>
          </div>
        </div>
        <div
          className="relative mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center"
          style={{ borderColor: "hsl(var(--bc-danger) / 0.18)" }}
        >
          <input
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder="Type DELETE to confirm"
            aria-label="Type DELETE to confirm account deletion"
            className={inputCls}
            style={{
              borderColor: "hsl(var(--bc-danger) / 0.5)",
              backgroundColor: "hsl(var(--bc-surface-2) / 0.6)",
              color: "hsl(var(--bc-fg))",
            }}
          />
          <button
            type="button"
            onClick={deleteAccount}
            disabled={deleteConfirm !== "DELETE" || deleting}
            className="bc-press tap-target inline-flex shrink-0 items-center justify-center gap-2 rounded-[var(--bc-radius-sm)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_1px_0_hsl(2_84%_74%/0.4)_inset,0_8px_24px_-12px_hsl(var(--bc-danger)/0.55)] transition-[transform,filter,box-shadow] duration-200 ease-[var(--ease-out)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              background:
                "linear-gradient(180deg, hsl(var(--bc-danger)), hsl(2 74% 46%))",
            }}
          >
            <Trash2 className="h-4 w-4" />
            {deleting ? "Deleting..." : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionCard({
  index,
  title,
  subtitle,
  icon,
  children,
}: {
  index?: number;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className="buttercupp-glass bc-rise flex h-full flex-col rounded-[var(--bc-radius-lg)] p-5 sm:p-6"
      style={{ "--i": index ?? 0 } as React.CSSProperties}
    >
      <div className="mb-5 flex items-start gap-3">
        {icon ? (
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--bc-radius)] ring-1 ring-[hsl(var(--bc-amber)/0.2)]"
            style={{
              background:
                "linear-gradient(135deg, hsl(var(--bc-honey) / 0.15), hsl(var(--bc-amber) / 0.15))",
              color: "hsl(var(--bc-amber))",
            }}
          >
            {icon}
          </div>
        ) : null}
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
          {subtitle ? (
            <p className="mt-1 text-pretty text-xs leading-relaxed" style={{ color: "hsl(var(--bc-muted))" }}>
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function InfoRow({
  icon,
  label,
  value,
  action,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-[var(--bc-radius-sm)] border px-3.5 py-3 transition-[border-color,background-color] duration-200 ease-[var(--ease-out)] hover:border-[hsl(var(--bc-amber)/0.3)] hover:bg-[hsl(var(--bc-surface-2)/0.6)]"
      style={{
        borderColor: "hsl(var(--bc-border))",
        backgroundColor: "hsl(var(--bc-surface-2) / 0.4)",
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--bc-radius-xs)]"
          style={{
            backgroundColor: "hsl(var(--bc-surface-2))",
            color: "hsl(var(--bc-muted))",
          }}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <div
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "hsl(var(--bc-muted))" }}
          >
            {label}
          </div>
          <div className="truncate text-sm font-medium">{value}</div>
        </div>
      </div>
      {action}
    </div>
  );
}
