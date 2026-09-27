/**
 * mapGen.js
 * ---------------------------------------------------------------------------
 * Map Generator — Roger's ask: "a separate tooling program" for building
 * game maps (100x100 and up), with Perlin noise and math nodes run over
 * manually painted layers, where you can click "+" to add more custom
 * terrain/water layers that all work together on the same noise. Lives as a
 * second MODE of this single-page app (see the mode switch in the menu bar
 * and #map-app in index.html) rather than a second HTML file, entirely
 * independent of the pixel editor's own SpriteProject/Frame/Layer model —
 * a map is its own thing with its own data below.
 *
 * How a cell's color is decided (see MapGen.layerWeight/renderComposite):
 * every layer computes its own 0..1 "weight" at that cell from THREE
 * ingredients — its own seeded Perlin fbm noise, whatever you've manually
 * PAINTED for that layer there (a per-cell bias added directly to the noise
 * before anything else runs, per Roger's "paint biases the noise" answer),
 * and an optional ordered chain of Math nodes (Add/Multiply/Power) that
 * reshape the result — then the live canvas blends every layer's color by
 * its weight (a layer with weight 1 near here shows almost pure its own
 * color; several overlapping layers blend between them; weak/unclaimed
 * areas fade toward a neutral base color). Exporting (see buildExportData)
 * instead picks, per cell, whichever ONE layer's weight is highest (ties
 * broken by list order) as that cell's terrain ID — the same live weights,
 * just read out as a discrete winner instead of a blend, which is what a
 * game engine actually wants.
 *
 * Perlin noise itself is NOT reimplemented here — `window.PAE.PerlinNoise`
 * (vbrushPipeline.js) is reused as-is, the exact same seeded gradient-noise
 * class the V Brush pipeline's own Noise node already relies on.
 */

// ---- Data model ----------------------------------------------------------

/** A default color for each "+"-added custom layer, cycled by index so successive custom layers are visually distinct without Roger having to pick a color for the very first one. */
const MAP_DEFAULT_LAYER_COLORS = ['#c98a3f', '#8a6bbf', '#d1495b', '#c9a227', '#5a7d9a', '#b5651d', '#4f9d69'];

class MapLayer {
  constructor(name, color, perlinOverrides) {
    this.id = 'maplayer' + Date.now() + Math.floor(Math.random() * 1000000);
    this.name = name;
    this.color = color;
    // fbm params — same shape/meaning as the V Brush pipeline's Noise node
    // (scale/octaves/persistence/seed), just read directly rather than
    // through a node's `params` object, since a map layer only ever has
    // exactly one noise source (unlike the pipeline's ordered node list).
    this.perlin = Object.assign({ scale: 0.07, octaves: 4, persistence: 0.5, seed: Math.floor(Math.random() * 10000) }, perlinOverrides || {});
    // How strongly this layer counts once several layers' weights are
    // compared/blended — a plain multiplier on the final 0..1 weight, so
    // 1 = normal, 2 = "dominates ties/blends twice as hard", 0 = "ignore
    // this layer's noise entirely" without having to delete it.
    this.influence = 1;
    // Optional ordered chain of {id, op, amount} — see MapGen._applyMathNode.
    this.mathNodes = [];
    // Float32Array(width*height), one -1..1 bias per cell, painted directly
    // (see MapGen.paintStroke) and added to the noise before anything else
    // runs. Sized/created by MapProject — null until then.
    this.paintBias = null;
  }

  ensureBiasSize(width, height) {
    const size = width * height;
    if (!this.paintBias || this.paintBias.length !== size) {
      this.paintBias = new Float32Array(size);
    }
  }
}

class MapProject {
  constructor(width, height, layers) {
    this.width = width;
    this.height = height;
    this.layers = layers;
    this.layers.forEach((l) => l.ensureBiasSize(width, height));
  }

