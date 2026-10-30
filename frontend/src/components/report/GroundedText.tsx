import type { GroundedValue } from "@/lib/grounding";
import { linkNumbers } from "@/lib/grounding";
import { showValue } from "@/lib/citations";
import styles from "./report.module.css";

/** Text whose numbers link to the measured value each came from (`#${prefix}-${index}`). */
export function GroundedText({
  text,
  values,
  prefix,
  onFollow,
}: {
  text: string;
  values: GroundedValue[];
  prefix: string;
  onFollow?: () => void;
}) {
  return (
    <>
      {linkNumbers(text, values).map((p, i) =>
        p.ref === undefined ? (
          <span key={i}>{p.text}</span>
        ) : (
          <a key={i} href={`#${prefix}-${p.ref}`} className={styles.grounded} title={values[p.ref]!.path} onClick={onFollow}>
            {p.text}
          </a>
        ),
      )}
    </>
  );
}

/** The list of values a text was written from, as link targets. */
export function GroundList({ values, prefix }: { values: GroundedValue[]; prefix: string }) {
  return (
    <ul className={styles.groundList}>
      {values.map((v, i) => (
        <li key={v.path} id={`${prefix}-${i}`}>
          <code>{v.path}</code>
          <span className="mono">{showValue(v.value)}</span>
        </li>
      ))}
    </ul>
  );
}
