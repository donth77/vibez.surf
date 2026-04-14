import type { TrackData } from '../track/trackData';

/**
 * Track-height minimap showing the song's Y profile across the whole track
 * with a marker for the player's current position. Rendered into a fixed
 * `<canvas>` overlay.
 *
 * Algorithm:
 *   positionCount = splinePoints.Length / 50
 *   step = 1 / positionCount
 *   for i in 0..positionCount-1:
 *     x = i * step * width
 *     y = -height * (1 - invLerp(minY, maxY, splinePoints[i * 50].y))
 *
 *   marker: lerp between adjacent line vertices at the current song percentage.
 */

export interface TrackVisualizer {
  showTrack(trackData: TrackData): void;
  updatePosition(percentage: number): void;
  remove(): void;
}

const W = 220;
const H = 28;

export function mountTrackVisualizer(): TrackVisualizer {
  const style = document.createElement('style');
  style.textContent = `
    #track-visualizer {
      position: fixed;
      top: calc(12px + var(--safe-top, 0px));
      left: calc(12px + var(--safe-left, 0px));
      width: ${W}px; height: ${H}px;
      padding: 4px 8px; box-sizing: content-box;
      background: rgba(0,0,0,0.45); backdrop-filter: blur(4px);
      border-radius: 6px; pointer-events: none; z-index: 6;
    }
    #track-visualizer canvas { display: block; width: ${W}px; height: ${H}px; }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'track-visualizer';
  root.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  root.appendChild(canvas);
  document.body.appendChild(root);

  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  /** Pre-baked Y coords along the track at positionCount points. */
  let pts: Float32Array | null = null;
  let positionCount = 0;

  const drawBase = () => {
    if (!pts) return;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(140, 200, 255, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < positionCount; i++) {
      const x = (i / (positionCount - 1)) * W;
      const y = pts[i]!;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };

  return {
    showTrack(trackData) {
      // One sample per 50 spline points.
      positionCount = Math.max(2, Math.floor(trackData.splinePointCount / 50));
      pts = new Float32Array(positionCount);

      // Find min/max Y across the full spline (then sample every 50th point
      // for the line). The min/max over all points vs sampled points is
      // nearly identical at this density.
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < trackData.splinePointCount; i++) {
        const y = trackData.splinePoints[i * 3 + 1]!;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const range = maxY - minY || 1;

      for (let i = 0; i < positionCount; i++) {
        const srcIdx = Math.min(trackData.splinePointCount - 1, i * 50);
        const y = trackData.splinePoints[srcIdx * 3 + 1]!;
        const t = (y - minY) / range; // 0..1 from low to high
        // positionY = -height * (1 - t) — highest points at the top of the
        // widget. Our canvas has y-down, so (1 - t) * H gives the same look.
        pts[i] = (1 - t) * (H - 4) + 2; // with 2px vertical padding
      }
      drawBase();
    },

    updatePosition(percentage) {
      if (!pts || positionCount < 2) return;
      drawBase();
      const lerp = percentage * (positionCount - 2);
      const u = Math.max(0, Math.min(positionCount - 2, Math.floor(lerp)));
      const inter = lerp - u;
      const x = ((u + inter) / (positionCount - 1)) * W;
      const y = pts[u]! * (1 - inter) + pts[u + 1]! * inter;

      // Marker: bright dot + vertical hairline.
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    },

    remove() {
      root.remove();
      style.remove();
    },
  };
}
