/**
 * ui.js
 * ---------------------------------------------------------------------------
 * Everything about the sidebar (palette management), the toolbar (tool
 * buttons + opacity slider), the status bar, and global keyboard shortcuts.
 * Like menu.js, this file wires DOM <-> app state but delegates real work
 * to the palette manager / tool manager / history it's given.
 */

function initUI(app) {
  initToolbar(app);
  initToolOptions(app);
  initPaletteSidebar(app);
  initColorHistory(app);
  initColorMixer(app);
  initStatusBar(app);
  initShortcuts(app);
  initZoomControls(app);
  initCanvasWheelZoom(app);
}

// ---- Toolbar (tool buttons + opacity) -------------------------------------

function initToolbar(app) {
  const buttons = document.querySelectorAll('#toolbar .tool-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => selectTool(app, btn.dataset.tool));
  });

  const opacitySlider = document.getElementById('opacity-slider');
  opacitySlider.addEventListener('input', () => applyOpacity(app, Number(opacitySlider.value)));

  app.toolManager.onChange(() => highlightActiveTool(app));
  highlightActiveTool(app);
}

// The toolbar's Opacity slider and the Mix section's Opacity slider (see
// initColorMixer below) both drive the exact same app.opacity — this is the
// one place that updates app state and keeps both sliders' displayed values
// in sync, however the change came in.
function applyOpacity(app, percent) {
  app.opacity = percent / 100;
  const pct = `${percent}%`;
  const toolbarSlider = document.getElementById('opacity-slider');
  const toolbarValue = document.getElementById('opacity-value');
  const mixerSlider = document.getElementById('mix-opacity-slider');
  const mixerValue = document.getElementById('mix-opacity-value');
  if (toolbarSlider) toolbarSlider.value = percent;
  if (toolbarValue) toolbarValue.textContent = pct;
  if (mixerSlider) mixerSlider.value = percent;
  if (mixerValue) mixerValue.textContent = pct;
}

function selectTool(app, toolId) {
  app.toolManager.setActive(toolId, app.toolCtx);
  document.getElementById('canvas').style.cursor = app.toolManager.getActiveTool().cursor;
}

function highlightActiveTool(app) {
  document.querySelectorAll('#toolbar .tool-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === app.toolManager.activeId);
  });
}

