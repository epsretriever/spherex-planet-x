import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Footer } from "@/components/Footer";
import { Guide } from "@/components/guide/Guide";
import { TopBar } from "@/components/TopBar";
import { Tour } from "@/components/tour/Tour";
import { pageMeta, SITE_URL } from "@/lib/meta";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";
import styles from "./layout.module.css";

// Self-hosted, preloaded variable font (see src/fonts/README.md). Archivo has weight and width
// axes, so one file covers headlines (expanded), body text and data (condensed, tabular figures).
const archivo = localFont({
  src: "../fonts/archivo-latin-wdth-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-archivo",
  declarations: [{ prop: "font-stretch", value: "62% 125%" }],
});

export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  applicationName: SITE_NAME,
  metadataBase: new URL(SITE_URL),
  ...pageMeta(null, SITE_TAGLINE, "/"),
};

export const viewport: Viewport = {
  themeColor: "#0b1f3a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>
        <a href="#main" className={styles.skip}>
          Skip to content
        </a>
        <TopBar />
        <main id="main" className={styles.main}>
          {children}
        </main>
        <Footer />
        <Tour />
        <Guide />
      </body>
    </html>
  );
}
