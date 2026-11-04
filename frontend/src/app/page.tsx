import Link from "next/link";
import { FieldGrid } from "@/components/FieldGrid";
import { GrowthCharts } from "@/components/home/GrowthCharts";
import { SpacetimeFabric } from "@/components/home/SpacetimeFabric";
import { TourButton } from "@/components/tour/Tour";
import { SpectralStrip } from "@/components/SpectralStrip";
import { formatUtcDate } from "@/lib/format";
import { staticCandidates, staticGrowth, staticSurvey } from "@/lib/staticData";
import styles from "./page.module.css";

/** The whole sky: 4π steradians, in square degrees. */
const SKY_DEG2 = 41252.96;

const CAPABILITIES = [
  {
    kicker: "Find",
    title: "Moving-object detection in real survey data",
    body: "We process SPHEREx Level 2 images from NASA's public archive, measure every source in every exposure, discard what stays fixed to the sky, and link the sightings that move consistently into tracks.",
  },
  {
    kicker: "Verify",
    title: "Every track checked against known objects",
    body: "Each track is compared with JPL's catalog of known asteroids and comets for the exact time and place of each image. Matches are labelled as known; anything left over is reported as unexplained, never as a discovery.",
  },
  {
    kicker: "Explain",
    title: "Evidence you can audit",
    body: "Every object gets a report with its measured positions, motion fit, signal quality, the ways it could be wrong, and a link from every image to the exact archive file it came from. AI-written summaries are checked number by number against the measurements.",
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

export default function LandingPage() {
  // Real numbers from the data the site was built with.
  const survey = staticSurvey();
  const candidates = staticCandidates();
  const t = survey?.totals;
  // Objects JPL couldn't identify, as last recorded from the live site by the pipeline.
  const unidentified = staticGrowth().findLast((d) => d.unidentified != null)?.unidentified ?? null;
  const stats = [
    t && { value: fmtInt(t.n_epochs), label: "SPHEREx images analyzed" },
    t && { value: fmtInt(t.n_searched ?? t.n_processed), label: "patches of sky searched" },
    t && { value: `${(t.area_deg2_searched ?? t.area_deg2_processed).toFixed(1)} deg²`, label: `of sky covered (${skyShare(t.area_deg2_searched ?? t.area_deg2_processed)})` },
    candidates && { value: fmtInt(candidates.candidates.filter((c) => c.classification !== "injected").length), label: "moving objects tracked" },
  ].filter((s): s is { value: string; label: string } => !!s);

  return (
    <>
      <SpacetimeFabric />
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroShade} aria-hidden="true" />
        <div className={`container ${styles.heroInner}`}>
          <p className="eyebrow">NASA SPHEREx · moving-object search · Planet X</p>
          <h1 id="hero-title" className={styles.title}>
            Everything that moves
            <br />
            <span className={styles.glow}>in the infrared sky.</span>
          </h1>
          <p className={styles.lede}>
            SPHEREx Planet X Explorer searches real images from NASA&apos;s SPHEREx space telescope for objects that move between
            observations: asteroids, comets and distant bodies in the outer solar system. Every one is tracked, checked against
            JPL&apos;s catalog of known objects, and published with the evidence for and against it.
          </p>
          <div className={styles.actions}>
            <Link href="/explore/" className="button button-primary">
              Explore the sky →
            </Link>
            <Link href="/leads/" className="button">
              {unidentified != null ? `${unidentified} unexplained leads` : "Unexplained leads"}
            </Link>
            <TourButton />
            <Link href="#how" className={styles.textLink}>
              How it works ↓
            </Link>
          </div>
          {stats.length > 0 && (
            <dl className={styles.stats}>
              {stats.map((s) => (
                <div key={s.label}>
                  <dt>{s.label}</dt>
                  <dd className="mono">{s.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {survey && <p className={styles.asOf}>Survey data as of {formatUtcDate(survey.generated_utc)}.</p>}
        </div>
      </section>

      <div className="container">
        <GrowthCharts days={staticGrowth()} />

        <section className={styles.what} aria-labelledby="what-heading">
          <div className={styles.whatHead}>
            <p className="eyebrow">What it does</p>
            <h2 id="what-heading">A transparent search for moving objects, built on real data</h2>
            <p className={styles.sectionLede}>
              Moving objects reveal themselves by shifting against the fixed stars. SPHEREx photographs each part of the sky again and
              again, in 102 infrared colors, which makes its archive a natural place to look. We turn those images into a searchable,
              checkable record of what moved.
            </p>
          </div>
          <ul className={styles.capabilities}>
            {CAPABILITIES.map((c) => (
              <li key={c.kicker} className={`card ${styles.capability}`}>
                <span className="eyebrow">{c.kicker}</span>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="how" className={`section ${styles.how}`} aria-labelledby="how-heading">
          <div className={styles.howGrid}>
            <div className={styles.howIntro}>
              <p className="eyebrow">How it works</p>
              <h2 id="how-heading">From raw images to an evidence report</h2>
              <p className={styles.sectionLede}>
                A Python pipeline in GitHub Actions searches new patches of sky several times a day and checks every new track against
                JPL&apos;s catalogs before it is published. Tracks JPL couldn&apos;t explain are re-checked on a schedule, so labels can
                change as catalogs grow.
              </p>
              <div className={`card ${styles.instrument}`}>
                <p className={`mono ${styles.instrumentLabel}`}>What SPHEREx sees</p>
                <SpectralStrip />
                <p className={styles.instrumentNote}>
                  0.75 to 5 µm, invisible to our eyes. Each detector&apos;s filter changes color from edge to edge, so one object can look
                  brighter or fainter from one visit to the next.
                </p>
              </div>
            </div>
            <ol className={styles.pipeline}>
              {PIPELINE.map((s, i) => (
                <li key={s.title} className={styles.stage}>
                  <span className={`mono ${styles.stageNo}`} aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
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

        <section className="section" aria-labelledby="modes-heading">
          <div className={styles.sectionHead}>
            <div>
              <p className="eyebrow">Ways in</p>
              <h2 id="modes-heading">See it for yourself</h2>
            </div>
          </div>
          <div className={styles.modes}>
            <Link href="/leads/" className={`card ${styles.mode}`}>
              <span className="eyebrow">Unexplained leads</span>
              <h3>What JPL can&apos;t explain</h3>
              <p>
                The objects no known asteroid or comet explains, ranked by the strength of the evidence, each with a blink, the case for
                and against, and where to point a telescope to confirm it.
              </p>
              <span className={styles.modeCta}>See the leads →</span>
            </Link>
            <Link href="/explore/" className={`card ${styles.mode}`}>
              <span className="eyebrow">Explorer</span>
              <h3>Blink the sky</h3>
              <p>Pick a patch of sky and flip between real SPHEREx images taken hours or days apart. Stars hold still; movers jump.</p>
              <span className={styles.modeCta}>Start exploring →</span>
            </Link>
            <Link href="/detective/" className={`card ${styles.mode}`}>
              <span className="eyebrow">Detective</span>
              <h3>Weigh the evidence</h3>
              <p>Every tracked object with its positions, speed, signal quality, JPL check, and the explanations we can and can&apos;t rule out.</p>
              <span className={styles.modeCta}>Open the case files →</span>
            </Link>
            <Link href="/objects/" className={`card ${styles.mode}`}>
              <span className="eyebrow">Objects</span>
              <h3>Follow one across visits</h3>
              <p>Each moving body with every sighting linked to it, how far away it is and, once one can be fitted, its orbit in 3D.</p>
              <span className={styles.modeCta}>Browse objects →</span>
            </Link>
            <Link href="/sky/" className={`card ${styles.mode}`}>
              <span className="eyebrow">Sky map</span>
              <h3>Where we&apos;ve searched</h3>
              <p>Every patch of sky we&apos;ve processed on one all-sky map, with the ecliptic and the Milky Way for reference.</p>
              <span className={styles.modeCta}>Open the map →</span>
            </Link>
            <Link href="/limits/" className={`card ${styles.mode}`}>
              <span className="eyebrow">Detection limits</span>
              <h3>What we could miss</h3>
              <p>How faint and how slow an object we can recover, measured by planting simulated objects in real images.</p>
              <span className={styles.modeCta}>See the limits →</span>
            </Link>
          </div>
        </section>

        <section className="section" aria-labelledby="featured-heading">
          <div className={styles.sectionHead}>
            <div>
              <p className="eyebrow">Start here</p>
              <h2 id="featured-heading">Patches of sky to explore</h2>
            </div>
            <Link href="/explore/" className={styles.more}>
              See all →
            </Link>
          </div>
          <FieldGrid limit={3} />
        </section>

        <section className={`section ${styles.integrity}`} aria-labelledby="integrity-heading">
          <p className="eyebrow">Scientific integrity</p>
          <h2 id="integrity-heading">We&apos;re looking, not claiming.</h2>
          <p>
            Scientists have proposed that an undiscovered planet, often called Planet X or Planet Nine, may orbit far beyond Neptune.
            That question is why we built this, but we have not found it. When a moving object doesn&apos;t match anything known, it
            could be an image artifact, a measurement error, or a real object no catalog lists yet. We publish the evidence and say
            which explanations we can and can&apos;t rule out.
          </p>
          <p>
            <Link href="/limits/">See where Planet X could still be hiding, and how we test ourselves →</Link>
          </p>
        </section>
      </div>
    </>
  );
}
