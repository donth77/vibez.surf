import type * as THREE from 'three';

/**
 * Pickup-celebration particle bursts:
 *   - Three fixed screen-space emitters (LEFT, CENTER, RIGHT) that play
 *     a burst when the player picks a block in the matching lane.
 *   - Duration + startSize vary landscape vs portrait (1.5s / 0.9s and
 *     (0.45, 0.8) / (0.3, 0.65) particle-size range).
 *   - Burst color = current track color.
 *
 * Implementation: a full-screen 2D canvas overlay (z-index above the 3D
 * canvas, pointer-events disabled). Particles live in a JS-side pool; we
 * integrate positions + draw circles each frame.
 */

export type FireworksLane = 'left' | 'center' | 'right';

interface Particle {
  x: number;   // screen px
  y: number;
  vx: number;  // px per second
  vy: number;
  age: number;
  life: number;
  color: string; // rgba(...) string, color + alpha baked together
  size: number;  // px radius at age=0
}

export class FireworksManager {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly particles: Particle[] = [];
  private readonly dpr: number;
  private readonly lifetime: number;
  private readonly sizeRange: [number, number]; // px
  /**
   * Anchors are exactly at the top edge corners:
   *   - LEFT   → (0, 0)      top-left corner
   *   - CENTER → (w/2, 0)    top-center
   *   - RIGHT  → (w, 0)      top-right corner
   * Particles emit in all 360° from the anchor; only the quadrant(s) that
   * fall into the visible area are seen (bottom-right / bottom half /
   * bottom-left respectively).
   */
  /** Gravity (px/s²). Positive = down, matches screen Y. */
  private readonly gravity = 900;
  /** How many particles per burst. */
  private readonly particlesPerBurst: number;

  constructor(opts: { particlesPerBurst?: number } = {}) {
    this.particlesPerBurst = opts.particlesPerBurst ?? 70;
    this.dpr = Math.min(window.devicePixelRatio ?? 1, 2);

    // Particle-size ranges, converted from the reference's world-size units
    // to screen-space px. The landscape range (0.45..0.8) sized ~50–90 px on
    // the reference's fullscreen render; portrait (0.3..0.65) ~30–65 px. We
    // use viewport-scaled radii instead for responsive sizing.
    const landscape = window.innerWidth >= window.innerHeight;
    this.lifetime = landscape ? 1.5 : 0.9;
    const sMin = landscape ? 0.45 : 0.3;
    const sMax = landscape ? 0.8 : 0.65;
    // Scale to px by viewport short-edge / 12 — gives ~60 px max on a
    // 720-high screen, ~90 px on 1080-high.
    const scale = Math.min(window.innerWidth, window.innerHeight) / 12;
    this.sizeRange = [sMin * scale, sMax * scale];

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'fireworks-overlay';
    this.canvas.style.cssText = `
      position: fixed; inset: 0;
      pointer-events: none; z-index: 8;
    `;
    document.body.appendChild(this.canvas);
    this.resize();
    window.addEventListener('resize', this.resize);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
  }

  emitAt(lane: FireworksLane, color: THREE.Color): void {
    const w = window.innerWidth;
    const ax = lane === 'left' ? 0 : lane === 'right' ? w : w * 0.5;
    const ay = 0;

    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    const rgba = (a: number) => `rgba(${r},${g},${b},${a.toFixed(3)})`;

    for (let i = 0; i < this.particlesPerBurst; i++) {
      const theta = Math.random() * Math.PI * 2;
      const speed = 260 + Math.random() * 340; // px/s
      const size = this.sizeRange[0] + Math.random() * (this.sizeRange[1] - this.sizeRange[0]);
      this.particles.push({
        x: ax,
        y: ay,
        vx: Math.cos(theta) * speed,
        // No upward kick — anchor is at the top edge so any initial upward
        // velocity would send particles off-screen. Gravity still pulls them
        // further down over the burst's lifetime.
        vy: Math.sin(theta) * speed,
        age: 0,
        life: this.lifetime * (0.6 + Math.random() * 0.5),
        color: rgba(1),
        size: size * 0.5,
      });
    }
  }

  /** Step simulation + redraw. Call every frame with `dt` in seconds. */
  update(dt: number): void {
    this.ctx.clearRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);

    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter'; // additive, HDR-ish glow

    let writeIdx = 0;
    for (let readIdx = 0; readIdx < this.particles.length; readIdx++) {
      const p = this.particles[readIdx]!;
      p.age += dt;
      if (p.age >= p.life) continue;

      p.vy += this.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      const t = p.age / p.life;
      const alpha = (1 - t) * (1 - t); // ease-out fade
      const radius = p.size * (1 - t * 0.5); // shrink slightly

      // Extract "r,g,b" from the baked rgba string and re-stamp with alpha.
      const match = /^rgba\((\d+),(\d+),(\d+),/.exec(p.color);
      if (match) {
        ctx.fillStyle = `rgba(${match[1]},${match[2]},${match[3]},${alpha.toFixed(3)})`;
      } else {
        ctx.fillStyle = p.color;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();

      this.particles[writeIdx++] = p;
    }
    this.particles.length = writeIdx;

    ctx.globalCompositeOperation = 'source-over';
  }

  /** Drop all in-flight particles and wipe the canvas. Call on restart so
   *  mid-burst particles from the previous run don't stay frozen on screen
   *  through the pre-roll (when `update()` isn't being called). */
  reset(): void {
    this.particles.length = 0;
    this.ctx.clearRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.canvas.remove();
  }

  private resize = (): void => {
    this.canvas.width = window.innerWidth * this.dpr;
    this.canvas.height = window.innerHeight * this.dpr;
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    const ctx = this.canvas.getContext('2d');
    ctx?.scale(this.dpr, this.dpr);
  };
}
