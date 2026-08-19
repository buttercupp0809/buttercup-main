import type { Metadata, Viewport } from "next";
import { Geist, Fraunces } from "next/font/google";
import Script from "next/script";
import "./globals.css";

// Geist carries all UI and body copy: neutral, tight, excellent at small sizes.
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

// Fraunces carries headlines. The brand wordmark is a soft high-contrast serif,
// so a serif display face is what makes a page look like it belongs to the
// logo; Geist alone (the old setup used it for both) had no voice of its own.
// SOFT rounds the terminals toward the mark's shapes, WONK keeps the single
// storey g/y quirk that stops it reading as a stock editorial serif.
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["SOFT", "WONK"],
});

export const metadata: Metadata = {
  title: {
    default: "ButterCupp - AI GF with no limits",
    template: "%s - ButterCupp",
  },
  description:
    "Companions who remember you. Build a bond that actually grows, chat without limits, and make her yours.",
  icons: {
    icon: [{ url: "/brand/mark.svg", type: "image/svg+xml" }],
    apple: [{ url: "/brand/mark.svg" }],
  },
  openGraph: {
    title: "ButterCupp - AI GF with no limits",
    description:
      "Companions who remember you. Build a bond that actually grows, chat without limits, and make her yours.",
    siteName: "ButterCupp",
    type: "website",
  },
};

// viewportFit: "cover" lets the layout draw edge to edge on notched/home-bar
// devices so env(safe-area-inset-*) resolves to a real value instead of 0
// everywhere (used by the .pt-safe/.pb-safe/.px-safe utilities in globals.css).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0e0c0a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${geist.variable} ${fraunces.variable}`}>
      {/* bc-grain lays a single fixed noise layer over the whole app. */}
      <body className="bc-grain min-h-screen antialiased">
        {children}
        <Script id="meta-pixel" strategy="afterInteractive">{`
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '2065090824399737');
          fbq('track', 'PageView');
        `}</Script>
        <noscript>
          <img
            height="1"
            width="1"
            style={{ display: "none" }}
            src="https://www.facebook.com/tr?id=2065090824399737&ev=PageView&noscript=1"
            alt=""
          />
        </noscript>
      </body>
    </html>
  );
}
