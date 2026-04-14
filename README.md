# Vibez.surf

A browser-based music visualizer and rhythm game. Pick any audio file; we
analyze it and generate a 3D track you ride along to the beat — picking up
blocks that correspond to moments of energy in the song.

Inspired by Audiosurf.

## Quick start

```bash
pnpm install      # or npm install
pnpm dev          # starts Vite on http://localhost:5173
```

Open the URL, pick an audio file (MP3 / AAC / OGG / WAV / FLAC — anything your
browser can decode), and ride.

## How it works

1. **Load** — the browser decodes the audio file into a `Float32Array` of
   interleaved samples.
2. **Analyze** — a pool of Web Workers runs an FFT across the stream to get
   per-chunk frequency spectra. From those we derive:
   - chunk intensity (drives track speed, color hue, rocket-fire size)
   - low-band and high-band beat indexes (drive block placement and pillar
     pulses)
3. **Generate track** — a cubic B-spline control-point polyline is built from
   the intensity signal; smoothed slope values drive vertical bumps and
   horizontal sweeps. The result is rendered as a vertex-colored ribbon mesh.
4. **Play** — a player controller rides the spline, locked to audio playback
   time. Lateral offset is driven by keyboard (A/D or arrows), mouse, or
   touch. A swept-sphere collision sweep decides block picks vs misses.

## Controls

| Input                | Action            |
|----------------------|-------------------|
| Arrow keys / A, D    | Steer left/right  |
| Mouse / touch        | Steer left/right  |
| Esc                  | Pause/resume      |
| Pause button (touch) | Pause/resume      |

Add `?debug` to the URL to show the FPS counter and audio analysis HUD.

## Project layout

```
src/
  audio/        Decode, interleave, FFT (with worker pool), beat detection
  track/        Spline mesh generation + track shader
  player/       Player controller, spaceship loader, input
  blocks/       Block placement, instanced mesh, collision sweep
  points/       Scoring logic + HUD
  effects/      Hexagon pillars, rocket fire, rays, fireworks
  ui/           File picker, pause menu, end-song panel, loading overlay,
                track minimap
  util/         Shared math (B-spline, HSV color, filename helpers)
  main.ts       Composition root
public/
  assets/       Spaceship OBJ + hex texture
tests/
  parity/       Vitest specs for FFT, B-spline, block placement, scoring
```

## Scripts

```bash
pnpm dev          # dev server
pnpm build        # typecheck + production build
pnpm preview      # preview a production build
pnpm typecheck    # type-check without emitting
pnpm test         # run vitest once
pnpm test:watch   # watch mode
```

## Tech

- TypeScript + Vite (ESM, ES2022 target)
- Three.js (WebGL renderer, EffectComposer + UnrealBloomPass)
- Web Audio API for decoding
- Web Workers for FFT (pooled)
- Vitest for unit tests

## Accessibility

- Keyboard focus rings on all interactive elements.
- All dialogs are proper `role="dialog"` with focus trap and restore.
- Score is exposed via `aria-live="polite"`.
- Loading progress is a `role="progressbar"` with announced values.
- `prefers-reduced-motion` short-circuits non-essential animation.
- Decorative HUDs (minimap, floating `+N`/`-N` labels) are `aria-hidden`.

The gameplay itself is inherently audiovisual; see `fileBrowser.ts`,
`pauseMenu.ts`, `endSongPanel.ts`, `loadingOverlay.ts`, and `pointsHud.ts`
for the accessible wrappers around it.
