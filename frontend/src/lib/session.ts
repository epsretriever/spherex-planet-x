const KEY = "spx-session";
let memory: string | null = null;

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/**
 * An anonymous id for this browser tab, used by the API only for per-visitor rate limits.
 * Kept in sessionStorage when it is available; otherwise in memory for this page.
 */
export function sessionId(): string {
  if (memory) return memory;
  try {
    const stored = window.sessionStorage.getItem(KEY);
    if (stored && stored.length >= 8 && stored.length <= 64) return (memory = stored);
    memory = newId();
    window.sessionStorage.setItem(KEY, memory);
  } catch {
    memory ??= newId();
  }
  return memory;
}
