import * as THREE from 'three';
import Stats from 'stats.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { mountFileBrowser, unmountFileBrowser } from './ui/fileBrowser';
import { loadAudioFromFile, type LoadedAudio } from './audio/audioLoader';
import { getNameFromPath } from './util/files';
import { FftWorkerPool } from './audio/workerPool';
import { getBeatIndexes, getIntensities, getSpectrumAmplitudes } from './audio/audioAnalysis';
import { generateTrack } from './track/trackGenerator';
import { createTrackMaterial, type TrackMaterial } from './track/trackMaterial';
import { loadSpaceship } from './player/spaceshipLoader';
import { PlayerController } from './player/playerController';
import { BlocksManager } from './blocks/blocksManager';
import { BlockCollisionSweep } from './blocks/collisionSweep';
import { PointsManager } from './points/pointsManager';
import { mountPointsHud, type PointsHud } from './points/pointsHud';
import { HexagonsManager } from './effects/hexagonsManager';
import { FireworksManager } from './effects/fireworksManager';
import { RaysManager } from './effects/raysManager';
import { mountTrackVisualizer, type TrackVisualizer } from './ui/trackVisualizer';
import { mountEndSongPanel, type EndSongPanel } from './ui/endSongPanel';
import { mountPauseMenu, type PauseMenu } from './ui/pauseMenu';
import { mountLoadingOverlay, type LoadingOverlay } from './ui/loadingOverlay';

const FFT_WINDOW_SIZE = 4096;
const fftPool = new FftWorkerPool({ windowSize: FFT_WINDOW_SIZE });

/** `?debug` (or `?debug=1`) in the URL enables the Stats.js counter + the
 *  bottom audio HUD. Off by default for a clean player-facing view. */
const DEBUG = new URLSearchParams(location.search).has('debug');

const container = document.getElementById('app');
if (!container) throw new Error('#app missing');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Canvas content isn't exposed to assistive tech; provide a short label so
// screen readers announce the purpose rather than a bare "graphic".
renderer.domElement.setAttribute('role', 'img');
renderer.domElement.setAttribute('aria-label', 'Vibez.surf game viewport');
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100000);
camera.position.set(0, 60, 80);
camera.lookAt(0, 0, 0);

// Low ambient so the scene stays dramatic; emissive materials (track stripes,
// block cubes, hex columns, ship submaterials) carry most of the lighting.
scene.add(new THREE.AmbientLight(0xffffff, 0.22));
const key = new THREE.DirectionalLight(0xffffff, 0.45);
key.position.set(3, 5, 4);
scene.add(key);
// Subtle distance fog — pulls the horizon into the dark background and adds
// depth to the hexagons / track tail.
scene.fog = new THREE.Fog(0x05070d, 80, 260);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Postprocessing — bloom defined by §5.4. Strength/radius/threshold are starting
// values to be tuned in M11.
const composer = new EffectComposer(renderer);
composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  1.05, // strength — punchier glow after dropping ambient
  0.55, // radius
  0.75, // threshold — cleaner, only strongly emissive surfaces bloom
);
composer.addPass(bloom);

let trackMesh: THREE.Mesh | null = null;
let trackMaterial: TrackMaterial | null = null;
let player: PlayerController | null = null;
let detachInput: (() => void) | null = null;
let blocks: BlocksManager | null = null;
let collisions: BlockCollisionSweep | null = null;
const points = new PointsManager();
let pointsHud: PointsHud | null = null;
let lastLabelSide: 'left' | 'right' = 'left';
let hexagons: HexagonsManager | null = null;
let hexagonTexture: THREE.Texture | null = null;
let fireworks: FireworksManager | null = null;
let trackViz: TrackVisualizer | null = null;
let rays: RaysManager | null = null;
let endSongPanel: EndSongPanel | null = null;
let pauseMenu: PauseMenu | null = null;
let loadingOverlay: LoadingOverlay | null = null;
let paused = false;
let currentSongTitle = '';

/** Toggle pause — pauses audio, freezes the game tick (paused branch skips
 *  updates), and shows/hides the pause overlay. */
function setPaused(next: boolean): void {
  if (!currentAudio) return;
  paused = next;
  if (paused) {
    currentAudio.element.pause();
    pauseMenu?.open();
  } else {
    currentAudio.element.play().catch(() => { /* swallow — user can press Resume */ });
    pauseMenu?.close();
  }
}

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  if (!currentAudio) return;
  // Only pause while a song is loaded.
  setPaused(!paused);
});

// No temp objects needed for the 2D screen-space fireworks any more.
const _currentColor = new THREE.Color();