// ---- Per-tool option panels ------------------------------------------------
// Every tool's own little strip of controls lives in the toolbar, but at
// most a couple are ever visible at once — which ones depends on which tool
// is active (see `VISIBILITY` below; several tools share the same panel,
// e.g. Pencil/Eraser/Mirror Pen all show the Pen Size control, and Mirror
// Pen shows Pen Size AND its own axis toggle). Switching tools is the only
// thing that shows/hides them, so this just listens to the same toolManager
// change event the toolbar buttons themselves already use.
function initToolOptions(app) {
  const panels = {
    shape: document.getElementById('shape-options'),
    blender: document.getElementById('blender-options'),
    pen: document.getElementById('pen-size-options'),
    mirror: document.getElementById('mirror-options'),
    select: document.getElementById('select-options'),
    rotate: document.getElementById('rotate-options'),
    vbrush: document.getElementById('vbrush-options'),
  };
  const VISIBILITY = {
    pencil: ['pen'],
    eraser: ['pen'],
    mirror: ['pen', 'mirror'],
    rect: ['shape'],
    ellipse: ['shape'],
    blender: ['blender'],
    select: ['select'],
    rotate: ['rotate'],
    vbrush: ['vbrush'],
  };

  // ---- Shape (Rectangle/Ellipse): outline vs. filled ----
  const shapeFillCheckbox = document.getElementById('shape-fill-checkbox');
  shapeFillCheckbox.addEventListener('change', () => {
    app.shapeFill = shapeFillCheckbox.checked;
  });

  // ---- Blender: brush radius + blend strength ----
  const blenderRadius = document.getElementById('blender-radius');
  const blenderRadiusValue = document.getElementById('blender-radius-value');
  const blenderStrength = document.getElementById('blender-strength');
  const blenderStrengthValue = document.getElementById('blender-strength-value');
  blenderRadius.addEventListener('input', () => {
    app.blenderRadius = Number(blenderRadius.value);
    blenderRadiusValue.textContent = `${blenderRadius.value}px`;
  });
  blenderStrength.addEventListener('input', () => {
    app.blenderStrength = Number(blenderStrength.value) / 100;
    blenderStrengthValue.textContent = `${blenderStrength.value}%`;
  });

  // ---- Pen Size: shared 1x1/2x2/3x3 control (Pencil, Eraser, Mirror Pen) ----
  const penSizeButtons = Array.from(panels.pen.querySelectorAll('.segmented-btn'));
  penSizeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      app.brushSize = Number(btn.dataset.size);
      penSizeButtons.forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  // ---- Mirror Pen: which axis it mirrors across ----
  const mirrorAxisButtons = [document.getElementById('mirror-axis-x'), document.getElementById('mirror-axis-y')];
  mirrorAxisButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      app.mirrorAxis = btn.dataset.axis;
      mirrorAxisButtons.forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  // ---- Pixel Selection: clipboard + copy/cut to a brand-new layer ----
  document.getElementById('select-copy').addEventListener('click', () => app.copySelection());
  document.getElementById('select-cut').addEventListener('click', () => app.cutSelection());
  document.getElementById('select-paste').addEventListener('click', () => app.pasteSelection());
  document.getElementById('select-copy-new-layer').addEventListener('click', () => app.copySelectionToNewLayer({ cut: false }));
  document.getElementById('select-cut-new-layer').addEventListener('click', () => app.copySelectionToNewLayer({ cut: true }));

  // ---- Rotate Selection: arbitrary-angle slider, re-derived from scratch
  // every move (see RotateSelectionTool.applyAngle) ----
  const rotateAngle = document.getElementById('rotate-angle');
  const rotateAngleValue = document.getElementById('rotate-angle-value');
  rotateAngle.addEventListener('input', () => {
    rotateAngleValue.textContent = `${rotateAngle.value}°`;
    const tool = app.toolManager.getTool('rotate');
    if (tool && tool.applyAngle) tool.applyAngle(app.toolCtx, Number(rotateAngle.value));
  });

  // ---- V Brush: dab radius + hard color-count limit, averaged down from
  // the current Mix grid (see VBrushTool / toolCtx.getMixColors). Its node
  // pipeline (Perlin noise/math/palette-pick/color-clamp) lives in its own
  // dialog, wired independently by vbrushPipeline.js's initVBrushPipelinePanel. ----
  const vbrushRadius = document.getElementById('vbrush-radius');
  const vbrushRadiusValue = document.getElementById('vbrush-radius-value');
  const vbrushColors = document.getElementById('vbrush-colors');
  const vbrushColorsValue = document.getElementById('vbrush-colors-value');
  vbrushRadius.addEventListener('input', () => {
    app.vbrushRadius = Number(vbrushRadius.value);
    vbrushRadiusValue.textContent = `${vbrushRadius.value}px`;
  });
  vbrushColors.addEventListener('input', () => {
    app.vbrushColorLimit = Number(vbrushColors.value);
    vbrushColorsValue.textContent = vbrushColors.value;
  });

  function syncVisibility() {
    const shown = VISIBILITY[app.toolManager.activeId] || [];
    Object.entries(panels).forEach(([key, panel]) => {
      panel.hidden = !shown.includes(key);
    });
    // Rotate Selection re-snapshots from the current selection every time
    // it's (re)activated (see onActivate) — reset the slider to match, so
    // a leftover angle from a previous rotation never looks "already applied".
    if (app.toolManager.activeId === 'rotate') {
      rotateAngle.value = 0;
      rotateAngleValue.textContent = '0°';
    }
  }

  app.toolManager.onChange(syncVisibility);
  syncVisibility();
}

// ---- Sidebar: palette manager ---------------------------------------------

