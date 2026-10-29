import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mover } from "@/lib/contract";
import { testEpoch, testPair } from "@/test/factories";
import { BlinkViewer } from "./BlinkViewer";

/** jsdom never loads images; resolve them so the viewer becomes ready. */
class InstantImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decoding = "auto";
  set src(_: string) {
    queueMicrotask(() => this.onload?.());
  }
  decode() {
    return Promise.resolve();
  }
}

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: reduce && query.includes("reduce"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

const epochs = [testEpoch("a", 60001), testEpoch("b", 60002, { wavelength_um_center: 2.5 }), testEpoch("c", 60003)];
const wcs = { width_px: 175, height_px: 175, cdelt_arcsec: 6.15 };
const mover: Mover = {
  candidate_id: "cand-1",
  classification: "unmatched",
  label_plain: "Test mover",
  quality_level: "medium",
  rate_arcsec_per_hr: 3,
  track: epochs.map((e, i) => ({ epoch_id: e.epoch_id, time_utc: e.time_utc, mjd: e.mjd, ra_deg: 0, dec_deg: 0, x_grid: 50 + i * 5, y_grid: 60 })),
};

beforeEach(() => {
  vi.stubGlobal("Image", InstantImage);
  setReducedMotion(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function renderViewer(props: Partial<Parameters<typeof BlinkViewer>[0]> = {}) {
  render(<BlinkViewer fieldName="Test field" wcs={wcs} epochs={epochs} blinkPairs={[testPair("a", "c", true), testPair("a", "b", false)]} {...props} />);
  await act(async () => {});
}

describe("BlinkViewer", () => {
  it("defaults to the wavelength-matched pair and auto-blinks", async () => {
    await renderViewer();
    expect(screen.getByText("Same wavelength.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Blink" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: /Pause/ })).toBeInTheDocument();
    // Both images of the matched pair (a and c) are stacked in the stage; one is shown at a time.
    expect(screen.getAllByRole("img", { name: /SPHEREx infrared image/, hidden: true })).toHaveLength(2);
    expect(screen.getAllByRole("img", { name: /SPHEREx infrared image/ })).toHaveLength(1);
  });

  it("labels different-wavelength pairs", async () => {
    await renderViewer();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Compare" }), "pair:a:b");
    expect(screen.getByText("Different wavelengths: brightness changes are expected.")).toBeInTheDocument();
  });

  it("starts in Swipe without autoplay when reduced motion is requested", async () => {
    setReducedMotion(true);
    await renderViewer();
    expect(screen.getByRole("radio", { name: "Swipe" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("button", { name: /Pause/ })).not.toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Divider position" })).toBeInTheDocument();
  });

  it("steps between dates with the buttons and the keyboard", async () => {
    await renderViewer({ blinkPairs: [] });
    await userEvent.click(screen.getByRole("radio", { name: "Step" }));
    await userEvent.click(screen.getByRole("button", { name: "Next date" }));
    expect(screen.getByText(/Showing image B/)).toBeInTheDocument();
    screen.getByRole("group", { name: /Test field/ }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByText(/Showing image C/)).toBeInTheDocument();
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByText(/Showing image A/)).toBeInTheDocument();
  });

  it("refuses to render an image without a source", async () => {
    const noSource = testEpoch("b", 60002, { image: { ...epochs[1]!.image, source: null as never } });
    await renderViewer({ epochs: [epochs[0]!, noSource], blinkPairs: [] });
    expect(screen.getByRole("img", { name: /Image B hidden: missing source/, hidden: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Image B has no source information/ })).toBeDisabled();
  });

  it("opens the provenance drawer", async () => {
    await renderViewer();
    await userEvent.click(screen.getByRole("button", { name: "Source for image A" }));
    const dialog = screen.getByRole("dialog", { name: /Image A: source/, hidden: true });
    expect(within(dialog).getByText("test-a.fits")).toBeInTheDocument();
  });

  it("shows what moved and opens a mover's details", async () => {
    await renderViewer({ movers: [mover, { ...mover, candidate_id: "sim", classification: "injected" }] });
    await userEvent.click(screen.getByRole("button", { name: "Show me what moved" }));
    expect(screen.getByText(/1 moving object circled/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Include SIMULATED test objects"));
    expect(screen.getByText(/2 moving objects circled/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Unexplained: Test mover" }));
    expect(screen.getByRole("link", { name: /See the full evidence/ })).toHaveAttribute("href", expect.stringMatching(/^\/detective\/candidate\/?\?id=cand-1$/));
  });

  it("shows an empty state with no epochs", async () => {
    await renderViewer({ epochs: [], blinkPairs: [] });
    expect(screen.getByRole("status")).toHaveTextContent("No observations");
  });
});
