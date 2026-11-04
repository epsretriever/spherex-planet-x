import type { Metadata } from "next";
import { Moved } from "@/components/Moved";

export const metadata: Metadata = { title: "Unexplained leads", robots: { index: false }, alternates: { canonical: "/objects/?view=leads" } };

/** The ranked leads are now the "Unexplained leads" tab of the Objects page. */
export default function LeadsPage() {
  return <Moved to="/objects/?view=leads" label="Objects › Unexplained leads" />;
}
