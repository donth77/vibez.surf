/**
 * Pause menu:
 *   - Esc toggles pause
 *   - Pausing: pause audio + freeze game tick
 *   - Unpausing: resume audio + game tick
 *   - Actions: Resume, Restart, Back to menu
 */

export interface PauseMenuActions {
  onResume(): void;
  onRestart(): void;
  onBack(): void;
}

export interface PauseMenu {
  /** Wires button callbacks. Returns a teardown that also clears them. */
  setActions(actions: PauseMenuActions): () => void;
  /** Wires a toggle callback the touch-device pause button can call. */
  setOnTapToggle(cb: () => void): void;
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  remove(): void;
}

export function mountPauseMenu(): PauseMenu {
  const style = document.createElement('style');
  style.textContent = `
    /* Touch-only pause button — shown on coarse-pointer devices (phones,
       tablets). Desktop users have Esc instead. */
    #pause-btn {
      position: fixed;
      bottom: calc(20px + var(--safe-bottom, 0px));
      right:  calc(20px + var(--safe-right, 0px));
      width: 56px; height: 56px; border-radius: 50%;
      border: 1px solid rgba(255,255,255,0.2);
      background: rgba(14, 20, 38, 0.75); backdrop-filter: blur(6px);
      color: #fff; cursor: pointer; padding: 0;
      display: none; align-items: center; justify-content: center;
      gap: 5px;
      z-index: 7;
      -webkit-tap-highlight-color: transparent;
    }
    /* Two bars side-by-side, flex-centered via the parent's gap. */
    #pause-btn::before,
    #pause-btn::after {
      content: '';
      width: 4px; height: 16px;
      background: #fff; border-radius: 1px;
    }
    @media (pointer: coarse) { #pause-btn { display: flex; } }

    #pause-menu {
      position: fixed; inset: 0;
      display: none; place-items: center;
      background: rgba(0,0,0,0.55); backdrop-filter: blur(6px);
      z-index: 18;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #fff;
    }
    #pause-menu.open { display: grid; }
    #pause-menu .pm-card {
      padding: 28px 40px; border-radius: 12px;
      background: rgba(14, 20, 38, 0.92);
      border: 1px solid #2a3550;
      text-align: center; min-width: 260px;
      box-shadow: 0 10px 60px rgba(0,0,0,0.6);
    }
    #pause-menu h2 { margin: 0 0 18px; font-size: 18px; letter-spacing: 0.12em; color: #cde; text-transform: uppercase; }
    #pause-menu[hidden] { display: none !important; }
    #pause-menu .pm-buttons { display: flex; flex-direction: column; gap: 10px; }
    #pause-menu button {
      padding: 10px 20px; border-radius: 8px;
      border: 1px solid #3a4a6a;
      background: linear-gradient(180deg, #2360c4, #1a479a);
      color: #fff; font-family: inherit; font-weight: 600; letter-spacing: 0.05em;
      cursor: pointer; min-width: 200px;
    }
    #pause-menu button.secondary { background: rgba(255,255,255,0.06); border-color: #445a78; }
    #pause-menu button:hover { filter: brightness(1.12); }
    #pause-menu .pm-hint { margin-top: 14px; font-size: 11px; color: #789; }
  `;
  document.head.appendChild(style);

  const btn = document.createElement('button');
  btn.id = 'pause-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Pause');
  btn.setAttribute('aria-pressed', 'false');
  document.body.appendChild(btn);

  const root = document.createElement('div');
  root.id = 'pause-menu';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'pm-heading');
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="pm-card">
      <h2 id="pm-heading">Paused</h2>
      <div class="pm-buttons">
        <button type="button" class="primary" data-action="resume">Resume</button>
        <button type="button" class="secondary" data-action="restart">Restart</button>
        <button type="button" class="secondary" data-action="back">Back to menu</button>
      </div>
      <div class="pm-hint">Press Esc to resume</div>
    </div>
  `;
  document.body.appendChild(root);

  const resumeBtn = root.querySelector<HTMLButtonElement>('[data-action="resume"]')!;
  const restartBtn = root.querySelector<HTMLButtonElement>('[data-action="restart"]')!;
  const backBtn = root.querySelector<HTMLButtonElement>('[data-action="back"]')!;

  let actions: PauseMenuActions | null = null;
  let open = false;
  let onTapToggle: (() => void) | null = null;
  let previouslyFocused: HTMLElement | null = null;

  resumeBtn.addEventListener('click', () => actions?.onResume());
  restartBtn.addEventListener('click', () => actions?.onRestart());
  backBtn.addEventListener('click', () => actions?.onBack());
  btn.addEventListener('click', () => onTapToggle?.());

  // Trap Tab within the dialog while it's open so keyboard focus can't
  // escape onto the (inert) game canvas behind the overlay.
  root.addEventListener('keydown', (e) => {
    if (!open || e.key !== 'Tab') return;
    const focusables = [resumeBtn, restartBtn, backBtn];
    const active = document.activeElement as HTMLElement | null;
    const idx = active ? focusables.indexOf(active as HTMLButtonElement) : -1;
    const nextIdx = e.shiftKey
      ? (idx <= 0 ? focusables.length - 1 : idx - 1)
      : (idx === focusables.length - 1 || idx < 0 ? 0 : idx + 1);
    e.preventDefault();
    focusables[nextIdx]!.focus();
  });

  return {
    setActions(a) {
      actions = a;
      return () => { actions = null; };
    },
    setOnTapToggle(cb) {
      onTapToggle = cb;
    },
    open() {
      open = true;
      previouslyFocused = document.activeElement as HTMLElement | null;
      root.classList.add('open');
      root.setAttribute('aria-hidden', 'false');
      btn.setAttribute('aria-label', 'Resume');
      btn.setAttribute('aria-pressed', 'true');
      resumeBtn.focus();
    },
    close() {
      open = false;
      root.classList.remove('open');
      root.setAttribute('aria-hidden', 'true');
      btn.setAttribute('aria-label', 'Pause');
      btn.setAttribute('aria-pressed', 'false');
      if (previouslyFocused && document.body.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
      previouslyFocused = null;
    },
    get isOpen() { return open; },
    remove() {
      root.remove();
      btn.remove();
      style.remove();
    },
  };
}
