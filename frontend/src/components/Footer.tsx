import Link from "next/link";
import styles from "./Footer.module.css";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <p>
          SPHEREx data: NASA / JPL-Caltech / IPAC, via the{" "}
          <a href="https://irsa.ipac.caltech.edu/" target="_blank" rel="noopener noreferrer">
            NASA/IPAC Infrared Science Archive
          </a>
          . Small-body predictions: JPL Solar System Dynamics.
        </p>
        <p className="muted">
          We do not claim to have discovered Planet X. Objects we can&apos;t match may be image artifacts, measurement
          errors or objects missing from catalogs. <Link href="/about/" prefetch={false}>How this works</Link>
        </p>
      </div>
    </footer>
  );
}