  /** A fresh map with Roger's own starting pair — a Water layer and a Grass (terrain) layer — per his "layers for adding terrain types and water types" ask. Different seeds/scales so the two don't look identical. */
  static createDefault(width, height) {
    const water = new MapLayer('Water', '#2f6fb0', { scale: 0.055, octaves: 4, persistence: 0.5, seed: 1013 });
    const grass = new MapLayer('Grass', '#4a9950', { scale: 0.085, octaves: 4, persistence: 0.5, seed: 90731 });
    water.influence = 1.15; // water reads a little more readily than grass at a tie, so coastlines don't disappear into the "unclaimed" base color
    return new MapProject(width, height, [water, grass]);
  }

  /** True if ANY layer has been painted on at all — used to decide whether "New Map…" needs a confirm() before discarding this one. */
  hasAnyPaint() {
    return this.layers.some((l) => l.paintBias.some((v) => v !== 0));
  }
}

// ---- Pure computation: noise + paint + math -> a 0..1 weight, per cell ---

const MapGen = {
  /** Neutral "nothing has claimed this cell strongly" color — a sandy/tan mid-tone that reads as "unassigned ground" rather than any one real terrain. */
  BASE_COLOR: [214, 201, 164],
  /** Export only counts a layer as the winner if its weight clears this floor; below it, the cell exports as "Unclaimed" (id 0) rather than the technically-highest-but-barely-there layer. */
  EXPORT_THRESHOLD: 0.12,

  _perlinCache: new Map(),
  _getPerlin(seed) {
    let p = MapGen._perlinCache.get(seed);
    if (!p) {
      p = new window.PAE.PerlinNoise(seed);
      MapGen._perlinCache.set(seed, p);
    }
    return p;
  },

  createMathNode(op) {
    const defaults = { add: 0.15, multiply: 1.5, power: 2 };
    return { id: 'mn' + Date.now() + Math.floor(Math.random() * 1000000), op: op || 'add', amount: defaults[op] !== undefined ? defaults[op] : 0.15 };
  },

  /** Applies one Add/Multiply/Power node to a running 0..1 scalar, clamping back to 0..1 afterward so a chain of nodes can never silently blow past the range every downstream calculation (and the final blend/export) assumes. */
  _applyMathNode(node, v) {
    let out;
    switch (node.op) {
      case 'add':
        out = v + node.amount;
        break;
      case 'multiply':
        out = v * node.amount;
        break;
      case 'power':
        out = Math.pow(Math.max(0, v), node.amount);
        break;
      default:
        out = v;
    }
    return Math.max(0, Math.min(1, out));
  },

  /**
   * This layer's weight at (x, y): seeded Perlin fbm (via the SAME class
   * the V Brush pipeline uses), normalized to 0..1, with the painted bias
   * for that cell added in directly (Roger's "paint biases the noise"
   * answer — the noise still varies on top of what you painted, it doesn't
   * get overridden by it), clamped, then run through this layer's own Math
   * node chain in order, and finally scaled by `influence`. The
   * `influence` scale is applied AFTER the 0..1 clamp on purpose, so it's
   * a pure "how much this layer counts against its neighbors" multiplier —
   * it can legitimately push the returned value above 1 (a layer with
   * influence 2 reads as "twice as certain" for blending purposes), never
   * something the math-node chain itself has to account for.
   */
  layerWeight(layer, x, y, width) {
    const perlin = MapGen._getPerlin(layer.perlin.seed);
    const raw = perlin.fbm(x * layer.perlin.scale, y * layer.perlin.scale, layer.perlin.octaves, layer.perlin.persistence); // ~ -1..1
    const idx = y * width + x;
    let v = Math.max(0, Math.min(1, (raw + 1) / 2 + layer.paintBias[idx]));
    for (const node of layer.mathNodes) v = MapGen._applyMathNode(node, v);
    return v * layer.influence;
  },

  /**
   * Renders the live, blended preview as a PixelBuffer (so the existing
   * `CanvasView.paintBuffer` can scale/draw it, same as every other canvas
   * in this app — no separate scaling code needed here). Every layer's
   * color contributes proportional to its own weight relative to the
   * others' (a normalized weighted average), and the overall mix fades
   * toward BASE_COLOR the weaker every layer's weight is here — a cell no
   * layer claims strongly reads as plain unclaimed ground, a cell one
   * layer claims strongly (weight near/above 1) reads as nearly its pure
   * color, and an area where two layers both have real weight blends
   * between their two colors.
   */
  renderComposite(map) {
    const buf = window.PAE.PixelBuffer.createBlank(map.width, map.height);
    const colors = map.layers.map((l) => window.PAE.PaletteManager.hexToRgb(l.color));
    const base = MapGen.BASE_COLOR;
    const data = buf.data;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        let sum = 0;
        const weights = new Array(map.layers.length);
        for (let li = 0; li < map.layers.length; li++) {
          const w = MapGen.layerWeight(map.layers[li], x, y, map.width);
          weights[li] = w;
          sum += w;
        }
        let r, g, b;
        if (sum <= 0.0001) {
          r = base[0];
          g = base[1];
          b = base[2];
        } else {
          let mr = 0,
            mg = 0,
            mb = 0;
          for (let li = 0; li < weights.length; li++) {
            const t = weights[li] / sum;
            mr += colors[li][0] * t;
            mg += colors[li][1] * t;
            mb += colors[li][2] * t;
          }
          const strength = Math.min(1, sum);
          r = base[0] * (1 - strength) + mr * strength;
          g = base[1] * (1 - strength) + mg * strength;
          b = base[2] * (1 - strength) + mb * strength;
        }
        const i = (y * map.width + x) * 4;
        data[i] = Math.round(r);
        data[i + 1] = Math.round(g);
        data[i + 2] = Math.round(b);
        data[i + 3] = 255;
      }
    }
    return buf;
  },

  /**
   * The discrete, game-ready readout of the exact same weights the live
   * preview blends: for every cell, whichever layer's weight is highest
   * wins that cell's terrain id (1-based; ties go to whichever layer comes
   * FIRST in the list) — UNLESS even the winner's weight doesn't clear
   * EXPORT_THRESHOLD, in which case the cell exports as id 0, "Unclaimed".
   * `legend` maps every id back to a name + the color it's shown as on the
   * live canvas, so the JSON is self-describing without this app's own
   * source alongside it.
   */
  buildExportData(map) {
    const legend = [{ id: 0, name: 'Unclaimed', color: MapGen._rgbToHex(MapGen.BASE_COLOR) }];
    map.layers.forEach((layer, i) => legend.push({ id: i + 1, name: layer.name, color: layer.color }));
    const grid = [];
    for (let y = 0; y < map.height; y++) {
      const row = new Array(map.width);
      for (let x = 0; x < map.width; x++) {
        let bestIdx = -1;
        let bestW = 0;
        for (let li = 0; li < map.layers.length; li++) {
          const w = MapGen.layerWeight(map.layers[li], x, y, map.width);
          if (w > bestW) {
            bestW = w;
            bestIdx = li;
          }
        }
        row[x] = bestW >= MapGen.EXPORT_THRESHOLD ? bestIdx + 1 : 0;
      }
      grid.push(row);
    }
    return { width: map.width, height: map.height, legend, grid };
  },

  _rgbToHex(rgb) {
    const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + c(rgb[0]) + c(rgb[1]) + c(rgb[2]);
  },

  /**
   * Paints a soft round brush of bias into `layer.paintBias` centered at
   * fractional image coordinates (cx, cy) — called once per mousedown and
   * again on every mousemove while a stroke is in progress, same
   * "accumulates as you drag" feel as the Blender tool. A linear falloff
   * from the brush's center to its edge (`1 - dist / radius`) keeps a
   * stroke's edge soft rather than a hard-edged disc, so painted regions
   * blend into the noise instead of looking like a sticker. `erase` flips
   * the sign, pulling bias AWAY from this layer instead of toward it;
   * either way the result is clamped to the same -1..1 range the noise
   * normalization itself assumes.
   */
  paintStroke(map, layer, cx, cy, radius, strength, erase) {
    const r = Math.max(1, radius);
    const sign = erase ? -1 : 1;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(map.width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(map.height - 1, Math.ceil(cy + r));
    const bias = layer.paintBias;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (dist > r) continue;
        const falloff = 1 - dist / r;
        const idx = y * map.width + x;
        bias[idx] = Math.max(-1, Math.min(1, bias[idx] + sign * strength * falloff));
      }
    }
  },
};

