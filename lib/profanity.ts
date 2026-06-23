// lib/profanity.ts
// Thin wrapper around `bad-words` for profanity/slur detection.
//
// NOTE: bad-words uses a substring-match heuristic and will occasionally
// flag legitimate words that contain blocked substrings (the "Scunthorpe
// problem"). This is an acceptable tradeoff for catching actual slurs in
// user-visible text like display names, bike nicknames, and track names.
import Filter from "bad-words";

let filter: Filter;
try {
  filter = new Filter();
} catch {
  // If the Filter constructor fails for any reason, create a no-op fallback
  // so isProfane never blocks all saves.
  filter = { isProfane: () => false, clean: (t: string) => t } as any;
}

/**
 * Returns true if `text` contains profanity or slurs.
 * Fails open on error — a broken filter should never block all saves.
 */
export function isProfane(text: string): boolean {
  try {
    return filter.isProfane(text);
  } catch {
    return false;
  }
}

/**
 * Returns `text` with profane words replaced by asterisks.
 * Fails open — returns the original text if the filter errors.
 */
export function cleanText(text: string): string {
  try {
    return filter.clean(text);
  } catch {
    return text;
  }
}
