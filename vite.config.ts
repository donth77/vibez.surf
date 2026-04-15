import { defineConfig, type Plugin } from 'vite';

/**
 * Inject a Content-Security-Policy + sibling security headers into the
 * production HTML only. Dev is skipped because Vite's HMR client relies on
 * inline scripts, which a strict `script-src 'self'` would block.
 *
 * `style-src` keeps `'unsafe-inline'` because several UI modules inject a
 * <style> element at mount time (sunoSettings, pauseMenu, etc.). Scripts
 * are the higher-value target for CSP, so locking those to 'self' is the
 * real win; stylesheet-XSS has a much narrower blast radius.
 *
 * `connect-src` / `media-src` use `https:` rather than an explicit list
 * because users can paste arbitrary audio URLs. Scripts, objects, and
 * frame-ancestors remain tightly locked down.
 */
function cspPlugin(): Plugin {
  return {
    name: 'vibez-csp',
    apply: 'build',
    transformIndexHtml(html) {
      const csp = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob: https:",
        "connect-src 'self' https:",
        "worker-src 'self' blob:",
        "font-src 'self' data:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "object-src 'none'",
        "form-action 'none'",
      ].join('; ');
      const tags = [
        `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
        `<meta name="referrer" content="no-referrer">`,
        // Permissions-Policy meta is a limited subset of the header, but it
        // still short-circuits the most sensitive permissions for this app.
        `<meta http-equiv="Permissions-Policy" content="camera=(), microphone=(), geolocation=(), payment=(), usb=()">`,
      ].join('\n    ');
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    ${tags}`);
    },
  };
}

export default defineConfig({
  server: { port: 5173, open: false },
  build: { target: 'es2022', sourcemap: true },
  plugins: [cspPlugin()],
});
