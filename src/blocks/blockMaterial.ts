import * as THREE from 'three';

/**
 * Block shader. Reference (real Audiosurf): blocks render as **solid bright
 * emissive cubes** — the soft glow halo comes entirely from the bloom pass,
 * not from anything in the block shader itself.
 *
 * Authoritative values from `Assets/Materials/Block.mat`:
 *   _EmissionIntensity = 1.5     (multiplier on color)
 *   _Alpha             = 1       (driven from JS during pickup animation)
 *   _BaseColor         = (1,1,1) (overridden per-frame from current track color)
 *
 * Per-instance pickup (wired in M7):
 *   `aPickedAt` = -1 means not picked; otherwise time in seconds when pickup
 *   was triggered. While picked: alpha fades out and the block rises along Y.
 */

const VERT = /* glsl */ `
attribute float aPickedAt;
varying float vPickT;

uniform float uTime;
uniform float uPickDuration;
uniform float uPickRiseSpeed;

void main() {
  vPickT = aPickedAt < 0.0 ? -1.0 : clamp((uTime - aPickedAt) / uPickDuration, 0.0, 1.0);

  vec3 p = position;
  if (vPickT >= 0.0) {
    p.y += vPickT * uPickRiseSpeed * uPickDuration;
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
  vec3 col = uColor * uEmissionIntensity * uHdrBoost;
  float alpha = vPickT < 0.0 ? 1.0 : (1.0 - vPickT);
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
      uPickDuration: { value: 0.6 },
      uPickRiseSpeed: { value: 8.0 },
    },
  }) as BlockMaterial;

  mat.setTime = (t: number) => { mat.uniforms.uTime!.value = t; };
  mat.setColor = (c: THREE.Color) => { mat.uniforms.uColor!.value.copy(c); };

  return mat;
}
