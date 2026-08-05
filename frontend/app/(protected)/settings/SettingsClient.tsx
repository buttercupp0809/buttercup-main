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

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <h2 className="mb-2 text-lg font-semibold">Profile</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-slate-500">Email</dt>
          <dd>{props.email}</dd>
          <dt className="text-slate-500">Jurisdiction</dt>
          <dd>{props.jurisdiction ?? "not set"}</dd>
          <dt className="text-slate-500">Tier</dt>
          <dd className="capitalize">{props.tier}</dd>
          <dt className="text-slate-500">Tokens</dt>
          <dd>{props.tokenBalance}</dd>
          <dt className="text-slate-500">Age verified</dt>
          <dd>{props.ageVerified ? "yes" : "no"}</dd>
        </dl>
      </section>

      <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <h2 className="mb-2 text-lg font-semibold">Change password</h2>
        <form onSubmit={changePassword} className="flex flex-col gap-3">
          <input
            type="password"
            placeholder="Current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            type="password"
            placeholder="New password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="self-start rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white">
            Update password
          </button>
          {pwStatus ? <span className="text-xs text-slate-500">{pwStatus}</span> : null}
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <h2 className="mb-2 text-lg font-semibold">Data</h2>
        <p className="mb-2 text-sm text-slate-600">
          Export a copy of your data (profile, messages, memories, characters, ledger) as a JSON file.
        </p>
        <button
          type="button"
          onClick={exportData}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        >
          Export my data
        </button>
      </section>

      <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <h2 className="mb-2 text-lg font-semibold">Session</h2>
        <p className="mb-2 text-sm text-slate-600 dark:text-slate-400">
          Sign out of ButterCupp on this device. Other devices stay signed in.
        </p>
        <button
          type="button"
          onClick={logout}
          disabled={loggingOut}
          data-testid="settings-logout"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
        >
          {loggingOut ? "Signing out..." : "Log out"}
        </button>
      </section>

      <section className="rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
        <h2 className="mb-2 text-lg font-semibold text-red-700 dark:text-red-300">Delete account</h2>
        <p className="mb-2 text-sm text-red-700 dark:text-red-300">
          Type <strong>DELETE</strong> to confirm. This cannot be undone.
        </p>
        <div className="flex items-center gap-2">
          <input
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder="DELETE"
            className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={deleteAccount}
            disabled={deleteConfirm !== "DELETE" || deleting}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {deleting ? "Deleting..." : "Delete permanently"}
          </button>
        </div>
      </section>
    </div>
  );
}
