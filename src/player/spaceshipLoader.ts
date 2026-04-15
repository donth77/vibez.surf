import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

/**
 * Loads the spaceship OBJ and assigns per-submaterial materials from
 * hardcoded PBR specs.
 *
 * The OBJ uses 8 `usemtl` groups (Blue_body, glass, silver_metal, yellow_emit,
 * side_, golden_emit, weapon, uper_thruster). Three's OBJLoader splits these
 * into separate child meshes whose `.material.name` matches the usemtl value.
 *
 * Material properties (ALL submaterials have baseColor=black):
 *   most submaterials:  metallic=0,     smoothness=0.38,  emission=(1,1,0)
 *   Blue body:          metallic=0,     smoothness=0.132, emission=(0,0,0)
 *   Glass:              metallic=0,     smoothness=0.38,  emission=(1,1,0)
 *   Uper thruster:      metallic=0.877, smoothness=0.392, emission=black
 *
 * So the ship reads as a near-black silhouette with yellow glowing accents on
 * most surfaces and a chrome thruster.
 */

interface SubMatSpec {
  baseColor: number;
  metallic: number;
  roughness: number;
  emissiveColor: number;
  emissiveIntensity: number;
  /**
   * If true, this material's emissive color is updated per-frame from the
   * current track color. Applies to the glass, silver_metal, yellow_emit,
   * side_, golden_emit, and weapon submaterials.
   */
  syncEmissive: boolean;
}

// Smoothness ≈ 1 - roughness (PBR convention). `syncEmissive` marks the
// submaterials whose emissive color follows the track color.
const SUBMATERIALS: Record<string, SubMatSpec> = {
  'Blue_body':     { baseColor: 0x000000, metallic: 0,     roughness: 1 - 0.132, emissiveColor: 0x000000, emissiveIntensity: 0,   syncEmissive: false },
  'glass':         { baseColor: 0x000000, metallic: 0,     roughness: 1 - 0.38,  emissiveColor: 0xffff00, emissiveIntensity: 2.5, syncEmissive: true  },
  'silver_metal':  { baseColor: 0x000000, metallic: 0,     roughness: 1 - 0.38,  emissiveColor: 0xffff00, emissiveIntensity: 2.5, syncEmissive: true  },
  'yellow_emit':   { baseColor: 0x000000, metallic: 0,     roughness: 1 - 0.38,  emissiveColor: 0xffff00, emissiveIntensity: 3.0, syncEmissive: true  },
  'side_':         { baseColor: 0x000000, metallic: 0,     roughness: 1 - 0.38,  emissiveColor: 0xffff00, emissiveIntensity: 2.5, syncEmissive: true  },
  'golden_emit':   { baseColor: 0x000000, metallic: 0,     roughness: 1 - 0.38,  emissiveColor: 0xffff00, emissiveIntensity: 3.0, syncEmissive: true  },
  'weapon':        { baseColor: 0x000000, metallic: 0,     roughness: 1 - 0.38,  emissiveColor: 0xffff00, emissiveIntensity: 2.5, syncEmissive: true  },
  'uper_thruster': { baseColor: 0x111111, metallic: 0.877, roughness: 1 - 0.392, emissiveColor: 0x000000, emissiveIntensity: 0,   syncEmissive: false },
};

const FALLBACK_SPEC: SubMatSpec = {
  baseColor: 0x222222, metallic: 0.5, roughness: 0.5, emissiveColor: 0x000000, emissiveIntensity: 0, syncEmissive: false,
};

export interface LoadedSpaceship {
  wrapper: THREE.Group;
  /** Materials whose emissive color should track the current song color. */
  syncedEmissiveMaterials: THREE.MeshStandardMaterial[];
}

export async function loadSpaceship(opts: { targetLength?: number } = {}): Promise<LoadedSpaceship> {
  const targetLength = opts.targetLength ?? 1.326;
  const loader = new OBJLoader();
  const url = new URL('/assets/models/spaceship.obj', window.location.href).toString();
  const root = await loader.loadAsync(url);

  // Apply per-submesh materials. Three's OBJLoader sets `material.name` to the
  // `usemtl` value when no MTLLoader is provided. When a single mesh has
  // multiple usemtl groups it ends up with `material` as an array — handle both.
  const seenMatNames = new Set<string>();
  const syncedEmissiveMaterials: THREE.MeshStandardMaterial[] = [];
  root.traverse((child) => {
    const m = child as THREE.Mesh;
    if (!m.isMesh) return;
    const apply = (sourceMat: THREE.Material): THREE.MeshStandardMaterial => {
      const name = sourceMat.name ?? '';
      seenMatNames.add(name);
      const spec = SUBMATERIALS[name] ?? FALLBACK_SPEC;
      const out = new THREE.MeshStandardMaterial({
        color: spec.baseColor,
        metalness: spec.metallic,
        roughness: spec.roughness,
        emissive: spec.emissiveColor,
        emissiveIntensity: spec.emissiveIntensity,
      });
      if (spec.syncEmissive) syncedEmissiveMaterials.push(out);
      return out;
    };
    if (Array.isArray(m.material)) {
      m.material = m.material.map(apply);
    } else if (m.material) {
      m.material = apply(m.material);
    }
    m.castShadow = false;
    m.receiveShadow = false;
  });
  console.log('[spaceship] submaterials loaded:', [...seenMatNames], 'synced:', syncedEmissiveMaterials.length);

  // Rescale + reorient so that the wrapper's local coord space has
  //   +Z = ship forward, +Y = up, +X = lateral
  // AND the ship is centered at the wrapper origin. Any caller parenting
  // children to the wrapper (e.g. the rocket-fire emitters) can then use
  // ship-relative offsets and trust that (0,0,0) is the ship's center.

  // Measure original model bounds in model space.
  const modelBox = new THREE.Box3().setFromObject(root);
  const modelSize = new THREE.Vector3();
  const modelCenter = new THREE.Vector3();
  modelBox.getSize(modelSize);
  modelBox.getCenter(modelCenter);
  const scale = targetLength / modelSize.x; // model +X = forward axis

  // Recenter each child geometry in model space. This avoids the usual
  // "scale then translate" ordering trap (three.js applies T·R·S so a
  // position set on the parent goes after scale — subtracting the raw model
  // center there leaves the ship offset by (scale-1)·center).
  root.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      m.geometry.translate(-modelCenter.x, -modelCenter.y, -modelCenter.z);
    }
  });

  root.scale.setScalar(scale);

  // Axis remap: model {X=fwd, Y=lat, Z=up} → world {X=lat, Y=up, Z=fwd}.
  const orient = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 0, 1), // model X → wrapper Z (forward)
    new THREE.Vector3(1, 0, 0), // model Y → wrapper X (lateral)
    new THREE.Vector3(0, 1, 0), // model Z → wrapper Y (up)
  );
  root.quaternion.setFromRotationMatrix(orient);

  const wrapper = new THREE.Group();
  wrapper.add(root);
  return { wrapper, syncedEmissiveMaterials };
}
