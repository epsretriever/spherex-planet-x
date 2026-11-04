import { PageGuide } from "@/components/PageGuide";
import type { Metadata } from "next";
import { pageMeta } from "@/lib/meta";
import Link from "next/link";
import { ClassificationBadge } from "@/components/ClassificationBadge";
import { GLOSSARY } from "@/components/Term";
import { CLASSIFICATIONS, CLASSIFICATION_ORDER } from "@/lib/labels";
import { blindSpeeds, summarizeLimits } from "@/lib/limits";
import { staticInjectionStudy, staticSurvey } from "@/lib/staticData";
import styles from "./page.module.css";

export const metadata: Metadata = pageMeta(
  "About and methods",
  "How the SPHEREx Planet X Explorer finds moving objects in NASA SPHEREx images: the pipeline, data sources, honest limitations and the team.",
  "/about/",
);

/** Where each stage runs, in order. */
const PIPELINE: { where: string; note: string; steps: { title: string; body: string }[] }[] = [
  {
    where: "GitHub Actions",
    note: "Python pipeline (pipeline/), several runs a day, in parallel shards",
    steps: [
      { title: "Fetch", body: "Find every SPHEREx Level 2 exposure covering a 0.3° patch in NASA/IPAC's archive (IRSA) and read just that region of each file." },
      { title: "Clean and align", body: "Subtract the zodiacal-light model and background, mask the pixels SPHEREx flags as unreliable, and put every image on one grid." },
      { title: "Detect", body: "Measure every source above signal-to-noise 4.5 in every exposure." },
      { title: "Remove the fixed sky", body: "Drop sources that stay put across visits: stars and galaxies." },
      { title: "Link and fit", body: "Link sightings across visits into tracks with one steady motion, including SPHEREx's own parallax. Three or more visits confirm a track; two make an unconfirmed pair." },
      { title: "Vet and score", body: "Artifact checks (flagged pixels, shape, edges, static sources, brightness across wavelengths) and a rule-based score." },
      { title: "JPL triage", body: "Ask JPL SBIdent which known bodies were near each visit, as seen from SPHEREx, then refine with Horizons. Within 15″ at every visit is a match." },
      { title: "Orbit and publish", body: "Fit a preliminary orbit and prediction for what JPL can't explain, then commit the JSON to the repository." },
    ],
  },
  {
    where: "Cloudflare Worker",
    note: "worker/, the /api the site reads",
    steps: [
      { title: "Serve and re-check", body: "Serves the published data and re-checks unexplained and unchecked objects against JPL on a schedule." },
    ],
  },
  {
    where: "Vercel",
    note: "frontend/, this Next.js site",
    steps: [{ title: "Show the evidence", body: "Blinks, evidence reports, leads, limits and the sky map, built from the same data." }],
  },
];

const SOURCES: { name: string; use: string; href: string; cite?: string }[] = [
  {
    name: "SPHEREx Level 2 images (NASA / JPL-Caltech / IPAC)",
    use: "Every image and measurement on this site.",
    href: "https://irsa.ipac.caltech.edu/Missions/spherex.html",
    cite: "Mission: Doré et al. 2014, “Cosmology with the SPHEREx All-Sky Spectral Survey”, arXiv:1412.4872.",
  },
  {
    name: "NASA/IPAC Infrared Science Archive (IRSA)",
    use: "Finding the exposures that cover each patch, and the files themselves.",
    href: "https://irsa.ipac.caltech.edu/",
  },
  {
    name: "JPL Small-Body Identification (SBIdent) API",
    use: "Which known asteroids and comets were near each detection, from SPHEREx's position.",
    href: "https://ssd-api.jpl.nasa.gov/doc/sb_ident.html",
  },
  {
    name: "JPL Horizons",
    use: "Precise predicted positions for the closest known objects; ephemeris links for identified objects.",
    href: "https://ssd.jpl.nasa.gov/horizons/",
    cite: "Giorgini et al. 1996, “JPL's On-Line Solar System Data Service”, BAAS 28, 1158.",
  },
  {
    name: "JPL Small-Body Database (SBDB)",
    use: "Orbit pages for every identified object (we link to JPL rather than recompute its orbits).",
    href: "https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html",
  },
];

const REPO = "https://github.com/epsretriever/spherex-planet-x";

const rate = (r: number) => `${r}″/hr`;

function Limitations() {
  const study = staticInjectionStudy();
  const survey = staticSurvey();
  const area = survey ? (survey.totals.area_deg2_searched ?? survey.totals.area_deg2_processed) : null;
  const sum = study ? summarizeLimits(study) : null;
  const blind = study ? blindSpeeds(study) : null;
  const fp = study?.false_positives;
  return (
    <ul className={styles.limits}>
      {sum?.deepest && (
        <li>
          <strong>Depth: about AB {sum.deepest.m50_ab.toFixed(1)}.</strong> Half of the simulated objects we planted were found down to
          AB magnitude {sum.shallowest ? `${sum.shallowest.m50_ab.toFixed(1)}–` : ""}
          {sum.deepest.m50_ab.toFixed(1)} at {sum.reachedRates.map(rate).join(", ")}. Anything fainter is mostly missed.
        </li>
      )}
      {blind && blind.slowNeverHalf.length > 0 && (
        <li>
          <strong>Planet X–like motion can&apos;t be detected yet.</strong> At {blind.slowNeverHalf.map(rate).join(" and ")}, the speeds
          of a distant planet, the pipeline never found half of the planted objects at any brightness: over a day or two they move less than
          one 6.2″ pixel, so they look like fixed stars. Finding them needs visits weeks or months apart.
        </li>
      )}
      {blind && blind.fastNeverHalf.length > 0 && (
        <li>
          <strong>Very fast movers are missed too:</strong> at {blind.fastNeverHalf.map(rate).join(", ")} the pipeline also never found
          half of them.
        </li>
      )}
      {fp && (
        <li>
          <strong>False alarms are rare but not zero:</strong> {fp.n_candidates} in {fp.area_deg2} deg² of control fields with nothing
          planted.
        </li>
      )}
      {area != null && (
        <li>
          <strong>Coverage is small so far:</strong> {area.toFixed(0)} deg², {((100 * area) / 41252.96).toFixed(2)}% of the sky, mostly
          near the ecliptic. Unsearched sky tells us nothing either way.
        </li>
      )}
      <li>
        <strong>Unexplained is not new.</strong> JPL&apos;s check looks within 15″ of predicted positions; an object with a poorly known
        orbit, or a very recent discovery, can be missed. Our orbits usually come from about a day of data, so their predictions are very uncertain.
      </li>
      <li>
        <strong>The scores are rankings, not probabilities.</strong> No object here has been confirmed by another telescope.
      </li>
    </ul>
  );
}

