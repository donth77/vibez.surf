import * as THREE from 'three';
import Stats from 'stats.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { mountFileBrowser, type FileBrowser } from './ui/fileBrowser';
import { type LoadedAudio } from './audio/audioLoader';
import { loadAudioFromUrl } from './audio/urlLoader';
import { generateFromPrompt, waitForSong, parseSunoUrl, fetchSongById, isSunoEnabled } from './suno/sunoClient';
import { mountSunoSettingsModal, type SunoSettingsModal } from './ui/sunoSettings';
import { getNameFromPath } from './util/files';
import { FftWorkerPool } from './audio/workerPool';
import { getBeatIndexes, getIntensities, getSpectrumAmplitudes } from './audio/audioAnalysis';
import { generateTrack } from './track/trackGenerator';
import { createTrackMaterial, type TrackMaterial } from './track/trackMaterial';
import { buildRunwayMesh } from './track/buildRunwayMesh';
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
import { recordSong, computeRecentId, type SourceKind, type RecentSong } from './util/recentSongs';
import { saveAudioBytes, loadAudioBytes } from './util/audioBytesStore';
import { loadAudioFromArrayBuffer } from './audio/audioLoader';

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
renderer.domElement.setAttribute('aria-label', 'vibez.surf game viewport');
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
  0.85, // strength — slight reduction from 1.05 for a cleaner look
  0.55, // radius
  0.75, // threshold — only strongly emissive surfaces bloom
);
composer.addPass(bloom);

let trackMesh: THREE.Mesh | null = null;
let runwayMesh: THREE.Mesh | null = null;
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
/** Seconds of pre-roll "runway cruise" before audio starts. Ship glides along
 *  the runway at constant speed, then transitions straight into the song.
 *  Gives the player time to orient before any blocks appear. */
const PREROLL_SECONDS = 3;
let paused = false;
let currentSongTitle = '';
/** Source context for the currently-playing song — used by the "recently
 *  played" list so replays know what URL / prompt to re-request. File-backed
 *  entries carry no replayable reference (File objects don't survive a reload). */
