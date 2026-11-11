"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ClassificationBadge } from "@/components/ClassificationBadge";
import { ErrorState } from "@/components/DataState";
import { CopyLink } from "@/components/object/CopyLink";
import { OrbitTopDown } from "@/components/orbit/OrbitTopDown";
import orbitStyles from "@/components/orbit/Orbit.module.css";
import { Figure3D } from "@/components/three/Figure3D";
import { WhenVisible } from "@/components/WhenVisible";
import { assetUrl, getObject, getObjects } from "@/lib/api";
import { compareRows, differingRows } from "@/lib/compare";
import type { ObjectDetail, ObjectSummary } from "@/lib/contract";
import { PLANETS, isDrawable } from "@/lib/orbit";
import { compareHref, objectHref } from "@/lib/routes";
import { useData, type DataState } from "@/lib/useData";
import { useObjectNames } from "@/lib/useObjectNames";
import styles from "./Compare.module.css";

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,95}$/;
const valid = (id: string | null) => (id && ID_RE.test(id) ? id : null);

/** Two objects side by side. The pair lives in the address (?a=…&b=…), so any comparison is a link. */
export function CompareView() {
  const params = useSearchParams();
  const [a, setA] = useState<string | null>(() => valid(params.get("a")));
  const [b, setB] = useState<string | null>(() => valid(params.get("b")));
  const [onlyDiff, setOnlyDiff] = useState(false);

  // Keep the address in step with the pair without adding a history entry per change.
  useEffect(() => {
    const next = compareHref(a, b);
    if (`${window.location.pathname}${window.location.search}` !== next) window.history.replaceState(null, "", next);
  }, [a, b]);

  const list = useData("objects", (signal) => getObjects(signal));
  const { nameFor } = useObjectNames();
  const titleOf = (o: Pick<ObjectSummary, "candidate_ids" | "classification" | "object_id"> & { designation?: string | null }) =>
    o.candidate_ids[0] ? nameFor({ candidate_id: o.candidate_ids[0], classification: o.classification, designation: o.designation }).title : o.object_id;
  const options = useMemo(() => {
    if (list.status !== "ok") return [];
    return list.data.objects
      .map((o) => ({ id: o.object_id, title: titleOf({ ...o, designation: o.known_object_designation }), simulated: o.classification === "injected" }))
      .sort((x, y) => x.title.localeCompare(y.title, "en", { numeric: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, nameFor]);

  const first = useData(a ? `object:${a}` : null, (signal) => getObject(a!, signal));
  const second = useData(b ? `object:${b}` : null, (signal) => getObject(b!, signal));
  const both = first.status === "ok" && second.status === "ok" ? [first.data, second.data] : null;
  const nameOf = (o: ObjectDetail) => titleOf({ ...o, designation: o.known_object.designation });

  return (
    <div className={styles.stack}>
      <form className={`card ${styles.pickers}`} onSubmit={(e) => e.preventDefault()} aria-label="Objects to compare">
        <Picker label="First object" value={a} onChange={setA} options={options} other={b} loading={list.status === "loading"} />
        <button
          type="button"
          className={`button ${styles.swap}`}
          onClick={() => {
            setA(b);
            setB(a);
          }}
          disabled={!a && !b}
          aria-label="Swap the two objects"
        >
          ⇄ Swap
        </button>
        <Picker label="Second object" value={b} onChange={setB} options={options} other={a} loading={list.status === "loading"} />
      </form>
      {list.status === "error" && <ErrorState reason={list.error.reason} message={list.error.message} onRetry={list.retry} />}

      {(!a || !b) && (
        <p className={styles.prompt} role="status">
          {!a && !b ? "Choose two objects above to compare them." : "Choose one more object to compare."} Not sure which?{" "}
          <Link href="/objects/">Browse the objects</Link>, open one, and use &ldquo;Compare with another object&rdquo;.
        </p>
      )}

      <div className={styles.cards}>
        <Side state={first} id={a} tone="first" nameOf={nameOf} />
        <Side state={second} id={b} tone="second" nameOf={nameOf} />
      </div>

      {both && a === b && (
        <p className={styles.prompt} role="note">
          Both sides are the same object, so every row matches. Pick a different second object.
        </p>
      )}

      {both && (
        <>
          <section className="card" aria-labelledby="compare-table" style={{ padding: "var(--space-4)" }}>
            <div className={styles.tableHead}>
              <h2 id="compare-table">Side by side</h2>
              <label className={styles.toggle}>
                <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Only rows that differ
              </label>
            </div>
            <CompareTable objects={both} names={both.map(nameOf)} onlyDiff={onlyDiff} />
            <p className={styles.note}>
              Every value is the one on each object&apos;s own report. Orbits from a day or two of sightings are preliminary: compare the
              distance ranges, not single numbers.
            </p>
          </section>

          <OrbitsTogether a={both[0]!} b={both[1]!} names={[nameOf(both[0]!), nameOf(both[1]!)]} />

          <div className={styles.share}>
            <CopyLink label="Copy link to this comparison" />
          </div>
        </>
      )}
    </div>
  );
}

function Picker({
  label,
  value,
  onChange,
  options,
  other,
  loading,
}: {
  label: string;
  value: string | null;
  onChange: (id: string | null) => void;
  options: { id: string; title: string; simulated: boolean }[];
  other: string | null;
  loading: boolean;
}) {
  const known = !value || options.some((o) => o.id === value);
  return (
    <label className={styles.picker}>
      <span>{label}</span>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{loading ? "Loading the objects…" : "Choose an object"}</option>
        {/* An object from a link that the list doesn't hold (merged into another, or not loaded yet). */}
        {!known && <option value={value!}>{value}</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id} disabled={o.id === other}>
            {o.title}
            {o.simulated ? " (SIMULATED)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function Side({ state, id, tone, nameOf }: { state: DataState<ObjectDetail>; id: string | null; tone: "first" | "second"; nameOf: (o: ObjectDetail) => string }) {
  if (!id) return <div className={`card ${styles.side} ${styles.sideEmpty}`} data-tone={tone} aria-hidden="true" />;
  if (state.status === "loading") return <div className={`card skeleton ${styles.side}`} data-tone={tone} role="status" aria-label="Loading the object" />;
  if (state.status === "error") {
    return (
      <div className={`card ${styles.side}`} data-tone={tone}>
        <ErrorState reason={state.error.reason} message={state.error.reason === "not_found" ? `There is no object with the ID ${id}.` : state.error.message} onRetry={state.retry} />
      </div>
    );
  }
  const o = state.data;
  return (
    <article className={`card ${styles.side}`} data-tone={tone}>
      {o.thumbnail_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={assetUrl(o.thumbnail_url)} alt="" width={64} height={64} className={styles.thumb} loading="lazy" />
      )}
      <div>
        <ClassificationBadge value={o.classification} />
        <h2 className={styles.sideTitle}>
          <Link href={objectHref(o.object_id)} prefetch={false}>
            {nameOf(o)}
          </Link>
        </h2>
        <p className={`mono ${styles.sideId}`}>{o.object_id}</p>
        <p className={styles.sideSummary}>{o.summary_plain}</p>
      </div>
    </article>
  );
}

function CompareTable({ objects, names, onlyDiff }: { objects: ObjectDetail[]; names: string[]; onlyDiff: boolean }) {
  const all = compareRows(objects);
  const rows = onlyDiff ? differingRows(all) : all;
  if (!rows.length) return <p className={styles.note}>None of the published measurements differ.</p>;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Measurement</th>
            {names.map((n, i) => (
              <th scope="col" key={i} data-tone={i === 0 ? "first" : "second"}>
                {n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} data-differs={new Set(r.values).size > 1}>
              <th scope="row">
                {r.label}
                {r.hint && <small>{r.hint}</small>}
              </th>
              {r.values.map((v, i) => (
                <td key={i} className="mono">
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Both orbits in one scene, with the planets at the first object's orbit epoch. */
function OrbitsTogether({ a, b, names }: { a: ObjectDetail; b: ObjectDetail; names: [string, string] }) {
  const oa = a.orbit && isDrawable(a.orbit) ? a.orbit : null;
  const ob = b.orbit && isDrawable(b.orbit) ? b.orbit : null;
  const props = useMemo(() => {
    const main = oa ?? ob;
    if (!main) return null;
    const others = oa && ob ? [{ elements: ob, label: names[1] }] : [];
    const far = Math.max(main.a_au * (1 + main.e), ...others.map((o) => o.elements.a_au * (1 + o.elements.e)));
    return {
      object: main,
      clones: [],
      planets: PLANETS.filter((p) => p.a <= 5.3 || p.a <= far * 1.6),
      epochMjd: main.epoch_mjd,
      objectLabel: oa ? names[0] : names[1],
      others,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oa, ob, names[0], names[1]]);

  return (
    <section className="card" aria-labelledby="compare-orbits" style={{ padding: "var(--space-4)" }}>
      <h2 id="compare-orbits">Both orbits around the Sun</h2>
      {!props ? (
        <p className={styles.note}>Neither object has an orbit we can draw yet, so there is nothing to show here.</p>
      ) : (
        <>
          {(!oa || !ob) && (
            <p className={styles.note} role="note">
              Only {oa ? names[0] : names[1]} has an orbit we can draw, so it is shown alone.
            </p>
          )}
          <WhenVisible minHeight={360}>
            <Figure3D load={() => import("@/components/orbit/OrbitScene")} props={props} flat={<OrbitTopDown {...props} />} label="the 3D orbits" />
          </WhenVisible>
          <ul className={orbitStyles.legend}>
            <li>
              <span className={orbitStyles.swObject} aria-hidden="true" /> {props.objectLabel}
            </li>
            {props.others.map((o) => (
              <li key={o.label}>
                <span className={orbitStyles.swSecond} aria-hidden="true" /> {o.label}
              </li>
            ))}
            <li>
              <span className={orbitStyles.swPlanet} aria-hidden="true" /> Planets (approximate positions)
            </li>
          </ul>
          <p className={styles.note}>
            Each line is the one orbit reported for that object. For preliminary orbits many others fit as well; each object&apos;s own
            report shows that spread as a cloud.
          </p>
        </>
      )}
    </section>
  );
}
