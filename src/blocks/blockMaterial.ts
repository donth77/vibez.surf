import * as THREE from 'three';

/**
 * Block shader. Solid bright emissive cube; bloom provides the glow halo.
 *
 * Pickup animation (per-instance via `aPickedAt`):
 *   - Block **shrinks** toward its local center (absorbed-into-the-ship feel)
 *   - Brief **flash** of extra emissive in the first ~20% of the animation
 *   - Alpha fades as the shrink progresses
 *
 * Missed blocks keep `aPickedAt = -1` and render at full scale/opacity,
 * passing by the ship unaffected — the visual difference between "picked"
 * and "missed" is now unambiguous.
 */

const VERT = /* glsl */ `
attribute float aPickedAt;
varying float vPickT;

uniform float uTime;
uniform float uPickDuration;

void main() {
  vPickT = aPickedAt < 0.0 ? -1.0 : clamp((uTime - aPickedAt) / uPickDuration, 0.0, 1.0);

  vec3 p = position;
  if (vPickT >= 0.0) {
    // Shrink toward the block's geometric center (geometry was translated
    // +0.175 on Y at construction so (0, 0.175, 0) is the cube center).
    // Ease-in cubic so the first frames of shrink are slow, then snap down —
    // reads as "zap!" rather than a gentle fade.
    float shrink = 1.0 - pow(vPickT, 0.6);
    vec3 center = vec3(0.0, 0.175, 0.0);
    p = center + (p - center) * shrink;
    // Small upward drift so the residual flash doesn't sit on the track.
    p.y += vPickT * 0.25;
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
  // Flash: strong extra emission during the first 20% of the pickup so the
  // block briefly lights up before collapsing. Peak at vPickT ≈ 0.1.
  float flash = vPickT < 0.0 ? 0.0 : smoothstep(0.0, 0.15, vPickT) * (1.0 - smoothstep(0.15, 0.45, vPickT));

  vec3 col = uColor * uEmissionIntensity * uHdrBoost;
  col += uColor * flash * 3.0;     // HDR flash, catches bloom heavily
  col = mix(col, vec3(1.0) * uHdrBoost * 2.0, flash * 0.6); // white-hot briefly

  // Alpha stays full for most of the shrink, then fades in the last 30%.
  float alpha = vPickT < 0.0 ? 1.0 : (1.0 - smoothstep(0.7, 1.0, vPickT));
  if (alpha <= 0.001) discard;

  gl_FragColor = vec4(col, alpha);
}
`;

export interface BlockMaterial extends THREE.ShaderMaterial {
  setTime(t: number): void;
  setColor(color: THREE.Color): void;
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
      // Shorter duration than the previous 0.6s — feels more like a zap and
      // less like a gentle fade.
      uPickDuration: { value: 0.25 },
    },
  }) as BlockMaterial;

  mat.setTime = (t: number) => { mat.uniforms.uTime!.value = t; };
  mat.setColor = (c: THREE.Color) => { mat.uniforms.uColor!.value.copy(c); };

  return mat;
}