function initPaletteSidebar(app) {
  const paletteSelect = document.getElementById('palette-select');
  const swatchGrid = document.getElementById('swatch-grid');
  const colorPicker = document.getElementById('color-picker');
  const hexInput = document.getElementById('hex-input');

  function renderPaletteList() {
    paletteSelect.innerHTML = '';
    app.palette.getPalettes().forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === app.palette.activePaletteId) opt.selected = true;
      paletteSelect.appendChild(opt);
    });
  }

  function renderSwatches() {
    // No "selected" highlight here anymore — the palette grid is purely a
    // picker now. What's actually selected lives in its own dedicated
    // "Current Color" section (see renderCurrentColor below), since a
    // color picked from the Mix grid or the eyedropper often isn't in any
    // palette at all and couldn't be highlighted here regardless.
    //
    // A palette entry is either a solid color (plain hex string) or a mix
    // set (see palette.js) — PaletteManager.isMixSet tells them apart. Both
    // live in the same grid; a mix set just renders/behaves differently.
    const palette = app.palette.getActivePalette();
    swatchGrid.innerHTML = '';
    palette.colors.forEach((entry, index) => {
      const isMixSet = window.PAE.PaletteManager.isMixSet(entry);
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = isMixSet ? 'swatch swatch-mixset' : 'swatch';

      if (isMixSet) {
        // A 4-way pie preview of its Top/Right/Bottom/Left modifiers — there's
        // no single color to show since a mix set isn't tied to a base.
        swatch.style.background = `conic-gradient(from -45deg, ${entry.top} 0% 25%, ${entry.right} 25% 50%, ${entry.bottom} 50% 75%, ${entry.left} 75% 100%)`;
        swatch.title = `${entry.name} (mix set)`;
        swatch.setAttribute('aria-label', `Mix set: ${entry.name}`);
        swatch.addEventListener('click', () => app.applyMixSet(entry)); // loads the recipe, leaves the base alone
      } else {
        swatch.style.backgroundColor = entry;
        swatch.title = entry;
        swatch.setAttribute('aria-label', `Color ${entry}`);
        swatch.addEventListener('click', () => app.setBaseColor(entry)); // also re-centers the Mix grid on this color
      }

      // Right-click (or long press target) removes an entry — color or mix set — from the palette.
      const deleteBtn = document.createElement('span');
      deleteBtn.className = 'swatch-delete';
      deleteBtn.textContent = '×';
      deleteBtn.title = isMixSet ? 'Remove mix set' : 'Remove color';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        app.palette.removeColor(palette.id, index);
      });
      swatch.appendChild(deleteBtn);
      swatchGrid.appendChild(swatch);
    });
  }

  function renderCurrentColor() {
    const hex = app.palette.getActiveColor();
    document.getElementById('current-color-swatch').style.backgroundColor = hex;
    document.getElementById('current-color-hex').textContent = hex;
    document.getElementById('current-color-swatch-lg').style.backgroundColor = hex;
    document.getElementById('current-color-hex-lg').textContent = hex;
    colorPicker.value = hex;
    hexInput.value = hex;
  }

  function renderAll() {
    renderPaletteList();
    renderSwatches();
    renderCurrentColor();
  }

  app.palette.onChange(renderAll);
  renderAll();

  paletteSelect.addEventListener('change', () => {
    app.palette.setActivePalette(paletteSelect.value);
  });

  document.getElementById('palette-new').addEventListener('click', () => {
    const name = prompt('Name for the new palette:', 'New Palette');
    if (name) app.palette.createPalette(name);
  });

  document.getElementById('palette-rename').addEventListener('click', () => {
    const current = app.palette.getActivePalette();
    const name = prompt('Rename palette:', current.name);
    if (name) app.palette.renamePalette(current.id, name);
  });

  document.getElementById('palette-delete').addEventListener('click', () => {
    const current = app.palette.getActivePalette();
    if (app.palette.getPalettes().length <= 1) {
      alert('You need at least one palette.');
      return;
    }
    if (confirm(`Delete palette "${current.name}"? This cannot be undone.`)) {
      app.palette.deletePalette(current.id);
    }
  });

  // Add color: color-picker and hex-input stay in sync, "Add" commits it.
  colorPicker.addEventListener('input', () => {
    hexInput.value = colorPicker.value;
  });
  hexInput.addEventListener('change', () => {
    const normalized = window.PAE.PaletteManager.normalizeHex(hexInput.value);
    if (normalized) colorPicker.value = normalized;
  });
  document.getElementById('palette-add-color').addEventListener('click', () => {
    const hex = window.PAE.PaletteManager.normalizeHex(hexInput.value) || colorPicker.value;
    app.palette.addColor(app.palette.activePaletteId, hex);
    app.setBaseColor(hex); // newly added color becomes current AND re-centers the Mix grid
  });

  // Eyedropper lives right next to the Current Color swatch it fills in —
  // see App.activateEyedropper for the real-screen-sampling / canvas-only-
  // fallback logic. It's a one-shot action, not a persistent "active tool"
  // toggle, so there's no "active" class to manage most of the time — the
  // only exception is the rare fallback where it DOES become the active
  // canvas tool, which we still want to reflect here.
  const eyedropperBtn = document.getElementById('eyedropper-btn');
  eyedropperBtn.addEventListener('click', () => app.activateEyedropper());
  app.toolManager.onChange(() => {
    eyedropperBtn.classList.toggle('active', app.toolManager.activeId === 'eyedropper');
  });
}

