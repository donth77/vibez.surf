# vibez.surf

A browser-based music visualizer and rhythm game. Pick any song; the game
analyzes it and generates a 3D track you ride to the beat, picking up blocks
placed on moments of musical energy.

Inspired by Audiosurf.

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

Open the URL, drop in an audio file (MP3 / AAC / OGG / WAV / FLAC — anything
your browser can decode), and ride.

## Controls

| Input                   | Action           |
|-------------------------|------------------|
| Arrow keys or A / D     | Steer left/right |
| Touch swipe             | Steer left/right |
| Esc / pause button      | Pause / resume   |

## Bringing your own audio

Three ways to start a song:

- **File picker** — drop or select an audio file from your computer.
  Recent uploads are cached in the browser (IndexedDB) so you can replay
  them from the "Recently played" list without re-picking the file.
- **URL** — paste any direct audio URL (MP3, Suno CDN link, etc.) served
  with CORS headers. Streaming-page URLs (YouTube, SoundCloud) aren't
  supported — convert to MP3 first with your tool of choice.
- **Suno AI** — type a prompt and generate a track. Requires the site
  operator to have the Suno proxy configured (see below) AND each user to
  paste their own Suno session cookie in ⚙ Settings. Users pick the model
  version (v3.5 / v4 / v4.5 / v5) from the same modal.

The URL + AI options are optional. Neither is needed to play — the file
picker works out of the box.

### Suno generation setup (site operator)

Two pieces of infrastructure:

1. **Suno generation proxy** — a deployed [gcui-art/suno-api](https://github.com/gcui-art/suno-api)
   fork that handles Suno's hCaptcha via 2Captcha. Bake its URL into the
   build via `VITE_SUNO_API_URL`, with an optional `VITE_SUNO_API_URL_FALLBACK`
   for a secondary host (primary on Vercel free is useful only for
   non-captcha endpoints; use a long-running host for the fallback since
   captcha-solving routinely exceeds Vercel's 10s serverless limit).

2. **Suno share-link resolver** (optional) — a small Cloudflare Worker in
   [`workers/suno-share-resolver/`](workers/suno-share-resolver/) that
   converts `suno.com/s/<code>` URLs to direct CDN links. Deploy with a
   free Cloudflare account (`npx wrangler deploy`), then set
   `VITE_SUNO_RESOLVER` to the resulting URL. Direct `cdn1.suno.ai/<uuid>.mp3`
   links work without the resolver.

Both are configured at build time via env vars — see [`.env.example`](.env.example).
Self-hosters can override with their own values.

## Debug

Append `?debug` to the URL to show the FPS counter and a bottom-of-screen
audio analysis HUD.

## Scripts

```bash
pnpm dev          # dev server
pnpm build        # typecheck + production build
pnpm test         # run vitest once
pnpm test:watch   # watch mode
```

## Built with

TypeScript · Vite · Three.js · Web Audio API · Web Workers · Vitest.

---

Contributor/architecture notes live in [CLAUDE.md](CLAUDE.md).
