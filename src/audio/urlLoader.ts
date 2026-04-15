import { loadAudioFromArrayBuffer, type LoadedAudio } from './audioLoader';

/**
 * Loads audio from a user-supplied URL into the game.
 *
 * Supports any URL whose response has an `audio/*` MIME type (mp3, m4a,
 * ogg, wav, flac, Suno CDN links, Dropbox public links, etc.). The server
 * must send CORS headers (`Access-Control-Allow-Origin`).
 *
 * YouTube / SoundCloud / other streaming-page URLs are NOT supported — they
 * require a server-side resolver (cobalt etc.) which in practice gets
 * blocked by the streaming services from any free cloud host. Users should
 * paste a direct audio URL or use a Suno link instead.
 */
export async function loadAudioFromUrl(
  url: string,
  onProgress?: (fraction: number) => void,
): Promise<LoadedAudio> {
  return fetchAndDecode(url.trim(), onProgress);
}

async function fetchAndDecode(
  url: string,
  onProgress?: (fraction: number) => void,
): Promise<LoadedAudio> {
  let res: Response;
  try {
    res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  } catch (err) {
    // Most common failure mode: CORS.
    throw new Error(
      `Failed to fetch "${url}". ` +
      `This usually means the server doesn't allow cross-origin requests (CORS). ` +
      `Try a URL from a host that sets Access-Control-Allow-Origin (e.g. Suno CDN).`,
      { cause: err as Error },
    );
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get('content-type') ?? 'audio/mpeg';
  if (!/^audio\//i.test(contentType) && !/\.(mp3|m4a|wav|ogg|flac|aac)(\?|$)/i.test(url)) {
    throw new Error(
      `URL returned "${contentType}" — expected an audio file. ` +
      `Paste a direct audio link (e.g. ending in .mp3) or a Suno link.`,
    );
  }

  const contentLength = Number(res.headers.get('content-length') ?? 0);
  const body = res.body;
  let arrayBuffer: ArrayBuffer;

  if (contentLength > 0 && body && onProgress) {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        onProgress(Math.min(1, received / contentLength));
      }
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    arrayBuffer = merged.buffer;
  } else {
    arrayBuffer = await res.arrayBuffer();
    onProgress?.(1);
  }

  return loadAudioFromArrayBuffer(arrayBuffer, contentType);
}
