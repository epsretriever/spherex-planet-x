import type { Classification } from "@/lib/contract";
import { CLASSIFICATIONS } from "@/lib/labels";
import styles from "./ClassificationBadge.module.css";

export function ClassificationBadge({ value, size = "md" }: { value: Classification; size?: "sm" | "md" | "lg" }) {
  const c = CLASSIFICATIONS[value] ?? { label: value, icon: "•", cssVar: "--status-artifact" };
  return (
    <span
      className={styles.badge}
      data-size={size}
      data-classification={value}
      style={{ ["--badge" as string]: `var(${c.cssVar})` }}
    >
      <span className={styles.icon} aria-hidden="true">
        {c.icon}
      </span>
      {c.label}
    </span>
  );
}
