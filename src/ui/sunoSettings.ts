/**
 * Settings modal for Suno AI generation. BYOK — each user pastes their own
 * Suno session cookie. The cookie is stored in the browser's localStorage
 * and sent to the proxy as the `X-Suno-Cookie` header on generation
 * requests. The proxy URL itself is baked in at build time via the
 * deployer's `VITE_SUNO_API_URL` env var — users never see or configure it.
 *
 * Cookies expire every few weeks; when that happens the user gets a 401
 * from the proxy and must open this modal to paste a fresh one.
 */

import {
  loadSunoToken, saveSunoToken, clearSunoToken,
  loadSunoModel, saveSunoModel,
  SUNO_MODELS, type SunoModelId,
} from '../suno/sunoClient';

export interface SunoSettingsModal {
  open(): void;
  close(): void;
  onSave(cb: (token: string) => void): void;
  remove(): void;
}

export function mountSunoSettingsModal(): SunoSettingsModal {
  const style = document.createElement('style');
  style.textContent = `
    #suno-settings {
      position: fixed; inset: 0;
      display: none; place-items: center;
      background: rgba(0,0,0,0.65); backdrop-filter: blur(6px);
      z-index: 22;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #fff;
    }
    #suno-settings.open { display: grid; }
    #suno-settings .ss-card {
      padding: 28px 36px; border-radius: 12px;
      background: rgba(14, 20, 38, 0.95);
      border: 1px solid #2a3550;
      min-width: 380px; max-width: 520px;
      box-shadow: 0 10px 60px rgba(0,0,0,0.6);
    }
    #suno-settings h2 { margin: 0 0 8px; font-size: 16px; letter-spacing: 0.18em; color: #8aa; text-transform: uppercase; }
    #suno-settings .ss-hint { margin: 0 0 18px; font-size: 14px; color: #8ea0c0; line-height: 1.55; }
    #suno-settings label { display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: #9ab; margin: 14px 0 6px; letter-spacing: 0.05em; }
    #suno-settings .ss-reveal {
      background: none; border: none; padding: 2px 4px; cursor: pointer;
      color: #8aa; display: inline-flex; align-items: center;
    }
    #suno-settings .ss-reveal:hover { color: #cde; }
    #suno-settings .ss-reveal svg { display: block; }
    /* Icon reflects CURRENT state (not the action):
       - visible → open eye (you can see it)
       - masked  → crossed eye (it's hidden) */
    #suno-settings .ss-reveal[data-state="visible"] .ss-icon-show { display: block; }
    #suno-settings .ss-reveal[data-state="visible"] .ss-icon-hide { display: none; }
    #suno-settings .ss-reveal[data-state="masked"]  .ss-icon-show { display: none; }
    #suno-settings .ss-reveal[data-state="masked"]  .ss-icon-hide { display: block; }
    #suno-settings code {
      background: rgba(255,255,255,0.06); padding: 2px 5px;
      border-radius: 3px; font-size: 13px;
    }
    #suno-settings input, #suno-settings select {
      width: 100%; box-sizing: border-box;
      padding: 10px 12px; border-radius: 6px;
      border: 1px solid #2a3550; background: rgba(0,0,0,0.4);
      color: #fff; font-family: inherit; font-size: 14px;
    }
    #suno-settings input:focus, #suno-settings select:focus { outline: 2px solid #6cf; outline-offset: 2px; }
    #suno-settings select { appearance: none; cursor: pointer; }
    #suno-settings .ss-buttons { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
    #suno-settings button {
      padding: 10px 20px; border-radius: 6px;
      border: 1px solid #3a4a6a;
      background: linear-gradient(180deg, #2360c4, #1a479a);
      color: #fff; font-family: inherit; font-weight: 600; letter-spacing: 0.05em;
      cursor: pointer; font-size: 15px;
    }
    #suno-settings button.secondary { background: rgba(255,255,255,0.06); border-color: #445a78; }
    #suno-settings button:hover { filter: brightness(1.12); }
    /* Narrow-viewport: fill the screen, bump touch targets to ≥44px,
       ≥16px inputs so iOS doesn't zoom on focus. */
    @media (max-width: 560px) {
      #suno-settings { padding: 0; align-items: stretch; }
      #suno-settings.open { display: block; }
      #suno-settings .ss-card {
        min-width: 0; max-width: 100vw; width: 100%;
        min-height: 100vh; border-radius: 0;
        padding: 28px 22px;
        box-sizing: border-box;
        display: flex; flex-direction: column;
      }
      #suno-settings h2 { font-size: 15px; }
      #suno-settings .ss-hint { font-size: 14px; }
      #suno-settings input { font-size: 16px; padding: 12px 14px; }
      #suno-settings .ss-reveal { padding: 10px; min-width: 44px; min-height: 44px; justify-content: center; }
      #suno-settings .ss-reveal svg { width: 20px; height: 20px; }
      #suno-settings button { padding: 14px 22px; font-size: 16px; }
      #suno-settings .ss-buttons { margin-top: auto; padding-top: 24px; flex-wrap: wrap; }
    }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'suno-settings';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'ss-heading');
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="ss-card">
      <h2 id="ss-heading">Suno AI</h2>
      <p class="ss-hint">
        Paste your Suno session cookie to enable AI song generation. It's
        stored only in your browser's localStorage and sent only to the
        vibez.surf generation proxy via the <code>X-Suno-Cookie</code>
        header.
      </p>
      
      <p class="ss-hint" style="margin-top: 12px;">
        To get it: open <a href="https://suno.com" target="_blank"
        rel="noreferrer" style="color:#6cf">suno.com</a> logged in →
        DevTools (F12) → Network tab → refresh → click any request with
        <code>__clerk_api_version</code> in its URL → Headers → Request
        Headers → right-click the <code>cookie:</code> value → Copy value.
      </p>

      <label for="ss-token">
        Suno cookie
        <button type="button" class="ss-reveal" data-action="reveal" data-state="masked" aria-label="Show cookie" title="Show cookie">
          <svg class="ss-icon-show" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          <svg class="ss-icon-hide" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
        </button>
      </label>
      <input id="ss-token" type="password" placeholder="paste cookie value from suno.com DevTools" autocomplete="off"
             spellcheck="false" data-1p-ignore data-lpignore="true" />

      <label for="ss-model">Model</label>
      <select id="ss-model">
        ${SUNO_MODELS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('')}
      </select>

      <div class="ss-buttons">
        <button type="button" class="secondary" data-action="clear">Clear</button>
        <button type="button" class="secondary" data-action="cancel">Cancel</button>
        <button type="button" class="primary" data-action="save">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const tokenEl = root.querySelector<HTMLInputElement>('#ss-token')!;
  const modelEl = root.querySelector<HTMLSelectElement>('#ss-model')!;
  const revealBtn = root.querySelector<HTMLButtonElement>('[data-action="reveal"]')!;
  revealBtn.addEventListener('click', () => {
    const isMasked = tokenEl.type === 'password';
    tokenEl.type = isMasked ? 'text' : 'password';
    revealBtn.dataset.state = isMasked ? 'visible' : 'masked';
    revealBtn.setAttribute('aria-label', isMasked ? 'Hide cookie' : 'Show cookie');
    revealBtn.setAttribute('title', isMasked ? 'Hide cookie' : 'Show cookie');
  });
  const saveBtn = root.querySelector<HTMLButtonElement>('[data-action="save"]')!;
  const cancelBtn = root.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
  const clearBtn = root.querySelector<HTMLButtonElement>('[data-action="clear"]')!;

  let onSaveCb: ((token: string) => void) | null = null;

  const loadIntoForm = () => {
    tokenEl.value = loadSunoToken() ?? '';
    tokenEl.type = 'password'; // always masked on open
    modelEl.value = loadSunoModel();
  };

  const close = () => {
    root.classList.remove('open');
    root.setAttribute('aria-hidden', 'true');
  };

  saveBtn.addEventListener('click', () => {
    const token = tokenEl.value.trim();
    if (token) {
      saveSunoToken(token);
      onSaveCb?.(token);
    }
    // Model is always saved (even if cookie empty) so users who skip
    // the cookie input for now don't lose their selection.
    saveSunoModel(modelEl.value as SunoModelId);
    close();
  });
  cancelBtn.addEventListener('click', () => close());
  clearBtn.addEventListener('click', () => {
    if (!confirm('Clear your saved Suno cookie?')) return;
    clearSunoToken();
    loadIntoForm();
  });

  return {
    open() {
      loadIntoForm();
      root.classList.add('open');
      root.setAttribute('aria-hidden', 'false');
      tokenEl.focus();
    },
    close,
    onSave(cb) { onSaveCb = cb; },
    remove() { root.remove(); style.remove(); },
  };
}
