import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { KnownObject } from "@/lib/contract";
import { KnownObjectPanel } from "./KnownObjectPanel";

const base: KnownObject = {
  checked: true,
  matched: true,
  catalogs_checked: ["JPL SBIdent", "JPL Horizons"],
  search_radius_arcsec: 15,
  designation: "433 Eros (A898 PA)",
  query_utc: "2026-11-01T00:00:00Z",
};

describe("KnownObjectPanel", () => {
  it("shows one row per catalog and the agreement headline", () => {
    render(
      <KnownObjectPanel
        detections={[]}
        known={{
          ...base,
          catalogs_checked: [...base.catalogs_checked, "IMCCE SkyBoT"],
          cross_checks: [{ catalog: "IMCCE SkyBoT", status: "agrees", designation: "Eros", separation_arcsec: 2.1, checked_utc: "2026-11-02T00:00:00Z" }],
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Catalog check" })).toBeInTheDocument();
    expect(screen.getByTestId("catalog-verdict")).toHaveTextContent("Confirmed by 2 independent catalogs");
    const rows = within(screen.getByRole("list", { name: "Answer from each catalog" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveTextContent("IMCCE SkyBoT");
    expect(rows[1]).toHaveTextContent("Agrees");
    expect(rows[1]).toHaveTextContent("2.1″");
    expect(within(rows[1]!).getByRole("link", { name: /ssoCard/ })).toHaveAttribute("href", "https://ssp.imcce.fr/forms/ssocard/Eros");
    expect(screen.getByText(/within 15″ of our position at every sighting/)).toBeInTheDocument();
  });

  it("says honestly when only JPL has answered", () => {
    render(<KnownObjectPanel detections={[]} known={{ ...base, cross_checks: [{ catalog: "IMCCE SkyBoT", status: "not_checked_yet" }] }} />);
    expect(screen.getByTestId("catalog-verdict")).toHaveTextContent("Only JPL has answered so far: re-checking");
    expect(screen.getAllByText("Not checked yet").length).toBeGreaterThan(0);
  });

  it("works on data without cross-checks", () => {
    render(<KnownObjectPanel detections={[]} known={base} />);
    expect(screen.getByText(/Yes: matches 433 Eros/)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Answer from each catalog" })).toBeNull();
    expect(screen.queryByText(/Confirmed by/)).toBeNull();
  });
});
