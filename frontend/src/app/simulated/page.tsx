import type { Metadata } from "next";
import { Forward } from "./Forward";

export const metadata: Metadata = {
  title: "Detection limits",
  robots: { index: false },
};

/** The injection test moved to /limits/; keep old links (including ?study=) working. */
export default function SimulatedPage() {
  return (
    <div className="container">
      <Forward />
    </div>
  );
}
