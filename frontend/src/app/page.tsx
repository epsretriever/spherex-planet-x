import Link from "next/link";
import { FieldGrid } from "@/components/FieldGrid";
import { GrowthCharts } from "@/components/home/GrowthCharts";
import { HeroBlink, type HeroBlinkProps } from "@/components/home/HeroBlink";
import { HomeSky } from "@/components/home/HomeSky";
import { HowToUse } from "@/components/home/HowToUse";
import { TourButton } from "@/components/tour/Tour";
import { SpectralStrip } from "@/components/SpectralStrip";
import { formatInterval, formatUtcDate, formatUtcShortDate, formatUtcTime, formatWavelength } from "@/lib/format";
import { gridToImage } from "@/lib/grid";
import { fieldHref, objectHref } from "@/lib/routes";
import { staticCandidates, staticField, staticGrowth, staticObjects, staticSurvey } from "@/lib/staticData";
import styles from "./page.module.css";

/** The whole sky: 4π steradians, in square degrees. */
const SKY_DEG2 = 41252.96;

const CAPABILITIES = [
  {
    title: "Find what moves",
    body: "We read SPHEREx Level 2 images from NASA's public archive, measure every source in every exposure, set aside what stays fixed to the sky, and link the sightings that move steadily into tracks.",
  },
  {
    title: "Check it against what's known",
    body: "Each track is compared with JPL's catalog of known asteroids and comets for the exact time and place of each image. Matches are labelled known; anything left over is reported as unexplained, never as a discovery.",
  },
  {
    title: "Show the evidence",
    body: "Every object gets a report with its measured positions, motion fit, signal quality, the ways it could be wrong, and a link from every image to the archive file it came from. AI-written summaries are checked number by number against the measurements.",
  },
];

const WAYS_IN = [
  {
    href: "/objects/?view=patches",
    title: "Blink the sky",
    body: "Pick a patch of sky and flip between real SPHEREx images taken hours or days apart.",
  },
  {
    href: "/objects/?view=leads",
    title: "What JPL can't explain",
    body: "Objects no known asteroid or comet explains, ranked by the strength of the evidence, with where to point a telescope to confirm them.",
  },
  {
    href: "/objects/",
    title: "Weigh the evidence",
    body: "Every moving object in one list. Each report has its images, positions, speed, signal quality, the JPL check and, once fitted, its orbit.",
  },
  {
    href: "/sky/",
    title: "Where we've searched",
    body: "Every patch of sky processed so far on one all-sky map, with the ecliptic and the Milky Way for reference.",
  },
  {
    href: "/limits/",
    title: "What we could miss",
    body: "How faint and how slow an object we can recover, measured by planting simulated objects in real images.",
  },
];

const PIPELINE = [
  {
    title: "Ingest",
    body: "SPHEREx Level 2 images for each patch of sky, fetched from NASA/IPAC's public SPHEREx archive with their observation IDs, times and wavelengths.",
  },
  {
    title: "Detect",
    body: "Sources are measured in every exposure. Pixels the instrument flags as unreliable are tracked, so a detector glitch can't pass as a sighting.",
  },
  {
    title: "Remove the fixed sky",
    body: "Stars and galaxies sit in the same place on every date. Sources that stay put are set aside; what's left are sightings that might be moving.",
  },
  {
    title: "Link and fit",
    body: "Sightings from different exposures are linked into tracks that move at a steady rate and direction, and the motion is fitted, including the shift from SPHEREx's own movement around Earth.",
  },
  {
    title: "Check against JPL",
    body: "The pipeline asks JPL's small-body services (SBIdent, then Horizons) which known asteroids and comets were at each position at each time, as seen from SPHEREx. Matches are labelled known; tracks JPL can't explain stay Unexplained and are re-checked on a schedule.",
  },
  {
    title: "Score and publish",
    body: "Vetting checks and a rule-based score rank each track. Simulated objects planted in real images measure how faint and how slow an object we can actually recover.",
  },
];

function fmtInt(n: number) {
  return n.toLocaleString("en-US");
}

function skyShare(area: number) {
  const p = (100 * area) / SKY_DEG2;
  return p < 0.01 ? "<0.01%" : `${p < 1 ? p.toFixed(2) : p.toFixed(1)}%`;
}

