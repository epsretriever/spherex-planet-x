import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/space-grotesk";
import "./globals.css";
import { Footer } from "@/components/Footer";
import { TopBar } from "@/components/TopBar";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";
import styles from "./layout.module.css";

// Social previews need absolute URLs. Set NEXT_PUBLIC_SITE_URL (for example in the
// Cloudflare build variables) to the deployed origin; without it the share image is left out
// rather than pointing at the wrong host.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const shareImage = { url: "/og.png", width: 1200, height: 630, alt: `${SITE_NAME}: ${SITE_TAGLINE}` };

export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: SITE_TAGLINE,
  applicationName: SITE_NAME,
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_TAGLINE,
    ...(siteUrl ? { images: [shareImage] } : {}),
  },
  twitter: {
    card: siteUrl ? "summary_large_image" : "summary",
    title: SITE_NAME,
    description: SITE_TAGLINE,
    ...(siteUrl ? { images: [shareImage.url] } : {}),
  },
};

export const viewport: Viewport = {
  themeColor: "#08060d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className={styles.skip}>
          Skip to content
        </a>
        <TopBar />
        <main id="main" className={styles.main}>
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
