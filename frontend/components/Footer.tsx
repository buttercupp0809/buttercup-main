import Link from "next/link";
import { LEGAL_PAGES } from "@/lib/legal/config";

// Site-wide footer for public + legal routes. Legal + Company links source
// from LEGAL_PAGES so the routing table and the footer never drift; add or
// rename a page there and the footer follows.

const LEGAL_LINKS = LEGAL_PAGES.filter((p) => p.group === "legal").map((p) => ({
  href: `/legal/${p.slug}`,
  label: p.title,
}));

const COMPANY_LINKS = LEGAL_PAGES.filter((p) => p.group === "company").map((p) => ({
  href: `/legal/${p.slug}`,
  label: p.title,
}));

// PLACEHOLDER: real social URL
const SOCIAL_LINKS: Array<{ href: string; label: string }> = [
  // PLACEHOLDER: real social URL
  { href: "https://x.com/buttercupp", label: "X" },
  // PLACEHOLDER: real social URL
  { href: "https://instagram.com/buttercupp", label: "Instagram" },
  // PLACEHOLDER: real social URL
  { href: "https://discord.gg/buttercupp", label: "Discord" },
];

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer
      data-testid="site-footer"
      className="mt-16 border-t border-slate-200 bg-white text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400"
    >
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-12 sm:grid-cols-4">
        <div className="col-span-2 flex flex-col gap-3 sm:col-span-1">
          <Link href="/" className="text-base font-semibold text-slate-900 dark:text-white">
            ButterCupp
          </Link>
          <p className="max-w-xs text-xs">
            Unfiltered AI companions built for grown-ups.
          </p>
          <span className="inline-flex w-fit items-center gap-1 rounded-full border border-slate-300 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:border-slate-700 dark:text-slate-300">
            18+
          </span>
        </div>
        <div>
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Legal
          </div>
          <ul className="flex flex-col gap-2">
            {LEGAL_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="hover:text-slate-900 hover:underline dark:hover:text-white">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Company
          </div>
          <ul className="flex flex-col gap-2">
            {COMPANY_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="hover:text-slate-900 hover:underline dark:hover:text-white">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Social
          </div>
          <ul className="flex flex-col gap-2">
            {SOCIAL_LINKS.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-slate-900 hover:underline dark:hover:text-white"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-200 py-6 text-center text-xs dark:border-slate-800">
        &copy; {year} ButterCupp Labs. All rights reserved.
      </div>
    </footer>
  );
}
