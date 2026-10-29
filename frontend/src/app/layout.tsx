import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/space-grotesk";
import "./globals.css";
import { Footer } from "@/components/Footer";
import { TopBar } from "@/components/TopBar";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";
import styles from "./layout.module.css";

export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: SITE_TAGLINE,
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
