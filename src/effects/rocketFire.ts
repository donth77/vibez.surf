import * as THREE from 'three';

/**
 * Ship rocket-fire trail: a solid teardrop-shaped flame per thruster
 * (not a cloud of point particles).
 *
 * Built as a cone mesh aligned along -Z (back of ship). The vertex shader
 * exposes a `vAlongLength` varying (0 at base → 1 at tip) which the fragment
 * shader uses for:
 *   - alpha fade from solid at the base to transparent at the tip
 *   - hot-core highlight that whites out the color near the base
 *
 * Driven from `PlayerController` each frame:
 *   - Length scales with `normalizedIntensities[u]` between min/max.
 *   - Color tracks the current song color.
 *   - Suppressed when intensity ≤ 0.1 (silent section).
 */

const VERT = /* glsl */ `
varying float vAlongLength;  // 0 at flame base, 1 at tip

void main() {
  // Post-rotation/translate, cone base is at z=0 and tip at z=-1 (before
  // scale). So local z ∈ [-1, 0]; we negate so vAlongLength is 0 → 1 from
  // base to tip regardless of per-frame scale.
  vAlongLength = clamp(-position.z, 0.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform vec3 uColor;
uniform float uHdrBoost;
uniform float uActive;
uniform float uCoreHot;   // mix factor for the white-hot core near the base

varying float vAlongLength;

void main() {
  float lengthFade = 1.0 - vAlongLength;

  // Alpha highest near the base, tapers hard toward the tip so the trail
  // doesn't smear into a long bloom halo.
  float alpha = pow(lengthFade, 2.2) * uActive;
  if (alpha < 0.01) discard;

  // Hot core — mixes white into the song color near the base.
  float coreMask = pow(lengthFade, 6.0);
  vec3 hot = mix(uColor, vec3(1.0), coreMask * uCoreHot);

  gl_FragColor = vec4(hot * uHdrBoost, alpha);
}
`;

export interface RocketFireOptions {
  baseRadius?: number;
}

export class RocketFire {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(opts: RocketFireOptions = {}) {
    const baseRadius = opts.baseRadius ?? 0.07;

    // ConeGeometry(radius, height, radialSegments, heightSegments, openEnded).
    // Authored along +Y (base at y=-0.5, tip at y=+0.5). Rotate & translate so
    // the BASE sits at the mesh origin and the tip extends -Z. After this, the
    // cone's length runs from z=0 (base) to z=-1 (tip) before scale.
    const geo = new THREE.ConeGeometry(baseRadius, 1, 20, 1, true);
    geo.rotateX(-Math.PI / 2); // +Y tip → -Z
    geo.translate(0, 0, -0.5); // base was at z=+0.5 → now at z=0

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: new THREE.Color(1, 0.6, 0.2) },
        uHdrBoost: { value: 0.9 },    // gentle HDR — small bloom halo, not a flood
        uActive: { value: 1 },
        uCoreHot: { value: 0.6 },     // subtler white-hot core
      },
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
  }

  /**
   * Per-frame update.
   *   intensity ∈ [0,1] — current chunk's normalized audio intensity
   *   color            — current track color
   *   minLen / maxLen  — flame length bounds (world units)
   */
  update(_time: number, intensity: number, color: THREE.Color, minLen: number, maxLen: number): void {
    const clamped = Math.max(0, Math.min(1, intensity));
    const length = minLen + (maxLen - minLen) * clamped;
    // Geometry is authored at length 1 along its local -Z; scale.z stretches it.
    this.mesh.scale.set(1, 1, length);
    this.material.uniforms.uColor!.value.copy(color);
    this.material.uniforms.uActive!.value = intensity > 0.1 ? 1 : 0;
  }
}
