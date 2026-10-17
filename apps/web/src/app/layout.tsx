import type { Metadata, Viewport } from "next";
import { connection } from "next/server";

import { SiteChrome } from "@/components/site-chrome";

import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://stoma3d.org";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Stoma3D - Guided mouth scans and visual change tracking",
    template: "%s - Stoma3D",
  },
  description:
    "Stoma3D guides a consistent eight-region mouth scan, checks each capture, tracks visible observations, and prepares a report you control.",
  applicationName: "Stoma3D",
  category: "health",
  openGraph: {
    type: "website",
    siteName: "Stoma3D",
    title: "Stoma3D - Guided mouth scans and visual change tracking",
    description:
      "Capture eight consistent mouth views, track visible observations, and create a report you control.",
  },
  twitter: {
    card: "summary",
    title: "Stoma3D",
    description: "Track visible changes, one consistent scan at a time.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7faf8" },
    { media: "(prefers-color-scheme: dark)", color: "#091719" },
  ],
};

const directionContract = `<!--
THESIS: Open straight into a focused scan workspace, with a separate guided sample journey for recording.
OWN-WORLD: Porcelain paper, graphite type, mineral teal actions, fine rules, instrument-like controls, and amber only for attention.
STORY: Consent leads to consistent capture, honest observation review, and sharing the user controls.
FIRST VIEWPORT: Compact brand bar, clear scan action, optional sample tour, and four familiar destinations. No marketing detour.
FORM: Calm task surfaces, generous photo area, fixed reachable navigation, and responsive single-column controls.
-->`;

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // A fresh request is required so Next.js can attach the proxy-generated CSP
  // nonce to its framework and hydration scripts.
  await connection();
  return (
    <html lang="en">
      <body>
        <div
          className="direction-contract"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: directionContract }}
        />
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <SiteChrome>{children}</SiteChrome>
      </body>
    </html>
  );
}
