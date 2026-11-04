import type { Metadata } from "next";
import { Moved } from "@/components/Moved";

export const metadata: Metadata = { title: "Objects", robots: { index: false }, alternates: { canonical: "/objects/" } };

/** The Detective list is now the Objects page (same search and filters, same query string). */
export default function DetectivePage() {
  return <Moved to="/objects/" label="Objects" />;
}
