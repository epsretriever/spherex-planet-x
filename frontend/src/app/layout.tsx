import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Footer } from "@/components/Footer";
import { TopBar } from "@/components/TopBar";
import { pageMeta, SITE_URL } from "@/lib/meta";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";
import styles from "./layout.module.css";

// Self-hosted, preloaded variable fonts (see src/fonts/README.md). Each exposes a CSS variable
// that globals.css builds its font stacks from.
const inter = localFont({
  src: "../fonts/inter-latin-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-inter",
});
const spaceGrotesk = localFont({
  src: "../fonts/space-grotesk-latin-wght-normal.woff2",
  weight: "300 700",
  display: "swap",
  variable: "--font-space-grotesk",
});
const jetbrainsMono = localFont({
  src: "../fonts/jetbrains-mono-latin-wght-normal.woff2",
  weight: "100 800",
  display: "swap",
  variable: "--font-jetbrains-mono",
  // Only labels and numbers use it; leave it off the critical path so the text that counts as the
  // largest paint (Inter) downloads first.
  preload: false,
});

export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  applicationName: SITE_NAME,
  metadataBase: new URL(SITE_URL),
  ...pageMeta(null, SITE_TAGLINE, "/"),
};

export const viewport: Viewport = {
  themeColor: "#08060d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}>
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
