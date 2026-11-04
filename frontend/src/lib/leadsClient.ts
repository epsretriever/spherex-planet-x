import { DataError } from "./api";
import type { Lead } from "./leads";

/** The build-time lead list (see leads.json/route.ts). */
export async function getLeadSeeds(signal: AbortSignal): Promise<Lead[]> {
  let res: Response;
  try {
    res = await fetch("/leads/leads.json", { signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new DataError("unavailable", "Could not load the leads.");
  }
  if (!res.ok) throw new DataError(res.status === 404 ? "not_found" : "unavailable", `The leads returned ${res.status}.`, res.status);
  const body = (await res.json()) as { leads?: Lead[] };
  if (!Array.isArray(body.leads)) throw new DataError("invalid", "The leads file has no list.");
  return body.leads;
}

/**
 * The build-time leads, filtered by the live object list: JPL results live in the Worker, so only
 * the live API knows which objects are still unidentified. If it can't be reached, every
 * published lead is shown with a note.
 */
