/**
 * Suno share-link resolver.
 *
 * Follows a `https://suno.com/s/<code>` redirect and scrapes the canonical
 * song page for its UUID + title. Returns JSON with CORS headers so our
 * browser app can call it.
 *
 * Deploy:
 *   cd workers/suno-share-resolver
 *   npm install
 *   npx wrangler deploy
 *
 * Usage from the client:
 *   GET https://<worker>.workers.dev/?url=https://suno.com/s/5Vbdu5e9IJ0N4uay
 *   → { uuid, title, audioUrl, pageUrl }
 *
 * Free tier: 100,000 requests/day — way more than a personal demo needs.
 */

export interface Env {
  /** Comma-separated CORS allowlist. Default covers the production site
   *  and local Vite dev. Override via `wrangler.toml` or Cloudflare env. */
  ALLOWED_ORIGIN?: string;
  /**
   * Shared secret — when set, requests must present a matching `X-API-Key`
   * header (or `?key=` query param, for CORS-friendly GETs). Ships in the
   * client bundle so it's not a real secret, but it blocks drive-by curl
   * abuse that would otherwise drain the free-tier quota.
   */
  API_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Echo the request's Origin header back if it matches the allowlist;
    // otherwise omit the ACAO header entirely so the browser correctly
    // rejects the response. A single '*' in ALLOWED_ORIGIN disables the
    // check (useful for public deployments).
    const allowed = (env.ALLOWED_ORIGIN ?? 'https://vibez.surf,https://www.vibez.surf,http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const reqOrigin = request.headers.get('Origin') ?? '';
    const allowOrigin = allowed.includes('*')
      ? '*'
      : allowed.includes(reqOrigin) ? reqOrigin : '';
    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    if (allowOrigin) corsHeaders['Access-Control-Allow-Origin'] = allowOrigin;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== 'GET') {
      return json({ error: 'method not allowed' }, 405, corsHeaders);
    }

    const url = new URL(request.url);

    // Optional shared-secret gate. Accept the key from either the header
    // (preferred) or a `?key=` query param (for environments where custom
    // headers trigger preflight overhead).
    if (env.API_KEY) {
      const provided = request.headers.get('X-API-Key') ?? url.searchParams.get('key') ?? '';
      if (!timingSafeEqual(provided, env.API_KEY)) {
        return json({ error: 'unauthorized' }, 401, corsHeaders);
      }
    }

    const target = url.searchParams.get('url');
    if (!target) {
      return json({ error: 'missing ?url=…' }, 400, corsHeaders);
    }

    // Only accept https suno.com URLs so the worker can't be abused as a
    // general-purpose scraper or pointed at non-web schemes.
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      return json({ error: 'invalid url' }, 400, corsHeaders);
    }
    if (parsed.protocol !== 'https:') {
      return json({ error: 'only https URLs are supported' }, 400, corsHeaders);
    }
    if (!/(^|\.)suno\.com$/i.test(parsed.hostname)) {
      return json({ error: 'only suno.com URLs are supported' }, 400, corsHeaders);
    }

    // Follow redirects; Cloudflare fetch does this by default. UA
    // mimics a real browser so Suno doesn't block us for looking bot-y.
    let upstream: Response;
    try {
      upstream = await fetch(parsed.toString(), {
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        },
      });
    } catch (err) {
      return json(
        { error: 'failed to fetch suno.com', detail: String(err) },
        502,
        corsHeaders,
      );
    }

    if (!upstream.ok) {
      return json(
        { error: `suno.com returned HTTP ${upstream.status}` },
        502,
        corsHeaders,
      );
    }

    const finalUrl = new URL(upstream.url);
    const uuidMatch = finalUrl.pathname.match(
      /\/song\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    );
    if (!uuidMatch) {
      return json(
        {
          error: 'could not extract UUID from redirect target',
          finalUrl: upstream.url,
        },
        502,
        corsHeaders,
      );
    }
    const uuid = uuidMatch[1]!;

    // Scrape a <title> tag. Suno pages are client-rendered so the <title>
    // usually reads "Suno" generically, but og:title (set server-side)
    // carries the real song name.
    //
    // Cap at 512 KB so a malicious / oversized upstream response can't
    // OOM the Worker (128 MB memory limit) — og:title always sits in
    // the <head>, so we only need the first ~50 KB realistically.
    const MAX_BYTES = 512 * 1024;
    const reader = upstream.body?.getReader();
    let html = '';
    if (reader) {
      const decoder = new TextDecoder();
      let received = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        html += decoder.decode(value, { stream: true });
        if (received >= MAX_BYTES) {
          await reader.cancel();
          break;
        }
      }
    }
    const ogTitle = html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    );
    const plainTitle = html.match(/<title>([^<]+)<\/title>/i);
    let title = ogTitle?.[1] ?? plainTitle?.[1] ?? '';
    // Strip " | Suno" suffix that the site appends.
    title = title.replace(/\s*[|·]\s*Suno\s*$/i, '').trim();
    // Defense-in-depth: suno.com could serve a title containing HTML /
    // control chars that would bite any future client path that forgets to
    // escape. Drop anything outside a reasonable printable set and cap
    // length so a long title can't DoS a naive consumer.
    title = title
      .replace(/[\x00-\x1f\x7f]/g, '')
      .replace(/[<>]/g, '')
      .slice(0, 200)
      .trim();

    return json(
      {
        uuid,
        title: title || null,
        audioUrl: `https://cdn1.suno.ai/${uuid}.mp3`,
        pageUrl: upstream.url,
      },
      200,
      corsHeaders,
    );
  },
};

function json(body: unknown, status: number, headers: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** Constant-time string compare to avoid leaking the API key via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
