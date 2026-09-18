/**
 * palette.js
 * ---------------------------------------------------------------------------
 * PaletteManager owns the list of named palettes and persists them to
 * localStorage. It has no idea the UI or canvas exist — ui.js reads from it
 * and re-renders whenever it changes.
 *
 * A palette's `colors` array holds TWO kinds of entries, side by side:
 *   - a solid color: plain string "#rrggbb"
 *   - a mix set: { type: 'mix', name, top, bottom, left, right, mixAmount }
 *     i.e. everything colorMixer.js's ColorMixer needs to reproduce that
 *     exact grid later via applyRecipe() — a reusable shading "recipe" you
 *     can apply to any base color, not a snapshot of one particular base.
 * `PaletteManager.isMixSet(entry)` tells the two apart; ui.js's swatch grid
 * renders/handles each differently but keeps them in the one list, same as
 * a real palette holding whatever colors AND recipes you've saved.
 *
 * Data shape kept in localStorage:
 *   [{ id, name, colors: [ "#rrggbb" | {type:'mix', ...}, ... ] }, ...]
 */

class PaletteManager {
  constructor(storageKey = 'pixelArtEditor.palettes') {
    this.storageKey = storageKey;
    this.palettes = this._load();
    if (!this.palettes.length) this._seedDefaults();
    this._seedThemePalettesOnce();
    this.activePaletteId = this.palettes[0].id;
    this.activeColor = this.palettes[0].colors[0] || '#000000';
    this._listeners = [];
  }

  // ---- persistence -------------------------------------------------------

