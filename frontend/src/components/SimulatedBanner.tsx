import styles from "./SimulatedBanner.module.css";

export function SimulatedBanner({ children }: { children?: React.ReactNode }) {
  return (
    <div className={styles.banner} role="note">
      <strong className={styles.tag}>SIMULATED</strong>
      <span>
        {children ??
          "This shows fake objects we added to real SPHEREx images on purpose, to test our software. They are not real objects in the sky."}
      </span>
    </div>
  );
}