export default function AboutPage() {
  return (
    <div className={`container ${styles.page}`}>
      <PageGuide>How the search works, where the data comes from, its honest limits, and who built it.</PageGuide>
      <h1>How it works</h1>
      <p className={styles.lede}>
        SPHEREx is a NASA space telescope that maps the entire sky in 102 infrared colors, from 0.75 to 5 microns. It revisits each part
        of the sky, so objects that move between visits, like asteroids, comets and distant solar system bodies, show up as dots that
        change position. We search its public images for them, check each against JPL&apos;s catalogs, and publish the evidence.
      </p>

      <section aria-labelledby="pipeline">
        <h2 id="pipeline">The pipeline</h2>
        <div className={styles.flow}>
          {PIPELINE.map((stage, si) => (
            <div key={stage.where} className={styles.stage}>
              <p className={styles.where}>
                <span className="mono">{stage.where}</span> · {stage.note}
              </p>
              <ol className={styles.steps} start={PIPELINE.slice(0, si).reduce((n, s) => n + s.steps.length, 1)}>
                {stage.steps.map((m, i) => (
                  <li key={m.title}>
                    <h3>
                      <span className={`mono ${styles.stepNo}`} aria-hidden="true">
                        {String(PIPELINE.slice(0, si).reduce((n, s) => n + s.steps.length, 1) + i).padStart(2, "0")}
                      </span>
                      {m.title}
                    </h3>
                    <p>{m.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="limitations">
        <h2 id="limitations">Honest limitations</h2>
        <p>Measured by planting simulated objects in real SPHEREx images and running the same pipeline on them.</p>
        <Limitations />
        <p>
          <Link href="/limits/">The full detection-limits study →</Link>
        </p>
      </section>

      <section aria-labelledby="sources">
        <h2 id="sources">Data sources and citations</h2>
        <ul className={styles.sources}>
          {SOURCES.map((src) => (
            <li key={src.name}>
              <a href={src.href} target="_blank" rel="noopener noreferrer">
                {src.name}
              </a>
              <span>{src.use}</span>
              {src.cite && <span className={styles.cite}>{src.cite}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="wavelength">
        <h2 id="wavelength">Why brightness can change between dates</h2>
        <p>
          Each SPHEREx detector sits behind a filter whose color changes from one edge to the other. On different visits,
          the same star usually lands on a different part of the detector, so it is photographed at a different infrared
          wavelength. Stars are brighter at some wavelengths than others. When two images were taken at different
          wavelengths, we say so on the image, and we judge motion by position, not brightness.
        </p>
      </section>

      <section aria-labelledby="labels">
        <h2 id="labels">What the labels mean</h2>
        <p>Our pipeline sorts every moving source into one of five groups. We show its label exactly as the pipeline assigned it.</p>
        <dl className={styles.labels}>
          {CLASSIFICATION_ORDER.map((c) => (
            <div key={c}>
              <dt>
                <ClassificationBadge value={c} />
              </dt>
              <dd>{CLASSIFICATIONS[c].plain}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="testing">
        <h2 id="testing">How we test ourselves</h2>
        <p>
          We plant fake moving objects, of known brightness and speed, into real images and check how many the pipeline finds. We
          also run it on patches with nothing planted to count false alarms. These planted objects are always labeled SIMULATED.{" "}
          <Link href="/limits/">See the results →</Link>
        </p>
      </section>

      <section aria-labelledby="integrity">
        <h2 id="integrity">Scientific integrity</h2>
        <p>
          We do not claim to discover Planet X. A candidate that does not match a known object could be an imaging
          artifact, a measurement error, or an object missing from the catalog. Planet X is our scientific motivation,
          not a promised result. Every image links back to the archive file it came from, and every number in an
          explanation comes from our measurements.
        </p>
      </section>

      <section aria-labelledby="glossary">
        <h2 id="glossary">Glossary</h2>
        <dl className={styles.glossary}>
          {Object.entries(GLOSSARY).map(([term, text]) => (
            <div key={term}>
              <dt>{term === "snr" ? "S/N" : term === "mjd" ? "MJD" : term === "µjy" ? "µJy" : term}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="team">
        <h2 id="team">Team and code</h2>
        <ul>
          <li>Armaan: frontend, UI/UX, sky viewer, candidate dashboard</li>
          <li>Bodhi: NASA data research, image analysis, scientific validation</li>
        </ul>
        <p>
          Built for the NASA Space Apps Challenge 2026, &ldquo;Planet X and SPHEREx&rdquo;. Everything is open source (MIT):{" "}
          <a href={REPO} target="_blank" rel="noopener noreferrer">
            github.com/epsretriever/spherex-planet-x
          </a>
          , including the pipeline, the published data and the survey runs.
        </p>
      </section>
    </div>
  );
}