function showEndSongPanel(): void {
  if (!endSongPanel) endSongPanel = mountEndSongPanel();
  endSongPanel.show(
    {
      songTitle: currentSongTitle,
      currentPoints: points.currentPoints,
      totalTrackPoints: points.totalTrackPoints,
      pickedCount: points.pickedCount,
      missedCount: points.missedCount,
    },
    {
      onRestart: () => {
        endSongPanel?.hide();
        if (!currentAudio) return;
        // Reset gameplay state and replay from the start.
        points.reset();
        if (collisions) collisions.reset();
        if (pointsHud) pointsHud.setScore(0, points.totalTrackPoints, 0);
        currentAudio.element.currentTime = 0;
        currentAudio.element.play().catch((err) => {
          console.warn('[restart] play() failed', err);
        });
      },
      onBack: () => {
        endSongPanel?.hide();
        // Simplest "back to menu" = reload the page — reshows the file
        // browser with a clean game state.
        location.reload();
      },
    },
  );
}

// Kick off the hexagon texture load eagerly (it's tiny and we'll want it as
// soon as the user picks a song).
const textureLoader = new THREE.TextureLoader();
textureLoader.load('/assets/textures/hexagon.png', (t) => {
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  hexagonTexture = t;
});

const stats = new Stats();
if (DEBUG) {
  stats.dom.style.position = 'fixed';
  stats.dom.style.top = '8px';
  stats.dom.style.left = '8px';
  document.body.appendChild(stats.dom);
}

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloom.setSize(window.innerWidth, window.innerHeight);
  rays?.onResize(window.innerWidth, window.innerHeight);
});

// Debug-only bottom HUD. When `?debug` is absent we return a no-op stub so
// the rest of the code can keep calling hud.setStatus/setSummary/tick freely.
const hud: ReturnType<typeof mountAudioHud> = DEBUG
  ? mountAudioHud()
  : { setStatus: () => {}, setSummary: () => {}, tick: () => {} };

let currentAudio: LoadedAudio | null = null;

