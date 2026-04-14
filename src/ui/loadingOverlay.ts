/**
 * Minimal loading overlay shown between "file picked" and "audio starts".
 * Covers the decode + FFT analysis window so non-debug users see feedback
 * instead of a frozen screen. Hidden by default; `show()` fades it in.
 */

export interface LoadingOverlay {
  show(): void;
  setMessage(text: string): void;
  /** progress ∈ [0, 1] — sets the progress bar width. */
  setProgress(progress: number): void;
  hide(): void;
  remove(): void;
}

export function mountLoadingOverlay(): LoadingOverlay {
  const style = document.createElement('style');
  style.textContent = `
    #loading-overlay {
      position: fixed; inset: 0;
      display: grid; place-items: center;
      background: rgba(3, 5, 10, 0.88);
      backdrop-filter: blur(4px);
      z-index: 15;
      opacity: 0;
      pointer-events: none;
      transition: opacity 180ms ease-out;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #cde;
    }
    #loading-overlay.open { opacity: 1; }
    #loading-overlay .lo-card {
      padding: 28px 40px;
      min-width: 300px;
      max-width: 460px;
      text-align: center;
    }
    #loading-overlay .lo-spinner {
      width: 28px; height: 28px;
      margin: 0 auto 16px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.15);
      border-top-color: #6cf;
      animation: lo-spin 900ms linear infinite;
    }
    #loading-overlay .lo-message {
      font-size: 13px; letter-spacing: 0.08em;
      text-transform: uppercase; color: #8aa;
      margin: 0 0 14px;
    }
    #loading-overlay .lo-bar {
      width: 100%; height: 3px;
      background: rgba(255,255,255,0.08);
      border-radius: 2px; overflow: hidden;
    }
    #loading-overlay .lo-bar-fill {
      height: 100%; width: 0%;
      background: linear-gradient(90deg, #2360c4, #6cf);
      transition: width 120ms ease-out;
    }
    @keyframes lo-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      #loading-overlay .lo-spinner { animation: none; }
      #loading-overlay { transition: none; }
    }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'loading-overlay';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="lo-card">
      <div class="lo-spinner" aria-hidden="true"></div>
      <p class="lo-message">Loading</p>
      <div class="lo-bar" role="progressbar" aria-label="Loading progress"
           aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div class="lo-bar-fill"></div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const messageEl = root.querySelector<HTMLParagraphElement>('.lo-message')!;
  const barEl = root.querySelector<HTMLDivElement>('.lo-bar')!;
  const barFill = root.querySelector<HTMLDivElement>('.lo-bar-fill')!;

  return {
    show() {
      root.classList.add('open');
      root.setAttribute('aria-hidden', 'false');
    },
    setMessage(text) { messageEl.textContent = text; },
    setProgress(progress) {
      const pct = Math.max(0, Math.min(1, progress)) * 100;
      barFill.style.width = `${pct.toFixed(1)}%`;
      barEl.setAttribute('aria-valuenow', pct.toFixed(0));
    },
    hide() {
      root.classList.remove('open');
      root.setAttribute('aria-hidden', 'true');
    },
    remove() { root.remove(); style.remove(); },
  };
}
