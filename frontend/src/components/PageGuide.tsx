import styles from "./PageGuide.module.css";

/** One plain line at the top of a page: what this page is for. */
export function PageGuide({ children }: { children: React.ReactNode }) {
  return (
    <p className={styles.guide}>
      <span className={styles.tag}>This page</span>
      <span>{children}</span>
    </p>
  );
}
