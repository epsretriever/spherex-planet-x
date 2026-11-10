"use client";

import { Panel } from "@/components/report/Panel";
import report from "@/components/report/report.module.css";
import { getCompositionValidation } from "@/lib/api";
import { pct } from "@/lib/composition";
import type { CompositionValidation } from "@/lib/contract";
import { formatUtcDateTime } from "@/lib/format";
import { useData } from "@/lib/useData";
import styles from "./CompositionValidationPanel.module.css";

/** How far to trust "What is it made of?": agreement with published classes, and a simulated test. */
export function CompositionValidationPanel() {
  const state = useData("composition-validation", (signal) => getCompositionValidation(signal));
  return (
    <Panel
      id="composition"
      title="How reliable is “What is it made of?”"
      kicker="Composition check"
      intro="Each object's report compares its SPHEREx colors with the average spectra of the Bus-DeMeo asteroid types. These two checks show how far to trust that indicative answer."
    >
      {state.status === "loading" && <p className="muted">Loading the composition check…</p>}
      {state.status === "error" && <p className="muted">The composition check is not available right now.</p>}
      {state.status === "ok" && <Body v={state.data} />}
    </Panel>
  );
}

function Body({ v }: { v: CompositionValidation }) {
  const sim = v.simulated_recovery;
  return (
    <>
      <h3 className={styles.h3}>Against published asteroid types</h3>
      {v.n_compared > 0 ? (
        <p>
          For <span className="mono">{v.n_compared}</span> objects that JPL identified and that have a published type in JPL&apos;s Small-Body
          Database, our broad type (S, C, X…) agrees <strong className="mono">{pct(v.overall.complex_agreement)}</strong> of the time (
          {pct(v.overall.broad_agreement)} for stony vs dark vs X). Calling every one of them stony would agree {pct(v.baseline_always_s)} of the
          time. With so few objects these numbers are rough.
        </p>
      ) : (
        <p>
          Not measured yet: {v.n_identified === 0 ? "none of our objects is JPL-identified so far" : `${v.n_identified} of our objects are JPL-identified, but ${v.n_with_taxonomy === 0 ? "none has" : "too few have"} a published type with a usable SPHEREx spectrum`}
          . This check runs again each week as JPL identifies more.
        </p>
      )}
      <h3 className={styles.h3}>
        On simulated spectra <span className={styles.sim}>SIMULATED</span>
      </h3>
      <p className="muted">
        Every asteroid type&apos;s average spectrum, varied within that type, was sampled at each real object&apos;s SPHEREx bands with its real
        errors, then classified the same way. How often the right broad type came back:
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Stated confidence</th>
            <th scope="col">Trials</th>
            <th scope="col">Right broad type</th>
          </tr>
        </thead>
        <tbody>
          {sim.map((r) => (
            <tr key={r.confidence}>
              <th scope="row">{r.confidence === "all" ? "All" : r.confidence}</th>
              <td className="mono">{r.n.toLocaleString("en-US")}</td>
              <td className="mono">{pct(r.complex_recovered)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={report.note}>
        {v.n_classified} of {v.n_objects} objects have enough bands for a type. Most SPHEREx tracks last about a day and cover a narrow range of
        wavelengths, so most answers are low confidence. Updated {formatUtcDateTime(v.generated_utc)}
        {v.truth_query_utc ? `; JPL asked ${formatUtcDateTime(v.truth_query_utc)}` : ""}.
      </p>
    </>
  );
}
