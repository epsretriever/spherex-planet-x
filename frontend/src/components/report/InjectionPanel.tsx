import Link from "next/link";
import type { InjectionInfo } from "@/lib/contract";
import { fmt, formatRate } from "@/lib/format";
import { Panel } from "./Panel";
import styles from "./report.module.css";

export function InjectionPanel({ injection }: { injection: InjectionInfo }) {
  const t = injection.injected;
  return (
    <Panel id="injection" title="What we planted vs. what we found" kicker="SIMULATED">
      <div className={styles.callout}>
        <p>
          <strong>{injection.recovered ? "Recovered." : "Not recovered."}</strong> We added this fake object to real images, then ran
          the pipeline without telling it. {injection.recovered ? "It found the object." : "It missed the object."}
        </p>
      </div>
      <dl className={styles.facts} style={{ marginTop: "var(--space-4)" }}>
        <div>
          <dt>Planted brightness</dt>
          <dd>
            AB {fmt(t.mag_ab, 1)} <small>({fmt(t.flux_ujy, 1)} µJy)</small>
          </dd>
        </div>
        <div>
          <dt>Planted speed</dt>
          <dd>{formatRate(t.rate_arcsec_per_hr)}</dd>
        </div>
        <div>
          <dt>Measured speed</dt>
          <dd>{formatRate(injection.recovered_rate_arcsec_per_hr)}</dd>
        </div>
        <div>
          <dt>Position error</dt>
          <dd>
            {fmt(injection.position_error_arcsec, 2)} <small>arcsec</small>
          </dd>
        </div>
        {t.distance_au != null && (
          <div>
            <dt>Planted distance</dt>
            <dd>
              {fmt(t.distance_au, 0)} <small>AU</small>
            </dd>
          </div>
        )}
      </dl>
      <Link href={`/limits/?study=${encodeURIComponent(injection.study_id)}`}>See the full injection test →</Link>
    </Panel>
  );
}
