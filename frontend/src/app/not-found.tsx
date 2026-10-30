import type { Metadata } from "next";
import Link from "next/link";
import { ObjectPathFallback } from "@/components/ObjectPathFallback";
import styles from "./not-found.module.css";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <div className={`container ${styles.page}`}>
      <div className={styles.art} aria-hidden="true">
        <span className={styles.ring} />
        <span className={`${styles.dot} ${styles.was}`} />
        <span className={styles.trail} />
        <span className={`${styles.dot} ${styles.gone}`} />
      </div>
      <ObjectPathFallback />
      <p className="eyebrow">Error 404</p>
      <h1 className={styles.title}>This page moved on.</h1>
      <p className="lede">
        Like an asteroid between two exposures, whatever was here has drifted out of frame. The link may be old, or the
        address mistyped.
      </p>
      <div className={styles.actions}>
        <Link href="/explore/" className="button button-primary">
          Explore the sky →
        </Link>
        <Link href="/detective/" className="button">
          See the candidates
        </Link>
        <Link href="/" className="button">
          Home
        </Link>
      </div>
    </div>
  );
}
