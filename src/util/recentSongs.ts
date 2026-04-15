/**
 * localStorage-backed "recently played" list. Holds up to N most recent
 * songs with the user's final score. File uploads can't be replayed (File
 * objects don't survive page reload) so their entries carry no sourceUrl.
 */

export type SourceKind = 'file' | 'url' | 'suno-share' | 'suno-prompt';

export interface RecentSong {
  /** Stable identity for dedup — URL when we have one, else `file:<name>`. */
  id: string;
  title: string;
  kind: SourceKind;
  /** Present for url / suno-share / suno-prompt when we have a replayable URL. */
  sourceUrl?: string;
  /** Original prompt text for suno-prompt entries. */
  sourcePrompt?: string;
  score: number;
  totalScore: number;
  /** 0..100. Denormalised so we don't recompute when rendering. */
  percent: number;
  pickedCount: number;
  missedCount: number;
  /** Unix ms. */
  playedAt: number;
}

const LOCAL_STORAGE_KEY = 'vibez.surf.recentSongs';
const MAX_ENTRIES = 50;

export function loadRecentSongs(): RecentSong[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: skip any entries missing required fields.
    return parsed.filter(
      (e): e is RecentSong =>
        e && typeof e.id === 'string' &&
        typeof e.title === 'string' &&
        typeof e.score === 'number' &&
        typeof e.totalScore === 'number',
    );
  } catch {
    return [];
  }
}

function save(list: RecentSong[]): void {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(list));
}

/**
 * Insert a new entry at the front; drop any previous entry with the same
 * id (same URL replayed → moves to top and overwrites score); cap to
 * MAX_ENTRIES (oldest FIFO-evicted).
 */
export function recordSong(song: RecentSong): RecentSong[] {
  const existing = loadRecentSongs().filter((e) => e.id !== song.id);
  const updated = [song, ...existing].slice(0, MAX_ENTRIES);
  save(updated);
  return updated;
}

/** Clear the list (not currently wired into UI but useful for debugging). */
export function clearRecentSongs(): void {
  localStorage.removeItem(LOCAL_STORAGE_KEY);
}

/**
 * Build a stable id for a played song. Songs with the same id are treated
 * as replays — the most recent score wins.
 */
export function computeRecentId(
  kind: SourceKind,
  title: string,
  sourceUrl?: string,
  sourcePrompt?: string,
): string {
  if (sourceUrl) return `url:${sourceUrl}`;
  if (kind === 'suno-prompt' && sourcePrompt) return `prompt:${sourcePrompt}`;
  // File uploads — identity = filename (best we can do without hashing bytes).
  return `${kind}:${title}`;
}