// ---- History: most-recently-used colors ------------------------------------

function initColorHistory(app) {
  const track = document.getElementById('color-history-track');
  const clearBtn = document.getElementById('color-history-clear');

  function render() {
    track.innerHTML = '';
    app.colorHistory.getColors().forEach((hex) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'history-swatch';
      swatch.style.backgroundColor = hex;
      swatch.title = hex;
      swatch.setAttribute('aria-label', `Recently used color ${hex}`);
      swatch.addEventListener('click', () => app.setBaseColor(hex));
      track.appendChild(swatch);
    });
  }

  clearBtn.addEventListener('click', () => {
    if (app.colorHistory.getColors().length && confirm('Clear color history?')) {
      app.colorHistory.clear();
    }
  });

  app.colorHistory.onChange(render);
  render();
}

// ---- Mix section: 3x3 grid centered on a base color -----------------------

function initColorMixer(app) {
  const grid = document.getElementById('mixer-3x3');
  const modInputs = {
    top: document.getElementById('mix-mod-top'),
    bottom: document.getElementById('mix-mod-bottom'),
    left: document.getElementById('mix-mod-left'),
    right: document.getElementById('mix-mod-right'),
  };
  const mixSlider = document.getElementById('mix-amount-slider');
  const mixValue = document.getElementById('mix-amount-value');
  const opacitySlider = document.getElementById('mix-opacity-slider');

  // Built once; only background color / stored hex change on re-render, so
  // clicking never has to fight a grid that just rebuilt itself.
  const cellKeys = ['topLeft', 'top', 'topRight', 'left', 'center', 'right', 'bottomLeft', 'bottom', 'bottomRight'];
  const cells = cellKeys.map((key) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mixer-cell' + (key === 'center' ? ' mixer-cell-center' : '');
    btn.dataset.key = key;
    btn.addEventListener('click', () => {
      // Picking any cell (including the center) changes what you paint
      // with, but never moves the grid's base — see App.pickMixedColor.
      if (btn.dataset.hex) app.pickMixedColor(btn.dataset.hex);
    });
    grid.appendChild(btn);
    return btn;
  });

  function render() {
    const [[tl, t, tr], [l, c, r], [bl, b, br]] = app.colorMixer.getGrid();
    const values = { topLeft: tl, top: t, topRight: tr, left: l, center: c, right: r, bottomLeft: bl, bottom: b, bottomRight: br };
    cells.forEach((btn) => {
      const hex = values[btn.dataset.key];
      btn.style.backgroundColor = hex;
      btn.dataset.hex = hex;
      btn.title = btn.dataset.key === 'center' ? `Base ${hex}` : hex;
    });
    // Keep the 4 modifier <input type=color> values in sync in case they
    // were changed some other way (e.g. a future "reset" action).
    Object.entries(modInputs).forEach(([dir, input]) => {
      if (input.value.toLowerCase() !== app.colorMixer.modifiers[dir]) {
        input.value = app.colorMixer.modifiers[dir];
      }
    });
  }

  Object.entries(modInputs).forEach(([dir, input]) => {
    input.addEventListener('input', () => app.colorMixer.setModifier(dir, input.value));
  });

  mixSlider.addEventListener('input', () => {
    mixValue.textContent = `${mixSlider.value}%`;
    app.colorMixer.setMixAmount(Number(mixSlider.value) / 100);
  });

  opacitySlider.addEventListener('input', () => applyOpacity(app, Number(opacitySlider.value)));

  document.getElementById('mix-save-set').addEventListener('click', () => {
    const name = prompt('Name this mix set:', 'Mix Set');
    if (!name) return; // cancelled
    app.saveCurrentMixAsSet(name);
  });

  app.colorMixer.onChange(render);
  render();
}

// ---- Status bar (zoom %, cursor position) ----------------------------------

function initStatusBar(app) {
  const canvas = document.getElementById('canvas');
  const posLabel = document.getElementById('status-position');

  canvas.addEventListener('mousemove', (evt) => {
    const { x, y } = app.canvasView.eventToPixel(evt);
    if (app.buffer.inBounds(x, y)) {
      posLabel.textContent = `${x}, ${y}`;
    }
  });
  canvas.addEventListener('mouseleave', () => {
    posLabel.textContent = '—';
  });
}

