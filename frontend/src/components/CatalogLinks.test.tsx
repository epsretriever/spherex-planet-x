import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JplLinksRow } from "./JplLinks";

describe("JplLinksRow", () => {
  it("links a matched object's designation to JPL SBDB and Horizons", () => {
    render(<JplLinksRow matched designation="433 Eros (A898 PA)" />);
    expect(screen.getByText("433 Eros (A898 PA)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /JPL SBDB/ })).toHaveAttribute("href", expect.stringContaining("sbdb_lookup.html#/?sstr=433"));
    expect(screen.getByRole("link", { name: /Horizons/ })).toHaveAttribute("href", expect.stringContaining("horizons"));
  });
  it("uses the pipeline's published links as-is", () => {
    render(<JplLinksRow matched designation="(2019 AB12)" published={{ sbdb_url: "https://ssd.jpl.nasa.gov/x", horizons_url: "https://ssd.jpl.nasa.gov/y" }} />);
    expect(screen.getByRole("link", { name: /JPL SBDB/ })).toHaveAttribute("href", "https://ssd.jpl.nasa.gov/x");
  });
  it("shows nothing for an unmatched object", () => {
    const { container } = render(<JplLinksRow matched={false} designation={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
