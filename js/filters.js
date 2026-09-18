/**
 * filters.js
 * ---------------------------------------------------------------------------
 * Basic whole-image adjustment filters for the Effects menu. Every function
 * mutates a PixelBuffer IN PLACE (matching how the rest of this app treats
 * PixelBuffer — see pixelBuffer.js) and skips fully transparent pixels, so
 * a filter never "invents" color on blank canvas or fades edges toward some
 * arbitrary background. Applied to the ACTIVE LAYER of the current frame
 * (see app.js's applyGrayscale/applyInvert/commitBrightnessContrast/
 * commitHueSaturation) — a deliberate choice now that layers exist: a
 * filter changes one layer's paint, not everything stacked underneath it.
 */

const Filters = {
  /** Standard luminosity-weighted grayscale (keeps alpha untouched). */
  grayscale(buffer) {
    const d = buffer.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const l = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      d[i] = l;
      d[i + 1] = l;
      d[i + 2] = l;
    }
  },

  /** Inverts every RGB channel (255 - value); alpha untouched. */
  invert(buffer) {
    const d = buffer.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      d[i] = 255 - d[i];
      d[i + 1] = 255 - d[i + 1];
      d[i + 2] = 255 - d[i + 2];
    }
  },

  /**
   * @param {PAE.PixelBuffer} buffer
   * @param {number} brightness  -100..100
   * @param {number} contrast    -100..100
   */
  brightnessContrast(buffer, brightness, contrast) {
    const b = brightness * 2.55; // scale the friendlier -100..100 UI range to -255..255
    const c = Math.max(-255, Math.min(255, contrast * 2.55));
    const factor = (259 * (c + 255)) / (255 * (259 - c));
    const d = buffer.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      for (let k = 0; k < 3; k++) {
        const v = factor * (d[i + k] - 128) + 128 + b;
        d[i + k] = Math.max(0, Math.min(255, v));
      }
    }
  },

  /**
   * @param {PAE.PixelBuffer} buffer
   * @param {number} hueDegrees  -180..180, added to each pixel's hue
   * @param {number} saturationPercent  -100..100 -> a 0..2 multiplier on saturation
   */
  hueSaturation(buffer, hueDegrees, saturationPercent) {
    const satMul = 1 + saturationPercent / 100;
    const d = buffer.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const [h, s, l] = Filters._rgbToHsl(d[i], d[i + 1], d[i + 2]);
      let nh = (h + hueDegrees / 360) % 1;
      if (nh < 0) nh += 1;
      const ns = Math.max(0, Math.min(1, s * satMul));
      const [r, g, bl] = Filters._hslToRgb(nh, ns, l);
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = bl;
    }
  },

  /** @returns {[number, number, number]} h, s, l each 0-1 */
  _rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    return [h / 6, s, l];
  },

  /** @returns {[number, number, number]} r, g, b each 0-255 */
  _hslToRgb(h, s, l) {
    if (s === 0) {
      const v = Math.round(l * 255);
      return [v, v, v];
    }
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [Math.round(hue2rgb(p, q, h + 1 / 3) * 255), Math.round(hue2rgb(p, q, h) * 255), Math.round(hue2rgb(p, q, h - 1 / 3) * 255)];
  },
};

window.PAE = window.PAE || {};
window.PAE.Filters = Filters;
