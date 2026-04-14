/**
 * HSV-to-RGB conversion (sectoral form).
 *
 * `h` is in [0, 1] (NOT degrees). `s` and `v` are in [0, 1]. Returns [r, g, b]
 * in [0, 1].
 *
 * Three.js's `Color.setHSL` is HSL not HSV — at `s=1, v=0.8` (the values used
 * by the track color ramp) the two color spaces produce visibly different
 * ramps. We need the HSV ramp.
 */
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  if (s <= 0) return [v, v, v];
  let hh = h - Math.floor(h); // wrap into [0, 1)
  if (hh < 0) hh += 1;
  hh *= 6;
  const i = Math.floor(hh);
  const f = hh - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  switch (i) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}
