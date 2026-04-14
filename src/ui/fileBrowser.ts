export type FilePickedHandler = (file: File) => void;

export function mountFileBrowser(onPicked: FilePickedHandler): void {
  const root = document.createElement('div');
  root.id = 'file-browser';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Start screen');
  root.innerHTML = `
    <main class="fb-card">
      <h1>Vibez.surf</h1>
      <p class="fb-sub">Drop an audio file or pick one to ride.</p>
      <label class="fb-pick" for="fb-file-input">
        <input id="fb-file-input" class="sr-only" type="file" accept="audio/*" />
        <span>Choose audio file</span>
      </label>
      <p class="fb-hint">MP3 / AAC / OGG / WAV / FLAC — anything your browser can decode.</p>
    </main>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #file-browser {
      position: fixed; inset: 0; display: grid; place-items: center;
      background: radial-gradient(ellipse at center, #0b1024 0%, #03050a 70%);
      z-index: 10;
    }
    #file-browser.dragging .fb-card { border-color: #6cf; box-shadow: 0 0 60px rgba(108,200,255,0.5); }
    .fb-card {
      padding: 40px 48px; border: 1px dashed #2a3550; border-radius: 12px;
      background: rgba(10, 16, 32, 0.6); backdrop-filter: blur(8px);
      text-align: center; min-width: 320px; max-width: 460px;
      transition: border-color 120ms ease, box-shadow 120ms ease;
    }
    .fb-card h1 { margin: 0 0 8px; font-weight: 600; letter-spacing: 0.04em; }
    .fb-sub { margin: 0 0 24px; color: #8aa; }
    .fb-pick {
      display: inline-block; padding: 12px 24px; border-radius: 8px;
      background: linear-gradient(180deg, #2360c4, #1a479a); cursor: pointer;
      font-weight: 600; letter-spacing: 0.05em;
    }
    .fb-pick:hover { filter: brightness(1.1); }
    /* Keyboard focus on the visually-hidden input paints a ring on the label
       so sighted keyboard users see where focus is. */
    .fb-pick:focus-within { outline: 2px solid #6cf; outline-offset: 3px; }
    .fb-hint { margin: 18px 0 0; font-size: 12px; color: #8ea0c0; }
  `;
  document.head.appendChild(style);
  document.body.appendChild(root);

  const input = root.querySelector<HTMLInputElement>('input[type="file"]')!;
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) onPicked(f);
  });

  // Drag/drop on the whole window so users don't have to aim.
  const stopAll = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
  ['dragenter', 'dragover'].forEach((t) => addEventListener(t, (e) => {
    stopAll(e);
    root.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach((t) => addEventListener(t, (e) => {
    stopAll(e);
    root.classList.remove('dragging');
  }));
  addEventListener('drop', (e) => {
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (f && f.type.startsWith('audio/')) onPicked(f);
  });
}

export function unmountFileBrowser(): void {
  document.getElementById('file-browser')?.remove();
}
