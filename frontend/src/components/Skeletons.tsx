import styles from "./Skeletons.module.css";

/** Shaped placeholders so pages don't jump when data arrives. */

function Bar({ w, h = 16, className }: { w: string; h?: number; className?: string }) {
  return <span className={`skeleton ${styles.bar} ${className ?? ""}`} style={{ width: w, height: h }} />;
}

export function HeaderSkeleton({ lede = true }: { lede?: boolean }) {
  return (
    <div className={styles.header} aria-hidden="true">
      <Bar w="120px" h={12} />
      <Bar w="min(520px, 90%)" h={40} />
      {lede && <Bar w="min(640px, 100%)" h={18} />}
      {lede && <Bar w="min(440px, 80%)" h={18} />}
    </div>
  );
}

export function ViewerSkeleton({ label = "Loading the sky images" }: { label?: string }) {
  return (
    <div className={styles.viewer} role="status">
      <span className="visually-hidden">{label}</span>
      <div className={styles.row} aria-hidden="true">
        <Bar w="min(360px, 100%)" h={44} />
        <Bar w="220px" h={44} />
      </div>
      <Bar w="100%" h={40} />
      <span className={`skeleton ${styles.stage}`} aria-hidden="true">
        <span className={styles.scan} />
      </span>
      <div className={styles.row} aria-hidden="true">
        <Bar w="112px" h={44} />
        <Bar w="44px" h={44} />
        <Bar w="44px" h={44} />
      </div>
    </div>
  );
}

export function FieldPageSkeleton() {
  return (
    <div className={styles.fieldPage}>
      <HeaderSkeleton />
      <div className={styles.fieldLayout}>
        <ViewerSkeleton label="Loading this patch of sky" />
        <div className={`skeleton ${styles.aside}`} aria-hidden="true" />
      </div>
    </div>
  );
}

export function CardListSkeleton({ count = 3, label = "Loading" }: { count?: number; label?: string }) {
  return (
    <ul className={styles.list} role="status" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className={`card ${styles.card}`} aria-hidden="true">
          <span className={`skeleton ${styles.thumb}`} />
          <span className={styles.lines}>
            <Bar w="120px" h={20} />
            <Bar w="70%" h={22} />
            <Bar w="90%" h={14} />
            <Bar w="60%" h={14} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ReportSkeleton() {
  return (
    <div className={styles.report} role="status">
      <span className="visually-hidden">Loading the evidence report</span>
      <HeaderSkeleton />
      <div className={styles.stats} aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <Bar key={i} w="100%" h={64} />
        ))}
      </div>
      <div className={`card ${styles.panel}`} aria-hidden="true">
        <Bar w="200px" h={28} />
        <span className={`skeleton ${styles.stage}`} />
      </div>
      <div className={`card ${styles.panel}`} aria-hidden="true">
        <Bar w="180px" h={28} />
        <Bar w="100%" h={96} />
      </div>
    </div>
  );
}

export function StudySkeleton() {
  return (
    <div className={styles.report} role="status">
      <span className="visually-hidden">Loading the injection test</span>
      <div className={styles.stats} aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <Bar key={i} w="100%" h={88} />
        ))}
      </div>
      <div className={`card ${styles.panel}`} aria-hidden="true">
        <Bar w="320px" h={28} />
        <div className={styles.grid}>
          {Array.from({ length: 20 }, (_, i) => (
            <span key={i} className={`skeleton ${styles.cell}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
