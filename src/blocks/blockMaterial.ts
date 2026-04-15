import * as THREE from 'three';

/**
 * Block shader. Solid bright emissive cube; bloom provides the glow halo.
 *
 * Pickup animation (per-instance via `aPickedAt`):
 *   - Block **collapses** quickly in place (fast shrink, no pop/expand —
 *     an expand phase reads as "bursting behind the ship" at cruise speed
 *     rather than absorption).
 *   - While shrinking it **slides forward** along the block's local +Z
 *     (the track tangent at its position). Since the ship is travelling
 *     the same direction, the block appears to trail the ship for a
 *     moment, selling the "sucked in" feel.
 *   - Bright **flash** of extra emissive at the start (peak ≈ t=0.05).
 *   - Alpha fades with the scale.
 *
 * Missed blocks keep `aPickedAt = -1` and render at full scale/opacity,
 * passing by the ship unaffected — the visual difference between "picked"
 * and "missed" is now unambiguous.
 */

const VERT = /* glsl */ `
attribute float aPickedAt;
varying float vPickT;

uniform float uTime;
uniform float uPickDurationSlow;  // duration at rest / slow hue
uniform float uPickDurationFast;  // duration at full ship speed
uniform float uSpeedFactor;       // 0..1 — higher = faster ship

void main() {
  // Linearly interpolate pickup duration between slow and fast endpoints
  // based on ship speed, so the animation doesn't lag behind on fast
  // sections. Same currentSpeed = (0.83 - hue) / 0.83 math as the
  // camera / rocket-fire scaling.
  float duration = mix(uPickDurationSlow, uPickDurationFast, clamp(uSpeedFactor, 0.0, 1.0));
  vPickT = aPickedAt < 0.0 ? -1.0 : clamp((uTime - aPickedAt) / duration, 0.0, 1.0);

  vec3 p = position;
  if (vPickT >= 0.0) {
    // Fast ease-out shrink so the block collapses quickly in place.
    float scale = pow(1.0 - vPickT, 1.8);
    vec3 center = vec3(0.0, 0.175, 0.0);
    p = center + (p - center) * scale;
    // Slide forward along the block's local +Z (track tangent) so the
    // residue trails the ship. The ship is travelling the same direction,
    // so this reads as "the ship is pulling it along as it dissolves".
    // Magnitude tuned so the trail is visible but doesn't overshoot
    // neighbouring blocks.
    p.z += vPickT * 2.5;
    // Tiny upward drift so the collapse isn't glued to the ribbon.
    p.y += vPickT * 0.2;
  }
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform vec3 uColor;
uniform float uEmissionIntensity;
uniform float uHdrBoost;

varying float vPickT;

void main() {
  // Flash: sharp bright burst right at impact, decays quickly. Peaks at
  // t ≈ 0.05 so the brightest moment is when the ship actually hits.
  float flash = vPickT < 0.0 ? 0.0 : smoothstep(0.0, 0.05, vPickT) * (1.0 - smoothstep(0.05, 0.30, vPickT));

  vec3 col = uColor * uEmissionIntensity * uHdrBoost;
  col += uColor * flash * 3.0;     // HDR flash, catches bloom heavily
  col = mix(col, vec3(1.0) * uHdrBoost * 2.0, flash * 0.6); // white-hot briefly

  // Alpha fades with the shrink so the trailing residue dissolves smoothly.
  float alpha = vPickT < 0.0 ? 1.0 : (1.0 - smoothstep(0.3, 0.9, vPickT));
  if (alpha <= 0.001) discard;

  gl_FragColor = vec4(col, alpha);
}
`;

export interface BlockMaterial extends THREE.ShaderMaterial {
  setTime(t: number): void;
  setColor(color: THREE.Color): void;
  /** 0 = fully at slow duration, 1 = fully at fast duration. */
  setSpeedFactor(s: number): void;
}

export function createBlockMaterial(): BlockMaterial {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uEmissionIntensity: { value: 1.5 }, // from `Assets/Materials/Block.mat`
      uHdrBoost: { value: 1.2 },          // light HDR push — blocks read colored, not blinding
      // Duration bounds linearly interpolated by uSpeedFactor (ship's
      // current speed fraction, 0..1). Full absorb animation at rest,
      // near-flash at top speed.
      uPickDurationSlow: { value: 0.35 },
      // ~1 frame at 60fps — the block is essentially gone by the time
      // the ship has moved past it at full speed, so nothing lags behind.
      uPickDurationFast: { value: 0.016 },
      uSpeedFactor: { value: 0.0 },
    },
  }) as BlockMaterial;

  mat.setTime = (t: number) => { mat.uniforms.uTime!.value = t; };
  mat.setColor = (c: THREE.Color) => { mat.uniforms.uColor!.value.copy(c); };
  mat.setSpeedFactor = (s: number) => { mat.uniforms.uSpeedFactor!.value = s; };

  return mat;
}
