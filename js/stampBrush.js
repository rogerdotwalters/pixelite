/**
 * stampBrush.js
 * ---------------------------------------------------------------------------
 * Everything about the Stamp Brush's "paint the pattern itself" side: the
 * Stamp Editor dialog (a small standalone pixel grid you paint on, entirely
 * separate from the main canvas) and a named preset library for saved
 * stamps. The actual "paint the stamp over the canvas" side lives in
 * tools/stampBrushTool.js; this file only builds/feeds `app.stamp`
 * (`{width, height, buffer}`), the same plain object shape that tool reads
 * via `ctx.getStamp()`.
 */

// ---- Presets (save/load a whole stamp by name) -----------------------------

/**
 * Persists named stamp patterns to localStorage — same "name it, reuse it
 * later" idea as VBrushPresetStore (vbrushPipeline.js) and the palette
 * manager's saved palettes, just for a small pixel grid instead of a node
 * list or a color list. Kept in its own storage key since a stamp isn't
 * tied to any pipeline or palette. Same defensive try/catch-around-
 * localStorage shape as those, for the same reasons (private browsing,
 * quota, etc. can all make localStorage throw).
 */
const StampPresetStore = {
  storageKey: 'pixelArtEditor.stampPresets',

  _load() {
    try {
      const raw = localStorage.getItem(StampPresetStore.storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn('StampPresetStore: could not read localStorage, starting fresh.', err);
      return [];
    }
  },

  _persist(presets) {
    try {
      localStorage.setItem(StampPresetStore.storageKey, JSON.stringify(presets));
    } catch (err) {
      console.warn('StampPresetStore: could not write localStorage (preset will not survive reload).', err);
    }
  },

  /** `[{id, name, width, height, pixels}, ...]`, most-recently-saved last. */
  list() {
    return StampPresetStore._load();
  },

  /**
   * Saves a snapshot of `buffer` (a PAE.PixelBuffer) under `name`. Saving
   * under a name that already exists (case-insensitive) overwrites that
   * preset in place rather than piling up duplicates — same behavior
   * Roger already gets from the V Brush pipeline / Mix Set naming prompts.
   */
  save(name, buffer) {
    const presets = StampPresetStore._load();
    const cleanName = (name || '').trim() || 'Preset';
    const existingIndex = presets.findIndex((p) => p.name.toLowerCase() === cleanName.toLowerCase());
    const entry = {
      id: existingIndex >= 0 ? presets[existingIndex].id : 'stamp' + Date.now() + Math.floor(Math.random() * 1000),
      name: cleanName,
      width: buffer.width,
      height: buffer.height,
      pixels: Array.from(buffer.data),
    };
    if (existingIndex >= 0) presets[existingIndex] = entry;
    else presets.push(entry);
    StampPresetStore._persist(presets);
    return entry;
  },

  /** Returns a fresh PAE.PixelBuffer built from the named preset, or `null` if it no longer exists (e.g. deleted from another tab). */
  load(id) {
    const found = StampPresetStore._load().find((p) => p.id === id);
    if (!found) return null;
    return new window.PAE.PixelBuffer(found.width, found.height, new Uint8ClampedArray(found.pixels));
  },

  remove(id) {
    StampPresetStore._persist(StampPresetStore._load().filter((p) => p.id !== id));
  },
};

window.PAE = window.PAE || {};
window.PAE.StampPresetStore = StampPresetStore;

// ---- Toolbar thumbnail -------------------------------------------------

/**
 * Redraws the toolbar panel's small thumbnail (`#stamp-thumb-canvas`) with
 * the CURRENT `app.stamp` tiled 2×2 — a quick "does this actually tile
 * seamlessly" sanity check that's visible without opening the full editor.
 * Called once at init and again every time a stamp is saved.
 */
function renderStampThumb(app) {
  const canvas = document.getElementById('stamp-thumb-canvas');
  if (!canvas) return;
  const stamp = app.stamp;
  const tile = window.PAE.PixelBuffer.createBlank(stamp.width * 2, stamp.height * 2);
  tile.blit(stamp.buffer, 0, 0);
  tile.blit(stamp.buffer, stamp.width, 0);
  tile.blit(stamp.buffer, 0, stamp.height);
  tile.blit(stamp.buffer, stamp.width, stamp.height);
  const zoom = Math.max(1, Math.floor(32 / Math.max(tile.width, tile.height)));
  window.PAE.CanvasView.paintBuffer(canvas, tile, zoom);
}

// ---- Stamp Editor dialog ------------------------------------------------

/**
 * Wires the Stamp Editor dialog: a small, independently-zoomed, fully
 * interactive pixel grid (NOT the main canvas) that you paint on to build
 * a stamp, plus Width/Height fields, a Paint/Erase toggle, Clear, and the
 * preset save/load row. Works on its own scratch buffer
 * (`stampEditorBuffer`) the whole time it's open, cloned from `app.stamp`
 * on open — Cancel just discards it, so nothing touches `app.stamp` (and
 * therefore nothing the Stamp Brush tool paints with) until "Save Stamp"
 * is actually clicked.
 */
function initStampEditorPanel(app) {
  const dialog = document.getElementById('stamp-editor-dialog');
  const openBtn = document.getElementById('stamp-edit-open');
  const cancelBtn = document.getElementById('stamp-editor-cancel');
  const form = document.getElementById('stamp-editor-form');
  const widthInput = document.getElementById('stamp-editor-width');
  const heightInput = document.getElementById('stamp-editor-height');
  const clearBtn = document.getElementById('stamp-editor-clear');
  const canvas = document.getElementById('stamp-editor-canvas');
  const editModeButtons = Array.from(document.querySelectorAll('#stamp-editor-form [data-stamp-edit-mode]'));
  const presetSelect = document.getElementById('stamp-preset-select');
  const presetLoadBtn = document.getElementById('stamp-preset-load-btn');
  const presetDeleteBtn = document.getElementById('stamp-preset-delete-btn');
  const presetSaveBtn = document.getElementById('stamp-preset-save-btn');

  let stampEditorBuffer = app.stamp.buffer.clone();
  let cellSize = 28; // recomputed by render() to fit the current grid into a fixed on-screen box

  /** True if ANY pixel in `stampEditorBuffer` has alpha > 0 — used to guard "save preset"/"load over" confirmations. */
  function hasPaintedContent() {
    const data = stampEditorBuffer.data;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
    return false;
  }

  /** Redraws the editable grid: a checkerboard under any transparent cell (so "left blank" is visually obvious), the cell's real color on top, and thin gridlines between cells. */
  function render() {
    const buf = stampEditorBuffer;
    cellSize = Math.max(8, Math.min(32, Math.floor(280 / Math.max(buf.width, buf.height))));
    canvas.width = buf.width * cellSize;
    canvas.height = buf.height * cellSize;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < buf.height; y++) {
      for (let x = 0; x < buf.width; x++) {
        const p = buf.getPixel(x, y);
        const px = x * cellSize;
        const py = y * cellSize;
        if (p[3] < 255) {
          const half = cellSize / 2;
          ctx.fillStyle = '#3a3a3f';
          ctx.fillRect(px, py, cellSize, cellSize);
          ctx.fillStyle = '#54545c';
          ctx.fillRect(px, py, half, half);
          ctx.fillRect(px + half, py + half, cellSize - half, cellSize - half);
        }
        if (p[3] > 0) {
          ctx.fillStyle = `rgba(${p[0]}, ${p[1]}, ${p[2]}, ${p[3] / 255})`;
          ctx.fillRect(px, py, cellSize, cellSize);
        }
      }
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= buf.width; x++) {
      const px = x * cellSize + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= buf.height; y++) {
      const py = y * cellSize + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(canvas.width, py);
      ctx.stroke();
    }
  }

  /** Client (mouse) coordinates -> integer cell coordinates, border-exclusive like CanvasView.eventToPixel — same reasoning: getBoundingClientRect() includes the canvas's CSS border, clientWidth/clientLeft don't. */
  function cellFromEvent(evt) {
    const rect = canvas.getBoundingClientRect();
    const contentX = evt.clientX - rect.left - canvas.clientLeft;
    const contentY = evt.clientY - rect.top - canvas.clientTop;
    const scaleX = canvas.width / canvas.clientWidth;
    const scaleY = canvas.height / canvas.clientHeight;
    return {
      x: Math.floor((contentX * scaleX) / cellSize),
      y: Math.floor((contentY * scaleY) / cellSize),
    };
  }

  let painting = false;
  function paintCellAt(evt) {
    const { x, y } = cellFromEvent(evt);
    if (!stampEditorBuffer.inBounds(x, y)) return;
    const erasing = editModeButtons.find((b) => b.classList.contains('active'))?.dataset.stampEditMode === 'erase';
    if (erasing) {
      stampEditorBuffer.setPixel(x, y, [0, 0, 0, 0]);
    } else {
      const [r, g, b] = window.PAE.PaletteManager.hexToRgb(app.palette.getActiveColor());
      stampEditorBuffer.setPixel(x, y, [r, g, b, 255]);
    }
    render();
  }
  canvas.addEventListener('mousedown', (e) => {
    painting = true;
    paintCellAt(e);
  });
  canvas.addEventListener('mousemove', (e) => {
    if (painting) paintCellAt(e);
  });
  window.addEventListener('mouseup', () => {
    painting = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Touch: same one-finger-paints behavior as the main canvas (see
  // app.js's _wireTouchEvents) — `cellFromEvent` only ever reads
  // clientX/clientY, so a Touch object works here with no changes needed
  // to the cell math itself, just a small clientX/clientY shim and the
  // preventDefault that stops the dialog/page from scrolling while
  // painting a cell. No pinch-zoom here — this editor grid has its own
  // fixed cell size, not a zoomable viewport like the main canvas.
  canvas.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      painting = true;
      paintCellAt({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
    },
    { passive: false }
  );
  canvas.addEventListener(
    'touchmove',
    (e) => {
      e.preventDefault();
      if (painting) paintCellAt({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
    },
    { passive: false }
  );
  canvas.addEventListener('touchend', () => {
    painting = false;
  });
  canvas.addEventListener('touchcancel', () => {
    painting = false;
  });

  editModeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      editModeButtons.forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  clearBtn.addEventListener('click', () => {
    stampEditorBuffer.fillAll([0, 0, 0, 0]);
    render();
  });

  /** Resizes the working buffer, keeping existing pixels anchored top-left (same simple anchor-free default as Resize Canvas) — PixelBuffer.blit already clips, so both growing and shrinking just work. */
  function resizeTo(newWidth, newHeight) {
    newWidth = Math.max(1, Math.min(32, Math.round(newWidth) || stampEditorBuffer.width));
    newHeight = Math.max(1, Math.min(32, Math.round(newHeight) || stampEditorBuffer.height));
    if (newWidth === stampEditorBuffer.width && newHeight === stampEditorBuffer.height) return;
    const resized = window.PAE.PixelBuffer.createBlank(newWidth, newHeight);
    resized.blit(stampEditorBuffer, 0, 0);
    stampEditorBuffer = resized;
    render();
  }
  widthInput.addEventListener('input', () => resizeTo(Number(widthInput.value), Number(heightInput.value)));
  heightInput.addEventListener('input', () => resizeTo(Number(widthInput.value), Number(heightInput.value)));

  /** Rebuilds the Preset dropdown's options from localStorage, keeping `preferId` selected if it's still there. */
  function renderPresetOptions(preferId) {
    const presets = window.PAE.StampPresetStore.list();
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
        opt.textContent = `${p.name} (${p.width}×${p.height})`;
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
    const loaded = window.PAE.StampPresetStore.load(id);
    if (!loaded) {
      renderPresetOptions(); // it's gone (e.g. deleted elsewhere) — refresh rather than silently doing nothing
      return;
    }
    if (hasPaintedContent() && !confirm('Load this preset? It replaces the stamp you’re currently editing.')) return;
    stampEditorBuffer = loaded;
    widthInput.value = loaded.width;
    heightInput.value = loaded.height;
    render();
  });

  presetDeleteBtn.addEventListener('click', () => {
    const id = presetSelect.value;
    if (!id) return;
    const preset = window.PAE.StampPresetStore.list().find((p) => p.id === id);
    const label = preset ? preset.name : 'this preset';
    if (!confirm(`Delete the "${label}" preset? This can't be undone.`)) return;
    window.PAE.StampPresetStore.remove(id);
    renderPresetOptions();
  });

  presetSaveBtn.addEventListener('click', () => {
    if (!hasPaintedContent()) {
      alert('Paint at least one pixel before saving a preset — an empty stamp is already what Clear gives you.');
      return;
    }
    const name = prompt('Name this stamp preset:', 'Preset');
    if (!name) return; // cancelled
    const saved = window.PAE.StampPresetStore.save(name, stampEditorBuffer);
    renderPresetOptions(saved.id);
  });

  openBtn.addEventListener('click', () => {
    stampEditorBuffer = app.stamp.buffer.clone();
    widthInput.value = app.stamp.width;
    heightInput.value = app.stamp.height;
    render();
    renderPresetOptions();
    dialog.showModal();
  });

  cancelBtn.addEventListener('click', () => dialog.close());

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    app.stamp = { width: stampEditorBuffer.width, height: stampEditorBuffer.height, buffer: stampEditorBuffer.clone() };
    renderStampThumb(app);
    dialog.close();
  });

  renderStampThumb(app);
}

window.PAE.initStampEditorPanel = initStampEditorPanel;
