# [vibez.surf](https://vibez.surf)

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