import type { Metadata } from "next";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "How it works",
};

const METHOD = [
  {
    title: "Fetch real observations",
    body: "For each patch of sky we find every SPHEREx exposure that covers it in NASA/IPAC's Infrared Science Archive (IRSA) and download small cutouts.",
  },
  {
    title: "Line them up",
    body: "The cutouts are placed on a common grid and given the same brightness scale, so a star sits on the same pixels in every image.",
  },
  {
    title: "Find dots that move",
    body: "Our pipeline detects sources in each image and links detections that move in a straight line or follow the motion expected of a distant object.",
  },
  {
    title: "Check against known objects",
    body: "Each moving source is compared with JPL's predictions for known asteroids and comets at the time of each image.",
  },
  {
    title: "Show the evidence",
    body: "Every candidate gets a report with its measured positions, motion, signal quality, known-object match and the ways it could be wrong.",
  },
];

export default function AboutPage() {
  return (
    <div className={`container ${styles.page}`}>
      <h1>How it works</h1>
      <p className={styles.lede}>
        SPHEREx is a NASA space telescope that maps the entire sky in 102 infrared colors, from 0.75 to 5 microns. It
        revisits each part of the sky, so objects that move between visits, like asteroids, comets and distant solar
        system bodies, show up as dots that change position.
      </p>

      <ol className={styles.method}>
        {METHOD.map((m) => (
          <li key={m.title}>
            <h2>{m.title}</h2>
            <p>{m.body}</p>
          </li>
        ))}
      </ol>

      <section aria-labelledby="wavelength">
        <h2 id="wavelength">Why brightness can change between dates</h2>
        <p>
          Each SPHEREx detector sits behind a filter whose color changes from one edge to the other. On different visits,
          the same star usually lands on a different part of the detector, so it is photographed at a different infrared
          wavelength. Stars are brighter at some wavelengths than others. When two images were taken at different
          wavelengths, we say so on the image, and we judge motion by position, not brightness.
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

      <section aria-labelledby="credits">
        <h2 id="credits">Data and credits</h2>
        <ul>
          <li>
            SPHEREx data: NASA / JPL-Caltech / IPAC, via the{" "}
            <a href="https://irsa.ipac.caltech.edu/" target="_blank" rel="noopener noreferrer">
              NASA/IPAC Infrared Science Archive
            </a>
            .
          </li>
          <li>
            Known-object predictions:{" "}
            <a href="https://ssd.jpl.nasa.gov/" target="_blank" rel="noopener noreferrer">
              JPL Solar System Dynamics
            </a>{" "}
            (Small-Body Identification and Horizons).
          </li>
          <li>Built for the NASA Space Apps Challenge 2026, &ldquo;Planet X and SPHEREx&rdquo;.</li>
        </ul>
      </section>

      <section aria-labelledby="team">
        <h2 id="team">Team</h2>
        <ul>
          <li>Armaan: frontend, UI/UX, sky viewer, candidate dashboard</li>
          <li>Bodhi: NASA data research, image analysis, scientific validation</li>
        </ul>
      </section>
    </div>
  );
}