mountFileBrowser(async (file) => {
  unmountFileBrowser();
  if (!loadingOverlay) loadingOverlay = mountLoadingOverlay();
  loadingOverlay.show();
  loadingOverlay.setMessage('Decoding audio');
  loadingOverlay.setProgress(0);
  hud.setStatus(`Loading "${file.name}"…`);
  try {
    currentAudio = await loadAudioFromFile(file);
    const { buffer, samples, element } = currentAudio;
    const title = getNameFromPath(file.name);
    currentSongTitle = title;

    const summary = {
      title,
      durationSec: buffer.duration.toFixed(2),
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
      framesPerChannel: buffer.length,
      interleavedSamples: samples.length,
      firstSamples: Array.from(samples.slice(0, 8)).map((v) => v.toFixed(4)),
    };
    console.log('[audio] loaded', summary);
    hud.setSummary(title, buffer);

    element.addEventListener('ended', () => {
      console.log('[audio] ended event fired');
      hud.setStatus('Playback ended.');
      showEndSongPanel();
    });
    element.addEventListener('timeupdate', () => {
      hud.tick(element.currentTime, buffer.duration);
    });

    // M2 — analysis pipeline. Runs while the file loads; we kick playback after.
    hud.setStatus('Analyzing audio…');
    loadingOverlay.setMessage('Analyzing audio');
    const intensitiesT0 = performance.now();
    const intensities = getIntensities(samples, FFT_WINDOW_SIZE);
    const intensitiesMs = performance.now() - intensitiesT0;

    const spectrumT0 = performance.now();
    const spectrum = await getSpectrumAmplitudes(samples, FFT_WINDOW_SIZE, fftPool, (done, total) => {
      loadingOverlay?.setProgress(done / total);
      if (done % 64 === 0 || done === total) {
        hud.setStatus(`FFT ${done}/${total} (${((done * 100) / total).toFixed(1)}%)`);
      }
    });
    const spectrumMs = performance.now() - spectrumT0;

    const lowBeats = getBeatIndexes(spectrum, buffer.sampleRate, buffer.numberOfChannels, 20, 0.1, 0.5);
    const highBeats = getBeatIndexes(spectrum, buffer.sampleRate, buffer.numberOfChannels, 7500, 0.025, 0.5);

    // M3 — track generation + ribbon mesh.
    const trackT0 = performance.now();
    const trackData = generateTrack(intensities);
    const trackMs = performance.now() - trackT0;

    if (trackMesh) scene.remove(trackMesh);
    if (trackMaterial) trackMaterial.dispose();
    trackMaterial = createTrackMaterial({ durationSec: buffer.duration });
    trackMesh = new THREE.Mesh(trackData.mesh, trackMaterial);
    // NOTE: not adding trackMesh to the scene yet. Adding it here (before the
    // player reparents the camera) would produce a one-frame flash rendering
    // the full track from the default OrbitControls position at (0, 60, 80).
    // We add after the player is constructed so the first rendered frame is
    // already in the player's third-person view.

    // M5 — player rides the spline.
    if (detachInput) { detachInput(); detachInput = null; }
    if (player) scene.remove(player.root);
    controls.enabled = false; // disable orbit; player owns the camera now

    // Target ship length: scale 6.5 applied to the raw OBJ X-extent of 0.204
    // → 1.326 units long.
    const ship = await loadSpaceship({ targetLength: 1.326 });
    player = new PlayerController({
      trackData,
      audio: element,
      camera,
      inputTarget: renderer.domElement,
      spaceship: ship.wrapper,
      syncedEmissiveMaterials: ship.syncedEmissiveMaterials,
      scene,
    });
    detachInput = player.attachInput();
    // Player + camera are ready — safe to show the track now.
    scene.add(trackMesh);

    // M6 — blocks (visual only; collision/scoring below).
    if (blocks) scene.remove((blocks as unknown as { mesh: THREE.Object3D }).mesh);
    blocks = new BlocksManager({
      trackData,
      lowBeatIndexes: lowBeats,
      highBeatIndexes: highBeats,
      scene,
    });
    console.log('[blocks]', { totalBlocks: blocks.totalCount });

    // M7 — collision sweep + points + HUD.
    points.reset();
    points.computeTotal(blocks.totalCount);
    collisions = new BlockCollisionSweep(blocks, points);
    if (!pointsHud) pointsHud = mountPointsHud();
    pointsHud.setScore(0, points.totalTrackPoints, 0);

    // M8 — hexagon side pillars.
    if (hexagons) hexagons.dispose(scene);
    if (hexagonTexture) {
      hexagons = new HexagonsManager({
        trackData,
        lowBeatIndexes: lowBeats,
        highBeatIndexes: highBeats,
        texture: hexagonTexture,
        scene,
      });
    } else {
      console.warn('[hexagons] texture not loaded yet; skipping');
    }

    // M9 finish — pickup fireworks. 2D screen-space overlay, not in-scene.
    if (fireworks) fireworks.dispose();
    fireworks = new FireworksManager();

    // Radial "speed line" rays.
    if (rays) rays.dispose(camera);
    rays = new RaysManager({ camera, trackData, audio: element });

    // M10 partial — track-height mini-map.
    if (!trackViz) trackViz = mountTrackVisualizer();
    trackViz.showTrack(trackData);

    // M10 — pause menu (Esc on desktop, button on touch). The touch pause
    // button toggles the same way Esc does.
    if (!pauseMenu) pauseMenu = mountPauseMenu();
    pauseMenu.setActions({
      onResume: () => setPaused(false),
      onRestart: () => {
        setPaused(false);
        if (!currentAudio) return;
        points.reset();
        if (collisions) collisions.reset();
        if (pointsHud) pointsHud.setScore(0, points.totalTrackPoints, 0);
        currentAudio.element.currentTime = 0;
        currentAudio.element.play().catch(() => {});
      },
      onBack: () => location.reload(),
    });
    pauseMenu.setOnTapToggle(() => {
      if (!currentAudio) return;
      setPaused(!paused);
    });

    console.log('[track]', {
      trackMs: trackMs.toFixed(1),
      splinePoints: trackData.splinePointCount,
      slopeIntensity: trackData.slopeIntensity.toFixed(3),
      firstSplinePoints: Array.from(trackData.splinePoints.slice(0, 12)).map((v) => v.toFixed(2)),
      firstColors: Array.from(trackData.colors.slice(0, 9)).map((v) => v.toFixed(3)),
      mesh: {
        verts: trackData.mesh.getAttribute('position').count,
        tris: (trackData.mesh.getIndex()?.count ?? 0) / 3,
      },
    });

    console.log('[analysis]', {
      chunks: intensities.length,
      intensitiesMs: intensitiesMs.toFixed(1),
      spectrumMs: spectrumMs.toFixed(1),
      lowBeats: lowBeats.length,
      highBeats: highBeats.length,
      firstIntensities: Array.from(intensities.slice(0, 5)).map((v) => v.toFixed(4)),
      firstLowBeats: lowBeats.slice(0, 5),
      firstHighBeats: highBeats.slice(0, 5),
    });
    hud.setStatus(
      `Analyzed: ${intensities.length} chunks · ${lowBeats.length} low / ${highBeats.length} high beats · FFT ${spectrumMs.toFixed(0)}ms`,
    );

    loadingOverlay.setMessage('Ready');
    loadingOverlay.setProgress(1);
    await element.play();
    loadingOverlay.hide();
  } catch (err) {
    console.error('[audio] load failed', err);
    hud.setStatus(`Error: ${(err as Error).message ?? err}`);
    loadingOverlay?.setMessage(`Error: ${(err as Error).message ?? 'load failed'}`);
  }
});

