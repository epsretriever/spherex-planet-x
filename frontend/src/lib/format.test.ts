import { describe, expect, it } from "vitest";
import { fmt, formatAgo, formatHours, formatInterval, formatRate, formatUtcDate, formatUtcDateTime, formatWavelength } from "./format";

describe("format", () => {
  it("formats UTC dates regardless of the local time zone", () => {
    expect(formatUtcDate("2025-06-05T23:30:00Z")).toBe("Jun 5, 2025");
    expect(formatUtcDateTime("2025-06-05T05:12:00Z")).toBe("Jun 5, 2025, 05:12 UTC");
    expect(formatUtcDate("not a date")).toBe("not a date");
  });

  it("formats wavelengths and rates", () => {
    expect(formatWavelength(1.4321)).toBe("1.43 µm");
    expect(formatRate(31.74)).toBe("31.7″ per hour");
    expect(formatRate(0.234)).toBe("0.23″ per hour");
    expect(formatRate(null)).toBe("not measured");
  });

  it("describes intervals in plain units", () => {
    expect(formatInterval(60000, 60000.25)).toBe("6 hours");
    expect(formatInterval(60000, 60003)).toBe("3 days");
    expect(formatInterval(60000, 60183)).toBe("6 months");
    expect(formatHours(6.2)).toBe("6.2 hours");
    expect(formatHours(72)).toBe("3.0 days");
    expect(fmt(null)).toBe("—");
    expect(fmt(1.236, 2)).toBe("1.24");
  });
});

describe("formatAgo", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");
  it("describes how long ago in plain units", () => {
    expect(formatAgo("2026-10-29T11:59:40Z", now)).toBe("just now");
    expect(formatAgo("2026-10-29T11:48:00Z", now)).toBe("12 minutes ago");
    expect(formatAgo("2026-10-29T09:00:00Z", now)).toBe("3 hours ago");
    expect(formatAgo("2026-10-27T12:00:00Z", now)).toBe("2 days ago");
    expect(formatAgo("bad", now)).toBe("at an unknown time");
  });
});
