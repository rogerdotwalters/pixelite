/**
 * colorMixer.js
 * ---------------------------------------------------------------------------
 * The "Mix" sidebar section's data model. Pure color math — no DOM here; see
 * ui.js's initColorMixer() for the wiring.
 *
 * Concept: `base` is the color sitting in the center of a 3x3 grid — set
 * only by picking a palette swatch or using the eyedropper tool, NEVER by
 * clicking a cell inside this grid (that just changes the app's current
 * drawing color, via App.pickMixedColor — see app.js). The 4 edge cells
 * (top/bottom/left/right) blend `base` toward one of 4 user-editable
 * "modifier" colors; the 4 corner cells blend `base` toward the AVERAGE of
 * the two modifiers on either side of that corner, so the grid reads as a
 * continuous gradient around the base color rather than 8 unrelated swatches.
 *
 *   top=red, left=white, base=orange, mixAmount=0.35  =>
 *     top cell     = orange shifted toward red   (a red-orange)
 *     left cell    = orange shifted toward white (a lighter orange)
 *     top-left     = orange shifted toward the red/white average (a salmon-orange)
 */

class ColorMixer {
  constructor() {
    this.base = '#000000';
    // Defaults: white above/left (as if lit from the top-left), black
    // below/right (shadow side) — arbitrary but gives a sensible starting
    // gradient before the user customizes any of the four.
    this.modifiers = { top: '#ffffff', bottom: '#000000', left: '#ffffff', right: '#000000' };
    this.mixAmount = 0.35; // 0-1, how strongly modifiers pull the edge/corner cells away from base
    this._listeners = [];
  }

  onChange(fn) {
    this._listeners.push(fn);
  }

  _notify() {
    this._listeners.forEach((fn) => fn(this));
  }

  /** Re-centers the whole grid on a new base color. Only palette picks / the eyedropper should call this. */
  setBase(hex) {
    const normalized = window.PAE.PaletteManager.normalizeHex(hex);
    if (!normalized) return;
    this.base = normalized;
    this._notify();
  }

  setModifier(direction, hex) {
    const normalized = window.PAE.PaletteManager.normalizeHex(hex);
    if (!normalized || !(direction in this.modifiers)) return;
    this.modifiers[direction] = normalized;
    this._notify();
  }

  setMixAmount(amount) {
    this.mixAmount = Math.max(0, Math.min(1, amount));
    this._notify();
  }

  /**
   * Loads a saved "mix set" (see palette.js's PaletteManager.addMixSet) —
   * the 4 modifiers plus the mix amount that was in effect when it was
   * saved — in one notification instead of 5. Deliberately does NOT touch
   * `base`: a mix set is a reusable shading recipe, meant to be applied to
   * whatever base color you currently have, not a snapshot tied to one.
   */
  applyRecipe({ top, bottom, left, right, mixAmount }) {
    const normalizeHex = window.PAE.PaletteManager.normalizeHex;
    const nTop = normalizeHex(top);
    const nBottom = normalizeHex(bottom);
    const nLeft = normalizeHex(left);
    const nRight = normalizeHex(right);
    if (nTop) this.modifiers.top = nTop;
    if (nBottom) this.modifiers.bottom = nBottom;
    if (nLeft) this.modifiers.left = nLeft;
    if (nRight) this.modifiers.right = nRight;
    if (typeof mixAmount === 'number') this.mixAmount = Math.max(0, Math.min(1, mixAmount));
    this._notify();
  }

  /**
   * Returns the 3x3 grid as hex strings, row-major:
   *   [[topLeft, top, topRight], [left, base, right], [bottomLeft, bottom, bottomRight]]
   * The center is always exactly `this.base`, unmixed.
   */
  getGrid() {
    const hexToRgb = window.PAE.PaletteManager.hexToRgb;
    const baseRgb = hexToRgb(this.base);
    const mod = {
      top: hexToRgb(this.modifiers.top),
      bottom: hexToRgb(this.modifiers.bottom),
      left: hexToRgb(this.modifiers.left),
      right: hexToRgb(this.modifiers.right),
    };
    const t = this.mixAmount;
    const edge = (modRgb) => ColorMixer._rgbToHex(ColorMixer._lerp(baseRgb, modRgb, t));
    const corner = (modRgbA, modRgbB) => {
      const avg = [0, 1, 2].map((i) => (modRgbA[i] + modRgbB[i]) / 2);
      return ColorMixer._rgbToHex(ColorMixer._lerp(baseRgb, avg, t));
    };

    return [
      [corner(mod.top, mod.left), edge(mod.top), corner(mod.top, mod.right)],
      [edge(mod.left), this.base, edge(mod.right)],
      [corner(mod.bottom, mod.left), edge(mod.bottom), corner(mod.bottom, mod.right)],
    ];
  }

  static _lerp(a, b, t) {
    return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
  }

  static _rgbToHex(rgb) {
    return (
      '#' +
      rgb
        .map((v) =>
          Math.max(0, Math.min(255, Math.round(v)))
            .toString(16)
            .padStart(2, '0')
        )
        .join('')
    );
  }
}

window.PAE = window.PAE || {};
window.PAE.ColorMixer = ColorMixer;
