/**
 * colorHistory.js
 * ---------------------------------------------------------------------------
 * A running, most-recent-first list of colors that have actually become the
 * active drawing color (palette clicks, the eyedropper, picking a Mix grid
 * cell — see App.setBaseColor/pickMixedColor, the only two places that
 * call `record()`). Persisted to localStorage like PaletteManager, but
 * kept as its own separate class/key since it's tracking usage, not
 * authored content — clearing your history shouldn't touch your palettes,
 * and vice versa.
 */

class ColorHistory {
  constructor(maxLength = 24, storageKey = 'pixelArtEditor.colorHistory') {
    this.maxLength = maxLength;
    this.storageKey = storageKey;
    this.colors = this._load();
    this._listeners = [];
  }

  _load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((h) => window.PAE.PaletteManager.normalizeHex(h)) : [];
    } catch (err) {
      console.warn('ColorHistory: could not read localStorage, starting fresh.', err);
      return [];
    }
  }

  _persist() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.colors));
    } catch (err) {
      console.warn('ColorHistory: could not write localStorage (history will not survive reload).', err);
    }
  }

  onChange(fn) {
    this._listeners.push(fn);
  }

  _notify() {
    this._listeners.forEach((fn) => fn(this));
  }

  /** Move-to-front: a color used again jumps back to the top instead of duplicating. */
  record(hex) {
    const normalized = window.PAE.PaletteManager.normalizeHex(hex);
    if (!normalized) return;
    this.colors = this.colors.filter((c) => c !== normalized);
    this.colors.unshift(normalized);
    if (this.colors.length > this.maxLength) this.colors.length = this.maxLength;
    this._persist();
    this._notify();
  }

  getColors() {
    return this.colors;
  }

  clear() {
    this.colors = [];
    this._persist();
    this._notify();
  }
}

window.PAE = window.PAE || {};
window.PAE.ColorHistory = ColorHistory;