interface CurrentSource {
  kind: SourceKind;
  sourceUrl?: string;
  sourcePrompt?: string;
}
let currentSource: CurrentSource = { kind: 'file' };
/** Guard so a single song only records once on the first `ended`. */
let songRecorded = false;

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
      onRestart: async () => {
        endSongPanel?.hide();
        if (!currentAudio) return;
        // Reset gameplay state and replay from the start.
        points.reset();
        if (collisions) collisions.reset();
        if (blocks) blocks.resetAllPicks(); // un-hide previously-picked blocks
        if (fireworks) fireworks.reset();   // clear any mid-burst particles
        if (pointsHud) pointsHud.setScore(0, points.totalTrackPoints, 0);
        currentAudio.element.currentTime = 0;
        songRecorded = false;
        if (player) await player.startPreRoll(PREROLL_SECONDS, preRollDistance);
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
/** Per-song pre-roll distance, recomputed in startGame to match the song's
 *  average forward speed. Used by both the runway mesh and `startPreRoll`. */
let preRollDistance = 0;
let fileBrowser: FileBrowser | null = null;
let sunoSettingsModal: SunoSettingsModal | null = null;

/**
 * Shared start-game pipeline: analyze audio, build track, instantiate all
 * managers, kick playback. Called from all three entry points (file / URL /
 * Suno). Throws descriptive errors that the file-browser's `run` helper
 * catches and surfaces inline.
 */
async function startGame(loaded: LoadedAudio, title: string, source: CurrentSource): Promise<void> {
  currentAudio = loaded;
  const { buffer, samples, element } = loaded;
  currentSongTitle = title;
  currentSource = source;
  songRecorded = false;

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
      if (!songRecorded) {
        songRecorded = true;
        const entry: RecentSong = {
          id: computeRecentId(currentSource.kind, title, currentSource.sourceUrl, currentSource.sourcePrompt),
          title,
          kind: currentSource.kind,
          sourceUrl: currentSource.sourceUrl,
          sourcePrompt: currentSource.sourcePrompt,
          score: points.currentPoints,
          totalScore: points.totalTrackPoints,
          percent: points.percentage,
          pickedCount: points.pickedCount,
          missedCount: points.missedCount,
          playedAt: Date.now(),
        };
        recordSong(entry);
        fileBrowser?.refreshRecents();
      }
      showEndSongPanel();
    });
    element.addEventListener('timeupdate', () => {
      hud.tick(element.currentTime, buffer.duration);
    });

    // M2 — analysis pipeline. Runs while the file loads; we kick playback after.
    hud.setStatus('Analyzing audio…');
    loadingOverlay?.setMessage('Analyzing audio');
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
    if (runwayMesh) {
      scene.remove(runwayMesh);
      runwayMesh.geometry.dispose();
      runwayMesh = null;
    }
    if (trackMaterial) trackMaterial.dispose();
    trackMaterial = createTrackMaterial({ durationSec: buffer.duration });
    trackMesh = new THREE.Mesh(trackData.mesh, trackMaterial);
    // Runway length sizes pre-roll to a CONSTANT cruise velocity matching
    // the song's instantaneous forward velocity at currentP=0. This is
    // measured by sampling two near-zero spline points and dividing by
    // time. With constant velocity during pre-roll and the same velocity
    // at song start, there's no acceleration at the handoff.
    const _probeA = new THREE.Vector3();
    const _probeB = new THREE.Vector3();
    const DP = 1 / Math.max(2, trackData.splinePointCount);
    trackData.spline.getPointAt(0, _probeA);
    trackData.spline.getPointAt(DP, _probeB);
    const initialSpeed = _probeA.distanceTo(_probeB) / (DP * buffer.duration);
    preRollDistance = initialSpeed * PREROLL_SECONDS;
    // Pad the runway mesh with extra length behind the ship's starting
    // position so the camera (which sits a few units behind the ship in
    // third-person) doesn't see past the back edge of the track during
    // pre-roll. ~30 units comfortably covers both landscape + portrait
    // camera offsets.
    const RUNWAY_PADDING = 30;
    const runwayGeom = buildRunwayMesh(
      trackData.spline,
      preRollDistance + RUNWAY_PADDING,
      5,
      new THREE.Vector3(0, 0, 1),
    );
    runwayMesh = new THREE.Mesh(runwayGeom, trackMaterial);
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
    if (runwayMesh) scene.add(runwayMesh);

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
    pointsHud.setSongTitle(title);

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
      onRestart: async () => {
        setPaused(false);
        if (!currentAudio) return;
        points.reset();
        if (collisions) collisions.reset();
        if (blocks) blocks.resetAllPicks(); // un-hide previously-picked blocks
        if (fireworks) fireworks.reset();   // clear any mid-burst particles
        if (pointsHud) pointsHud.setScore(0, points.totalTrackPoints, 0);
        currentAudio.element.currentTime = 0;
        currentAudio.element.pause();
        songRecorded = false;
        if (player) await player.startPreRoll(PREROLL_SECONDS, preRollDistance);
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

  loadingOverlay?.setMessage('Ready');
  loadingOverlay?.setProgress(1);
  // Hide loader + start screen first so the live 3D scene (track + runway)
  // is visible for the pre-roll cruise.
  loadingOverlay?.hide();
  fileBrowser?.hide();
  // Pre-roll cruise: ship glides along the runway behind the spline origin
  // for PREROLL_SECONDS before audio starts. Block/collision updates are
  // gated on `!player.isPreRolling` in the tick loop.
  if (player) await player.startPreRoll(PREROLL_SECONDS, preRollDistance);
  await element.play();
}

/** Wire up the start screen with three entry points. Errors thrown by any
 *  handler bubble up to fileBrowser's `run()` helper, which catches + shows
 *  them inline and re-enables the buttons. */
/**
 * Wrap a handler body so the loading overlay is guaranteed to hide on
 * failure. On success the overlay is already hidden by `startGame`.
 */
async function withOverlay<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    loadingOverlay?.hide();
    throw err;
  }
}

