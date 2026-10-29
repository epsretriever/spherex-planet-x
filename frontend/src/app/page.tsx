import Link from "next/link";
import { FieldGrid } from "@/components/FieldGrid";
import { SpectralStrip } from "@/components/SpectralStrip";
import styles from "./page.module.css";

const STEPS = [
  {
    title: "Real infrared pictures",
    body: "NASA's SPHEREx telescope maps the whole sky in 102 infrared colors and keeps coming back to photograph the same spots again.",
  },
  {
    title: "Flip between dates",
    body: "Line up pictures of one patch of sky taken on different days and flip between them. Stars stay exactly where they are.",
  },
  {
    title: "Catch what moved",
    body: "Asteroids, comets and distant solar system bodies drift against the stars. A dot that jumps between pictures is giving itself away.",
  },
];

export default function LandingPage() {
  return (
    <>
      <section className={styles.hero}>
        <div className={`container ${styles.heroInner}`}>
          <div className={styles.heroText}>
            <p className="eyebrow">NASA SPHEREx · the infrared sky over time</p>
            <h1 className={styles.title}>
              The sky moves.
              <br />
              <span className={styles.glow}>Catch it in the act.</span>
            </h1>
            <p className={styles.lede}>
              Flip between real SPHEREx images of the same patch of sky, taken days or months apart. Stars hold still. The
              things that move are asteroids, comets, and sometimes things nobody can explain yet.
            </p>
            <div className={styles.actions}>
              <Link href="/explore/" className="button button-primary">
                Explore the sky →
              </Link>
              <Link href="/detective/" className="button">
                Be a detective
              </Link>
            </div>
          </div>
          <div className={styles.heroArt}>
            <div className={`card ${styles.instrument}`}>
              <p className={`mono ${styles.instrumentLabel}`}>What SPHEREx sees</p>
              <SpectralStrip />
              <p className={styles.instrumentNote}>
                Every pixel of the sky is measured in 102 shades of infrared, invisible to our eyes. Each detector&apos;s filter
                changes color from edge to edge, which is why one star can look brighter or fainter from one visit to the
                next.
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="container">
        <section aria-labelledby="how-heading" className={styles.steps}>
          <h2 id="how-heading" className="visually-hidden">
            How it works
          </h2>
          <ol className={styles.stepList}>
            {STEPS.map((s, i) => (
              <li key={s.title} className={`card ${styles.step}`}>
                <span className={`mono ${styles.stepNumber}`}>0{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
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

        <section className="section" aria-labelledby="modes-heading">
          <h2 id="modes-heading" className="visually-hidden">
            Two ways in
          </h2>
          <div className={styles.modes}>
            <Link href="/explore/" className={`card ${styles.mode}`}>
              <span className="eyebrow">Explorer</span>
              <h3>Blink the sky yourself</h3>
              <p>No jargon. Pick a patch, flip between dates, and see if you can spot the dot that jumps before we show you.</p>
              <span className={styles.modeCta}>Start exploring →</span>
            </Link>
            <Link href="/detective/" className={`card ${styles.mode}`}>
              <span className="eyebrow">Detective</span>
              <h3>Weigh the evidence</h3>
              <p>
                Every moving object our pipeline flagged, with its positions, speed, signal quality, known-object match and the ways it
                could be wrong.
              </p>
              <span className={styles.modeCta}>Open the case files →</span>
            </Link>
          </div>
        </section>

        <section className={`section ${styles.integrity}`} aria-labelledby="integrity-heading">
          <p className="eyebrow">Honest science</p>
          <h2 id="integrity-heading">We&apos;re looking, not claiming.</h2>
          <p>
            Scientists have proposed that an undiscovered planet, often called Planet X, may orbit far beyond Neptune. That
            idea is why we built this, but we have not found it. When our software flags a moving dot that doesn&apos;t match
            any known object, it could be an image glitch, a measurement error, or a real object that no catalog lists yet. We
            show the evidence and say which explanations we can and can&apos;t rule out.
          </p>
          <p>
            <Link href="/simulated/">See how we test ourselves with planted, SIMULATED objects →</Link>
          </p>
        </section>
      </div>
    </>
  );
}
