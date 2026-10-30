import { badRequest } from "./errors";

/** Largest page a list endpoint returns. */
export const MAX_LIMIT = 500;

export interface PageParams {
  limit: number | null;
  offset: number;
}

/** `limit` (1-500, default: everything) and `offset` (default 0) query parameters. */
export function pageParams(query: (name: string) => string | undefined): PageParams {
  const l = query("limit");
  const o = query("offset");
  const limit = l === undefined ? null : Number(l);
  const offset = o === undefined ? 0 : Number(o);
  if (limit !== null && !(Number.isInteger(limit) && limit >= 1 && limit <= MAX_LIMIT)) {
    throw badRequest(`limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  if (!(Number.isInteger(offset) && offset >= 0)) throw badRequest("offset must be a non-negative integer");
  return { limit, offset };
}

/** One page of `items`; `total` is the number of items before paging. */
export function paginate<T>(items: T[], p: PageParams) {
  const end = p.limit === null ? items.length : Math.min(items.length, p.offset + p.limit);
  return {
    items: items.slice(p.offset, end),
    total: items.length,
    offset: p.offset,
    limit: p.limit,
    next_offset: end < items.length ? end : null,
  };
}
