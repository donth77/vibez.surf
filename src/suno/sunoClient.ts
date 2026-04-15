/**
 * Client for the gcui-art/suno-api proxy (deployed separately by the
 * vibez.surf operator). BYOK model — each user supplies their OWN Suno
 * session cookie, which is stored in localStorage and sent to the proxy
 * as the `X-Suno-Cookie` header. The proxy URL itself is baked in at
 * build time via `VITE_SUNO_API_URL`.
 *
 * Endpoints used:
 *   POST /api/generate        — kicks off a generation
 *   GET  /api/get?ids=<id>    — polls status / fetches audio_url
 *
 * Security: the cookie never leaves the user's browser except on requests
 * to the configured proxy. We never log it, never embed it in URLs, and
 * rely on localStorage's same-origin isolation for at-rest protection.
 * Users see a password-masked input in the settings modal.
 */

export interface SunoSongMeta {
  id: string;
  status: string;
  audio_url?: string;
  title?: string;
}

const TOKEN_KEY = 'vibez.surf.sunoToken';
const MODEL_KEY = 'vibez.surf.sunoModel';

/**
 * Suno model IDs (as the gcui-art proxy expects them). Order is newest →
 * oldest; the first entry is the default when nothing's saved.
 */
export const SUNO_MODELS = [
  { id: 'chirp-v5',   label: 'v5 (newest)' },
  { id: 'chirp-v4-5', label: 'v4.5' },
  { id: 'chirp-v4',   label: 'v4' },
  { id: 'chirp-v3-5', label: 'v3.5' },
] as const;
export type SunoModelId = typeof SUNO_MODELS[number]['id'];
export const DEFAULT_SUNO_MODEL: SunoModelId = 'chirp-v5';

export function loadSunoModel(): SunoModelId {
  const raw = (() => { try { return localStorage.getItem(MODEL_KEY); } catch { return null; } })();
  const hit = SUNO_MODELS.find((m) => m.id === raw);
  return hit ? hit.id : DEFAULT_SUNO_MODEL;
}
export function saveSunoModel(m: SunoModelId): void {
  localStorage.setItem(MODEL_KEY, m);
}

/** Abort primary request after this many ms — just past Vercel's 10s
 *  function-timeout so we notice the Vercel kill and fall back to the
 *  slower-but-unlimited secondary proxy. */
const PRIMARY_TIMEOUT_MS = 12_000;

function getApiUrls(): string[] {
  const primary = (import.meta.env.VITE_SUNO_API_URL as string | undefined) || '';
  const fallback = (import.meta.env.VITE_SUNO_API_URL_FALLBACK as string | undefined) || '';
  return [primary, fallback].filter(Boolean);
}

/** True when the deployer configured at least one proxy URL. Gates the UI. */
export function isSunoEnabled(): boolean {
  return getApiUrls().length > 0;
}

export function loadSunoToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveSunoToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearSunoToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** True when both the proxy URL is configured AND the user has a cookie saved. */
export function hasSunoToken(): boolean {
  return !!loadSunoToken();
}

/**
 * Extracts a Suno song ID from a share URL like
 * `https://suno.com/song/<uuid>` or just a bare UUID. Returns null if the
 * input doesn't look like either.
 */
export function parseSunoUrl(input: string): string | null {
  const trimmed = input.trim();
  const uuidRe = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
  const match = trimmed.match(uuidRe);
  return match ? match[0] : null;
}

function authHeaders(): Record<string, string> {
  const token = loadSunoToken();
  if (!token) {
    throw new Error(
      'No Suno cookie saved — click the ⚙ gear in the "Generate with ' +
      'Suno AI" section and paste your cookie first.',
    );
  }
  const headers: Record<string, string> = { 'X-Suno-Cookie': token };
  // Shared-secret gate on the proxy. Ships in the bundle (so not a
  // real secret), but blocks drive-by curl abuse that skips CORS.
  const apiKey = (import.meta.env.VITE_SUNO_API_KEY as string | undefined) || '';
  if (apiKey) headers['X-API-Key'] = apiKey;
  return headers;
}

/**
 * Try the request against the primary proxy URL; on infrastructure failure
 * (timeout, 5xx) retry the secondary. 4xx responses (auth/rate-limit) are
 * returned as-is without fallback — those are the user's fault and
 * retrying won't help.
 *
 * Primary gets a short timeout (PRIMARY_TIMEOUT_MS) because Vercel free
 * will kill the function at 10s anyway; we notice the abort and move on
 * rather than waiting around.
 */
