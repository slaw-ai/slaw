const STORAGE_PREFIX = "slaw:recent-searches:";
const MAX_RECENT_SEARCHES = 5;

function storageKey(squadId: string) {
  return `${STORAGE_PREFIX}${squadId}`;
}

function isStorageAvailable() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadRecentSearches(squadId: string): string[] {
  if (!isStorageAvailable() || !squadId) return [];
  try {
    const raw = window.localStorage.getItem(storageKey(squadId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cleaned: string[] = [];
    for (const value of parsed) {
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      cleaned.push(trimmed);
      if (cleaned.length >= MAX_RECENT_SEARCHES) break;
    }
    return cleaned;
  } catch {
    return [];
  }
}

export function pushRecentSearch(squadId: string, query: string): string[] {
  if (!isStorageAvailable() || !squadId) return [];
  const trimmed = query.trim();
  if (!trimmed) return loadRecentSearches(squadId);
  const existing = loadRecentSearches(squadId);
  const filtered = existing.filter((entry) => entry.toLowerCase() !== trimmed.toLowerCase());
  const next = [trimmed, ...filtered].slice(0, MAX_RECENT_SEARCHES);
  try {
    window.localStorage.setItem(storageKey(squadId), JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export function clearRecentSearches(squadId: string): void {
  if (!isStorageAvailable() || !squadId) return;
  try {
    window.localStorage.removeItem(storageKey(squadId));
  } catch {
    // ignore
  }
}

export const RECENT_SEARCHES_LIMIT = MAX_RECENT_SEARCHES;
