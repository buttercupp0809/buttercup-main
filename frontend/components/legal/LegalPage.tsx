import { LEGAL } from "@/lib/legal/config";

// Presentational wrapper for every /legal/* page. Enforces the same visual
// treatment (H1, "draft template" banner, last-updated line, prose measure)
// so we never ship a page that forgets one. Everything sensitive is a
// placeholder token from LEGAL; nothing here is legal advice.

export interface LegalPageProps {
  title: string;
  children: React.ReactNode;
}

export function LegalPage({ title, children }: LegalPageProps) {
  return (
    <article
      data-testid="legal-page"
      className="mx-auto max-w-3xl px-6 py-12 text-slate-800 dark:text-slate-200"
    >
      <h1 className="text-4xl font-semibold tracking-tight">{title}</h1>
      <div
        role="note"
        className="mt-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200"
      >
        <strong>Draft template pending legal review.</strong> This page is a
        placeholder for counsel. It is not legal advice and must not ship
        as-is.
      </div>
      <p className="mt-3 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Last updated: {LEGAL.LAST_UPDATED}
      </p>
      <div className="mt-8 space-y-5 text-base leading-7 [&_h2]:mt-10 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mt-6 [&_h3]:text-xl [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6 [&_p]:leading-7 [&_a]:text-sky-700 [&_a]:underline dark:[&_a]:text-sky-400 [&_strong]:font-semibold">
        {children}
      </div>
    </article>
  );
}