fileBrowser = mountFileBrowser({
  onFile: async (file) => withOverlay(async () => {
    if (!loadingOverlay) loadingOverlay = mountLoadingOverlay();
    loadingOverlay.show();
    loadingOverlay.setMessage('Decoding audio');
    loadingOverlay.setProgress(0);
    // Read bytes once; decode from them AND persist them so the entry stays
    // replayable from the Recents list on future visits. Bytes live in
    // IndexedDB under id `file:<name>`, FIFO-capped to 10 most-recent files.
    const bytes = await file.arrayBuffer();
    const loaded = await loadAudioFromArrayBuffer(bytes, file.type || 'audio/mpeg');
    const title = getNameFromPath(file.name);
    const id = computeRecentId('file', title);
    // Clone the bytes before persisting — loadAudioFromArrayBuffer's blob URL
    // holds the original, and IndexedDB may detach the buffer on older
    // browsers. Clone is cheap relative to song size; avoids a class of
    // "audio stops playing after save" bugs.
    await saveAudioBytes(id, bytes.slice(0)).catch((err) => {
      // Non-fatal: user can still play the song, just won't be able to
      // replay from the Recents list. Log and keep going.
      console.warn('[audioBytesStore] save failed', err);
    });
    await startGame(loaded, title, { kind: 'file' });
  }),
  onUrl: async (url) => withOverlay(async () => {
    if (!loadingOverlay) loadingOverlay = mountLoadingOverlay();
    loadingOverlay.show();

    // `effectiveUrl` is the URL we'll actually fetch; Suno redirects/share
    // resolution can mutate it before the generic fetch runs.
    let effectiveUrl = url;
    let suggestedTitle: string | null = null;

    // Suno short-share URLs (https://suno.com/s/<code>) are 307 redirects to
    // the canonical /song/<uuid> page. Browsers can't follow cross-origin
    // (Suno has no CORS). If the user has deployed the share-resolver
    // Worker (workers/suno-share-resolver), we call it to get {uuid, title,
    // audioUrl}; otherwise we instruct them how to proceed manually.
    if (/^https?:\/\/(?:www\.)?suno\.com\/s\//i.test(url.trim())) {
      // Resolver is baked in at build time via VITE_SUNO_RESOLVER — set it
      // in your Vercel/host env vars so every visitor uses your Worker.
      const sunoResolverUrl = (import.meta.env.VITE_SUNO_RESOLVER as string | undefined) || '';
      if (!sunoResolverUrl) {
        throw new Error(
          'Suno share links (/s/<code>) need the share-resolver Worker ' +
          'configured at build time (VITE_SUNO_RESOLVER). Or open the link ' +
          'in a new tab, wait for it to redirect, copy the resulting ' +
          '/song/<uuid> URL, and paste that here.',
        );
      }
      loadingOverlay.setMessage('Resolving Suno share link');
      const base = sunoResolverUrl.replace(/\/+$/, '');
      const resolverResp = await fetch(`${base}/?url=${encodeURIComponent(url.trim())}`);
      if (!resolverResp.ok) {
        throw new Error(`Suno share resolver returned HTTP ${resolverResp.status}`);
      }
      const body = await resolverResp.json() as { uuid?: string; title?: string; audioUrl?: string };
      if (!body.audioUrl) {
        throw new Error('Suno share resolver returned no audioUrl');
      }
      effectiveUrl = body.audioUrl;
      suggestedTitle = body.title ?? null;
    }

    // Suno song-page URLs (https://suno.com/song/<uuid>) are HTML. We resolve
    // them to a CDN URL one of two ways:
    //
    //   1. If the user has the Suno proxy configured → GET /feed/{id} and
    //      use the proxy's `audio_url` (also gets the real song title).
    //   2. Otherwise → construct `https://cdn1.suno.ai/<uuid>.mp3` directly.
    //      Suno's CDN serves public songs at this path with CORS open, so
    //      this works for any public song without needing any proxy.
    const sunoId = parseSunoUrl(url);
    const looksLikeSunoPage = sunoId && /^https?:\/\/(?:www\.)?suno\.com\/song\//i.test(url.trim());
    if (looksLikeSunoPage && sunoId) {
      if (isSunoEnabled()) {
        loadingOverlay.setMessage('Resolving Suno song');
        loadingOverlay.setProgress(0);
        try {
          const song = await fetchSongById(sunoId);
          if (song.audio_url) {
            effectiveUrl = song.audio_url;
            suggestedTitle = song.title ?? null;
          } else {
            effectiveUrl = `https://cdn1.suno.ai/${sunoId}.mp3`;
          }
        } catch (err) {
          // Proxy call failed (down, auth issue, etc.) — fall back to the
          // direct CDN URL so the user isn't blocked by a broken proxy.
          console.warn('[suno] proxy failed, using direct CDN URL:', err);
          effectiveUrl = `https://cdn1.suno.ai/${sunoId}.mp3`;
        }
      } else {
        // No proxy configured — go straight to the CDN URL.
        effectiveUrl = `https://cdn1.suno.ai/${sunoId}.mp3`;
      }
    }

    loadingOverlay.setMessage('Fetching audio');
    loadingOverlay.setProgress(0);
    const loaded = await loadAudioFromUrl(effectiveUrl, (f) => {
      loadingOverlay?.setProgress(f);
    });

    // Title: Suno song title if we resolved one, else derive from the URL.
    let title: string;
    if (suggestedTitle) {
      title = suggestedTitle;
    } else {
      try {
        const u = new URL(url);
        const last = u.pathname.split('/').filter(Boolean).pop() ?? u.hostname;
        title = decodeURIComponent(last).replace(/\.[a-z0-9]+$/i, '') || u.hostname;
      } catch {
        title = url.slice(0, 60);
      }
    }
    // Suno share links stay replayable as their original /s/<code> URL (the
    // resolver re-runs on replay). Plain URLs and resolved Suno pages replay
    // from the original URL the user pasted.
    const isSunoShare = /^https?:\/\/(?:www\.)?suno\.com\/s\//i.test(url.trim());
    const source: CurrentSource = {
      kind: isSunoShare ? 'suno-share' : 'url',
      sourceUrl: url,
    };
    await startGame(loaded, title, source);
  }),
  onSunoPrompt: async (prompt) => withOverlay(async () => {
    if (!isSunoEnabled()) {
      throw new Error('Suno generation is not configured on this site.');
    }
    if (!loadingOverlay) loadingOverlay = mountLoadingOverlay();
    loadingOverlay.show();
    loadingOverlay.setMessage('Submitting prompt');
    loadingOverlay.setProgress(0);
    // Start a time-based "pseudo progress" tick that fills the bar
    // asymptotically toward 95% over ~90s — Suno gives us status strings
    // but no real progress %, so time-elapsed is the best visual we can
    // honestly show. Final 5% jumps when audio_url actually lands.
    const stopProgress = runSunoProgressTimer(() => loadingOverlay, 90);
    try {
      const songs = await generateFromPrompt(prompt);
      if (songs.length === 0) throw new Error('Suno returned no songs.');
      const first = songs[0]!;
      const finished = await waitForSong(first.id, {
        onTick: (s) => loadingOverlay?.setMessage(friendlySunoStatus(s.status)),
      });
      stopProgress();
      loadingOverlay.setProgress(1);
      if (!finished.audio_url) throw new Error('Suno finished but returned no audio URL.');
      loadingOverlay.setMessage('Fetching generated audio');
      loadingOverlay.setProgress(0);
      const loaded = await loadAudioFromUrl(finished.audio_url, (f) => loadingOverlay?.setProgress(f));
      // For Suno-generated tracks we store BOTH the prompt (to regenerate
      // if needed) and the resolved CDN URL (for a cheap direct replay
      // without calling Suno again). The replay handler prefers the URL.
      await startGame(loaded, finished.title ?? prompt.slice(0, 60), {
        kind: 'suno-prompt',
        sourcePrompt: prompt,
        sourceUrl: finished.audio_url,
      });
    } finally {
      stopProgress();
    }
  }),
  onReplay: async (song) => withOverlay(async () => {
    // A replay just re-runs the same pipeline with the song's preserved
    // source. File entries need to be looked up in IndexedDB since the raw
    // bytes are the only way to re-decode without re-picking.
    if (!loadingOverlay) loadingOverlay = mountLoadingOverlay();
    loadingOverlay.show();
    if (song.kind === 'file') {
      loadingOverlay.setMessage('Loading saved file');
      const bytes = await loadAudioBytes(song.id);
      if (!bytes) {
        // Bytes were evicted (past the 10-file FIFO cap). UI normally hides
        // the play button in this case; this guard catches races.
        throw new Error('The saved bytes for this file have been evicted — re-pick the file to play again.');
      }
      const loaded = await loadAudioFromArrayBuffer(bytes, 'audio/mpeg');
      await startGame(loaded, song.title, { kind: 'file' });
      return;
    }
    if (song.sourceUrl) {
      loadingOverlay.setMessage('Fetching audio');
      loadingOverlay.setProgress(0);
      const loaded = await loadAudioFromUrl(song.sourceUrl, (f) => loadingOverlay?.setProgress(f));
      await startGame(loaded, song.title, {
        kind: song.kind,
        sourceUrl: song.sourceUrl,
        sourcePrompt: song.sourcePrompt,
      });
      return;
    }
    // No URL but we have a prompt → regenerate with Suno.
    if (song.kind === 'suno-prompt' && song.sourcePrompt) {
      if (!isSunoEnabled()) {
        throw new Error('Suno generation is not configured on this site.');
      }
      loadingOverlay.setMessage('Regenerating with Suno');
      loadingOverlay.setProgress(0);
      const stopProgress = runSunoProgressTimer(() => loadingOverlay, 90);
      let finished;
      try {
        const songs = await generateFromPrompt(song.sourcePrompt);
        if (songs.length === 0) throw new Error('Suno returned no songs.');
        const first = songs[0]!;
        finished = await waitForSong(first.id, {
          onTick: (s) => loadingOverlay?.setMessage(friendlySunoStatus(s.status)),
        });
      } finally {
        stopProgress();
      }
      loadingOverlay.setProgress(1);
      if (!finished.audio_url) throw new Error('Suno finished but returned no audio URL.');
      const loaded = await loadAudioFromUrl(finished.audio_url, (f) => loadingOverlay?.setProgress(f));
      await startGame(loaded, finished.title ?? song.title, {
        kind: 'suno-prompt',
        sourcePrompt: song.sourcePrompt,
        sourceUrl: finished.audio_url,
      });
      return;
    }
    throw new Error('This entry has no replayable source.');
  }),
  onOpenSunoSettings: () => {
    if (!sunoSettingsModal) sunoSettingsModal = mountSunoSettingsModal();
    sunoSettingsModal.open();
  },
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

  if (blocks && currentAudio && player && !paused && !player.isPreRolling) {
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
            // Lane→screen mapping is INVERTED from the source enum: our
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

/**
 * Time-based progress estimator for Suno generation. Fills from 0 → 95%
 * asymptotically over ~`expectedSec` seconds — we can't get a real
 * percent from Suno, but users react better to a moving bar than a
 * frozen one. Returns a cancel function; caller calls it when the real
 * generation finishes (and sets progress to 1.0 themselves).
 *
 * Curve: `1 - exp(-t/τ)` with τ = expectedSec/3 so it feels fast early
 * and asymptotes slower — matches the "90% done in 60% of the time" vibe
 * users expect from progress bars.
 */
function runSunoProgressTimer(getOverlay: () => LoadingOverlay | null, expectedSec: number): () => void {
  const start = performance.now();
  const tau = expectedSec / 3;
  const id = setInterval(() => {
    const elapsed = (performance.now() - start) / 1000;
    const progress = Math.min(0.95, 1 - Math.exp(-elapsed / tau));
    getOverlay()?.setProgress(progress);
  }, 250);
  return () => clearInterval(id);
}

/** Map Suno's raw status strings to user-friendly messages. */
function friendlySunoStatus(status: string | undefined): string {
  switch ((status ?? '').toLowerCase()) {
    case 'submitted': return 'Submitted to Suno';
    case 'queued':    return 'Queued in Suno';
    case 'streaming': return 'Generating audio';
    case 'complete':  return 'Finalizing';
    case 'error':     return 'Suno reported an error';
    default:          return status ? `Generating (${status})` : 'Generating';
  }
}

function fmt(sec: number): string {
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
