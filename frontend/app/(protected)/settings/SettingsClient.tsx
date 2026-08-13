"use client";

// Interactive settings surface. Handles password change, data export
// download, and account deletion with typed confirmation.

import * as React from "react";
import { useRouter } from "next/navigation";

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
  const [pwStatus, setPwStatus] = React.useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);
  const [loggingOut, setLoggingOut] = React.useState(false);

  async function logout() {
    setLoggingOut(true);
    const res = await fetch("/api/auth/logout", { method: "POST" });
    if (!res.ok) {
      setLoggingOut(false);
      alert("Logout failed. Try again.");
      return;
    }
    window.location.assign("/");
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
      setPwStatus("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
    } else {
      const body = await res.json().catch(() => ({}));
      setPwStatus(`Error: ${(body as { error?: string }).error ?? res.status}`);
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

  const sectionStyle = {
    borderColor: "hsl(var(--buttercupp-border))",
    backgroundColor: "hsl(var(--buttercupp-surface))",
  } as const;
  const inputCls = "rounded-md border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400";
  const inputStyle = {
    borderColor: "hsl(var(--buttercupp-border))",
    backgroundColor: "hsl(var(--buttercupp-surface))",
    color: "hsl(var(--buttercupp-fg))",
  } as const;

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-lg border p-4" style={sectionStyle}>
        <h2 className="mb-2 text-lg font-semibold">Profile</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt style={{ color: "hsl(var(--buttercupp-muted))" }}>Email</dt>
          <dd>{props.email}</dd>
          <dt style={{ color: "hsl(var(--buttercupp-muted))" }}>Jurisdiction</dt>
          <dd>{props.jurisdiction ?? "not set"}</dd>
          <dt style={{ color: "hsl(var(--buttercupp-muted))" }}>Tier</dt>
          <dd className="capitalize">{props.tier}</dd>
          <dt style={{ color: "hsl(var(--buttercupp-muted))" }}>Tokens</dt>
          <dd>{props.tokenBalance}</dd>
          <dt style={{ color: "hsl(var(--buttercupp-muted))" }}>Age verified</dt>
          <dd>{props.ageVerified ? "yes" : "no"}</dd>
        </dl>
      </section>

      <section className="rounded-lg border p-4" style={sectionStyle}>
        <h2 className="mb-2 text-lg font-semibold">Change password</h2>
        <form onSubmit={changePassword} className="flex flex-col gap-3">
          <input
            type="password"
            placeholder="Current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className={inputCls}
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="New password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={inputCls}
            style={inputStyle}
          />
          <button
            type="submit"
            className="self-start rounded-md px-3 py-1.5 text-sm"
            style={{
              backgroundColor: "hsl(var(--buttercupp-accent-rose))",
              color: "hsl(var(--buttercupp-primary-fg))",
            }}
          >
            Update password
          </button>
          {pwStatus ? <span className="text-xs" style={{ color: "hsl(var(--buttercupp-muted))" }}>{pwStatus}</span> : null}
        </form>
      </section>

      <section className="rounded-lg border p-4" style={sectionStyle}>
        <h2 className="mb-2 text-lg font-semibold">Data</h2>
        <p className="mb-2 text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
          Export a copy of your data (profile, messages, memories, characters, ledger) as a JSON file.
        </p>
        <button
          type="button"
          onClick={exportData}
          className="rounded-md border px-3 py-1.5 text-sm"
          style={{
            borderColor: "hsl(var(--buttercupp-border))",
            color: "hsl(var(--buttercupp-fg))",
          }}
        >
          Export my data
        </button>
      </section>

      <section className="rounded-lg border p-4" style={sectionStyle}>
        <h2 className="mb-2 text-lg font-semibold">Session</h2>
        <p className="mb-2 text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
          Sign out of ButterCupp on this device. Other devices stay signed in.
        </p>
        <button
          type="button"
          onClick={logout}
          disabled={loggingOut}
          data-testid="settings-logout"
          className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
          style={{
            borderColor: "hsl(var(--buttercupp-border))",
            color: "hsl(var(--buttercupp-fg))",
          }}
        >
          {loggingOut ? "Signing out..." : "Log out"}
        </button>
      </section>

      <section
        className="rounded-lg border p-4"
        style={{
          borderColor: "hsl(var(--buttercupp-accent-rose) / 0.5)",
          backgroundColor: "hsl(var(--buttercupp-accent-rose) / 0.08)",
        }}
      >
        <h2 className="mb-2 text-lg font-semibold" style={{ color: "hsl(var(--buttercupp-accent-rose))" }}>Delete account</h2>
        <p className="mb-2 text-sm" style={{ color: "hsl(var(--buttercupp-accent-rose))" }}>
          Type <strong>DELETE</strong> to confirm. This cannot be undone.
        </p>
        <div className="flex items-center gap-2">
          <input
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder="DELETE"
            className="rounded-md border px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
            style={{
              borderColor: "hsl(var(--buttercupp-accent-rose) / 0.5)",
              backgroundColor: "hsl(var(--buttercupp-surface))",
              color: "hsl(var(--buttercupp-fg))",
            }}
          />
          <button
            type="button"
            onClick={deleteAccount}
            disabled={deleteConfirm !== "DELETE" || deleting}
            className="rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
            style={{
              backgroundColor: "hsl(var(--buttercupp-accent-rose))",
              color: "hsl(var(--buttercupp-primary-fg))",
            }}
          >
            {deleting ? "Deleting..." : "Delete permanently"}
          </button>
        </div>
      </section>
    </div>
  );
}
