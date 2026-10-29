"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SITE_NAME } from "@/lib/site";
import styles from "./TopBar.module.css";

const NAV = [
  { href: "/explore/", label: "Explore", match: "/explore" },
  { href: "/detective/", label: "Detective", match: "/detective" },
  { href: "/simulated/", label: "Simulated", match: "/simulated" },
  { href: "/about/", label: "About", match: "/about" },
];

export function TopBar() {
  const pathname = usePathname() ?? "/";
  return (
    <header className={styles.bar}>
      <div className={`container ${styles.inner}`}>
        <Link href="/" className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            <span />
          </span>
          <span>{SITE_NAME}</span>
        </Link>
        <nav aria-label="Main" className={styles.navWrap}>
          <ul className={styles.nav}>
            {NAV.map((item) => {
              const active = pathname === item.match || pathname.startsWith(`${item.match}/`);
              return (
                <li key={item.href}>
                  <Link href={item.href} className={styles.link} aria-current={active ? "page" : undefined}>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
      <div className={styles.spectrum} aria-hidden="true" />
    </header>
  );
}
