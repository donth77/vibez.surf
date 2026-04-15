# CLAUDE.md

This file is the fast-path briefing. Read it before you read the code.

## What the project is

vibez.surf is a browser-based music visualizer / rhythm game, inspired by
Audiosurf. A user picks an audio file; we analyze it, generate a 3D track
from the intensity signal, and they ride the track locked to audio playback
time while collecting blocks placed on detected beats.

## Stack

- TypeScript, Vite, Three.js, Web Audio API, Web Workers, Vitest.
- No framework (no React/Vue) — UI is vanilla DOM in `src/ui/*`.
- ESM only, ES2022 target.
- Package manager: pnpm (lockfile present). npm works too.

## Running things

```bash
pnpm dev          # dev server on :5173
pnpm typecheck    # run before claiming a task done
pnpm test         # vitest run
pnpm build        # tsc -b && vite build
```

Prefer `pnpm typecheck` over starting the dev server when you just want to
validate changes.

## How it works (pipeline)

From "user drops a file" to "player riding the track":

1. **Load** (`src/audio/audioLoader.ts`) — `AudioContext.decodeAudioData`
   on the file bytes. Interleave channels into a single `Float32Array`
   (`[L0,R0,L1,R1,…]`). Never averaged to mono — see the audio-sample-layout
   convention below.
2. **Analyze** (`src/audio/audioAnalysis.ts` + `fft.worker.ts`) — a worker
   pool runs FFT across the interleaved stream in 4096-sample chunks. The
   spectra + intensities feed:
   - per-chunk intensity → track speed, color hue, rocket-fire size
   - low-band (~20 Hz) + high-band (~7500 Hz) beat indexes → block placement
     and hexagon-pillar pulses
3. **Generate track** (`src/track/trackGenerator.ts` + `util/bSpline.ts`) —
   a cubic uniform B-spline polyline is built from the intensity signal.
   Smoothed slope values drive vertical bumps; a second, more heavily
   smoothed signal drives horizontal sweeps. Vertex colors derive from the
   slope via HSV. The ribbon mesh is built in `src/track/buildSplineMesh.ts`.
4. **Place blocks + hexagons** (`src/blocks/blocksManager.ts`,
   `src/effects/hexagonsManager.ts`) — beats → lanes via a deterministic
   noise rule; hexagon columns spaced adaptively by intensity. Both use the
   spline's tangent + bitangent for positioning so they track curves.
5. **Play** (`src/player/playerController.ts` + `src/main.ts` tick) — the
   player's percentage along the track is `audio.currentTime / duration`.
   Lateral offset accumulates from keyboard/touch input along the spline's
   bitangent. A swept-sphere collision sweep
   (`src/blocks/collisionSweep.ts`) decides block picks vs misses — it
   tracks the minimum lateral distance over a small percentage window
   around each block's `endP` so brief drive-bys still register.
6. **Feedback loop** — picks fire the block's `aPickedAt` instanced
   attribute (shader shrinks + flashes the cube), update `PointsManager`
   (exact curve: `inc = min(200, inc+4)` per pick; `score -= 200`,
   `inc = max(1, inc-50)` per miss), and trigger 2D screen-space fireworks
   in the matching lane corner (`src/effects/fireworksManager.ts`).

The shader files (`trackMaterial.ts`, `blockMaterial.ts`,
`hexagonMaterial.ts`, `rocketFire.ts`) are custom `ShaderMaterial`s with
inline GLSL. Only postprocessing is a single `UnrealBloomPass`.

## Directory map

```
src/audio/     Decode, interleave samples, FFT (pooled workers), beat detection
src/track/     Spline mesh generation, track shader, trackData type
src/player/    Player controller, spaceship loader, input handling
src/blocks/    Block placement, instanced mesh, collision sweep
src/points/    Scoring logic + HUD
src/effects/   Hexagon pillars, rocket fire, radial rays, fireworks overlay
src/ui/        Vanilla-DOM widgets (file picker, pause menu, dialogs, etc.)
src/util/      B-spline math, HSV color, filename helpers
src/main.ts    Composition root — wires everything together
tests/parity/  Vitest unit tests for FFT, B-spline, block placement, scoring
public/assets/ OBJ + textures
```

## Important conventions

- **Coordinate system**: X is track progression, Y is vertical, Z is
  lateral (lanes). Forward basis uses +Z = forward. Lanes sit at
  `z ∈ {-2.2, 0, +2.2}`.
- **Audio sample layout**: samples are always interleaved
  `[L0, R0, L1, R1, ...]`. Chunk size is 4096 (`FFT_WINDOW_SIZE`). Do not
  average to mono — the beat-index math factors `channels` into its skip
  arithmetic and averaging changes every beat.
- **Debug mode**: append `?debug` to the URL to show Stats.js + the bottom
  audio HUD. The DEBUG flag is read once at startup from
  `URLSearchParams(location.search)`.
- **Scratch vectors**: the hot paths (player update, block placement) cache
  `Vector3` / `Matrix4` / `Color` on the class and reuse them every frame.
  Don't allocate in update loops; reuse the `_scratch*` fields.
- **Float32Arrays over arrays**: all per-chunk and per-vertex data is typed
  arrays. Keep it that way.

## Accessibility rules

- All interactive elements need keyboard focus AND a visible `:focus-visible`
  ring (global styles in `index.html` cover this).
- Dialogs (`pauseMenu.ts`, `endSongPanel.ts`) use `role="dialog"`,
  `aria-modal`, focus trap, and focus restore. Copy that pattern for any
  new dialog.
- Score/progress updates go through `aria-live="polite"` regions.
- Decorative floating labels and the minimap get `aria-hidden="true"`.
- Any animation must respect `prefers-reduced-motion` (a global media query
  in `index.html` kills animations/transitions; don't reintroduce them in
  component styles without a guard).

## Writing code here

- **Don't add speculative abstractions**. The codebase is deliberately
  flat: small manager classes, no DI, no event bus. Match that style.
- **No mocks in parity tests**. Parity tests in `tests/parity/` pin
  numerical behavior — they run the real implementation end-to-end.

## Gotchas

- `src/util/bSpline.ts` duplicates the first and last control points twice
  so the spline interpolates endpoints. If you change control-point counts,
  remember the padding (original `n` → stored `n + 4`).
- `src/audio/fft.ts` uses a 3-coefficient truncated Blackman-Harris window.
  This is intentional — don't "fix" by adding the 4th coefficient. The
  pipeline (beat detection, block placement) is tuned against this exact
  transform.
- `buildSplineMesh.ts` stops at `t = (resolution - 1) / resolution`, NOT
  `t = 1`. The spline is degenerate at t=1 because of the endpoint
  duplication; including that vertex would produce a collapsed triangle.
- `BlocksManager.computeMatrix` samples the smooth B-spline (not the raw
  polyline) so blocks don't visibly hover above the ribbon at curvature
  changes.
- Renderer `outputColorSpace` is sRGB; vertex colors in the track mesh are
  stored linear-light. Don't double-convert.

## When making UI changes

1. If it's interactive, it must be keyboard-operable and have visible focus.
2. If it announces state (score, progress, status), wire a live region.
3. If it animates, check `prefers-reduced-motion`.
4. Run `pnpm typecheck` before claiming done.