async function fetchWithFallback(
  buildUrl: (base: string) => string,
  init: RequestInit,
): Promise<Response> {
  const urls = getApiUrls();
  if (urls.length === 0) throw new Error('Suno is not configured on this site.');

  let lastError: unknown = null;
  for (let i = 0; i < urls.length; i++) {
    const base = urls[i]!;
    const isPrimary = i === 0 && urls.length > 1;
    const controller = new AbortController();
    const timer = isPrimary
      ? setTimeout(() => controller.abort(), PRIMARY_TIMEOUT_MS)
      : null;
    try {
      const res = await fetch(buildUrl(base), { ...init, signal: controller.signal });
      if (timer) clearTimeout(timer);
      // 5xx on primary → try fallback. 4xx → return as-is (user-fault).
      if (!res.ok && res.status >= 500 && i < urls.length - 1) {
        lastError = new Error(`HTTP ${res.status} from ${base}`);
        continue;
      }
      return res;
    } catch (err) {
      if (timer) clearTimeout(timer);
      lastError = err;
      // Only iterate to the next URL if there IS one — otherwise rethrow.
      if (i >= urls.length - 1) throw err;
    }
  }
  throw lastError ?? new Error('All Suno proxy URLs exhausted');
}

/** POST /api/generate. Returns an array of song metadata (status may be "queued"). */
export async function generateFromPrompt(
  prompt: string,
  makeInstrumental: boolean = false,
  model: SunoModelId = loadSunoModel(),
): Promise<SunoSongMeta[]> {
  const res = await fetchWithFallback(
    (base) => `${trimTrailingSlash(base)}/api/generate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({
        prompt,
        make_instrumental: makeInstrumental,
        model,
        wait_audio: false,
      }),
    },
  );
  if (!res.ok) await throwFriendlyError(res, 'generate');
  return normalizeSongList(await res.json());
}

/** GET /api/get?ids=<id> — returns a single song's current status. */
export async function fetchSongById(id: string): Promise<SunoSongMeta> {
  const res = await fetchWithFallback(
    (base) => `${trimTrailingSlash(base)}/api/get?ids=${encodeURIComponent(id)}`,
    { headers: { ...authHeaders() } },
  );
  if (!res.ok) await throwFriendlyError(res, 'get');
  const list = normalizeSongList(await res.json());
  if (list.length === 0) throw new Error(`Suno returned no songs for id ${id}`);
  return list[0]!;
}

/**
 * Poll `fetchSongById` until `audio_url` is populated or `timeoutMs` elapses.
 * Suno generation typically takes 30–90 seconds.
 */
export async function waitForSong(
  id: string,
  opts: {
    intervalMs?: number;
    timeoutMs?: number;
    onTick?: (song: SunoSongMeta) => void;
  } = {},
): Promise<SunoSongMeta> {
  const intervalMs = opts.intervalMs ?? 4000;
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const started = Date.now();
  while (true) {
    const song = await fetchSongById(id);
    opts.onTick?.(song);
    if (song.audio_url) return song;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Suno generation timed out (${(timeoutMs / 1000).toFixed(0)}s)`);
    }
    await sleep(intervalMs);
  }
}

// --- helpers ---

function trimTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Translate proxy errors into user-friendly messages.
 *   - 401 → user's cookie is missing/expired
 *   - 402 / "credits" → user's Suno account out of credits
 *   - "ZERO_BALANCE" → site operator's 2Captcha budget exhausted
 *   - 429 → rate-limited
 */
async function throwFriendlyError(res: Response, op: string): Promise<never> {
  const rawBody = await res.text().catch(() => '');
  const bodyLower = rawBody.toLowerCase();
  if (res.status === 401) {
    throw new Error(
      'Your Suno cookie is missing or expired. Click the ⚙ gear and paste a fresh one from suno.com.',
    );
  }
  if (res.status === 402 || bodyLower.includes('credits')) {
    throw new Error(
      'Your Suno account is out of credits for this period. Try again after your quota resets.',
    );
  }
  if (bodyLower.includes('zero_balance') || bodyLower.includes('2captcha')) {
    throw new Error(
      'Song generation is temporarily unavailable (site-wide captcha budget exhausted). ' +
      'Try again later, or paste a Suno share link / direct MP3 URL.',
    );
  }
  if (res.status === 429) {
    throw new Error('Rate-limited by Suno — wait a minute and try again.');
  }
  // 5xx bodies can contain proxy-internal detail (stack traces, headers,
  // upstream error payloads) that we shouldn't surface to users. Only echo
  // the body for 4xx, which is assumed to be a user-actionable message.
  const bodySuffix = rawBody && res.status >= 400 && res.status < 500
    ? ` — ${rawBody.slice(0, 200)}`
    : '';
  throw new Error(
    `Suno /${op} failed: HTTP ${res.status} ${res.statusText}${bodySuffix}`,
  );
}

function normalizeSongList(data: unknown): SunoSongMeta[] {
  if (Array.isArray(data)) return data as SunoSongMeta[];
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as SunoSongMeta[];
    if (Array.isArray(obj.clips)) return obj.clips as SunoSongMeta[];
    if (typeof obj.id === 'string') return [obj as unknown as SunoSongMeta];
  }
  throw new Error(`Unexpected Suno response shape: ${JSON.stringify(data).slice(0, 200)}`);
}
