/**
 * vbrushPipeline.js
 * ---------------------------------------------------------------------------
 * The V Brush's node pipeline: an ordered, top-to-bottom list of nodes that
 * reshape the single per-pixel "value" the brush is about to paint. This
 * file has two halves:
 *
 *   1. `PerlinNoise` + `VBrushPipeline` — pure computation, no DOM. Given a
 *      node list and a starting scalar seed, runs every node in order and
 *      returns a final [r,g,b]. See vBrushTool.js for how/when this gets
 *      called (only when the pipeline has at least one node — an empty
 *      pipeline keeps the brush's original, simpler behavior untouched).
 *   2. `initVBrushPipelinePanel(app)` — wires the `#vbrush-pipeline-dialog`:
 *      renders the node list (plus a live preview canvas), and handles
 *      add/remove/reorder/param edits and the "Clear Output" reset.
 *      Self-contained, same pattern as layersPanel.js / selectionOverlay.js:
 *      it owns its own DOM elements end to end rather than routing through
 *      ui.js.
 *
 * The pipeline's value starts as a single tagged union, `{kind, v}` (a
 * scalar 0..1) or `{kind, rgb}` (a color) — every node declares what it
 * needs and coerces the incoming value if it doesn't already match
 * (`_toScalar`/`_toColor`), so nodes can be inserted in ANY order without
 * the pipeline ever breaking; if the list ends on a scalar (no Palette Pick,
 * Color Ramp, or Color Clamp node ran), the final value is still converted
 * to a color via the same reduced-palette lookup the brush would otherwise
 * use.
 *
 * Node types:
 *   noise   — Perlin Noise (fbm), blended into the current value.
 *   brick   — procedural brick-and-mortar texture, blended in the same way.
 *   wood    — procedural wood-grain rings (noise-warped sine bands).
 *   math    — add/multiply/power/abs-fold/sine/remap on the scalar.
 *   ramp    — Color Ramp: mixes between an ordered list of color stops.
 *   palette — converts the current value into a color from the reduced Mix
 *             palette.
 *   clamp   — Color Clamp: bounds each RGB channel to a min/max range.
 */

// ---- Perlin noise -----------------------------------------------------

/**
 * Classic (Ken Perlin's original, gradient-based) 2D Perlin noise, seeded
 * so the SAME seed always produces the SAME noise field — required for
 * repainting the same spot to look stable rather than flickering, matching
 * every other "no Math.random" deterministic-hash convention in this app.
 */
class PerlinNoise {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.perm = PerlinNoise._buildPermutation(this.seed);
  }

  /** A 512-entry permutation table shuffled by a seeded PRNG (mulberry32 — small, fast, decent distribution). */
  static _buildPermutation(seed) {
    let a = seed || 1;
    function rand() {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    const perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    return perm;
  }

  static _fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  static _lerp(t, a, b) {
    return a + t * (b - a);
  }

  /** 8-direction gradient (enough for smooth 2D noise, cheaper than the classic 12-direction table). */
  static _grad(hash, x, y) {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return (h & 1 ? -u : u) + (h & 2 ? -2 * v : 2 * v);
  }

  /** Raw 2D Perlin noise at (x, y), roughly in -1..1. */
  noise2D(x, y) {
    const perm = this.perm;
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = PerlinNoise._fade(xf);
    const v = PerlinNoise._fade(yf);
    const aa = perm[perm[X] + Y];
    const ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y];
    const bb = perm[perm[X + 1] + Y + 1];
    const x1 = PerlinNoise._lerp(u, PerlinNoise._grad(aa, xf, yf), PerlinNoise._grad(ba, xf - 1, yf));
    const x2 = PerlinNoise._lerp(u, PerlinNoise._grad(ab, xf, yf - 1), PerlinNoise._grad(bb, xf - 1, yf - 1));
    return PerlinNoise._lerp(v, x1, x2);
  }

  /** Fractal Brownian motion: `octaves` layers of noise at doubling frequency and `persistence`-scaled amplitude, normalized back to roughly -1..1. */
  fbm(x, y, octaves, persistence) {
    let total = 0;
    let amplitude = 1;
    let maxAmplitude = 0;
    let freq = 1;
    const n = Math.max(1, Math.round(octaves));
    for (let i = 0; i < n; i++) {
      total += this.noise2D(x * freq, y * freq) * amplitude;
      maxAmplitude += amplitude;
      amplitude *= persistence;
      freq *= 2;
    }
    return maxAmplitude > 0 ? total / maxAmplitude : 0;
  }
}

