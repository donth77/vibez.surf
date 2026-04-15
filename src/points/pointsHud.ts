/**
 * Minimal DOM-overlay score HUD (final polish lands in M10).
 * Exposes:
 *   setScore(points, total, percent)   — update the numbers
 *   spawnFloatingLabel(text, side, isMiss)  — animated +N / -N label
 */

export interface PointsHud {
  setScore(points: number, total: number, percent: number): void;
  /** Song name displayed beneath the score (derived from the file name,
   *  URL, or Suno title). Pass `''` to clear. */
  setSongTitle(title: string): void;
  spawnFloatingLabel(text: string, side: 'left' | 'right', isMiss: boolean): void;
  remove(): void;
}

export function mountPointsHud(): PointsHud {
  const style = document.createElement('style');
  style.textContent = `
    #points-hud {
      position: fixed;
      top: calc(16px + var(--safe-top, 0px));
      right: calc(16px + var(--safe-right, 0px));
      pointer-events: none; z-index: 6;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #fff; text-align: right;
      text-shadow: 0 0 8px rgba(0,0,0,0.8);
    }
    #points-hud .ph-score { font-size: 36px; font-weight: 700; letter-spacing: 0.02em; }
    #points-hud .ph-percent { font-size: 16px; color: #8ad; opacity: 0.9; }
    #points-hud .ph-title {
      margin-top: 8px;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      font-size: 18px; font-weight: 500;
      color: #cde; opacity: 0.9;
      max-width: 300px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      margin-left: auto;  /* right-align the truncated box */
    }
    #points-hud .ph-title:empty { display: none; }
    @media (max-width: 560px) {
      #points-hud .ph-title { max-width: 200px; font-size: 15px; }
    }
    #points-hud .ph-labels {
      position: absolute; top: 42px; right: 0; width: 0; height: 0;
    }
    #points-hud .ph-label {
      position: absolute; top: 0;
      font-size: 24px; font-weight: 700; white-space: nowrap;
      animation: ph-rise 900ms ease-out forwards;
      text-shadow: 0 0 8px rgba(0,0,0,0.9);
    }
    #points-hud .ph-label.left { right: 60px; }
    #points-hud .ph-label.right { right: -60px; }
    #points-hud .ph-label.miss { color: #ff5a5a; }
    #points-hud .ph-label.pick { color: #fff; }
    @keyframes ph-rise {
      0%   { transform: translateY(0);       opacity: 0.0; }
      15%  { transform: translateY(-4px);    opacity: 1.0; }
      100% { transform: translateY(-38px);   opacity: 0.0; }
    }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'points-hud';
  root.innerHTML = `
    <div class="ph-score" role="status" aria-live="polite" aria-label="Score">0</div>
    <div class="ph-percent" aria-hidden="true">0.00%</div>
    <div class="ph-title" aria-label="Now playing"></div>
    <div class="ph-labels" aria-hidden="true"></div>
  `;
  document.body.appendChild(root);

  const scoreEl = root.querySelector<HTMLDivElement>('.ph-score')!;
  const percentEl = root.querySelector<HTMLDivElement>('.ph-percent')!;
  const titleEl = root.querySelector<HTMLDivElement>('.ph-title')!;
  const labelsEl = root.querySelector<HTMLDivElement>('.ph-labels')!;

  return {
    setScore(points, _total, percent) {
      scoreEl.textContent = `${points}`;
      percentEl.textContent = `${percent.toFixed(2)}%`;
    },
    setSongTitle(title) {
      titleEl.textContent = title;
      titleEl.title = title; // native tooltip shows full text when truncated
    },
    spawnFloatingLabel(text, side, isMiss) {
      const el = document.createElement('div');
      el.className = `ph-label ${side} ${isMiss ? 'miss' : 'pick'}`;
      el.textContent = text;
      labelsEl.appendChild(el);
      setTimeout(() => el.remove(), 1000);
    },
    remove() {
      root.remove();
      style.remove();
    },
  };
}
