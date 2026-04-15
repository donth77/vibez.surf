/**
 * Client helper for the share-resolver Worker (workers/suno-share-resolver).
 *
 * Converts a `https://suno.com/s/<code>` share URL into a direct CDN URL and
 * (optionally) the real song title. Centralized here so every caller gets
 * the same auth header and response validation — previously this was
 * duplicated between the initial-play and replay paths in `main.ts`.
 */

export interface ResolvedShareLink {
  audioUrl: string;
  title: string | null;
}

const SUNO_CDN_HOSTNAME = 'cdn1.suno.ai';

/** True when the deployer configured a resolver Worker URL. */
export function isShareResolverConfigured(): boolean {
  return !!getResolverUrl();
}

function getResolverUrl(): string {
  return (import.meta.env.VITE_SUNO_RESOLVER as string | undefined) || '';
}

/**
 * Resolve a Suno `/s/<code>` share URL via the Worker.
 *
 * Throws with a user-visible message if the resolver isn't configured, if
 * the Worker returns an error, or if the Worker returns an `audioUrl` that
 * isn't a trusted Suno CDN URL (defense in depth against a compromised /
 * mis-deployed Worker).
 */
export async function resolveSunoShareLink(shareUrl: string): Promise<ResolvedShareLink> {
  const base = getResolverUrl().replace(/\/+$/, '');
  if (!base) {
    throw new Error(
      'Suno share-link resolver not configured — paste the original share ' +
      'link in the URL box to try again.',
    );
  }
  const apiKey = (import.meta.env.VITE_SUNO_API_KEY as string | undefined) || '';
  const headers: Record<string, string> = {};
  if (apiKey) headers['X-API-Key'] = apiKey;

  const resp = await fetch(`${base}/?url=${encodeURIComponent(shareUrl)}`, { headers });
  if (!resp.ok) {
    throw new Error(`Suno share resolver returned HTTP ${resp.status}`);
  }
  const body = await resp.json() as { audioUrl?: string; title?: string };
  if (!body.audioUrl) throw new Error('Suno share resolver returned no audioUrl');

  // Trust boundary — the Worker is the attacker-controlled surface in the
  // worst case (mis-deploy, takeover, typosquat). Only accept CDN URLs we
  // already intended to hit directly.
  let parsed: URL;
  try {
    parsed = new URL(body.audioUrl);
  } catch {
    throw new Error('Suno share resolver returned an invalid audioUrl.');
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== SUNO_CDN_HOSTNAME) {
    throw new Error(
      `Suno share resolver returned an unexpected host (${parsed.hostname}); ` +
      'refusing to fetch.',
    );
  }

  return { audioUrl: parsed.toString(), title: body.title ? decodeHtmlEntities(body.title) : null };
}

/**
 * Decode HTML entities in a scraped title. The worker pulls titles from
 * Suno's `og:title` meta tag, where attribute values are HTML-encoded — so
 * "Rock & Roll" arrives as "Rock &amp; Roll" and the HUD, which uses
 * `textContent`, would render the entity literally.
 */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
