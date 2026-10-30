import Link from "next/link";
import { Panel } from "@/components/report/Panel";
import type { ObjectDetail } from "@/lib/contract";
import { formatHours, formatInterval, formatUtcDateTime, formatUtcTime } from "@/lib/format";
import { groupVisits } from "@/lib/objects";
import { candidateHref, fieldHref } from "@/lib/routes";
import styles from "./Object.module.css";

/** The object's sightings grouped into visits, with the time between visits and where each was seen. */
export function VisitsPanel({ object, fieldName }: { object: ObjectDetail; fieldName: (id: string) => string }) {
  const visits = groupVisits(object.detections);
  if (!visits.length) return null;
  const span = (visits.at(-1)!.end_mjd - visits[0]!.start_mjd) * 24;
  return (
    <Panel
      id="visits"
      title="Tracked across visits"
      kicker={`${visits.length} ${visits.length === 1 ? "visit" : "visits"}`}
      intro={`SPHEREx came back to this part of the sky ${visits.length} ${visits.length === 1 ? "time" : "times"} while the object was in view, ${formatHours(span)} from first sighting to last. Each visit is a few exposures minutes apart.`}
    >
      <ol className={styles.visits}>
        {visits.map((v, i) => {
          const prev = visits[i - 1];
          return (
            <li key={v.index} className={styles.visit}>
              {prev && <p className={styles.gap}>{formatInterval(prev.end_mjd, v.start_mjd)} later</p>}
              <div className={styles.visitCard}>
                <p className={styles.visitHead}>
                  <span className={styles.visitNo}>Visit {i + 1}</span>
                  <span>
                    {formatUtcDateTime(v.start_utc)}
                    {v.end_utc !== v.start_utc && ` – ${formatUtcTime(v.end_utc)}`}
                  </span>
                </p>
                <p className={styles.visitBody}>
                  <span className="mono">{v.detections.length}</span> {v.detections.length === 1 ? "sighting" : "sightings"}
                  {v.field_ids.length > 0 && (
                    <>
                      {" "}
                      in{" "}
                      {v.field_ids.map((f, j) => (
                        <span key={f}>
                          {j > 0 && ", "}
                          <Link href={fieldHref(f)} prefetch={false}>
                            {fieldName(f)}
                          </Link>
                        </span>
                      ))}
                    </>
                  )}
                  {v.candidate_ids.length > 0 && (
                    <>
                      {" · "}
                      {v.candidate_ids.map((c, j) => (
                        <span key={c}>
                          {j > 0 && ", "}
                          <Link href={candidateHref(c)} prefetch={false}>
                            Evidence report{v.candidate_ids.length > 1 ? ` ${j + 1}` : ""}
                          </Link>
                        </span>
                      ))}
                    </>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