const clock = new THREE.Clock();
function tick() {
  if (DEBUG) stats.begin();
  const dt = clock.getDelta();
  const t = clock.elapsedTime;
  if (player) {
    if (!paused) player.update(dt);
  } else {
    controls.update();
  }
  if (trackMaterial) trackMaterial.setTime(t);

  if (blocks && currentAudio && player && !paused) {
    const dur = currentAudio.element.duration;
    if (isFinite(dur) && dur > 0) {
      const currentP = Math.min(0.9999, Math.max(0, currentAudio.element.currentTime / dur));
      // Use the player's track data (same instance) to read the current color.
      player.getCurrentColor(_currentColor);
      blocks.update(currentP, _currentColor, t);
      if (hexagons) hexagons.update(currentP, _currentColor, dt);
      if (fireworks) fireworks.update(dt);
      if (rays) rays.update(dt);
      if (trackViz) trackViz.updatePosition(currentP);

      // M7 collision + score updates.
      if (collisions && pointsHud) {
        const hud = pointsHud;
        collisions.update(currentP, player.lateralOffset, t, {
          onPick: (_blockIndex, lane) => {
            hud.setScore(points.currentPoints, points.totalTrackPoints, points.percentage);
            hud.spawnFloatingLabel(`+${points.lastPickLabelValue}`, lastLabelSide, false);
            lastLabelSide = lastLabelSide === 'left' ? 'right' : 'left';

            // Fireworks burst at the matching screen-space anchor (top-left /
            // top-center / top-right). Color = current track color.
            //
            // Lane→screen mapping is INVERTED from the source enum: the C#
            // calls world +Z "LEFT" (from its camera's perspective), but our
            // camera puts world +Z on the SCREEN RIGHT (same reason the
            // keyboard movement sign had to flip in playerController). So:
            //   lane = +1 (world +Z) → screen-right burst
            //   lane = -1 (world -Z) → screen-left burst
            if (fireworks) {
              const laneName = lane === 1 ? 'right' : lane === -1 ? 'left' : 'center';
              fireworks.emitAt(laneName, _currentColor);
            }
          },
          onMiss: () => {
            hud.setScore(points.currentPoints, points.totalTrackPoints, points.percentage);
            hud.spawnFloatingLabel(`-${points.lastMissLabelValue}`, lastLabelSide, true);
            lastLabelSide = lastLabelSide === 'left' ? 'right' : 'left';
          },
        });
      }
    }
  }

  composer.render();
  if (DEBUG) stats.end();
  requestAnimationFrame(tick);
}
tick();

function mountAudioHud() {
  const root = document.createElement('div');
  root.id = 'audio-hud';
  root.innerHTML = `
    <div class="ah-title"></div>
    <div class="ah-meta"></div>
    <div class="ah-time"></div>
    <div class="ah-status" role="status" aria-live="polite"></div>
  `;
  const style = document.createElement('style');
  style.textContent = `
    #audio-hud {
      position: fixed; bottom: 12px; left: 12px; right: 12px;
      padding: 10px 14px; border-radius: 8px;
      background: rgba(0,0,0,0.55); backdrop-filter: blur(6px);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
      color: #cde; pointer-events: none; z-index: 5;
      display: grid; grid-template-columns: 1fr auto auto; gap: 4px 18px;
      align-items: center;
    }
    #audio-hud .ah-title { grid-column: 1; font-weight: 600; color: #fff; }
    #audio-hud .ah-meta  { grid-column: 2; color: #8ad; }
    #audio-hud .ah-time  { grid-column: 3; color: #cde; font-variant-numeric: tabular-nums; }
    #audio-hud .ah-status{ grid-column: 1 / -1; color: #889; font-size: 11px; }
  `;
  document.head.appendChild(style);
  document.body.appendChild(root);

  const titleEl = root.querySelector<HTMLDivElement>('.ah-title')!;
  const metaEl = root.querySelector<HTMLDivElement>('.ah-meta')!;
  const timeEl = root.querySelector<HTMLDivElement>('.ah-time')!;
  const statusEl = root.querySelector<HTMLDivElement>('.ah-status')!;

  return {
    setStatus(text: string) { statusEl.textContent = text; },
    setSummary(title: string, buffer: AudioBuffer) {
      titleEl.textContent = title;
      metaEl.textContent =
        `${buffer.numberOfChannels}ch · ${buffer.sampleRate}Hz · ` +
        `${buffer.length} frames · ${(buffer.length * buffer.numberOfChannels).toLocaleString()} samples`;
    },
    tick(currentSec: number, totalSec: number) {
      timeEl.textContent = `${fmt(currentSec)} / ${fmt(totalSec)}`;
    },
  };
}

function fmt(sec: number): string {
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
