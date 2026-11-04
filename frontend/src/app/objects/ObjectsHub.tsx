"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FieldGrid } from "@/components/FieldGrid";
import { LeadsView } from "../leads/LeadsView";
import { CandidateBrowser } from "./browse/CandidateBrowser";
import styles from "./ObjectsHub.module.css";

export type HubView = "all" | "leads" | "known" | "patches";

/** Which tab a query string opens. "Known (JPL)" is the list filtered to known objects only. */
export function hubView(params: URLSearchParams): HubView {
  const view = params.get("view");
  if (view === "leads" || view === "patches") return view;
  const classes = params.getAll("class");
  return classes.length === 1 && classes[0] === "known_object" ? "known" : "all";
}

const TABS: { id: HubView; label: string; href: string; purpose: string }[] = [
  {
    id: "all",
    label: "All",
    href: "/objects/",
    purpose: "Every moving object, with search and filters. Open one for its full report.",
  },
  {
    id: "leads",
    label: "Unexplained leads",
    href: "/objects/?view=leads",
    purpose: "The objects JPL's catalogs can't explain, ranked by the strength of the evidence, with what would confirm each one.",
  },
  {
    id: "known",
    label: "Known (JPL)",
    href: "/objects/?class=known_object",
    purpose: "Objects JPL identified as catalogued asteroids or comets, with links to their JPL orbit and ephemeris pages.",
  },
  {
    id: "patches",
    label: "Patches of sky",
    href: "/objects/?view=patches",
    purpose: "The patches of sky we searched. Open one to blink its images and spot what moved yourself.",
  },
];

export function ObjectsHub() {
  const params = useSearchParams();
  const view = hubView(new URLSearchParams(params.toString()));
  const tab = TABS.find((t) => t.id === view)!;
  return (
    <>
      <nav className={styles.tabs} aria-label="Object lists">
        <ul>
          {TABS.map((t) => (
            <li key={t.id}>
              <Link href={t.href} aria-current={t.id === view ? "page" : undefined} scroll={false} prefetch={false}>
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <p className={styles.purpose}>{tab.purpose}</p>
      {view === "leads" ? <LeadsView /> : view === "patches" ? <FieldGrid /> : <CandidateBrowser />}
    </>
  );
}