window.PAE = window.PAE || {};
window.PAE.MapLayer = MapLayer;
window.PAE.MapProject = MapProject;
window.PAE.MapGen = MapGen;
window.PAE.MAP_DEFAULT_LAYER_COLORS = MAP_DEFAULT_LAYER_COLORS;

// ---- DOM wiring: mode switch, canvas/paint, layers panel, dialogs --------

function initMapGen() {
  const canvas = document.getElementById('map-canvas');
  const layersList = document.getElementById('map-layers-list');
  const settingsPanel = document.getElementById('map-layer-settings');
  const settingsHint = document.getElementById('map-layer-settings-hint');

  const state = {
    map: window.PAE.MapProject.createDefault(100, 100),
    activeLayerIndex: 0,
    zoom: 4,
    brushRadius: 10,
    brushStrength: 0.35,
    erase: false,
    undoStack: [], // [{layerId, before: Float32Array}]
    redoStack: [],
  };

  let renderScheduled = false;
  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      const buf = window.PAE.MapGen.renderComposite(state.map);
      window.PAE.CanvasView.paintBuffer(canvas, buf, state.zoom);
    });
  }

  // ---- Mode switch ---------------------------------------------------

  const pixelBody = document.getElementById('app-body');
  const mapBody = document.getElementById('map-app');
  document.querySelectorAll('[data-app-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.appMode;
      document.body.dataset.mode = mode;
      document.querySelectorAll('[data-app-mode]').forEach((b) => b.classList.toggle('active', b === btn));
      pixelBody.hidden = mode !== 'pixel';
      mapBody.hidden = mode !== 'map';
      if (mode === 'map') scheduleRender();
    });
  });

  // ---- Layer list ------------------------------------------------------

  function renderLayers() {
    layersList.innerHTML = '';
    state.map.layers.forEach((layer, index) => {
      const row = document.createElement('div');
      row.className = 'layer-row' + (index === state.activeLayerIndex ? ' active' : '');
      row.title = `${layer.name} — click to paint this layer`;
      row.addEventListener('click', () => {
        state.activeLayerIndex = index;
        renderLayers();
        renderLayerSettings();
      });

      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.className = 'map-layer-swatch';
      colorInput.value = layer.color;
      colorInput.title = 'Layer color';
      colorInput.addEventListener('click', (e) => e.stopPropagation());
      colorInput.addEventListener('input', () => {
        layer.color = colorInput.value;
        scheduleRender();
      });
      row.appendChild(colorInput);

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'map-layer-name-input';
      nameInput.value = layer.name;
      nameInput.addEventListener('click', (e) => e.stopPropagation());
      nameInput.addEventListener('input', () => {
        layer.name = nameInput.value || layer.name;
      });
      row.appendChild(nameInput);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'layer-delete-btn';
      deleteBtn.textContent = '×';
      deleteBtn.title = 'Delete this layer';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.map.layers.length <= 1) {
          alert('A map needs at least one layer.');
          return;
        }
        if (!confirm(`Delete layer "${layer.name}"? This cannot be undone.`)) return;
        state.map.layers.splice(index, 1);
        if (state.activeLayerIndex >= state.map.layers.length) state.activeLayerIndex = state.map.layers.length - 1;
        renderLayers();
        renderLayerSettings();
        scheduleRender();
      });
      row.appendChild(deleteBtn);

      layersList.appendChild(row);
    });
  }

  // ---- Layer settings panel (noise + influence + math nodes) ----------

  function sliderRow(labelText, value, step, min, max, decimals, onInput) {
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
    const valueLabel = document.createElement('span');
    valueLabel.className = 'vbrush-range-value';
    valueLabel.textContent = Number(value).toFixed(decimals);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      valueLabel.textContent = v.toFixed(decimals);
      onInput(v);
      scheduleRender();
    });
    row.appendChild(input);
    row.appendChild(valueLabel);
    wrap.appendChild(span);
    wrap.appendChild(row);
    return wrap;
  }

  function mathNodeRow(layer, node, index) {
    const row = document.createElement('div');
    row.className = 'vbrush-node-row';

    const header = document.createElement('div');
    header.className = 'vbrush-node-header';
    const title = document.createElement('span');
    title.className = 'vbrush-node-title';
    title.textContent = `${index + 1}. Math`;
    header.appendChild(title);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'layer-delete-btn';
    deleteBtn.textContent = '×';
    deleteBtn.title = 'Remove this node';
    deleteBtn.addEventListener('click', () => {
      layer.mathNodes.splice(index, 1);
      renderLayerSettings();
      scheduleRender();
    });
    header.appendChild(deleteBtn);
    row.appendChild(header);

    const controls = document.createElement('div');
    controls.className = 'vbrush-node-controls';

    const opWrap = document.createElement('label');
    opWrap.className = 'vbrush-field';
    const opSpan = document.createElement('span');
    opSpan.textContent = 'Operation';
    const opSelect = document.createElement('select');
    [
      ['add', 'Add'],
      ['multiply', 'Multiply'],
      ['power', 'Power'],
    ].forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (value === node.op) opt.selected = true;
      opSelect.appendChild(opt);
    });
    opSelect.addEventListener('change', () => {
      node.op = opSelect.value;
      scheduleRender();
    });
    opWrap.appendChild(opSpan);
    opWrap.appendChild(opSelect);
    controls.appendChild(opWrap);

    const amountWrap = document.createElement('label');
    amountWrap.className = 'vbrush-field';
    const amountSpan = document.createElement('span');
    amountSpan.textContent = 'Amount';
    const amountInput = document.createElement('input');
    amountInput.type = 'number';
    amountInput.step = 0.05;
    amountInput.value = node.amount;
    amountInput.addEventListener('input', () => {
      node.amount = Number(amountInput.value);
      scheduleRender();
    });
    amountWrap.appendChild(amountSpan);
    amountWrap.appendChild(amountInput);
    controls.appendChild(amountWrap);

    row.appendChild(controls);
    return row;
  }

  function renderLayerSettings() {
    const layer = state.map.layers[state.activeLayerIndex];
    settingsPanel.innerHTML = '<h2>Layer Settings</h2>';
    if (!layer) {
      const hint = document.createElement('p');
      hint.className = 'map-layer-settings-hint';
      hint.textContent = 'Add or select a layer above to edit its noise.';
      settingsPanel.appendChild(hint);
      return;
    }

    const heading = document.createElement('p');
    heading.className = 'map-layer-settings-heading';
    heading.textContent = layer.name + ' — Perlin Noise';
    settingsPanel.appendChild(heading);

    settingsPanel.appendChild(
      sliderRow('Scale', layer.perlin.scale, 0.005, 0.01, 0.5, 3, (v) => {
        layer.perlin.scale = v;
      })
    );
    settingsPanel.appendChild(
      sliderRow('Octaves', layer.perlin.octaves, 1, 1, 6, 0, (v) => {
        layer.perlin.octaves = Math.round(v);
      })
    );
    settingsPanel.appendChild(
      sliderRow('Persistence', layer.perlin.persistence, 0.05, 0, 1, 2, (v) => {
        layer.perlin.persistence = v;
      })
    );
    settingsPanel.appendChild(
      sliderRow('Seed', layer.perlin.seed, 1, 0, 9999, 0, (v) => {
        layer.perlin.seed = Math.round(v);
      })
    );
    const rerollBtn = document.createElement('button');
    rerollBtn.type = 'button';
    rerollBtn.className = 'btn';
    rerollBtn.textContent = 'Reroll Seed \u{1F3B2}';
    rerollBtn.addEventListener('click', () => {
      layer.perlin.seed = Math.floor(Math.random() * 10000);
      renderLayerSettings();
      scheduleRender();
    });
    settingsPanel.appendChild(rerollBtn);

    settingsPanel.appendChild(
      sliderRow('Strength (vs. other layers)', layer.influence, 0.05, 0, 2, 2, (v) => {
        layer.influence = v;
      })
    );

    const mathHeading = document.createElement('p');
    mathHeading.className = 'map-layer-settings-heading';
    mathHeading.textContent = 'Math Nodes';
    settingsPanel.appendChild(mathHeading);

    const mathList = document.createElement('div');
    mathList.className = 'vbrush-node-list';
    layer.mathNodes.forEach((node, i) => mathList.appendChild(mathNodeRow(layer, node, i)));
    settingsPanel.appendChild(mathList);

    const addMathBtn = document.createElement('button');
    addMathBtn.type = 'button';
    addMathBtn.className = 'btn';
    addMathBtn.textContent = '+ Add Math Node';
    addMathBtn.addEventListener('click', () => {
      layer.mathNodes.push(window.PAE.MapGen.createMathNode('add'));
      renderLayerSettings();
      scheduleRender();
    });
    settingsPanel.appendChild(addMathBtn);
  }

  document.getElementById('map-layer-add').addEventListener('click', () => {
    const name = prompt('Name this new layer (e.g. Mountain, Desert, Forest):', 'New Terrain');
    if (!name) return;
    const color = window.PAE.MAP_DEFAULT_LAYER_COLORS[state.map.layers.length % window.PAE.MAP_DEFAULT_LAYER_COLORS.length];
    const layer = new window.PAE.MapLayer(name, color, { seed: Math.floor(Math.random() * 10000), scale: 0.07 + Math.random() * 0.05 });
    layer.ensureBiasSize(state.map.width, state.map.height);
    state.map.layers.push(layer);
    state.activeLayerIndex = state.map.layers.length - 1;
    renderLayers();
    renderLayerSettings();
    scheduleRender();
  });

  // ---- Painting: mouse + touch, same shim-object approach as Round K's
  // main-canvas touch support (js/app.js's _wireTouchEvents) --------------

  function eventToMapPixel(evt) {
    const rect = canvas.getBoundingClientRect();
    const contentX = evt.clientX - rect.left - canvas.clientLeft;
    const contentY = evt.clientY - rect.top - canvas.clientTop;
    const scaleX = canvas.width / canvas.clientWidth;
    const scaleY = canvas.height / canvas.clientHeight;
    return { x: (contentX * scaleX) / state.zoom, y: (contentY * scaleY) / state.zoom };
  }

  let painting = false;
  let strokeSnapshot = null;

  function beginStroke() {
    const layer = state.map.layers[state.activeLayerIndex];
    if (!layer) return;
    strokeSnapshot = layer.paintBias.slice();
  }

  function paintAt(evt) {
    const layer = state.map.layers[state.activeLayerIndex];
    if (!layer) return;
    const { x, y } = eventToMapPixel(evt);
    window.PAE.MapGen.paintStroke(state.map, layer, x, y, state.brushRadius, state.brushStrength, state.erase);
    scheduleRender();
  }

  function endStroke() {
    const layer = state.map.layers[state.activeLayerIndex];
    if (!layer || !strokeSnapshot) {
      strokeSnapshot = null;
      return;
    }
    let changed = false;
    for (let i = 0; i < layer.paintBias.length; i++) {
      if (layer.paintBias[i] !== strokeSnapshot[i]) {
        changed = true;
        break;
      }
    }
    if (changed) {
      state.undoStack.push({ layerId: layer.id, before: strokeSnapshot });
      if (state.undoStack.length > 30) state.undoStack.shift();
      state.redoStack = [];
    }
    strokeSnapshot = null;
  }

  canvas.addEventListener('mousedown', (e) => {
    painting = true;
    beginStroke();
    paintAt(e);
  });
  canvas.addEventListener('mousemove', (e) => {
    if (painting) paintAt(e);
  });
  window.addEventListener('mouseup', () => {
    if (painting) endStroke();
    painting = false;
  });

  canvas.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      painting = true;
      beginStroke();
      paintAt({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
    },
    { passive: false }
  );
  canvas.addEventListener(
    'touchmove',
    (e) => {
      e.preventDefault();
      if (painting) paintAt({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
    },
    { passive: false }
  );
  const endTouch = () => {
    if (painting) endStroke();
    painting = false;
  };
  canvas.addEventListener('touchend', endTouch);
  canvas.addEventListener('touchcancel', endTouch);

  // ---- Undo/redo (Map mode only — see js/ui.js's initShortcuts guard) --

  function mapUndo() {
    const entry = state.undoStack.pop();
    if (!entry) return;
    const layer = state.map.layers.find((l) => l.id === entry.layerId);
    if (!layer) return;
    state.redoStack.push({ layerId: layer.id, before: layer.paintBias.slice() });
    layer.paintBias = entry.before;
    scheduleRender();
  }
  function mapRedo() {
    const entry = state.redoStack.pop();
    if (!entry) return;
    const layer = state.map.layers.find((l) => l.id === entry.layerId);
    if (!layer) return;
    state.undoStack.push({ layerId: layer.id, before: layer.paintBias.slice() });
    layer.paintBias = entry.before;
    scheduleRender();
  }
  window.addEventListener('keydown', (e) => {
    if (document.body.dataset.mode !== 'map') return;
    const inTextField = /^(input|textarea)$/i.test(document.activeElement.tagName);
    if (inTextField) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) mapRedo();
      else mapUndo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      mapRedo();
    }
  });

  // ---- Toolbar: brush/strength/paint-erase, zoom, New Map, Export ------

  const radiusSlider = document.getElementById('map-brush-radius');
  const radiusValue = document.getElementById('map-brush-radius-value');
  radiusSlider.addEventListener('input', () => {
    state.brushRadius = Number(radiusSlider.value);
    radiusValue.textContent = state.brushRadius + 'px';
  });

  const strengthSlider = document.getElementById('map-brush-strength');
  const strengthValue = document.getElementById('map-brush-strength-value');
  strengthSlider.addEventListener('input', () => {
    state.brushStrength = Number(strengthSlider.value) / 100;
    strengthValue.textContent = strengthSlider.value + '%';
  });

  document.querySelectorAll('[data-map-paint-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-map-paint-mode]').forEach((b) => b.classList.toggle('active', b === btn));
      state.erase = btn.dataset.mapPaintMode === 'erase';
    });
  });

  const zoomLabel = document.getElementById('map-status-zoom');
  function setZoom(z) {
    state.zoom = Math.max(1, Math.min(16, z));
    zoomLabel.textContent = Math.round(state.zoom * 100) + '%';
    scheduleRender();
  }
  document.getElementById('map-zoom-in').addEventListener('click', () => setZoom(state.zoom + 1));
  document.getElementById('map-zoom-out').addEventListener('click', () => setZoom(state.zoom - 1));
  canvas.parentElement.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(state.zoom + (e.deltaY < 0 ? 1 : -1));
    },
    { passive: false }
  );

  const newMapDialog = document.getElementById('new-map-dialog');
  document.getElementById('map-new-btn').addEventListener('click', () => {
    document.getElementById('new-map-width').value = state.map.width;
    document.getElementById('new-map-height').value = state.map.height;
    newMapDialog.showModal();
  });
  document.getElementById('new-map-cancel').addEventListener('click', () => newMapDialog.close());
  document.getElementById('new-map-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.map.hasAnyPaint() && !confirm('Create a new map? This replaces the current one and cannot be undone.')) return;
    const width = Math.max(8, Math.min(400, Number(document.getElementById('new-map-width').value) || 100));
    const height = Math.max(8, Math.min(400, Number(document.getElementById('new-map-height').value) || 100));
    state.map = window.PAE.MapProject.createDefault(width, height);
    state.activeLayerIndex = 0;
    state.undoStack = [];
    state.redoStack = [];
    renderLayers();
    renderLayerSettings();
    scheduleRender();
    newMapDialog.close();
  });

  document.getElementById('map-export-btn').addEventListener('click', async () => {
    const name = prompt('Export filename:', 'map');
    if (!name) return;
    const data = window.PAE.MapGen.buildExportData(state.map);
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    try {
      await window.PAE.FileIO._saveBlob(blob, `${name}.json`, { description: 'JSON map data', mime: 'application/json', ext: 'json' });
    } catch (err) {
      if (!err || err.code !== 'declined') console.warn('Map export failed.', err);
    }
  });

  renderLayers();
  renderLayerSettings();
  scheduleRender();
}

window.PAE.initMapGen = initMapGen;
