# CLAUDE.md — notes for AI agents working in this repo

This file is the fast-path briefing. Read it before you read the code.

## What the project is

Vibez.surf is a browser-based music visualizer / rhythm game, inspired by
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
  changes. This is a deliberate divergence from the reference algorithm.
- Renderer `outputColorSpace` is sRGB; vertex colors in the track mesh are
  stored linear-light. Don't double-convert.

## When making UI changes

1. If it's interactive, it must be keyboard-operable and have visible focus.
2. If it announces state (score, progress, status), wire a live region.
3. If it animates, check `prefers-reduced-motion`.
4. Run `pnpm typecheck` before claiming done.

## Milestones (M1–M11)

Code comments reference milestones like `M6`, `M7`, `M10`, `M11`. These are
development phases tracked in the user's own notes — not a shipping
contract. `M11` is a "final polish" catch-all; don't treat those TODOs as
urgent unless the user mentions them.
