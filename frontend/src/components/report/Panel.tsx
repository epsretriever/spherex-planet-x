import styles from "./report.module.css";

export function Panel({
  id,
  title,
  kicker,
  intro,
  children,
}: {
  id: string;
  title: string;
  kicker?: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={`card ${styles.panel}`} aria-labelledby={`${id}-title`}>
      <div className={styles.panelHead}>
        <h2 id={`${id}-title`}>{title}</h2>
        {kicker && <span className={styles.kicker}>{kicker}</span>}
      </div>
      {intro && <p className={styles.intro}>{intro}</p>}
      {children}
    </section>
  );
}
