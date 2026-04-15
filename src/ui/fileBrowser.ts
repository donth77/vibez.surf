/**
 * Start screen — three ways to load audio + a recently-played list:
 *   1. Pick / drop a local file
 *   2. Paste an audio URL (direct audio file or Suno link)
 *   3. Generate with Suno AI (prompt → proxy → polled audio URL)
 *   4. Click a row in "Recently played" to replay an earlier URL-based song.
 *
 * Handlers are async so they can throw descriptive errors; the browser catches
 * them, surfaces the message inline, and re-enables the UI. A gear button
 * opens the Suno settings modal (stored separately).
 */

import { loadRecentSongs, clearRecentSongs, type RecentSong } from '../util/recentSongs';
import { listStoredAudioIds, clearAllAudioBytes } from '../util/audioBytesStore';
import { isSunoEnabled } from '../suno/sunoClient';

export interface FileBrowserHandlers {
  onFile: (file: File) => Promise<void>;
  onUrl: (url: string) => Promise<void>;
  onSunoPrompt: (prompt: string) => Promise<void>;
  onReplay: (song: RecentSong) => Promise<void>;
  onOpenSunoSettings: () => void;
}

export interface FileBrowser {
  showError(message: string): void;
  clearError(): void;
  /** Hide the browser (game is running). */
  hide(): void;
  /** Re-show the browser (user clicked "Back to menu"). */
  show(): void;
  /** Re-render the "Recently played" list from localStorage. */
  refreshRecents(): void;
  remove(): void;
}

