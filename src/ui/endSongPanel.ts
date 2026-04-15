/**
 * End-of-song modal. Shows the final score + pick/miss stats, and offers
 * Restart and "Back to menu" actions.
 *
 * Text format:
 *   SCORE: {current}/{total} ({percent}%)
 *   HIT: {picked}/{picked + missed}
 *   MISSED: {missed}    (red)
 */

export interface EndSongStats {
  songTitle: string;
  currentPoints: number;
  totalTrackPoints: number;
  pickedCount: number;
  missedCount: number;
}

export interface EndSongActions {
  onRestart(): void;
  onBack(): void;
}

export interface EndSongPanel {
  show(stats: EndSongStats, actions: EndSongActions): void;
  hide(): void;
  remove(): void;
}

export function mountEndSongPanel(): EndSongPanel {
  const style = document.createElement('style');
  style.textContent = `
    #end-song {
      position: fixed; inset: 0;
      display: none; place-items: center;
      background: rgba(0,0,0,0.65); backdrop-filter: blur(6px);
      z-index: 20;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #fff;
    }
    #end-song.open { display: grid; }
    #end-song .es-card {
      padding: 32px 44px; border-radius: 12px;
      background: rgba(14, 20, 38, 0.92);
      border: 1px solid #2a3550;
      text-align: center; min-width: 340px; max-width: 520px;
      box-shadow: 0 10px 60px rgba(0,0,0,0.6);
    }
    #end-song h2 { margin: 0 0 6px; font-size: 14px; letter-spacing: 0.18em; color: #8aa; text-transform: uppercase; }
    #end-song .es-title {
      margin: 0 0 18px;
      font-size: 24px; font-weight: 600; color: #fff; letter-spacing: 0.02em;
      word-break: break-word;
    }
    #end-song .es-stats { margin: 14px 0 24px; font-size: 15px; line-height: 1.7; }
    #end-song .es-stats .miss { color: #ff5a5a; }
    #end-song .es-buttons { display: flex; justify-content: center; gap: 12px; }
    #end-song button {
      padding: 10px 20px; border-radius: 8px;
      border: 1px solid #3a4a6a; background: linear-gradient(180deg, #2360c4, #1a479a);
      color: #fff; font-family: inherit; font-weight: 600; letter-spacing: 0.05em;
      cursor: pointer;
    }
    #end-song button.secondary { background: rgba(255,255,255,0.06); border-color: #445a78; }
    #end-song button:hover { filter: brightness(1.12); }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'end-song';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'es-heading');
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="es-card">
      <h2 id="es-heading">Song Complete</h2>
      <p class="es-title"></p>
      <div class="es-stats" role="status" aria-live="polite"></div>
      <div class="es-buttons">
        <button type="button" class="primary" data-action="restart">Restart</button>
        <button type="button" class="secondary" data-action="back">Back to menu</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const titleEl = root.querySelector<HTMLParagraphElement>('.es-title')!;
  const statsEl = root.querySelector<HTMLDivElement>('.es-stats')!;
  const restartBtn = root.querySelector<HTMLButtonElement>('[data-action="restart"]')!;
  const backBtn = root.querySelector<HTMLButtonElement>('[data-action="back"]')!;

  let currentActions: EndSongActions | null = null;
  let isOpen = false;
  let previouslyFocused: HTMLElement | null = null;
  restartBtn.addEventListener('click', () => currentActions?.onRestart());
  backBtn.addEventListener('click', () => currentActions?.onBack());

  // Tab trap across the two buttons.
  root.addEventListener('keydown', (e) => {
    if (!isOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      currentActions?.onBack();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = [restartBtn, backBtn];
    const idx = focusables.indexOf(document.activeElement as HTMLButtonElement);
    const nextIdx = e.shiftKey
      ? (idx <= 0 ? focusables.length - 1 : idx - 1)
      : (idx === focusables.length - 1 || idx < 0 ? 0 : idx + 1);
    e.preventDefault();
    focusables[nextIdx]!.focus();
  });

  return {
    show(stats, actions) {
      currentActions = actions;
      titleEl.textContent = stats.songTitle;
      const picked = stats.pickedCount;
      const missed = stats.missedCount;
      const pct = stats.totalTrackPoints > 0
        ? ((stats.currentPoints * 100) / stats.totalTrackPoints).toFixed(2)
        : '0.00';
      statsEl.innerHTML = `
        <div>SCORE: ${stats.currentPoints}/${stats.totalTrackPoints} (${pct}%)</div>
        <div>HIT: ${picked}/${picked + missed}</div>
        <div>MISSED: <span class="miss">${missed}</span></div>
      `;
      isOpen = true;
      previouslyFocused = document.activeElement as HTMLElement | null;
      root.classList.add('open');
      root.setAttribute('aria-hidden', 'false');
      restartBtn.focus();
    },
    hide() {
      isOpen = false;
      root.classList.remove('open');
      root.setAttribute('aria-hidden', 'true');
      if (previouslyFocused && document.body.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
      previouslyFocused = null;
    },
    remove() {
      root.remove();
      style.remove();
    },
  };
}
