import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

// Geist (clean modern sans, matches the Candy/Nastia aesthetic) powers both
// body and headings. Loaded ONCE and exposed as --font-geist; globals.css maps
// --font-body and --font-display to it. Headings get character from weight +
// tight tracking (see .font-display), not a second face, so nothing can fail
// to load or clash.
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "ButterCupp",
  description: "companions built for adults.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${geist.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