function initZoomControls(app) {
  const zoomLabel = document.getElementById('status-zoom');
  document.getElementById('zoom-in').addEventListener('click', () => app.canvasView.zoomIn());
  document.getElementById('zoom-out').addEventListener('click', () => app.canvasView.zoomOut());
  app.canvasView.onZoomChange((zoom) => {
    zoomLabel.textContent = `${Math.round((zoom / 12) * 100)}%`;
  });
  // Trigger once at startup so the label isn't blank.
  zoomLabel.textContent = `${Math.round((app.canvasView.zoom / 12) * 100)}%`;
}

// Ctrl/Cmd + scroll-wheel zooms the canvas in and out, matching the
// convention used by most image editors and design tools (a plain scroll,
// without the modifier, is left alone so the viewport can still be panned
// normally on a canvas too big to fit on screen).
function initCanvasWheelZoom(app) {
  const viewport = document.getElementById('canvas-viewport');
  viewport.addEventListener(
    'wheel',
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault(); // also stops the browser's own page-zoom gesture
      if (e.deltaY < 0) app.canvasView.zoomIn();
      else if (e.deltaY > 0) app.canvasView.zoomOut();
    },
    { passive: false }
  );
}

// ---- Keyboard shortcuts -----------------------------------------------------

function initShortcuts(app) {
  window.addEventListener('keydown', (e) => {
    const inTextField = /^(input|textarea)$/i.test(document.activeElement.tagName);
    if (inTextField) return; // don't hijack typing in the hex box, etc.

    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault();
      app.undo();
      return;
    }
    if (meta && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
      e.preventDefault();
      app.redo();
      return;
    }
    // Clipboard: ordinary same-layer copy/cut/paste of the current pixel
    // selection (use the Pixel Selection tool's own "…to New Layer" buttons
    // for the two-tier "or to a new layer" behavior — see ui.js's select-options).
    if (meta && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      app.copySelection();
      return;
    }
    if (meta && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      app.cutSelection();
      return;
    }
    if (meta && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      app.pasteSelection();
      return;
    }
    if (meta) return; // leave other ctrl/cmd combos alone

    switch (e.key.toLowerCase()) {
      case 'b':
        selectTool(app, 'pencil');
        break;
      case 'g':
        selectTool(app, 'fill');
        break;
      case 'i':
        app.activateEyedropper();
        break;
      case 'l':
        selectTool(app, 'line');
        break;
      // Rectangle uses U rather than R since R already flips the Overlay
      // mode's reference target (see below) — Aseprite/Photoshop-style
      // mnemonics don't all fit here without colliding with shortcuts this
      // app already had first.
      case 'u':
        selectTool(app, 'rect');
        break;
      case 'o':
        selectTool(app, 'ellipse');
        break;
      case 'm':
        selectTool(app, 'blender');
        break;
      case 'k':
        selectTool(app, 'eraser');
        break;
      case 'f':
        selectTool(app, 'mirror');
        break;
      case 's':
        selectTool(app, 'select');
        break;
      case 't':
        selectTool(app, 'rotate');
        break;
      case 'v':
        selectTool(app, 'vbrush');
        break;
      // New blank frame (Q) / duplicate frame (E), always inserted right
      // after whichever frame is current — same as hovering the filmstrip's
      // gap just after the current tile and clicking its blank/duplicate button.
      case 'q':
        app.quickAddFrame(false);
        break;
      case 'e':
        app.quickAddFrame(true);
        break;
      case '+':
      case '=':
        app.canvasView.zoomIn();
        break;
      case '-':
        app.canvasView.zoomOut();
        break;
      // Frame navigation: [ and ] were the originals; A/D and the arrow
      // keys are aliases for the same thing so you can flip through an
      // animation without leaving the home row or reaching for the mouse.
      case '[':
      case 'a':
      case 'arrowleft':
        e.preventDefault();
        app.goPrevFrame();
        break;
      case ']':
      case 'd':
      case 'arrowright':
        e.preventDefault();
        app.goNextFrame();
        break;
      // Flips the Overlay mode's reference target between Prev ("what it
      // was") and Next ("what it's becoming"). Harmless outside Overlay
      // mode too — it just updates which one shows next time you switch to it.
      case 'r':
        if (app.toggleOverlayTarget) app.toggleOverlayTarget();
        break;
    }
  });
}

window.PAE = window.PAE || {};
window.PAE.initUI = initUI;
