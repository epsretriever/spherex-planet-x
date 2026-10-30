"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { SECTIONS, isCurrent } from "@/lib/sections";
import { SITE_NAME } from "@/lib/site";
import { Sheet } from "./Sheet";
import styles from "./TopBar.module.css";

export function TopBar() {
  const pathname = usePathname() ?? "/";
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className={styles.bar}>
      <div className={`container ${styles.inner}`}>
        <Link href="/" className={styles.brand} prefetch={false}>
          <span className={styles.mark} aria-hidden="true">
            <span />
          </span>
          <span>{SITE_NAME}</span>
        </Link>
        <nav aria-label="Main" className={styles.navWrap}>
          <ul className={styles.nav}>
            {SECTIONS.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className={styles.link} aria-current={isCurrent(pathname, item) ? "page" : undefined} prefetch={false}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <button
          type="button"
          className={styles.menuButton}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          <span className={styles.menuIcon} aria-hidden="true">
            <span />
          </span>
          <span className={styles.menuText}>Menu</span>
        </button>
      </div>
      <div className={styles.spectrum} aria-hidden="true" />
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Sections">
        <nav aria-label="Sections">
          <ul className={styles.menuList}>
            <li>
              <Link href="/" className={styles.menuLink} aria-current={pathname === "/" ? "page" : undefined} prefetch={false} onClick={() => setMenuOpen(false)}>
                <span className={styles.menuLabel}>Home</span>
                <span className={styles.menuBlurb}>Start here</span>
              </Link>
            </li>
            {SECTIONS.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className={styles.menuLink} aria-current={isCurrent(pathname, item) ? "page" : undefined} prefetch={false} onClick={() => setMenuOpen(false)}>
                  <span className={styles.menuLabel}>{item.label}</span>
                  <span className={styles.menuBlurb}>{item.blurb}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Sheet>
    </header>
  );
}