  _load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn('PaletteManager: could not read localStorage, starting fresh.', err);
      return [];
    }
  }

  _persist() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.palettes));
    } catch (err) {
      console.warn('PaletteManager: could not write localStorage (palettes will not survive reload).', err);
    }
  }

  _seedDefaults() {
    this.palettes = [
      {
        id: PaletteManager._uid(),
        name: 'Default',
        colors: ['#000000', '#ffffff', '#808080', '#e63946', '#f4a261', '#e9c46a', '#2a9d8f', '#264653'],
      },
      {
        id: PaletteManager._uid(),
        name: 'Pastel',
        colors: ['#ffd6e0', '#ffefcf', '#c9f0d8', '#c9e4ff', '#e0c9ff', '#fff1c1'],
      },
    ];
    this._persist();
  }

  static _uid() {
    return 'p_' + Math.random().toString(36).slice(2, 10);
  }

  /**
   * A library of ready-made, themed shading ramps (dark shadow -> light
   * highlight, the standard shape a pixel artist reaches for when tiling
   * terrain or shading a sprite) covering common biomes/materials plus a
   * few pure hue ramps. Added on top of whatever palettes already exist —
   * see `_seedThemePalettesOnce` below — rather than folding into
   * `_seedDefaults`, since these should show up for existing users too,
   * not just on a brand-new install.
   */
  static get THEME_PALETTES() {
    return [
      { name: 'Dirt', colors: ['#2b1d12', '#4a2f1c', '#6b4423', '#8b5a2f', '#a9713c', '#c48f52', '#e0b579'] },
      { name: 'Stone', colors: ['#17181a', '#2e3033', '#46484c', '#5f6165', '#797b80', '#97999e', '#c1c3c8'] },
      { name: 'Desert', colors: ['#4a3722', '#6e5330', '#967a45', '#bfa066', '#dcc189', '#eeddb0', '#f8f0d8'] },
      { name: 'Grass', colors: ['#17330e', '#235016', '#326b1f', '#4a8a2c', '#6bab3f', '#93c85f', '#c3e88a'] },
      { name: 'Forest', colors: ['#0f2118', '#16321f', '#204429', '#2d5a35', '#3d7442', '#568f52', '#7bab67'] },
      { name: 'Lava', colors: ['#2b0806', '#5c0f08', '#8c1c0d', '#c22e0e', '#e85d12', '#f79420', '#ffce54'] },
      { name: 'Snow', colors: ['#47607a', '#6f89a3', '#95b0c8', '#b9d0e0', '#d6e6f0', '#eef6fb', '#ffffff'] },
      { name: 'Rainbow', colors: ['#e63946', '#f4813f', '#f9d342', '#4caf50', '#2f80ed', '#4b3f8f', '#9b59b6'] },
      { name: 'Ashland', colors: ['#14100f', '#2a2422', '#423b3a', '#5c5452', '#766e6d', '#948c8a', '#c9622a', '#e0895a'] },
      { name: 'Meadow', colors: ['#3f6b1f', '#5c9331', '#7fbb4a', '#a8d873', '#d7ecab', '#f2e14c', '#f2789f'] },
      { name: 'Yellows', colors: ['#4d3b00', '#7a5f00', '#a88300', '#d1a900', '#f0c419', '#f7d84a', '#fbe98c'] },
      { name: 'Blue', colors: ['#0a1e3f', '#123a66', '#1c5b94', '#2b7fc0', '#4aa3dd', '#7cc3ea', '#b8e2f5'] },
      { name: 'Greens', colors: ['#0b2e1a', '#144a28', '#1f6b39', '#2f8f4c', '#4bb563', '#7cd08a', '#b8e8bd'] },
      { name: 'Oranges', colors: ['#3d1a00', '#6b2e00', '#9c4400', '#cf5f0e', '#f0812a', '#f7a352', '#fbc98a'] },
    ];
  }

  /**
   * Adds any of THEME_PALETTES the user doesn't already have (matched by
   * name, case-insensitively, so a palette they renamed or made themselves
   * under the same name is left alone) — but only the FIRST time this ever
   * runs for this browser, tracked via a separate localStorage flag. That
   * one-time gate matters: without it, a themed palette the user
   * deliberately deleted (e.g. they don't want "Lava") would just come
   * back on the next reload, since "doesn't already have a palette named
   * Lava" would be true again. Existing palettes/colors are never touched.
   */
  _seedThemePalettesOnce() {
    const flagKey = this.storageKey + '.themesSeededV1';
    try {
      if (localStorage.getItem(flagKey) === '1') return;
    } catch (err) {
      // Can't tell if we've seeded before (e.g. private browsing blocking
      // reads too) — fall through and seed; the name check below still
      // prevents duplicates within this run.
    }
    const existingNames = new Set(this.palettes.map((p) => (p.name || '').toLowerCase()));
    for (const theme of PaletteManager.THEME_PALETTES) {
      if (existingNames.has(theme.name.toLowerCase())) continue;
      this.palettes.push({ id: PaletteManager._uid(), name: theme.name, colors: theme.colors.slice() });
    }
    this._persist();
    try {
      localStorage.setItem(flagKey, '1');
    } catch (err) {
      // Best effort. If this write fails, we may re-run this seeding logic
      // on the next load — still safe, since the name check above just
      // no-ops for anything the user hasn't deleted, and re-adds nothing
      // for anything they have (as long as it's still absent by name).
    }
  }

  // ---- subscriptions -------------------------------------------------------

  onChange(fn) {
    this._listeners.push(fn);
  }

  _notify() {
    for (const fn of this._listeners) fn(this);
  }

  // ---- palette CRUD -------------------------------------------------------

  getPalettes() {
    return this.palettes;
  }

  getActivePalette() {
    return this.palettes.find((p) => p.id === this.activePaletteId) || this.palettes[0];
  }

  setActivePalette(id) {
    if (!this.palettes.some((p) => p.id === id)) return;
    this.activePaletteId = id;
    this._notify();
  }

  createPalette(name) {
    const palette = { id: PaletteManager._uid(), name: name || 'New Palette', colors: [] };
    this.palettes.push(palette);
    this.activePaletteId = palette.id;
    this._persist();
    this._notify();
    return palette;
  }

  renamePalette(id, newName) {
    const palette = this.palettes.find((p) => p.id === id);
    if (!palette || !newName) return;
    palette.name = newName;
    this._persist();
    this._notify();
  }

  deletePalette(id) {
    if (this.palettes.length <= 1) return; // always keep at least one palette
    this.palettes = this.palettes.filter((p) => p.id !== id);
    if (this.activePaletteId === id) this.activePaletteId = this.palettes[0].id;
    this._persist();
    this._notify();
  }

  // ---- color CRUD -------------------------------------------------------

  addColor(paletteId, hex) {
    const palette = this.palettes.find((p) => p.id === paletteId);
    if (!palette) return;
    const normalized = PaletteManager.normalizeHex(hex);
    if (!normalized) return;
    palette.colors.push(normalized);
    this._persist();
    this._notify();
  }

  removeColor(paletteId, index) {
    const palette = this.palettes.find((p) => p.id === paletteId);
    if (!palette) return;
    palette.colors.splice(index, 1); // works for a solid color OR a mix set — both just live in this array
    this._persist();
    this._notify();
  }

  /** Saves a reusable shading recipe (see the header comment) into a palette, alongside its solid colors. */
  addMixSet(paletteId, mixSet) {
    const palette = this.palettes.find((p) => p.id === paletteId);
    if (!palette) return;
    const cleaned = PaletteManager._cleanMixSet(mixSet);
    if (!cleaned) return;
    palette.colors.push(cleaned);
    this._persist();
    this._notify();
    return cleaned;
  }

  static isMixSet(entry) {
    return !!entry && typeof entry === 'object' && entry.type === 'mix';
  }

  /** Validates/normalizes a mix set object; returns null if any required color is invalid. */
  static _cleanMixSet(entry) {
    if (!PaletteManager.isMixSet(entry)) return null;
    const top = PaletteManager.normalizeHex(entry.top);
    const bottom = PaletteManager.normalizeHex(entry.bottom);
    const left = PaletteManager.normalizeHex(entry.left);
    const right = PaletteManager.normalizeHex(entry.right);
    if (!top || !bottom || !left || !right) return null; // all 4 are required for a repeatable mix
    const mixAmount = typeof entry.mixAmount === 'number' ? Math.max(0, Math.min(1, entry.mixAmount)) : 0.35;
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : 'Mix Set';
    return { type: 'mix', name, top, bottom, left, right, mixAmount };
  }

  /** One cleaner for either kind of `colors` entry — used by importAll below. */
  static _cleanColorEntry(entry) {
    if (typeof entry === 'string') return PaletteManager.normalizeHex(entry);
    return PaletteManager._cleanMixSet(entry);
  }

  // ---- current drawing color ---------------------------------------------

  setActiveColor(hex) {
    const normalized = PaletteManager.normalizeHex(hex);
    if (!normalized) return;
    this.activeColor = normalized;
    this._notify();
  }

  getActiveColor() {
    return this.activeColor;
  }

  // ---- import / export (Palettes > Save/Load palette set) ----------------

  exportAll() {
    return JSON.stringify(this.palettes, null, 2);
  }

  importAll(json, { replace = false } = {}) {
    let incoming;
    try {
      incoming = JSON.parse(json);
    } catch (err) {
      throw new Error('That file is not valid palette JSON.');
    }
    if (!Array.isArray(incoming)) throw new Error('Expected a list of palettes.');
    const cleaned = incoming
      .filter((p) => p && typeof p.name === 'string' && Array.isArray(p.colors))
      .map((p) => ({
        id: PaletteManager._uid(), // always assign fresh ids to avoid collisions
        name: p.name,
        colors: p.colors.map(PaletteManager._cleanColorEntry).filter(Boolean),
      }));
    if (!cleaned.length) throw new Error('No valid palettes found in that file.');
    this.palettes = replace ? cleaned : this.palettes.concat(cleaned);
    this.activePaletteId = cleaned[0].id;
    this._persist();
    this._notify();
  }

  // ---- helpers -------------------------------------------------------

  /** Accepts "#fff", "fff", "#ffffff", "ffffff" -> returns "#rrggbb" lowercase, or null if invalid. */
  static normalizeHex(hex) {
    if (typeof hex !== 'string') return null;
    let h = hex.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(h)) {
      h = h
        .split('')
        .map((c) => c + c)
        .join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return '#' + h.toLowerCase();
  }

  static hexToRgb(hex) {
    const normalized = PaletteManager.normalizeHex(hex) || '#000000';
    const num = parseInt(normalized.slice(1), 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }
}

window.PAE = window.PAE || {};
window.PAE.PaletteManager = PaletteManager;