/** "about half the width of this patch of Aquarius": distance as a share of the picture, not arcseconds. */
function shiftWords(fraction: number, arcsec: number): string {
  const share = fraction > 0.85 ? "nearly the full width" : fraction > 0.6 ? "about two-thirds of the width" : fraction > 0.4 ? "about half the width" : fraction > 0.25 ? "about a third of the width" : null;
  return share ? `${share} of this patch of Aquarius` : `${Math.round(arcsec)}″ across this patch of Aquarius`;
}

/** The showcase patch the hero blinks: its default pair, with the mover's place in each image. */
const HERO_FIELD = "aquarius-a";

function heroBlink(): HeroBlinkProps | null {
  const field = staticField(HERO_FIELD);
  if (!field) return null;
  const pair = field.blink_pairs.find((p) => p.default) ?? field.blink_pairs[0];
  const mover = field.movers[0];
  if (!pair || !mover) return null;
  const epochs = [pair.epoch_id_a, pair.epoch_id_b].map((id) => field.epochs.find((e) => e.epoch_id === id));
  const points = [pair.epoch_id_a, pair.epoch_id_b].map((id) => mover.track.find((t) => t.epoch_id === id));
  if (epochs.some((e) => !e?.image?.source) || points.some((p) => !p)) return null;
  const h = field.wcs.height_px;
  const frames = epochs.map((e, i) => ({
    key: i === 0 ? "A" : "B",
    src: e!.image.url,
    timeLabel: formatUtcTime(e!.time_utc),
    dateLabel: `${formatUtcShortDate(e!.time_utc)}, ${e!.time_utc.slice(0, 4)}`,
    wavelengthLabel: formatWavelength(e!.wavelength_um_center),
    sourceFile: e!.image.source.file,
    archiveUrl: e!.image.source.archive_url ?? null,
    mover: gridToImage(points[i]!.x_grid, points[i]!.y_grid, h),
  })) as HeroBlinkProps["frames"];
  const shiftPx = Math.hypot(points[1]!.x_grid - points[0]!.x_grid, points[1]!.y_grid - points[0]!.y_grid);
  const shift = shiftPx * field.wcs.cdelt_arcsec;
  const object = staticObjects()?.objects.find((o) => o.candidate_ids.includes(mover.candidate_id));
  return {
    frames,
    widthPx: field.wcs.width_px,
    heightPx: h,
    place: "a patch of Aquarius",
    interval: formatInterval(epochs[0]!.mjd, epochs[1]!.mjd),
    shift: shiftWords(shiftPx / field.wcs.width_px, shift),
    wavelengthMatched: pair.lambda_matched,
    fieldHref: fieldHref(field.field_id),
    objectHref: object ? objectHref(object.object_id) : null,
  };
}