// ---- Pipeline engine ----------------------------------------------------

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}
function clampRange(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
function remap(v, inMin, inMax, outMin, outMax) {
  if (inMax === inMin) return outMin;
  const t = (v - inMin) / (inMax - inMin);
  return outMin + t * (outMax - outMin);
}
/** Small deterministic hash → 0..1, used by the brick/wood texture nodes for their per-tile/per-ring variation. Independent of VBrushTool's own pixel hash so this file has no load-order dependency on it. */
function hash01(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h ^= h >>> 16;
  return (Math.abs(h) % 100000) / 99999;
}
/** Blends a freshly-computed 0..1 `norm` value into the pipeline's running scalar `input`, per the node's chosen Blend mode. Shared by noise/brick/wood so all three texture nodes behave consistently. */
function blendScalar(mode, input, norm) {
  if (mode === 'add') return clamp01(input + (norm - 0.5));
  if (mode === 'multiply') return clamp01(input * norm * 2);
  return norm; // 'replace' (default)
}
/**
 * Standard rounded-rectangle point test: is (px, py) inside the rect
 * [x0,x1]x[y0,y1] once its four corners are rounded off with radius `r`?
 * Clamp the point into the rect shrunk by `r` on every side, then check
 * whether it's still within `r` of that clamped point — the textbook
 * approach, and cheap enough to run per pixel. Used by the Brick Texture
 * node's "Corner Radius" control to round off each stone's corners.
 */
function insideRoundedRect(px, py, x0, y0, x1, y1, r) {
  if (r <= 0) return px >= x0 && px <= x1 && py >= y0 && py <= y1;
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  const cx = clampRange(px, x0 + r, x1 - r);
  const cy = clampRange(py, y0 + r, y1 - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

const VBrushPipeline = {
  NODE_TYPES: ['noise', 'brick', 'wood', 'math', 'ramp', 'palette', 'clamp'],
  NODE_LABELS: {
    noise: 'Perlin Noise',
    brick: 'Brick Texture',
    wood: 'Wood Grain',
    math: 'Math',
    ramp: 'Color Ramp',
    palette: 'Palette Pick',
    clamp: 'Color Clamp',
  },

  _nextId: 1,
  _perlinCache: new Map(),

  /** Fresh node of `type` with sensible defaults. Each node gets a unique `id` for React-free DOM keying (see the panel below). */
  createNode(type) {
    const id = 'n' + VBrushPipeline._nextId++;
    switch (type) {
      case 'noise':
        return { id, type, params: { scale: 0.15, octaves: 3, persistence: 0.5, seed: Math.floor(Math.random() * 10000), blend: 'replace' } };
      case 'brick':
        return {
          id,
          type,
          params: {
            brickWidth: 10,
            brickHeight: 5,
            mortarThickness: 1,
            rowOffset: 0.5,
            contrast: 0.5,
            blend: 'replace',
            // Seamless tiling: when on, Width/Height stop being raw pixel
            // sizes and instead become "how many bricks fit across the
            // canvas" — see the 'brick' case in _applyNode.
            seamless: false,
            widthIncrements: 8,
            heightIncrements: 6,
            // Variation controls.
            cornerRadius: 0,
            waviness: 0,
            waveFrequency: 1.5,
            mortarNoise: 0,
            stoneGrain: 0.15,
          },
        };
      case 'wood':
        return { id, type, params: { ringScale: 0.12, turbulence: 0.35, seed: Math.floor(Math.random() * 10000), blend: 'replace' } };
      case 'math':
        return { id, type, params: { op: 'add', amount: 0.1, remapInMin: 0, remapInMax: 1, remapOutMin: 0, remapOutMax: 1 } };
      case 'ramp':
        return {
          id,
          type,
          params: {
            stops: [
              { pos: 0, color: [24, 22, 32] },
              { pos: 1, color: [232, 228, 208] },
            ],
          },
        };
      case 'palette':
        return { id, type, params: {} };
      case 'clamp':
        return { id, type, params: { rMin: 0, rMax: 255, gMin: 0, gMax: 255, bMin: 0, bMax: 255 } };
      default:
        throw new Error('Unknown V Brush node type: ' + type);
    }
  },

  _getPerlin(seed) {
    let p = VBrushPipeline._perlinCache.get(seed);
    if (!p) {
      p = new PerlinNoise(seed);
      VBrushPipeline._perlinCache.set(seed, p);
    }
    return p;
  },

  _toScalar(cur) {
    if (cur.kind === 'scalar') return cur.v;
    const [r, g, b] = cur.rgb;
    return (r * 0.299 + g * 0.587 + b * 0.114) / 255;
  },

  _paletteLookup(v, paletteColors) {
    if (!paletteColors.length) return [0, 0, 0];
    const idx = Math.min(paletteColors.length - 1, Math.max(0, Math.floor(clamp01(v) * paletteColors.length)));
    return paletteColors[idx];
  },

  _toColor(cur, paletteColors) {
    if (cur.kind === 'color') return cur.rgb;
    return VBrushPipeline._paletteLookup(cur.v, paletteColors);
  },

  _applyNode(node, cur, x, y, paletteColors, canvasSize) {
    switch (node.type) {
      case 'noise': {
        const perlin = VBrushPipeline._getPerlin(node.params.seed);
        const raw = perlin.fbm(x * node.params.scale, y * node.params.scale, node.params.octaves, node.params.persistence); // ~ -1..1
        const norm = clamp01((raw + 1) / 2);
        const input = VBrushPipeline._toScalar(cur);
        return { kind: 'scalar', v: blendScalar(node.params.blend, input, norm) };
      }
      case 'brick': {
        const p = node.params;
        // Seamless mode: derive the brick size FROM the canvas's actual
        // pixel dimensions (Width/Height sliders become "how many bricks
        // fit across" instead of a raw pixel size) so a whole number of
        // bricks always exactly tiles the canvas — no half-brick cut off
        // at the edge, so the painted result repeats seamlessly when the
        // canvas itself is tiled. Falls back to the raw pixel sizes if no
        // canvas size was passed in (e.g. an older caller).
        let bw, bh;
        if (p.seamless && canvasSize && canvasSize.width > 0 && canvasSize.height > 0) {
          bw = canvasSize.width / Math.max(1, Math.round(p.widthIncrements));
          bh = canvasSize.height / Math.max(1, Math.round(p.heightIncrements));
        } else {
          bw = Math.max(2, p.brickWidth);
          bh = Math.max(2, p.brickHeight);
        }

        const row = Math.floor(y / bh);
        const shiftedX = x - (((row % 2) + 2) % 2) * (p.rowOffset * bw);
        const localX = ((shiftedX % bw) + bw) % bw;
        const localY = ((y - row * bh) % bh + bh) % bh;
        const brickCol = Math.floor(shiftedX / bw);

        // "Wavy Stones": the straight left/top mortar edges become sine
        // waves instead — amplitude from Waviness, cycles-per-edge from
        // Wave Frequency, with a per-brick hash-based phase offset so
        // neighboring bricks don't all wobble in lockstep.
        let leftEdge = p.mortarThickness;
        let topEdge = p.mortarThickness;
        if (p.waviness > 0) {
          const amp = p.waviness * Math.max(0.5, p.mortarThickness) * 1.5;
          const phaseA = hash01(brickCol, row) * Math.PI * 2;
          const phaseB = hash01(row, brickCol) * Math.PI * 2;
          leftEdge += Math.sin((localY / bh) * Math.PI * 2 * p.waveFrequency + phaseA) * amp;
          topEdge += Math.sin((localX / bw) * Math.PI * 2 * p.waveFrequency + phaseB) * amp;
        }

        let inMortar = localX < leftEdge || localY < topEdge;
        // "Rounded Corners": once inside the stone area, cut the four
        // corners off with a rounded-rect test (radius clamped so it can
        // never exceed half the brick, which would otherwise carve past
        // the opposite edge).
        if (!inMortar && p.cornerRadius > 0) {
          const r = Math.min(p.cornerRadius, bw / 2, bh / 2);
          inMortar = !insideRoundedRect(localX, localY, p.mortarThickness, p.mortarThickness, bw, bh, r);
        }

        let shade;
        if (inMortar) {
          // "Mortar Noise": subtle per-pixel jitter instead of a perfectly flat joint color.
          const jitter = p.mortarNoise > 0 ? (hash01(x, y) - 0.5) * p.mortarNoise * 0.3 : 0;
          shade = clamp01(0.12 + jitter);
        } else {
          // Contrast varies shade PER BRICK (every pixel of one stone shares a base shade);
          // Stone Grain layers a finer PER PIXEL jitter on top for texture.
          const brickShade = 0.5 + (hash01(brickCol, row) - 0.5) * p.contrast * 1.6;
          const grain = p.stoneGrain > 0 ? (hash01(x, y) - 0.5) * p.stoneGrain * 0.4 : 0;
          shade = clamp01(brickShade + grain);
        }
        const input = VBrushPipeline._toScalar(cur);
        return { kind: 'scalar', v: blendScalar(p.blend, input, shade) };
      }
      case 'wood': {
        const { ringScale, turbulence, seed, blend } = node.params;
        const perlin = VBrushPipeline._getPerlin(seed);
        const warp = perlin.fbm(x * ringScale * 0.5, y * ringScale * 0.5, 3, 0.5); // -1..1, low-freq warp
        const dist = Math.sqrt(x * x + y * y * 4) * ringScale + warp * turbulence * 6;
        const rings = Math.sin(dist);
        const norm = clamp01((rings + 1) / 2);
        const input = VBrushPipeline._toScalar(cur);
        return { kind: 'scalar', v: blendScalar(blend, input, norm) };
      }
      case 'math': {
        const v0 = VBrushPipeline._toScalar(cur);
        let v;
        switch (node.params.op) {
          case 'add':
            v = v0 + node.params.amount;
            break;
          case 'multiply':
            v = v0 * node.params.amount;
            break;
          case 'power':
            v = Math.pow(Math.max(0, v0), node.params.amount);
            break;
          case 'abs':
            v = Math.abs(v0 - 0.5) * 2; // "fold" around the midpoint
            break;
          case 'sine':
            v = (Math.sin(v0 * Math.PI * 2 * node.params.amount) + 1) / 2;
            break;
          case 'remap':
            v = remap(v0, node.params.remapInMin, node.params.remapInMax, node.params.remapOutMin, node.params.remapOutMax);
            break;
          default:
            v = v0;
        }
        return { kind: 'scalar', v: clamp01(v) };
      }
      case 'ramp': {
        const v0 = VBrushPipeline._toScalar(cur);
        const stops = (node.params.stops || []).slice().sort((a, b) => a.pos - b.pos);
        if (!stops.length) return cur;
        if (v0 <= stops[0].pos) return { kind: 'color', rgb: stops[0].color.slice() };
        const lastStop = stops[stops.length - 1];
        if (v0 >= lastStop.pos) return { kind: 'color', rgb: lastStop.color.slice() };
        for (let i = 0; i < stops.length - 1; i++) {
          const a = stops[i];
          const b = stops[i + 1];
          if (v0 >= a.pos && v0 <= b.pos) {
            const t = b.pos === a.pos ? 0 : (v0 - a.pos) / (b.pos - a.pos);
            return {
              kind: 'color',
              rgb: [
                Math.round(a.color[0] + (b.color[0] - a.color[0]) * t),
                Math.round(a.color[1] + (b.color[1] - a.color[1]) * t),
                Math.round(a.color[2] + (b.color[2] - a.color[2]) * t),
              ],
            };
          }
        }
        return { kind: 'color', rgb: lastStop.color.slice() };
      }
      case 'palette': {
        const v0 = VBrushPipeline._toScalar(cur);
        return { kind: 'color', rgb: VBrushPipeline._paletteLookup(v0, paletteColors) };
      }
      case 'clamp': {
        const rgb0 = cur.kind === 'color' ? cur.rgb : [cur.v * 255, cur.v * 255, cur.v * 255];
        const { rMin, rMax, gMin, gMax, bMin, bMax } = node.params;
        return {
          kind: 'color',
          rgb: [clampRange(rgb0[0], rMin, rMax), clampRange(rgb0[1], gMin, gMax), clampRange(rgb0[2], bMin, bMax)],
        };
      }
      default:
        return cur;
    }
  },

  /**
   * Runs every node in `nodes` (top to bottom) starting from `seedScalar`
   * (the brush's normal deterministic per-pixel hash, 0..1) and returns a
   * final [r,g,b], falling back to a plain palette lookup if the pipeline
   * never itself produced a color. `canvasSize` (`{width, height}`) is
   * optional and only read by nodes that need the actual document size —
   * currently just the Brick Texture node's Seamless Tiling mode.
   */
  run(nodes, seedScalar, x, y, paletteColors, canvasSize) {
    let cur = { kind: 'scalar', v: seedScalar };
    for (const node of nodes) {
      cur = VBrushPipeline._applyNode(node, cur, x, y, paletteColors, canvasSize);
    }
    return VBrushPipeline._toColor(cur, paletteColors);
  },
};

window.PAE = window.PAE || {};
window.PAE.PerlinNoise = PerlinNoise;
window.PAE.VBrushPipeline = VBrushPipeline;

// ---- Presets (save/load a WHOLE node list by name) ---------------------

/**
 * Persists named V Brush pipelines to localStorage — the "save/load-a-
 * recipe" feature flagged as a gap in earlier rounds, same idea as the
 * color Mix section's "Save as Mix Set…" (palette.js's PaletteManager)
 * but for the pipeline's node list instead of a color-mixing recipe, and
 * kept in its own storage key since a pipeline preset isn't tied to any
 * one color palette. Same defensive try/catch-around-localStorage shape
 * as PaletteManager, for the same reasons (private browsing, quota, etc.
 * can all make localStorage throw).
 */
const VBrushPresetStore = {
  storageKey: 'pixelArtEditor.vbrushPresets',

  _load() {
    try {
      const raw = localStorage.getItem(VBrushPresetStore.storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn('VBrushPresetStore: could not read localStorage, starting fresh.', err);
      return [];
    }
  },

  _persist(presets) {
    try {
      localStorage.setItem(VBrushPresetStore.storageKey, JSON.stringify(presets));
    } catch (err) {
      console.warn('VBrushPresetStore: could not write localStorage (preset will not survive reload).', err);
    }
  },

  /** `[{id, name, nodes}, ...]`, most-recently-saved last. */
  list() {
    return VBrushPresetStore._load();
  },

  /**
   * Saves a DEEP-CLONED snapshot of `nodes` under `name` (so later edits
   * to the live pipeline never mutate an already-saved preset). Saving
   * under a name that already exists (case-insensitive) overwrites that
   * preset in place rather than piling up duplicates — same behavior
   * users already expect from the Mix Set / palette naming prompts.
   */
  save(name, nodes) {
    const presets = VBrushPresetStore._load();
    const cleanName = (name || '').trim() || 'Preset';
    const snapshot = JSON.parse(JSON.stringify(nodes));
    const existingIndex = presets.findIndex((p) => p.name.toLowerCase() === cleanName.toLowerCase());
    const entry = { id: existingIndex >= 0 ? presets[existingIndex].id : 'preset' + Date.now() + Math.floor(Math.random() * 1000), name: cleanName, nodes: snapshot };
    if (existingIndex >= 0) presets[existingIndex] = entry;
    else presets.push(entry);
    VBrushPresetStore._persist(presets);
    return entry;
  },

  /**
   * Returns a fresh deep clone of the named preset's nodes with BRAND-NEW
   * node ids (via the same `_nextId` counter `createNode` uses), so
   * loading a preset never collides with ids already in the live
   * pipeline. Returns `null` if the preset no longer exists (e.g. deleted
   * from another tab).
   */
  load(id) {
    const found = VBrushPresetStore._load().find((p) => p.id === id);
    if (!found) return null;
    return found.nodes.map((n) => ({ id: 'n' + VBrushPipeline._nextId++, type: n.type, params: JSON.parse(JSON.stringify(n.params)) }));
  },

  remove(id) {
    VBrushPresetStore._persist(VBrushPresetStore._load().filter((p) => p.id !== id));
  },
};

window.PAE.VBrushPresetStore = VBrushPresetStore;

// ---- Pipeline dialog (DOM wiring) --------------------------------------

function initVBrushPipelinePanel(app) {
  const dialog = document.getElementById('vbrush-pipeline-dialog');
  const list = document.getElementById('vbrush-node-list');
  const hint = document.getElementById('vbrush-pipeline-hint');
  const addType = document.getElementById('vbrush-add-type');
  const addBtn = document.getElementById('vbrush-add-node-btn');
  const clearBtn = document.getElementById('vbrush-clear-pipeline');
  const closeBtn = document.getElementById('vbrush-pipeline-close');
  const openBtn = document.getElementById('vbrush-pipeline-open');
  const previewCanvas = document.getElementById('vbrush-preview-canvas');
  const previewCtx = previewCanvas ? previewCanvas.getContext('2d') : null;
  const presetSelect = document.getElementById('vbrush-preset-select');
  const presetLoadBtn = document.getElementById('vbrush-preset-load-btn');
  const presetDeleteBtn = document.getElementById('vbrush-preset-delete-btn');
  const presetSaveBtn = document.getElementById('vbrush-preset-save-btn');

  function rgbToHex(rgb) {
    const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + c(rgb[0]) + c(rgb[1]) + c(rgb[2]);
  }

  /** Called after every param edit (slider drag, color pick, add/remove) so the preview canvas always reflects the pipeline as it currently stands. */
  function notify() {
    renderPreview();
  }

  /**
   * Draws the pipeline's output over a tile of "fake canvas" pixels using
   * the exact same math VBrushTool._dab uses per-pixel (same hash, same
   * VBrushPipeline.run call) — so what's shown here is a true preview of
   * the texture the brush will paint, not just an approximation. Always
   * drawn fully opaque regardless of the Opacity slider so the pattern
   * itself stays easy to read.
   *
   * Sized off the REAL document's current pixel width/height (`app.buffer`)
   * rather than a fixed square swatch: anything that reasons about the
   * whole canvas — Seamless Brick Texture's "fit exactly N bricks across
   * the canvas" math above all — needs the preview's aspect ratio and
   * scale to match the real document, or the preview can show a different
   * number of tiles than will actually appear once painted. A wide sprite
   * strip previews wide, a tall one previews tall, a square canvas stays
   * square. `RENDER_CAP` only bounds how many pixels get looped over per
   * redraw (so a very large document doesn't redo a huge loop on every
   * slider drag) — sampling still reads real canvas coordinates via
   * `sampleScale`, so the texture itself (brick size, noise scale, etc.)
   * still matches what painting on the real canvas will produce.
   * `DISPLAY_BOX` keeps the on-screen swatch a consistent compact size
   * regardless of the real document's size, via CSS scaling — the canvas's
   * own pixel buffer stays at (up to `RENDER_CAP`) real resolution.
   */
  function renderPreview() {
    if (!previewCtx) return;
    const VBrushTool = window.PAE.VBrushTool;
    if (!VBrushTool) return; // shouldn't happen once boot finishes, but keep the panel from crashing if load order ever changes
    let rawColors = [];
    try {
      rawColors = app.colorMixer && app.colorMixer.getGrid ? app.colorMixer.getGrid().flat().map(window.PAE.PaletteManager.hexToRgb) : [];
    } catch (e) {
      rawColors = [];
    }
    const maxColors = app.vbrushColorLimit || 8;
    const palette = VBrushTool._reducePalette(rawColors.length ? rawColors : [[60, 60, 60]], maxColors);
    const nodes = app.vbrushPipeline.nodes;

    const realW = (app.buffer && app.buffer.width) || 32;
    const realH = (app.buffer && app.buffer.height) || 32;
    const RENDER_CAP = 128;
    const sampleScale = Math.min(1, RENDER_CAP / Math.max(realW, realH));
    const renderW = Math.max(1, Math.round(realW * sampleScale));
    const renderH = Math.max(1, Math.round(realH * sampleScale));
    if (previewCanvas.width !== renderW) previewCanvas.width = renderW;
    if (previewCanvas.height !== renderH) previewCanvas.height = renderH;
    const DISPLAY_BOX = 96;
    const displayScale = DISPLAY_BOX / Math.max(renderW, renderH);
    previewCanvas.style.width = Math.round(renderW * displayScale) + 'px';
    previewCanvas.style.height = Math.round(renderH * displayScale) + 'px';

    const canvasSize = { width: realW, height: realH };
    const imageData = previewCtx.createImageData(renderW, renderH);
    for (let py = 0; py < renderH; py++) {
      for (let px = 0; px < renderW; px++) {
        // Map each preview pixel back to the real canvas coordinate it
        // represents, so per-pixel hashing/noise/brick math lines up with
        // what would actually be painted at that spot.
        const x = Math.min(realW - 1, Math.floor(px / sampleScale));
        const y = Math.min(realH - 1, Math.floor(py / sampleScale));
        let color;
        if (nodes.length) {
          const seed = (VBrushTool._hash(x, y) % 1000) / 999;
          color = VBrushPipeline.run(nodes, seed, x, y, palette, canvasSize);
        } else {
          color = palette[VBrushTool._hash(x, y) % palette.length];
        }
        const idx = (py * renderW + px) * 4;
        imageData.data[idx] = color[0];
        imageData.data[idx + 1] = color[1];
        imageData.data[idx + 2] = color[2];
        imageData.data[idx + 3] = 255;
      }
    }
    previewCtx.putImageData(imageData, 0, 0);
  }

  function numberField(labelText, value, step, min, max, onInput) {
    const wrap = document.createElement('label');
    wrap.className = 'vbrush-field';
    const span = document.createElement('span');
    span.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'number';
    input.value = value;
    if (step !== undefined) input.step = step;
    if (min !== undefined) input.min = min;
    if (max !== undefined) input.max = max;
    input.addEventListener('input', () => {
      onInput(Number(input.value));
      notify();
    });
    wrap.appendChild(span);
    wrap.appendChild(input);
    return wrap;
  }

  /**
   * A slider (range input) with a small readout of its current value —
   * used wherever a control should be adjustable by dragging rather than
   * by typing into a spinner (Perlin Noise's params, the new texture
   * nodes). `opts.decimals` controls the readout's precision and
   * `opts.button` appends an extra control (e.g. the Seed field's "reroll"
   * die) into the same row instead of stacking it below.
   */
  function sliderField(labelText, value, step, min, max, onInput, opts) {
    opts = opts || {};
    const wrap = document.createElement('label');
    wrap.className = 'vbrush-field';
    const span = document.createElement('span');
    span.textContent = labelText;
    const row = document.createElement('div');
    row.className = 'vbrush-field-row';
    const input = document.createElement('input');
    input.type = 'range';
    input.step = step;
    input.min = min;
    input.max = max;
    input.value = value;
    const decimals = opts.decimals !== undefined ? opts.decimals : step < 1 ? 2 : 0;
    const valueLabel = document.createElement('span');
    valueLabel.className = 'vbrush-range-value';
    valueLabel.textContent = Number(value).toFixed(decimals);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      valueLabel.textContent = v.toFixed(decimals);
      onInput(v);
      notify();
    });
    row.appendChild(input);
    row.appendChild(valueLabel);
    if (opts.button) row.appendChild(opts.button);
    wrap.appendChild(span);
    wrap.appendChild(row);
    return { wrap, input, valueLabel };
  }

  function selectField(labelText, value, options, onChange) {
    const wrap = document.createElement('label');
    wrap.className = 'vbrush-field';
    const span = document.createElement('span');
    span.textContent = labelText;
    const select = document.createElement('select');
    options.forEach(([optValue, optLabel]) => {
      const opt = document.createElement('option');
      opt.value = optValue;
      opt.textContent = optLabel;
      if (optValue === value) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => {
      onChange(select.value);
      notify();
    });
    wrap.appendChild(span);
    wrap.appendChild(select);
    return wrap;
  }

  /**
   * A checkbox with its label on the same row (e.g. Brick Texture's
   * "Seamless Tiling" toggle). `onChange` fires with the new boolean; the
   * caller decides whether flipping it needs a full `render()` (it does
   * here, since it swaps Width/Height for Bricks Across/Brick Rows).
   */
  function checkboxField(labelText, checked, onChange) {
    const wrap = document.createElement('label');
    wrap.className = 'vbrush-field vbrush-checkbox-field';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => {
      onChange(input.checked);
      notify();
    });
    const span = document.createElement('span');
    span.textContent = labelText;
    wrap.appendChild(input);
    wrap.appendChild(span);
    return wrap;
  }

  /**
   * A labeled group for the Color Clamp node: one color-picker swatch that
   * sets/reads all three channels at once, plus a slider per channel for
   * fine independent adjustment — both stay in sync with each other and
   * with `node.params`.
   */
  function clampColorGroup(labelText, node, keys) {
    const group = document.createElement('div');
    group.className = 'vbrush-clamp-group';

    const heading = document.createElement('span');
    heading.className = 'vbrush-clamp-group-label';
    heading.textContent = labelText;
    group.appendChild(heading);

    const swatchRow = document.createElement('div');
    swatchRow.className = 'vbrush-clamp-swatch-row';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'vbrush-color-swatch';
    colorInput.title = labelText + ' — sets R, G and B together';
    colorInput.value = rgbToHex([node.params[keys[0]], node.params[keys[1]], node.params[keys[2]]]);
    swatchRow.appendChild(colorInput);
    group.appendChild(swatchRow);

    const sliderBuilts = ['R', 'G', 'B'].map((ch, i) =>
      sliderField(
        ch,
        node.params[keys[i]],
        1,
        0,
        255,
        (v) => {
          node.params[keys[i]] = v;
          colorInput.value = rgbToHex([node.params[keys[0]], node.params[keys[1]], node.params[keys[2]]]);
        },
        { decimals: 0 }
      )
    );
    sliderBuilts.forEach((built) => group.appendChild(built.wrap));

    colorInput.addEventListener('input', () => {
      const rgb = window.PAE.PaletteManager.hexToRgb(colorInput.value);
      keys.forEach((k, i) => {
        node.params[k] = rgb[i];
      });
      sliderBuilts.forEach((built, i) => {
        built.input.value = rgb[i];
        built.valueLabel.textContent = String(rgb[i]);
      });
      notify();
    });

    return group;
  }

  function buildNodeControls(node) {
    const controls = document.createElement('div');
    controls.className = 'vbrush-node-controls';

    if (node.type === 'noise' || node.type === 'wood') {
      const isWood = node.type === 'wood';
      controls.appendChild(
        sliderField(isWood ? 'Ring Scale' : 'Scale', isWood ? node.params.ringScale : node.params.scale, 0.01, 0.01, 2, (v) => {
          if (isWood) node.params.ringScale = v;
          else node.params.scale = v;
        }).wrap
      );
      if (isWood) {
        controls.appendChild(
          sliderField('Turbulence', node.params.turbulence, 0.05, 0, 1, (v) => {
            node.params.turbulence = v;
          }).wrap
        );
      } else {
        controls.appendChild(
          sliderField('Octaves', node.params.octaves, 1, 1, 6, (v) => {
            node.params.octaves = Math.round(v);
          }).wrap
        );
        controls.appendChild(
          sliderField('Persistence', node.params.persistence, 0.05, 0, 1, (v) => {
            node.params.persistence = v;
          }).wrap
        );
      }
      const rerollBtn = document.createElement('button');
      rerollBtn.type = 'button';
      rerollBtn.className = 'vbrush-reroll-btn';
      rerollBtn.title = 'Randomize the seed (new noise pattern, still deterministic once set)';
      rerollBtn.textContent = '\u{1F3B2}'; // 🎲
      const seedField = sliderField('Seed', node.params.seed, 1, 0, 9999, (v) => {
        node.params.seed = Math.round(v);
      }, { decimals: 0, button: rerollBtn });
      rerollBtn.addEventListener('click', () => {
        node.params.seed = Math.floor(Math.random() * 10000);
        seedField.input.value = node.params.seed;
        seedField.valueLabel.textContent = String(node.params.seed);
        notify();
      });
      controls.appendChild(seedField.wrap);
      controls.appendChild(
        selectField(
          'Blend',
          node.params.blend,
          [
            ['replace', 'Replace'],
            ['add', 'Add'],
            ['multiply', 'Multiply'],
          ],
          (v) => {
            node.params.blend = v;
          }
        )
      );
    } else if (node.type === 'brick') {
      controls.appendChild(
        checkboxField('Seamless Tiling (fit to canvas)', node.params.seamless, (v) => {
          node.params.seamless = v;
          render(); // Width/Height <-> Bricks Across/Brick Rows swap needs its own re-render
        })
      );

      if (node.params.seamless) {
        controls.appendChild(
          sliderField('Bricks Across', node.params.widthIncrements, 1, 1, 40, (v) => {
            node.params.widthIncrements = Math.round(v);
          }, { decimals: 0 }).wrap
        );
        controls.appendChild(
          sliderField('Brick Rows', node.params.heightIncrements, 1, 1, 40, (v) => {
            node.params.heightIncrements = Math.round(v);
          }, { decimals: 0 }).wrap
        );
        const seamlessNote = document.createElement('div');
        seamlessNote.className = 'vbrush-node-note';
        seamlessNote.textContent = 'Brick size is derived from the canvas size so a whole number of bricks always fits exactly — the pattern tiles with no cut-off half-bricks at the edge.';
        controls.appendChild(seamlessNote);
      } else {
        controls.appendChild(
          sliderField('Brick Width', node.params.brickWidth, 1, 2, 32, (v) => {
            node.params.brickWidth = Math.round(v);
          }, { decimals: 0 }).wrap
        );
        controls.appendChild(
          sliderField('Brick Height', node.params.brickHeight, 1, 2, 32, (v) => {
            node.params.brickHeight = Math.round(v);
          }, { decimals: 0 }).wrap
        );
      }

      controls.appendChild(
        sliderField('Mortar', node.params.mortarThickness, 1, 0, 6, (v) => {
          node.params.mortarThickness = Math.round(v);
        }, { decimals: 0 }).wrap
      );
      controls.appendChild(
        sliderField('Row Offset', node.params.rowOffset, 0.05, 0, 1, (v) => {
          node.params.rowOffset = v;
        }).wrap
      );
      controls.appendChild(
        sliderField('Contrast', node.params.contrast, 0.05, 0, 1, (v) => {
          node.params.contrast = v;
        }).wrap
      );
      controls.appendChild(
        selectField(
          'Blend',
          node.params.blend,
          [
            ['replace', 'Replace'],
            ['add', 'Add'],
            ['multiply', 'Multiply'],
          ],
          (v) => {
            node.params.blend = v;
          }
        )
      );

      const variationHeading = document.createElement('span');
      variationHeading.className = 'vbrush-node-subheading';
      variationHeading.textContent = 'Variation';
      controls.appendChild(variationHeading);

      controls.appendChild(
        sliderField('Corner Radius', node.params.cornerRadius, 1, 0, 10, (v) => {
          node.params.cornerRadius = Math.round(v);
        }, { decimals: 0 }).wrap
      );
      controls.appendChild(
        sliderField('Waviness', node.params.waviness, 0.05, 0, 1, (v) => {
          node.params.waviness = v;
        }).wrap
      );
      controls.appendChild(
        sliderField('Wave Freq.', node.params.waveFrequency, 0.1, 0.2, 5, (v) => {
          node.params.waveFrequency = v;
        }, { decimals: 1 }).wrap
      );
      controls.appendChild(
        sliderField('Mortar Noise', node.params.mortarNoise, 0.05, 0, 1, (v) => {
          node.params.mortarNoise = v;
        }).wrap
      );
      controls.appendChild(
        sliderField('Stone Grain', node.params.stoneGrain, 0.05, 0, 1, (v) => {
          node.params.stoneGrain = v;
        }).wrap
      );
    } else if (node.type === 'math') {
      controls.appendChild(
        selectField(
          'Operation',
          node.params.op,
          [
            ['add', 'Add'],
            ['multiply', 'Multiply'],
            ['power', 'Power'],
            ['abs', 'Abs Fold'],
            ['sine', 'Sine'],
            ['remap', 'Remap'],
          ],
          (v) => {
            node.params.op = v;
            render(); // field set differs per op — remap needs its own re-render
          }
        )
      );
      if (node.params.op === 'remap') {
        controls.appendChild(
          numberField('In Min', node.params.remapInMin, 0.05, undefined, undefined, (v) => {
            node.params.remapInMin = v;
          })
        );
        controls.appendChild(
          numberField('In Max', node.params.remapInMax, 0.05, undefined, undefined, (v) => {
            node.params.remapInMax = v;
          })
        );
        controls.appendChild(
          numberField('Out Min', node.params.remapOutMin, 0.05, undefined, undefined, (v) => {
            node.params.remapOutMin = v;
          })
        );
        controls.appendChild(
          numberField('Out Max', node.params.remapOutMax, 0.05, undefined, undefined, (v) => {
            node.params.remapOutMax = v;
          })
        );
      } else {
        controls.appendChild(
          numberField('Amount', node.params.amount, 0.05, undefined, undefined, (v) => {
            node.params.amount = v;
          })
        );
      }
    } else if (node.type === 'ramp') {
      const note = document.createElement('div');
      note.className = 'vbrush-node-note';
      note.textContent = 'Mixes between color stops based on the current value.';
      controls.appendChild(note);

      const stopsWrap = document.createElement('div');
      stopsWrap.className = 'vbrush-ramp-stops';
      node.params.stops.forEach((stop, i) => {
        const stopRow = document.createElement('div');
        stopRow.className = 'vbrush-ramp-stop';

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.className = 'vbrush-color-swatch';
        colorInput.title = 'Stop color';
        colorInput.value = rgbToHex(stop.color);
        colorInput.addEventListener('input', () => {
          stop.color = window.PAE.PaletteManager.hexToRgb(colorInput.value);
          notify();
        });
        stopRow.appendChild(colorInput);

        const posBuilt = sliderField(
          'Pos',
          stop.pos,
          0.01,
          0,
          1,
          (v) => {
            stop.pos = v;
          },
          { decimals: 2 }
        );
        stopRow.appendChild(posBuilt.wrap);

        if (node.params.stops.length > 2) {
          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className = 'layer-delete-btn';
          removeBtn.title = 'Remove this stop';
          removeBtn.textContent = '×';
          removeBtn.addEventListener('click', () => {
            node.params.stops.splice(i, 1);
            render();
          });
          stopRow.appendChild(removeBtn);
        }

        stopsWrap.appendChild(stopRow);
      });
      controls.appendChild(stopsWrap);

      if (node.params.stops.length < 6) {
        const addStopBtn = document.createElement('button');
        addStopBtn.type = 'button';
        addStopBtn.className = 'btn vbrush-add-stop-btn';
        addStopBtn.textContent = '+ Stop';
        addStopBtn.addEventListener('click', () => {
          // Insert a new stop roughly between the two highest existing ones, with an averaged color, so it starts somewhere sane rather than stacked on top of another stop.
          const sorted = node.params.stops.slice().sort((a, b) => a.pos - b.pos);
          const last = sorted[sorted.length - 1];
          const prev = sorted[sorted.length - 2] || sorted[0];
          node.params.stops.push({
            pos: clamp01((last.pos + prev.pos) / 2 + 0.001),
            color: [
              Math.round((last.color[0] + prev.color[0]) / 2),
              Math.round((last.color[1] + prev.color[1]) / 2),
              Math.round((last.color[2] + prev.color[2]) / 2),
            ],
          });
          render();
        });
        controls.appendChild(addStopBtn);
      }
    } else if (node.type === 'palette') {
      const note = document.createElement('span');
      note.className = 'vbrush-node-note';
      note.textContent = 'Converts the current value into a color from the reduced Mix palette.';
      controls.appendChild(note);
    } else if (node.type === 'clamp') {
      controls.classList.add('vbrush-clamp-controls');
      controls.appendChild(clampColorGroup('Min Color', node, ['rMin', 'gMin', 'bMin']));
      controls.appendChild(clampColorGroup('Max Color', node, ['rMax', 'gMax', 'bMax']));
    }
    return controls;
  }

  function makeNodeRow(node, index, total) {
    const row = document.createElement('div');
    row.className = 'vbrush-node-row';

    const header = document.createElement('div');
    header.className = 'vbrush-node-header';

    const title = document.createElement('span');
    title.className = 'vbrush-node-title';
    title.textContent = `${index + 1}. ${VBrushPipeline.NODE_LABELS[node.type]}`;
    header.appendChild(title);

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'layer-move-btn';
    upBtn.textContent = '↑';
    upBtn.title = 'Move this node earlier in the pipeline';
    upBtn.disabled = index === 0;
    upBtn.addEventListener('click', () => {
      const nodes = app.vbrushPipeline.nodes;
      [nodes[index - 1], nodes[index]] = [nodes[index], nodes[index - 1]];
      render();
    });
    header.appendChild(upBtn);

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'layer-move-btn';
    downBtn.textContent = '↓';
    downBtn.title = 'Move this node later in the pipeline';
    downBtn.disabled = index === total - 1;
    downBtn.addEventListener('click', () => {
      const nodes = app.vbrushPipeline.nodes;
      [nodes[index], nodes[index + 1]] = [nodes[index + 1], nodes[index]];
      render();
    });
    header.appendChild(downBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'layer-delete-btn';
    deleteBtn.textContent = '×';
    deleteBtn.title = 'Remove this node';
    deleteBtn.addEventListener('click', () => {
      app.vbrushPipeline.nodes.splice(index, 1);
      render();
    });
    header.appendChild(deleteBtn);

    row.appendChild(header);
    row.appendChild(buildNodeControls(node));
    return row;
  }

  function render() {
    const nodes = app.vbrushPipeline.nodes;
    list.innerHTML = '';
    nodes.forEach((node, index) => list.appendChild(makeNodeRow(node, index, nodes.length)));
    hint.hidden = nodes.length > 0;
    renderPreview();
  }

  addBtn.addEventListener('click', () => {
    app.vbrushPipeline.nodes.push(VBrushPipeline.createNode(addType.value));
    render();
  });

  clearBtn.addEventListener('click', () => {
    if (!app.vbrushPipeline.nodes.length) return;
    if (confirm('Clear the V Brush pipeline? This resets it to the brush’s default color picking.')) {
      app.vbrushPipeline.nodes = [];
      render();
    }
  });

  /** Rebuilds the Preset dropdown's options from localStorage, keeping `preferId` selected if it's still there. */
  function renderPresetOptions(preferId) {
    const presets = window.PAE.VBrushPresetStore.list();
    presetSelect.innerHTML = '';
    if (!presets.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No saved presets';
      presetSelect.appendChild(opt);
    } else {
      presets.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        presetSelect.appendChild(opt);
      });
      if (preferId && presets.some((p) => p.id === preferId)) presetSelect.value = preferId;
    }
    const hasPresets = presets.length > 0;
    presetLoadBtn.disabled = !hasPresets;
    presetDeleteBtn.disabled = !hasPresets;
  }

  presetLoadBtn.addEventListener('click', () => {
    const id = presetSelect.value;
    if (!id) return;
    const loadedNodes = window.PAE.VBrushPresetStore.load(id);
    if (!loadedNodes) {
      renderPresetOptions(); // it's gone (e.g. deleted elsewhere) — refresh the list rather than silently doing nothing
      return;
    }
    if (app.vbrushPipeline.nodes.length && !confirm('Load this preset? It replaces the current pipeline.')) return;
    app.vbrushPipeline.nodes = loadedNodes;
    render();
  });

  presetDeleteBtn.addEventListener('click', () => {
    const id = presetSelect.value;
    if (!id) return;
    const preset = window.PAE.VBrushPresetStore.list().find((p) => p.id === id);
    const label = preset ? preset.name : 'this preset';
    if (!confirm(`Delete the "${label}" preset? This can't be undone.`)) return;
    window.PAE.VBrushPresetStore.remove(id);
    renderPresetOptions();
  });

  presetSaveBtn.addEventListener('click', () => {
    if (!app.vbrushPipeline.nodes.length) {
      alert('Add at least one node before saving a preset — an empty pipeline is already what "Clear Output" gives you.');
      return;
    }
    const name = prompt('Name this V Brush preset:', 'Preset');
    if (!name) return; // cancelled
    const saved = window.PAE.VBrushPresetStore.save(name, app.vbrushPipeline.nodes);
    renderPresetOptions(saved.id);
  });

  openBtn.addEventListener('click', () => {
    render();
    renderPresetOptions();
    dialog.showModal();
  });

  closeBtn.addEventListener('click', () => dialog.close());
}

window.PAE.initVBrushPipelinePanel = initVBrushPipelinePanel;
