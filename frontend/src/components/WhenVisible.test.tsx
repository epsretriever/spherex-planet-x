import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Seen } from "./WhenVisible";

class NeverIntersects {
  observe() {}
  disconnect() {}
}

describe("Seen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fires when the reader jumps past the marker without it ever intersecting", () => {
    vi.stubGlobal("IntersectionObserver", NeverIntersects);
    let top = 5000;
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({ top }) as DOMRect);
    const onSeen = vi.fn();
    render(<Seen onSeen={onSeen} />);
    act(() => void window.dispatchEvent(new Event("scroll")));
    expect(onSeen).not.toHaveBeenCalled();
    top = -2000; // e.g. a #explanation link
    act(() => void window.dispatchEvent(new Event("scroll")));
    act(() => void window.dispatchEvent(new Event("scroll")));
    expect(onSeen).toHaveBeenCalledTimes(1);
    rect.mockRestore();
  });
});
