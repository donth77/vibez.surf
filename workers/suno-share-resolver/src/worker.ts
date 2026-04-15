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
  /** Optional allowlist; leave unset to allow all origins. */
  ALLOWED_ORIGIN?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = env.ALLOWED_ORIGIN ?? '*';
    const corsHeaders: HeadersInit = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== 'GET') {
      return json({ error: 'method not allowed' }, 405, corsHeaders);
    }

    const url = new URL(request.url);
    const target = url.searchParams.get('url');
    if (!target) {
      return json({ error: 'missing ?url=…' }, 400, corsHeaders);
    }

    // Only accept suno.com URLs so the worker can't be abused as a
    // general-purpose scraper.
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      return json({ error: 'invalid url' }, 400, corsHeaders);
    }
    if (!/(^|\.)suno\.com$/i.test(parsed.hostname)) {
      return json({ error: 'only suno.com URLs are supported' }, 400, corsHeaders);
    }

    // Follow redirects; Cloudflare fetch does this by default.
    let upstream: Response;
    try {
      upstream = await fetch(parsed.toString(), {
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (Suno share resolver)' },
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
    const html = await upstream.text();
    const ogTitle = html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    );
    const plainTitle = html.match(/<title>([^<]+)<\/title>/i);
    let title = ogTitle?.[1] ?? plainTitle?.[1] ?? '';
    // Strip " | Suno" suffix that the site appends.
    title = title.replace(/\s*[|·]\s*Suno\s*$/i, '').trim();

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
