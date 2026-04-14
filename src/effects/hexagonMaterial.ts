import * as THREE from 'three';

/**
 * Hexagon shader:
 *   texture: hexagon.png (sampled as both alpha mask and base color)
 *   alpha:   0.75        (blend intensity)
 *   depthWrite off, alpha-blended
 *   color tinted by the current song color at runtime
 *
 * We keep it simple: texture-mapped flat quad, alpha from texture, multiplied
 * by uColor (set per-frame from track color) + HDR boost so bloom catches
 * the glowing hex outlines.
 */

const VERT = /* glsl */ `
varying vec2 vUv;
varying float vViewDepth;   // distance from camera to fragment (for distance fade)

void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewDepth = -mv.z;       // positive distance in front of camera
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uAlpha;       // blend intensity (0..1)
uniform float uHdrBoost;
uniform float uFadeStart;   // distance at which hexagons start fading out
uniform float uFadeEnd;     // distance at which they're fully invisible

varying vec2 vUv;
varying float vViewDepth;

void main() {
  // Distance fade — hides distant hexagons so they don't stack into a blob
  // on the horizon. Close hexagons render at full alpha; beyond uFadeEnd
  // nothing renders.
  float distFade = 1.0 - smoothstep(uFadeStart, uFadeEnd, vViewDepth);
  if (distFade < 0.01) discard;

  vec4 tex = texture2D(uMap, vUv);
  float a = tex.a * uAlpha * distFade;
  if (a < 0.01) discard;
  vec3 col = uColor * tex.rgb * uHdrBoost;
  gl_FragColor = vec4(col, a);
}
`;

export interface HexagonMaterial extends THREE.ShaderMaterial {
  setColor(c: THREE.Color): void;
}

export function createHexagonMaterial(texture: THREE.Texture): HexagonMaterial {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uMap: { value: texture },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uAlpha: { value: 0.75 },
      uHdrBoost: { value: 1.8 },
      // Distance fade — hexagons visible up close, fade to invisible by 220
      // world units. Tune in M11 if the horizon starts feeling sparse.
      uFadeStart: { value: 90 },
      uFadeEnd: { value: 220 },
    },
  }) as HexagonMaterial;
  mat.setColor = (c) => mat.uniforms.uColor!.value.copy(c);
  return mat;
}