export default function LandingPage() {
  // Real numbers from the data the site was built with.
  const survey = staticSurvey();
  const candidates = staticCandidates();
  const t = survey?.totals;
  // Objects JPL couldn't identify, as last recorded from the live site by the pipeline.
  const unidentified = staticGrowth().findLast((d) => d.unidentified != null)?.unidentified ?? null;
  const tracked = candidates ? candidates.candidates.filter((c) => c.classification !== "injected").length : null;
  const area = t ? (t.area_deg2_searched ?? t.area_deg2_processed) : null;
  const blink = heroBlink();

  return (
    <>
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={`container ${styles.heroGrid}`}>
          <h1 id="hero-title" className={styles.title}>
            <span>Stars stay put.</span> <span>Asteroids don&rsquo;t.</span>
          </h1>
          <div className={styles.heroText}>
            <p className={styles.lede}>
              Driftnet compares real infrared images from NASA&apos;s SPHEREx space telescope, taken hours apart. Anything that jumps
              between them is moving: an asteroid, a comet, or something farther out. Every mover is checked against JPL&apos;s catalog of
              known objects and published with the evidence for and against it.
            </p>
            <div className={styles.actions}>
              <Link href="/objects/?view=patches" className="button button-primary">
                Blink a patch of sky
              </Link>
              <Link href="/objects/" className="button">
                Browse the objects
              </Link>
              <TourButton />
            </div>
            {t && (
              <dl className={styles.ledger}>
                <div>
                  <dt>SPHEREx images analyzed</dt>
                  <dd>{fmtInt(t.n_epochs)}</dd>
                </div>
                <div>
                  <dt>Patches of sky searched</dt>
                  <dd>{fmtInt(t.n_searched ?? t.n_processed)}</dd>
                </div>
                <div>
                  <dt>Share of the sky covered</dt>
                  <dd>
                    {skyShare(area!)} <span className={styles.unit}>({area!.toFixed(0)} deg²)</span>
                  </dd>
                </div>
                {tracked != null && (
                  <div>
                    <dt>Moving objects tracked</dt>
                    <dd>{fmtInt(tracked)}</dd>
                  </div>
                )}
                {unidentified != null && (
                  <div>
                    <dt>
                      <Link href="/objects/?view=leads">Not yet identified</Link>
                    </dt>
                    <dd>{fmtInt(unidentified)}</dd>
                  </div>
                )}
              </dl>
            )}
            {survey && <p className={styles.asOf}>Survey totals as of {formatUtcDate(survey.generated_utc)}.</p>}
          </div>
          {blink && (
            <div className={styles.heroBlink}>
              <HeroBlink {...blink} />
            </div>
          )}
        </div>
      </section>

      <div className="container">
        <HowToUse />
      </div>

      <div className="container">
        <GrowthCharts days={staticGrowth()} />

        <section className={styles.what} aria-labelledby="what-heading">
          <div className={styles.whatHead}>
            <h2 id="what-heading">Tombaugh&apos;s method, at SPHEREx scale</h2>
            <p className={styles.sectionLede}>
              In 1930 Clyde Tombaugh found Pluto, the first &ldquo;Planet X&rdquo;, by flicking between two photographs of the same stars
              taken days apart. SPHEREx photographs each part of the sky again and again, in 102 infrared colors, which makes its archive a
              natural place to do the same thing with software. Driftnet turns those images into a searchable, checkable record of what
              moved.
            </p>
          </div>
          <ul className={styles.capabilities}>
            {CAPABILITIES.map((c) => (
              <li key={c.title} className={styles.capability}>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="how" className={`section ${styles.how}`} aria-labelledby="how-heading">
          <div className={styles.howGrid}>
            <div className={styles.howIntro}>
              <h2 id="how-heading">From raw images to an evidence report</h2>
              <p className={styles.sectionLede}>
                A Python pipeline in GitHub Actions searches new patches of sky several times a day and checks every new track against
                JPL&apos;s catalogs before it is published. Tracks JPL couldn&apos;t explain are re-checked on a schedule, so labels can
                change as catalogs grow.
              </p>
              <figure className={styles.instrument}>
                <SpectralStrip />
                <figcaption className={styles.instrumentNote}>
                  What SPHEREx sees: 0.75 to 5 µm, invisible to our eyes. Each detector&apos;s filter changes color from edge to edge, so
                  one object can look brighter or fainter from one visit to the next.
                </figcaption>
              </figure>
            </div>
            <ol className={styles.pipeline}>
              {PIPELINE.map((s, i) => (
                <li key={s.title} className={styles.stage}>
                  <span className={styles.stageNo} aria-hidden="true">
                    {i + 1}
                  </span>
                  <div>
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <HomeSky searched={t ? (t.n_searched ?? t.n_processed) : null} withObjects={t ? t.n_processed : null} />

        <section className="section" aria-labelledby="modes-heading">
          <h2 id="modes-heading">See it for yourself</h2>
          <ul className={styles.ways}>
            {WAYS_IN.map((w) => (
              <li key={w.href}>
                <Link href={w.href} className={styles.way}>
                  <span className={styles.wayTitle}>{w.title}</span>
                  <span className={styles.wayBody}>{w.body}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="section" aria-labelledby="featured-heading">
          <div className={styles.sectionHead}>
            <h2 id="featured-heading">Patches of sky to explore</h2>
            <Link href="/objects/?view=patches" className={styles.more}>
              See all patches
            </Link>
          </div>
          <FieldGrid limit={3} />
        </section>

        <section className={`section ${styles.integrity}`} aria-labelledby="integrity-heading">
          <h2 id="integrity-heading">We&apos;re looking, not claiming.</h2>
          <p>
            Scientists have proposed that an undiscovered planet, often called Planet X or Planet Nine, may orbit far beyond Neptune.
            That question is why we built this, but we have not found it. When a moving object doesn&apos;t match anything known, it
            could be an image artifact, a measurement error, or a real object no catalog lists yet. We publish the evidence and say
            which explanations we can and can&apos;t rule out.
          </p>
          <p>
            <Link href="/limits/">See where Planet X could still be hiding, and how we test ourselves</Link>
          </p>
        </section>
      </div>
    </>
  );
}
