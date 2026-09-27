/**
 * personalPalette.js
 * ---------------------------------------------------------------------------
 * Roger's ask: "a new section that is a personal palette" — a single,
 * always-visible list of colors, deliberately separate from the multi-
 * palette switcher in the Palette section (see palette.js's PaletteManager,
 * which owns several NAMED, swappable palettes plus the built-in theme
 * ramps). The Personal Palette is just one flat list, meant to be "your own"
 * favorites/working set rather than one of many switchable palettes — it's
 * always on screen, in its own sidebar section, regardless of which
 * PaletteManager palette happens to be active.
 *
 * Persisted two ways, per Roger's follow-up ask ("save the personal palette
 * with the project file"):
 *   - localStorage, same as every other per-browser setting in this app, so
 *     it survives a reload even with no project explicitly saved.
 *   - Embedded directly in Project Save's JSON (see App.serializeProject /
 *     restoreProject in app.js) so it travels WITH a .paeproj file — opening
 *     that file on a different browser/machine brings the palette back too,
 *     which plain localStorage persistence alone could never do.
 *
 * Deliberately much simpler than PaletteManager: no mix sets, no multiple
 * named palettes, no active/inactive selection — just an ordered list of
 * "#rrggbb" strings you add to and remove from directly.
 */

class PersonalPalette {
  constructor(storageKey = 'pixelArtEditor.personalPalette') {
    this.storageKey = storageKey;
    this.colors = this._load();
    this._listeners = [];
  }

  _load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.map(window.PAE.PaletteManager.normalizeHex).filter(Boolean) : [];
    } catch (err) {
      console.warn('PersonalPalette: could not read localStorage, starting fresh.', err);
      return [];
    }
  }

  _persist() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.colors));
    } catch (err) {
      console.warn('PersonalPalette: could not write localStorage (personal palette will not survive reload).', err);
    }
  }

  onChange(fn) {
    this._listeners.push(fn);
  }

  _notify() {
    this._listeners.forEach((fn) => fn(this));
  }

  getColors() {
    return this.colors;
  }

  /** Ignores an exact duplicate (case-insensitive, since normalizeHex already lowercases) rather than piling up repeats of the same swatch. */
  addColor(hex) {
    const normalized = window.PAE.PaletteManager.normalizeHex(hex);
    if (!normalized || this.colors.includes(normalized)) return;
    this.colors.push(normalized);
    this._persist();
    this._notify();
  }

  removeColor(index) {
    if (index < 0 || index >= this.colors.length) return;
    this.colors.splice(index, 1);
    this._persist();
    this._notify();
  }

  /** Wholesale replace — used by Project Open (see App.restoreProject) to load whatever a .paeproj file's own personal palette was, without leaving any of the CURRENT browser's colors mixed in. */
  replaceAll(colors) {
    this.colors = (colors || []).map(window.PAE.PaletteManager.normalizeHex).filter(Boolean);
    this._persist();
    this._notify();
  }
}

window.PAE = window.PAE || {};
window.PAE.PersonalPalette = PersonalPalette;
