const dateFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
});

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parse(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Jun 5, 2025". Falls back to the raw string if it isn't a valid date. */
export function formatUtcDate(iso: string): string {
  const d = parse(iso);
  return d ? dateFmt.format(d) : iso;
}

const shortFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

/** "Jun 5", for tight labels where the year is shown elsewhere. */
export function formatUtcShortDate(iso: string): string {
  const d = parse(iso);
  return d ? shortFmt.format(d) : iso;
}

/** "05:12 UTC". */
export function formatUtcTime(iso: string): string {
  const d = parse(iso);
  return d ? `${timeFmt.format(d)} UTC` : iso;
}

/** "Jun 5, 2025, 05:12 UTC". */
export function formatUtcDateTime(iso: string): string {
  const d = parse(iso);
  return d ? `${dateFmt.format(d)}, ${timeFmt.format(d)} UTC` : iso;
}

/** "1.43 µm". */
export function formatWavelength(um: number): string {
  return Number.isFinite(um) ? `${um.toFixed(2)} µm` : "unknown wavelength";
}

/** Plain-language gap between two MJDs: "6 hours", "3 days", "6 months". */
export function formatInterval(mjdA: number, mjdB: number): string {
  const days = Math.abs(mjdB - mjdA);
  if (!Number.isFinite(days)) return "an unknown time";
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (days < 2) return plural(Math.max(1, Math.round(days * 24)), "hour");
  if (days < 60) return plural(Math.round(days), "day");
  if (days < 730) return plural(Math.round(days / 30.44), "month");
  return plural(Math.round(days / 365.25), "year");
}

/** "31.7″ per hour". */
export function formatRate(arcsecPerHr: number | null | undefined): string {
  if (arcsecPerHr === null || arcsecPerHr === undefined || !Number.isFinite(arcsecPerHr)) return "not measured";
  return `${arcsecPerHr < 10 ? arcsecPerHr.toFixed(2) : arcsecPerHr.toFixed(1)}″ per hour`;
}

/** Fixed decimals, or an em dash for null. */
export function fmt(value: number | null | undefined, decimals = 2): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(decimals);
}

/** "6.2 hours", "3.1 days". */
export function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return "—";
  if (hours < 48) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} hours`;
  const days = hours / 24;
  return `${days < 10 ? days.toFixed(1) : Math.round(days)} days`;
}

/** "just now", "12 minutes ago", "3 hours ago", "2 days ago". */
export function formatAgo(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "at an unknown time";
  const mins = Math.max(0, Math.round((now - t) / 60000));
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (mins < 1) return "just now";
  if (mins < 60) return plural(mins, "minute");
  const hours = Math.round(mins / 60);
  if (hours < 48) return plural(hours, "hour");
  return plural(Math.round(hours / 24), "day");
}