export function mountFileBrowser(h: FileBrowserHandlers): FileBrowser {
  const root = document.createElement('div');
  root.id = 'file-browser';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Start screen');
  root.innerHTML = `
    <main class="fb-card">
      <h1>vibez.surf</h1>
      <p class="fb-sub">Drop an audio file to ride.</p>

      <label class="fb-pick" for="fb-file-input">
        <input id="fb-file-input" class="sr-only" type="file" accept="audio/*" />
        <span>Choose audio file</span>
      </label>
      <p class="fb-hint">MP3 / AAC / OGG / WAV / FLAC — anything your browser can decode.</p>

      <details class="fb-details">
        <summary>Paste a URL</summary>
        <div class="fb-details-body">
          <div class="fb-row">
            <input id="fb-url-input" type="url" placeholder="https://… (direct audio file or Suno link)" autocomplete="off" />
            <button type="button" class="fb-btn" data-action="load-url">Load</button>
          </div>
        </div>
      </details>

      <details class="fb-details" id="fb-suno-details">
        <summary>Generate with Suno AI</summary>
        <div class="fb-details-body">
          <textarea id="fb-prompt" rows="2" placeholder="e.g. upbeat synthwave with a driving bassline" autocomplete="off"></textarea>
          <div class="fb-row fb-row-inline" style="margin-top: 12px; justify-content: space-between;">
            <button type="button" class="fb-btn fb-btn-primary" data-action="generate">Generate</button>
            <button type="button" class="fb-btn fb-btn-icon" data-action="settings" aria-label="Suno settings" title="Paste your Suno cookie">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          </div>
        </div>
      </details>

      <details id="fb-recents-details" class="fb-details" hidden>
        <summary>Recently played</summary>
        <div class="fb-details-body">
          <div id="fb-recents-scroll" class="fb-recents-scroll">
            <ul id="fb-recents-list" class="fb-recents"></ul>
          </div>
          <button type="button" id="fb-recents-clear" class="fb-recents-clear" aria-label="Clear recently played history">Clear history</button>
        </div>
      </details>

      <div id="fb-error" class="fb-error" hidden role="alert"></div>
    </main>

    <a class="fb-github" href="https://github.com/donth77/vibez.surf" target="_blank" rel="noreferrer noopener"
       aria-label="View source on GitHub" title="View source on GitHub">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
      </svg>
    </a>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #file-browser {
      position: fixed; inset: 0; display: grid; place-items: center;
      background: radial-gradient(ellipse at center, #0b1024 0%, #03050a 70%);
      z-index: 10;
      overflow-y: auto; padding: 20px 0;
    }
    #file-browser[hidden] { display: none; }
    .fb-card {
      padding: 36px 44px; border: 1px dashed #2a3550; border-radius: 12px;
      background: rgba(10, 16, 32, 0.6); backdrop-filter: blur(8px);
      text-align: center; min-width: 360px; max-width: 520px;
    }
    .fb-card h1 { margin: 0 0 10px; font-weight: 600; letter-spacing: 0.04em; font-size: 34px; }
    .fb-sub { margin: 0 0 24px; color: #8aa; font-size: 17px; }
    .fb-pick {
      display: inline-block; padding: 14px 28px; border-radius: 8px;
      background: linear-gradient(180deg, #2360c4, #1a479a); cursor: pointer;
      font-weight: 600; letter-spacing: 0.05em; font-size: 17px;
    }
    .fb-pick:hover { filter: brightness(1.1); }
    .fb-pick:focus-within { outline: 2px solid #6cf; outline-offset: 3px; }
    .fb-hint { margin: 14px 0 0; font-size: 14px; color: #8ea0c0; }

    .fb-details {
      margin-top: 18px;
      border-top: 1px solid #2a3550;
      padding-top: 14px;
      text-align: left;
    }
    .fb-details > summary {
      display: flex; align-items: center; gap: 8px;
      cursor: pointer; user-select: none;
      font-size: 14px; letter-spacing: 0.12em;
      color: #8aa; text-transform: uppercase;
      list-style: none;
      padding: 4px 0;
    }
    .fb-details > summary::-webkit-details-marker { display: none; }
    .fb-details > summary::before {
      content: '';
      display: inline-block;
      width: 10px; height: 10px;
      background-color: currentColor;
      -webkit-mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><path d='M3.5 2 L6.5 5 L3.5 8' stroke='black' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>") no-repeat center / contain;
      mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><path d='M3.5 2 L6.5 5 L3.5 8' stroke='black' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>") no-repeat center / contain;
      transition: transform 120ms ease;
      flex-shrink: 0;
    }
    .fb-details[open] > summary::before { transform: rotate(90deg); }
    .fb-details > summary:hover { color: #cde; }
    .fb-details-body { margin-top: 12px; }
    @media (prefers-reduced-motion: reduce) {
      .fb-details > summary::before { transition: none; }
    }

    .fb-row { display: flex; gap: 8px; align-items: stretch; }
    .fb-row-col { flex-direction: column; }
    .fb-row input, .fb-row textarea {
      flex: 1; padding: 12px 14px; border-radius: 6px;
      border: 1px solid #2a3550; background: rgba(0,0,0,0.4);
      color: #fff; font-family: inherit; font-size: 16px;
    }
    .fb-row input:focus, .fb-row textarea:focus { outline: 2px solid #6cf; outline-offset: 2px; }

    /* Suno prompt — natural-language input; dedicated styling distinct from
       the URL row so it reads as "write something" rather than "paste". */
    #fb-prompt {
      display: block; width: 100%; box-sizing: border-box;
      padding: 14px 16px;
      border-radius: 8px;
      border: 1px solid #2a3550;
      background: linear-gradient(180deg, rgba(108,200,255,0.04), rgba(0,0,0,0.35));
      color: #fff;
      font-family: inherit;       /* NOT monospace — it's prose */
      font-size: 17px;
      line-height: 1.45;
      resize: vertical;
      min-height: 76px;
      transition: border-color 120ms ease, box-shadow 120ms ease;
    }
    #fb-prompt::placeholder {
      color: #6a7a95;
      font-style: italic;
    }
    #fb-prompt:focus {
      outline: none;
      border-color: #6cf;
      box-shadow: 0 0 0 3px rgba(108,200,255,0.18);
    }

    .fb-btn {
      padding: 11px 22px; border-radius: 6px;
      border: 1px solid #3a4a6a;
      background: linear-gradient(180deg, #2360c4, #1a479a);
      color: #fff; font-family: inherit; font-weight: 600; letter-spacing: 0.05em;
      cursor: pointer; font-size: 16px;
    }
    .fb-btn:hover:not(:disabled) { filter: brightness(1.12); }
    .fb-btn:disabled { opacity: 0.5; cursor: wait; }
    /* Primary action in a space-between row — take the remaining width so
       the gear can anchor at the far right without the button collapsing. */
    .fb-btn-primary { flex: 1; margin-right: 12px; }
    /* Icon-only variant — matches the primary button's HEIGHT via
       align-self: stretch so the two don't look misaligned. Width is
       fixed, height inherits from the row. */
    .fb-btn-icon {
      width: 44px;
      min-height: 44px;
      padding: 0;
      align-self: stretch;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .fb-btn-icon > svg {
      display: block;
      color: #fff;
    }

    .fb-error {
      margin-top: 16px; padding: 12px 14px;
      background: rgba(200, 60, 60, 0.12); border: 1px solid #802020;
      border-radius: 6px; color: #ff9a9a;
      font-size: 15px; text-align: left; line-height: 1.45;
    }

    /* Recently played list. Hidden entirely when the list is empty.
       The inner scroll container caps height at ~6 rows (~280px) and
       scrolls; the outer <details> body never grows unbounded. */
    .fb-recents-scroll {
      max-height: 280px;
      overflow-y: auto;
      /* Inner scroll gets its own subtle border so it reads as a pane. */
      border: 1px solid rgba(42, 53, 80, 0.6);
      border-radius: 6px;
      padding: 6px;
      background: rgba(0, 0, 0, 0.15);
    }
    .fb-recents-scroll::-webkit-scrollbar { width: 8px; }
    .fb-recents-scroll::-webkit-scrollbar-thumb {
      background: rgba(108, 200, 255, 0.2); border-radius: 4px;
    }
    .fb-recents-scroll::-webkit-scrollbar-thumb:hover {
      background: rgba(108, 200, 255, 0.35);
    }
    .fb-recents { list-style: none; padding: 0; margin: 0; }
    /* Unassuming text-link clear button — aligned right, muted grey,
       underline-on-hover. Deliberately NOT a styled button. */
    .fb-recents-clear {
      display: block;
      margin: 8px 0 0 auto;
      padding: 4px 2px;
      background: none; border: none;
      color: #5a6a85;
      font-family: inherit; font-size: 12px;
      letter-spacing: 0.03em;
      cursor: pointer;
    }
    .fb-recents-clear:hover,
    .fb-recents-clear:focus-visible {
      color: #8ea0c0;
      text-decoration: underline;
      outline: none;
    }
    .fb-recents li {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; border-radius: 6px;
      background: rgba(255,255,255,0.03);
      border: 1px solid transparent;
      transition: background 120ms ease, border-color 120ms ease;
    }
    .fb-recents li + li { margin-top: 6px; }
    .fb-recents li:hover:not(.is-unreplayable) {
      background: rgba(108,200,255,0.08);
      border-color: rgba(108,200,255,0.3);
    }
    .fb-recents .fb-rec-meta { flex: 1; min-width: 0; text-align: left; }
    .fb-recents .fb-rec-title {
      font-size: 14px; font-weight: 500; color: #cde;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .fb-recents .fb-rec-stats {
      margin-top: 2px;
      font-size: 12px; color: #8ea0c0; letter-spacing: 0.02em;
      font-variant-numeric: tabular-nums;
    }
    .fb-recents .fb-rec-stats .miss { color: #ff9a9a; }
    .fb-recents .fb-rec-play {
      flex-shrink: 0;
      width: 34px; height: 34px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      background: linear-gradient(180deg, #2360c4, #1a479a);
      border: 1px solid #3a4a6a;
      color: #fff; cursor: pointer; padding: 0;
    }
    .fb-recents .fb-rec-play:hover { filter: brightness(1.12); }
    /* Row for an entry whose play button is hidden (bytes evicted or
       source not preserved). Kept slightly dimmed as a subtle signal. */
    .fb-recents li.is-unreplayable { opacity: 0.6; }

    /* Unassuming GitHub icon link, bottom-right of the start screen.
       Icon-only; the title attribute provides a hover tooltip, aria-label
       the screen-reader equivalent. 40x40 hit-area meets the touch-target
       guideline on mobile. */
    .fb-github {
      position: fixed;
      bottom: calc(14px + var(--safe-bottom, 0px));
      right:  calc(14px + var(--safe-right, 0px));
      display: inline-flex; align-items: center; justify-content: center;
      width: 40px; height: 40px;
      border-radius: 50%;
      color: #6a7a95;
      text-decoration: none;
      opacity: 0.55;
      transition: opacity 120ms ease, color 120ms ease;
      z-index: 11;
    }
    .fb-github:hover,
    .fb-github:focus-visible { opacity: 1; color: #cde; }
    .fb-github svg { display: block; }

    /* Mobile / narrow-viewport adjustments. The card fills the screen, buttons
       stack full-width, and the font eases up so it's finger-friendly. */
    @media (max-width: 560px) {
      #file-browser { padding: 0; }
      .fb-card {
        padding: 24px 22px;
        min-width: 0;
        max-width: 100vw;
        width: 100%;
        min-height: 100vh;
        border-radius: 0;
        border-left: none;
        border-right: none;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        justify-content: center;
      }
      .fb-card h1 { font-size: 26px; }
      .fb-pick {
        display: block;
        padding: 14px 20px;
        text-align: center;
        font-size: 16px;
      }
      .fb-row { flex-direction: column; gap: 10px; }
      /* Exception: rows marked .fb-row-inline (Generate + gear) stay
         horizontal on mobile so the gear doesn't drop below the button. */
      .fb-row.fb-row-inline { flex-direction: row; align-items: stretch; }
      .fb-row input, .fb-row textarea { font-size: 16px; /* ≥16px avoids iOS zoom */ }
      .fb-btn { padding: 14px 20px; font-size: 16px; }
      .fb-btn-icon { width: 56px; min-height: 56px; align-self: stretch; }
      /* Override the hardcoded width/height="20" attributes on the gear
         SVG — CSS alone isn't always enough because attribute-sized SVGs
         can resist layout in some engines. !important ensures the rule
         wins over the inline sizing. */
      .fb-btn-icon > svg {
        width: 32px !important;
        height: 32px !important;
      }
      #fb-prompt { font-size: 16px; min-height: 80px; }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(root);

  // --- element refs ---
  const fileInput = root.querySelector<HTMLInputElement>('#fb-file-input')!;
  const urlInput = root.querySelector<HTMLInputElement>('#fb-url-input')!;
  const promptEl = root.querySelector<HTMLTextAreaElement>('#fb-prompt')!;
  const urlBtn = root.querySelector<HTMLButtonElement>('[data-action="load-url"]')!;
  const genBtn = root.querySelector<HTMLButtonElement>('[data-action="generate"]')!;
  const settingsBtn = root.querySelector<HTMLButtonElement>('[data-action="settings"]')!;
  const sunoDetails = root.querySelector<HTMLDetailsElement>('#fb-suno-details')!;
  // Hide the Suno-generate section entirely on builds that didn't set
  // VITE_SUNO_API_URL — the feature is inert without it.
  if (!isSunoEnabled()) sunoDetails.hidden = true;
  const errorEl = root.querySelector<HTMLDivElement>('#fb-error')!;
  const recentsDetails = root.querySelector<HTMLDetailsElement>('#fb-recents-details')!;
  const recentsList = root.querySelector<HTMLUListElement>('#fb-recents-list')!;
  const recentsClearBtn = root.querySelector<HTMLButtonElement>('#fb-recents-clear')!;
  const allActionButtons: HTMLButtonElement[] = [urlBtn, genBtn];

  // --- error UI ---
  const showError = (msg: string) => {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  };
  const clearError = () => {
    errorEl.textContent = '';
    errorEl.hidden = true;
  };

  // --- guard that disables buttons + catches errors uniformly ---
  const run = async (fn: () => Promise<void>) => {
    clearError();
    allActionButtons.forEach((b) => (b.disabled = true));
    try {
      await fn();
    } catch (err) {
      const msg = formatError(err);
      console.error('[start-screen]', err);
      showError(msg);
    } finally {
      allActionButtons.forEach((b) => (b.disabled = false));
    }
  };

  // --- file input ---
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    if (!isLikelyAudio(f)) {
      showError(
        `"${f.name}" doesn't look like an audio file (type: ${f.type || 'unknown'}). ` +
        `Expected MP3 / AAC / OGG / WAV / FLAC.`,
      );
      fileInput.value = '';
      return;
    }
    run(() => h.onFile(f));
  });

  // --- URL input ---
  const submitUrl = () => {
    const url = urlInput.value.trim();
    if (!url) {
      showError('Paste a URL first.');
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      showError('URL must start with http:// or https://');
      return;
    }
    run(() => h.onUrl(url));
  };
  urlBtn.addEventListener('click', submitUrl);
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitUrl(); } });

  // --- Suno prompt ---
  genBtn.addEventListener('click', () => {
    const prompt = promptEl.value.trim();
    if (!prompt) {
      showError('Type a prompt first (e.g. "upbeat synthwave").');
      return;
    }
    run(() => h.onSunoPrompt(prompt));
  });
  settingsBtn.addEventListener('click', () => h.onOpenSunoSettings());

  // --- drag / drop on the whole window ---
  const stopAll = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((t) =>
    addEventListener(t, stopAll),
  );
  addEventListener('drop', (e) => {
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (!f) return;
    if (!isLikelyAudio(f)) {
      showError(
        `"${f.name}" doesn't look like an audio file (type: ${f.type || 'unknown'}). ` +
        `Expected MP3 / AAC / OGG / WAV / FLAC.`,
      );
      return;
    }
    run(() => h.onFile(f));
  });

  // --- Recently played ---
  // Cached set of ids whose raw bytes are present in IndexedDB. Used to
  // decide whether a file-entry's play button is shown. Populated async
  // from IndexedDB; the synchronous render reads from the cache so the
  // list appears immediately and re-renders once IDB resolves.
  let storedFileIdsCache: Set<string> = new Set();

  const isReplayable = (s: RecentSong): boolean => {
    if (s.kind === 'file') return storedFileIdsCache.has(s.id);
    if (s.sourceUrl) return true;
    if (s.kind === 'suno-prompt' && s.sourcePrompt) return true;
    return false;
  };

  const renderRecents = () => {
    const songs = loadRecentSongs();
    if (songs.length === 0) {
      recentsDetails.hidden = true;
      recentsList.innerHTML = '';
      return;
    }
    recentsDetails.hidden = false;
    recentsList.innerHTML = songs.map((s, i) => {
      const replayable = isReplayable(s);
      const pct = s.percent.toFixed(1);
      // Unreplayable rows render WITHOUT the play button at all — per the
      // request to hide rather than show-disabled. The row itself still
      // renders with slightly dimmed opacity so the user knows the entry
      // was played but can't be replayed from here.
      const playBtn = replayable
        ? `<button type="button" class="fb-rec-play" data-play="${i}" aria-label="Replay ${escapeAttr(s.title)}">
             <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
           </button>`
        : '';
      return `
        <li class="${replayable ? '' : 'is-unreplayable'}" data-index="${i}">
          <div class="fb-rec-meta">
            <div class="fb-rec-title">${escapeHtml(s.title)}</div>
            <div class="fb-rec-stats">
              ${s.score} pts · ${pct}% · ${s.pickedCount} hit<span class="miss"> · ${s.missedCount} missed</span>
            </div>
          </div>
          ${playBtn}
        </li>`;
    }).join('');
  };

  // Kick an async refresh of the stored-ids cache, then re-render so
  // file-entries with persisted bytes get their play button.
  const refreshStoredIdsAndRender = () => {
    listStoredAudioIds().then((ids) => {
      storedFileIdsCache = ids;
      renderRecents();
    }).catch((err) => {
      console.warn('[fileBrowser] listStoredAudioIds failed', err);
    });
  };

  recentsList.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-play]');
    if (!btn) return;
    const idx = Number(btn.dataset.play);
    const song = loadRecentSongs()[idx];
    if (!song) return;
    run(() => h.onReplay(song));
  });

  recentsClearBtn.addEventListener('click', () => {
    clearRecentSongs();
    // Also clear the stored audio bytes — keeping orphaned bytes after the
    // user explicitly clears history would be surprising.
    clearAllAudioBytes().catch((err) => {
      console.warn('[fileBrowser] clearAllAudioBytes failed', err);
    });
    storedFileIdsCache = new Set();
    renderRecents();
  });

  renderRecents();
  refreshStoredIdsAndRender();

  return {
    showError,
    clearError,
    hide() { root.hidden = true; },
    show() { root.hidden = false; clearError(); refreshStoredIdsAndRender(); },
    refreshRecents() { refreshStoredIdsAndRender(); },
    remove() { root.remove(); style.remove(); },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    c === '&' ? '&amp;' :
    c === '<' ? '&lt;' :
    c === '>' ? '&gt;' :
    c === '"' ? '&quot;' : '&#39;'
  ));
}
function escapeAttr(s: string): string { return escapeHtml(s); }

function isLikelyAudio(f: File): boolean {
  if (f.type.startsWith('audio/')) return true;
  return /\.(mp3|m4a|wav|ogg|flac|aac|opus|oga)$/i.test(f.name);
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    // Unwrap common causes.
    if (err.message.toLowerCase().includes('decodeaudiodata')) {
      return 'That file couldn\'t be decoded as audio — is it really an audio file?';
    }
    if (err.message.includes('HTTP 401') || err.message.includes('HTTP 403')) {
      return 'Authentication failed — your Suno cookie is missing, invalid, or expired. Open Settings and paste a fresh one.';
    }
    if (err.message.includes('HTTP 429')) {
      return 'Rate-limited — try again in a minute.';
    }
    if (err.message.includes('HTTP 5')) {
      return `Server error: ${err.message}. The proxy or remote host may be down.`;
    }
    if (err.message.toLowerCase().includes('cors')) {
      return err.message;
    }
    return err.message;
  }
  return String(err);
}
