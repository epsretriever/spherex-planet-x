import type { InjectionStudy, ObjectList, Survey } from "./contract";
import { isUnidentified, rankLeads, type Lead } from "./leads";
import { limitsSentence } from "./limits";
import { candidateHref, fieldHref } from "./routes";

/** The guided tour for judges: six stops, each caption written from the live data when it loaded. */
export interface TourStep {
  href: string;
  title: string;
  caption: string;
}

export interface TourData {
  survey: Survey | null;
  objects: ObjectList | null;
  leads: Lead[] | null;
  study: InjectionStudy | null;
}

const int = (n: number) => n.toLocaleString("en-US");

export function tourSteps({ survey, objects, leads, study }: TourData): TourStep[] {
  const t = survey?.totals;
  const area = t ? (t.area_deg2_searched ?? t.area_deg2_processed) : null;
  const pct = area != null ? (100 * area) / 41252.96 : null;
  const real = objects?.objects.filter((o) => o.classification !== "injected") ?? [];
  const known = real.filter((o) => o.classification === "known_object").length;
  const unidentifiedIds = new Set(real.filter((o) => isUnidentified(o.classification)).map((o) => o.object_id));
  const ranked = leads ? rankLeads(objects ? leads.filter((l) => unidentifiedIds.has(l.object_id)) : leads) : [];
  const top = ranked[0] ?? null;
  const strong = ranked.filter((l) => l.confidence.level === "strong").length;

  return [
    {
      href: "/",
      title: "A real search, in real NASA data",
      caption: t
        ? `So far the pipeline has analyzed ${int(t.n_epochs)} SPHEREx images covering ${int(t.n_searched ?? t.n_processed)} patches of sky (${area!.toFixed(0)} deg², ${pct!.toFixed(2)}% of the sky), and tracked ${int(real.length || t.n_objects)} moving objects. New patches are searched several times a day.`
        : "The pipeline searches real SPHEREx images for things that move, several times a day. These numbers update as it goes.",
    },
    {
      href: top ? fieldHref(top.field_id) : "/objects/?view=patches",
      title: "Blink the sky",
      caption: top
        ? `This patch is where our top unexplained lead was caught. Press Blink: stars stay put while it moves about ${top.rate_arcsec_per_hr != null ? `${top.rate_arcsec_per_hr.toFixed(0)}″ per hour` : "steadily"} across ${top.n_visits} visits.`
        : "Pick a patch and press Blink: stars stay put; anything that jumps between images is a candidate moving object.",
    },
    {
      href: top ? candidateHref(top.candidate_id) : "/objects/",
      title: "Every object gets an evidence report",
      caption: top
        ? `${top.name}: ${top.n_detections} detections, the faintest at signal-to-noise ${top.min_snr?.toFixed(1) ?? "n/a"}, positions fitting one motion to ${top.fit_rms_arcsec?.toFixed(1) ?? "n/a"}″. Below: the JPL check, the artifact tests, and what could still make it wrong.`
        : "Each report shows the measured positions, the motion fit, signal quality, the JPL check, and the ways it could be wrong.",
    },
    {
      href: "/objects/?view=leads",
      title: "What JPL can't explain",
      caption: objects
        ? `JPL identifies ${int(known)} of the ${int(real.length)} objects as known asteroids or comets. ${int(unidentifiedIds.size)} remain unexplained${ranked.length ? `; ${strong} are strong leads, and the best scores ${top!.confidence.score}/100` : ""}. Unexplained is not new: each comes with a follow-up file for a telescope.`
        : "The objects no known asteroid or comet explains, ranked by the strength of the evidence, each with what would confirm it.",
    },
    {
      href: "/limits/",
      title: "How we test ourselves",
      caption: study
        ? `We planted ${int(study.n_injected)} simulated objects in real images. ${limitsSentence(study)}`
        : "We plant simulated moving objects in real images to measure how faint and how slow an object we can find.",
    },
    {
      href: "/sky/",
      title: "Where we've searched, and what's left",
      caption: t
        ? `${int(t.n_searched ?? t.n_processed)} patches searched so far: ${pct!.toFixed(2)}% of the sky. Select a tile to open it. The rest is unsearched. A distant Planet X would move under about 1″ per hour, slower than this search can link yet.`
        : "Every patch of sky we've searched on one all-sky map. Select a tile to open it.",
    },
  ];
}
