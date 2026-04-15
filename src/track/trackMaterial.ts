import * as THREE from 'three';

/**
 * Track shader. Parameters:
 *
 *   borderThickness   = 0.075   — width of the bright edge stripes (UV.y)
 *   linesThickness    = 0.003   — width of each transverse line (fraction of cell)
 *   lineSubdivisions  = 1000 default; overridden per song to
 *                                 `3000 · audioClip.length / 160`.
 *
 * The body color comes from the per-chunk vertex colors (slope-driven hue).
 * Both lines and borders are HDR (>1) so the bloom pass clips them — §5.4.
 */

const VERT = /* glsl */ `
varying vec3 vColor;
varying vec2 vUv;

void main() {
  vColor = color;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Track shader. Layout:
//   - Body: BLACK (no body color tint).
//   - Side borders (long edges, V near 0 and V near 1): bright with the
//     per-chunk slope-driven vertex color — this is where the song's hue
//     actually shows.
//   - Lane dividers: WHITE DASHED lines running ALONG the track length, at
//     the boundaries between the three block lanes. With block lanes at
//     z = {-2.2, 0, +2.2} on a ribbon of z ∈ [-5, +5], the dividers sit at
//     z = ±1.1 → V ≈ 0.39 and V ≈ 0.61.
//
// Uniform wiring:
//   lineSubdivisions  → uLineSubdivisions  (dash frequency per V cell)
//   linesThickness    → uLinesThickness    (dash duty-cycle along U)
//   borderThickness   → uBorderThickness   (V distance for the edge glow)
//
// fwidth() keeps these tiny values visible at distance — it's the
// screen-space derivative used to anti-alias the step thresholds.
const FRAG = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uLineSubdivisions;    // dash frequency per V cell (kept for future use)
uniform float uLaneDashCount;       // number of lane-divider dashes across the track
uniform float uLinesThickness;
uniform float uBorderThickness;
uniform float uDashDuty;            // 0..1 — fraction of each cell that's bright
uniform float uLaneDividerWidth;    // half-width of each lane divider in V
uniform vec3  uLaneDividerColor;    // color of the dashed lane lines (white-ish)
uniform float uBorderBrightness;    // HDR multiplier for the colored side borders
uniform float uLaneDividerBrightness; // HDR multiplier for the white dashes
uniform float uScrollSpeed;         // U-units per second
uniform float uLaneVPositions[2];   // V coords of the two lane dividers

varying vec3 vColor;
varying vec2 vUv;

// Anti-aliased step (1 when x < edge, 0 when x > edge). A smoothstep
// combined with fwidth for screen-space derivatives keeps the transition
// crisp at any distance.
float aaStep(float edge, float x) {
  float aa = fwidth(x);
  return 1.0 - smoothstep(edge - aa, edge + aa, x);
}

void main() {
  // ---- Dashed lane dividers running ALONG the track at fixed V positions.
  // We use uLaneDashCount (a small fixed number, ~80) instead of
  // uLineSubdivisions because road-line-style dashes need to be widely
  // spaced. The duration-derived value (5587 for a 5-min song) is too dense
  // and reads as a near-continuous blur. To be revisited in M11.
  float u = vUv.x * uLaneDashCount - uTime * uScrollSpeed;
  float dashOn = aaStep(uDashDuty, fract(u));

  float laneMask = 0.0;
  for (int i = 0; i < 2; i++) {
    float dV = abs(vUv.y - uLaneVPositions[i]);
    laneMask = max(laneMask, aaStep(uLaneDividerWidth, dV));
  }
  laneMask *= dashOn;

  // ---- Colored side borders.
  float distToVEdge = min(vUv.y, 1.0 - vUv.y);
  float borderMask = aaStep(uBorderThickness, distToVEdge);

  // Composite: black body + colored side borders + white dashes.
  vec3 col = vec3(0.0);
  col += vColor * borderMask * uBorderBrightness;
  col += uLaneDividerColor * laneMask * uLaneDividerBrightness;

  gl_FragColor = vec4(col, 1.0);
}
`;

export interface TrackMaterialOptions {
  /** Audio duration in seconds — drives `uLineSubdivisions`. */
  durationSec: number;
}

export interface TrackMaterial extends THREE.ShaderMaterial {
  setTime(t: number): void;
}

export function createTrackMaterial({ durationSec }: TrackMaterialOptions): TrackMaterial {
  // Duration-scaled subdivisions: `3000 * duration / 160`.
  const subdivisions = (3000 * durationSec) / 160;

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    vertexColors: true,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uLineSubdivisions: { value: subdivisions },
      uLaneDashCount: { value: 1000 }, // ~1 dash per 10 world units → road-line spacing
      // AA-step thresholds.
      uLinesThickness: { value: 0.003 },
      uBorderThickness: { value: 0.075 },
      uDashDuty: { value: 0.4 }, // dash:gap ≈ 40:60 — typical road marker
      // Lane dividers at z = ±1.1 on a ribbon of z ∈ [-5, +5] → V ≈ 0.39 / 0.61.
      uLaneDividerWidth: { value: 0.005 },
      uLaneDividerColor: { value: new THREE.Color(1, 1, 1) },
      uLaneVPositions: { value: [0.39, 0.61] },
      // Brightness multipliers — modest HDR so bloom is a glow, not a flood.
      uBorderBrightness: { value: 1.6 },
      uLaneDividerBrightness: { value: 1.4 },
      uScrollSpeed: { value: 0.0 },
    },
  }) as TrackMaterial;

  mat.setTime = (t: number) => {
    mat.uniforms.uTime!.value = t;
  };

  return mat;
}
