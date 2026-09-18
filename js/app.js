/**
 * app.js
 * ---------------------------------------------------------------------------
 * The composition root. Every other file defines a class or a namespace
 * function and does nothing on its own; this file is where they're all
 * instantiated and wired together. If you're trying to understand how the
 * pieces fit, start here.
 *
 * Why a global `window.PAE` namespace instead of ES modules? So this app
 * runs by simply double-clicking index.html — no bundler, no dev server,
 * no CORS restrictions on `file://` imports.
 *
 * Every project (see spriteProject.js) is a sequence of one or more frames.
 * `app.project.buffer` / `app.project.history` always refer to whichever
 * frame is currently active — App exposes them as `buffer` / `history`
 * getters so the rest of the code (tools, status bar, etc.) doesn't need
 * to know frames exist at all.
 */

(function () {
  const DEFAULT_WIDTH = 32;
  const DEFAULT_HEIGHT = 32;

  class App {
    constructor() {
      this.project = window.PAE.SpriteProject.blank(DEFAULT_WIDTH, DEFAULT_HEIGHT);
      this.palette = new window.PAE.PaletteManager();
      this.colorMixer = new window.PAE.ColorMixer();
      this.colorMixer.setBase(this.palette.getActiveColor()); // mixer starts centered on whatever's active
      this.colorHistory = new window.PAE.ColorHistory();
      this.colorHistory.record(this.palette.getActiveColor()); // seed it so History isn't empty on first run
      this.toolManager = new window.PAE.ToolManager();
      this.opacity = 1; // 0-1, read by tools through toolCtx.getOpacity()
      this.shapeFill = false; // Rectangle/Ellipse: outline (false) vs filled (true) — see the toolbar's Fill checkbox
      this.blenderRadius = 3; // Blender brush: circular radius in pixels
      this.blenderStrength = 0.6; // Blender brush: 0-1, how far each dab moves pixels toward the local average
      this.brushSize = 1; // "Pen Size": 1, 2, or 3 — shared by Pencil, Eraser, Mirror Pen (see the toolbar's Size control)
      this.mirrorAxis = 'x'; // Mirror Pen: 'x' mirrors left-right, 'y' mirrors top-bottom
      this.vbrushRadius = 4; // V Brush: circular radius in pixels
      this.vbrushColorLimit = 8; // V Brush: hard cap on distinct colors it'll use per dab
      this.vbrushPipeline = { nodes: [] }; // V Brush: ordered node list (Perlin noise/math/palette-pick/color-clamp) — see vbrushPipeline.js. Empty = the brush's original, simpler behavior.
      this.selection = new window.PAE.Selection(); // Pixel Selection tool's current rectangle, or null
      this.clipboard = null; // { x, y, buffer } from the last Copy/Cut — see copySelection()
      this._filterSnapshot = null; // pre-filter buffer, while a filter dialog is open — see openBrightnessContrastDialog()
      this._changeListeners = [];

      const canvasEl = document.getElementById('canvas');
      const viewportEl = document.getElementById('canvas-viewport');
      // A live callback, not a stored buffer — a frame can hold several
      // layers now (see layer.js), so what the canvas actually shows is
      // "flatten every visible layer," recomputed fresh on every render()
      // rather than a single object reference that would go stale the
      // moment a different layer changed.
      this.canvasView = new window.PAE.CanvasView(canvasEl, viewportEl, () => this.project.getDisplayBuffer());

      this.referenceView = new window.PAE.ReferenceView(
        {
          prevPane: document.getElementById('ref-pane-prev'),
          nextPane: document.getElementById('ref-pane-next'),
          prevCanvas: document.getElementById('ref-canvas-prev'),
          nextCanvas: document.getElementById('ref-canvas-next'),
          prevPlaceholder: document.getElementById('ref-placeholder-prev'),
          nextPlaceholder: document.getElementById('ref-placeholder-next'),
          prevOverlayCanvas: document.getElementById('ref-canvas-prev-overlay'),
          nextOverlayCanvas: document.getElementById('ref-canvas-next-overlay'),
        },
        () => this.canvasView.zoom
      );
      // Zooming the main canvas should keep every reference view in lockstep.
      this.canvasView.onZoomChange(() => this.referenceView.render(this.project));

      // The interface every tool interacts through (see tools/tool.js).
      // buffer/history are getters (not plain properties) so they always
      // resolve to whichever frame is current, even after switching frames —
      // no manual re-syncing needed anywhere else in the app.
      const app = this;
      this.toolCtx = {
        get buffer() {
          return app.project.buffer;
        },
        get history() {
          return app.project.history;
        },
        getColor: () => window.PAE.PaletteManager.hexToRgb(this.palette.getActiveColor()),
        getOpacity: () => this.opacity,
        getShapeFill: () => this.shapeFill,
        getBlenderRadius: () => this.blenderRadius,
        getBlenderStrength: () => this.blenderStrength,
        getBrushSize: () => this.brushSize,
        getMirrorAxis: () => this.mirrorAxis,
        getSelection: () => this.selection.get(),
        setSelection: (rect) => this.selection.set(rect),
        getMixColors: () => this.colorMixer.getGrid().flat().map(window.PAE.PaletteManager.hexToRgb),
        getVBrushRadius: () => this.vbrushRadius,
        getVBrushColorLimit: () => this.vbrushColorLimit,
        getVBrushPipeline: () => this.vbrushPipeline,
        pickColor: (hex) => this.setBaseColor(hex),
        requestRender: () => this.canvasView.render(),
      };

      // ---- Register built-in tools --------------------------------------
      // To add a new tool, register it here (see tools/tool.js for the guide).
      this.toolManager.register(new window.PAE.PencilTool());
      this.toolManager.register(new window.PAE.FillTool());
      this.toolManager.register(new window.PAE.EyedropperTool());
      this.toolManager.register(new window.PAE.LineTool());
      this.toolManager.register(new window.PAE.ShapeTool('rect', 'Rectangle'));
      this.toolManager.register(new window.PAE.ShapeTool('ellipse', 'Ellipse'));
      this.toolManager.register(new window.PAE.BlenderTool());
      this.toolManager.register(new window.PAE.EraserTool());
      this.toolManager.register(new window.PAE.MirrorPenTool());
      this.toolManager.register(new window.PAE.PixelSelectionTool());
      this.toolManager.register(new window.PAE.RotateSelectionTool());
      this.toolManager.register(new window.PAE.VBrushTool());

      this._wireCanvasEvents(canvasEl);
      this.canvasView.render();
    }

    // ---- buffer/history always reflect the CURRENT frame ------------------

    get buffer() {
      return this.project.buffer;
    }

    get history() {
      return this.project.history;
    }

    // ---- lightweight pub-sub so the menu bar / filmstrip / reference bar
    // can stay in sync with app state without caring about *why* it changed
    // (drawing, undo, switching frames, loading a file, ...). See menu.js,
    // filmstrip.js, referenceBar.js.

    onChange(fn) {
      this._changeListeners.push(fn);
    }

    notifyChange() {
      this._changeListeners.forEach((fn) => fn(this));
    }

    // ---- current color / color mixer --------------------------------------
    // Two related but distinct ideas: `palette.activeColor` is whatever
    // color tools actually paint with right now; `colorMixer.base` is the
    // color the Mix section's 3x3 grid is centered on. They start out equal
    // but can diverge — picking one of the mixed swatches changes what you
    // paint with WITHOUT recentering the grid (see colorMixer.js's header
    // comment for why: so the grid keeps reading relative to one anchor
    // color instead of jumping around every click).

    /** Palette swatch click, a History swatch, or the eyedropper: sets the active color AND re-centers the mixer. */
    setBaseColor(hex) {
      this.palette.setActiveColor(hex);
      this.colorMixer.setBase(hex);
      this.colorHistory.record(hex);
    }

    /** Clicking a cell in the Mix grid: changes what you paint with, leaves the grid's base alone. */
    pickMixedColor(hex) {
      this.palette.setActiveColor(hex);
      this.colorHistory.record(hex);
    }

    // ---- mix sets: saved, reusable Top/Bottom/Left/Right shading recipes --
    // (see palette.js's header comment and PaletteManager.addMixSet/_cleanMixSet)

    /** Loads a saved mix set's 4 modifiers + mix amount into the grid, applied to whatever base is current. */
    applyMixSet(mixSet) {
      this.colorMixer.applyRecipe(mixSet);
    }

    /** The Mix section's "Save as Mix Set…" button: snapshots the CURRENT modifiers/mix amount, not the base. */
    saveCurrentMixAsSet(name) {
      const { top, bottom, left, right } = this.colorMixer.modifiers;
      return this.palette.addMixSet(this.palette.activePaletteId, {
        type: 'mix',
        name,
        top,
        bottom,
        left,
        right,
        mixAmount: this.colorMixer.mixAmount,
      });
    }

    // ---- layers -------------------------------------------------------
    // A frame is a stack of Layer objects (see layer.js/spriteProject.js);
    // tools always paint on the ACTIVE one. Every method here commits
    // history first (except pure cosmetics/navigation — rename, and
    // switching which layer is active, since neither changes the picture)
    // so add/delete/reorder/visibility are as undoable as a brush stroke.

    addLayer() {
      this.history.commit();
      this.project.currentFrame.addLayer();
      this.canvasView.render();
      this.notifyChange();
    }

    deleteLayer(index) {
      this.history.commit();
      if (this.project.currentFrame.deleteLayerAt(index)) {
        this.canvasView.render();
        this.notifyChange();
      }
    }

    moveLayer(index, delta) {
      this.history.commit();
      if (this.project.currentFrame.moveLayerAt(index, delta)) {
        this.notifyChange();
      }
    }

    toggleLayerVisibility(index) {
      this.history.commit();
      this.project.currentFrame.toggleLayerVisibilityAt(index);
      this.canvasView.render();
      this.notifyChange();
    }

    renameLayer(index, name) {
      this.project.currentFrame.renameLayerAt(index, name);
      this.notifyChange();
    }

    /** Which layer tools paint on next — doesn't touch the picture, so no history entry. */
    setActiveLayer(index) {
      this.project.currentFrame.setActiveLayerIndex(index);
      this.notifyChange();
    }

    // ---- pixel selection: clipboard + copy/cut to a new layer -------------
    // See selection.js for why a selection itself isn't part of undo
    // history — only the actual pixel/layer mutations below are.

    /** Snapshots the selected pixels into `this.clipboard`, remembering their original position so Paste can put them back exactly where they were by default. */
    copySelection() {
      const sel = this.selection.get();
      if (!sel) return;
      const source = this.buffer;
      const snippet = new window.PAE.PixelBuffer(sel.w, sel.h);
      for (let y = 0; y < sel.h; y++) {
        for (let x = 0; x < sel.w; x++) {
          snippet.setPixel(x, y, source.getPixel(sel.x + x, sel.y + y) || [0, 0, 0, 0]);
        }
      }
      this.clipboard = { x: sel.x, y: sel.y, buffer: snippet };
    }

    /** Copy, then clear the selected pixels from the active layer — an ordinary same-layer cut. */
    cutSelection() {
      const sel = this.selection.get();
      if (!sel) return;
      this.copySelection();
      this.history.commit();
      const buf = this.buffer;
      for (let y = 0; y < sel.h; y++) {
        for (let x = 0; x < sel.w; x++) buf.setPixel(sel.x + x, sel.y + y, [0, 0, 0, 0]);
      }
      this.canvasView.render();
      this.notifyChange();
    }

    /** Blends the clipboard back onto the ACTIVE layer at its original position — an ordinary same-layer paste (use "Copy/Cut to New Layer" below for a real new layer instead). */
    pasteSelection() {
      if (!this.clipboard) return;
      this.history.commit();
      const { x, y, buffer } = this.clipboard;
      const target = this.buffer;
      for (let dy = 0; dy < buffer.height; dy++) {
        for (let dx = 0; dx < buffer.width; dx++) {
          const p = buffer.getPixel(dx, dy);
          if (p[3] > 0) target.blendPixel(x + dx, y + dy, [p[0], p[1], p[2]], p[3] / 255);
        }
      }
      this.selection.set({ x, y, w: buffer.width, h: buffer.height });
      this.canvasView.render();
      this.notifyChange();
    }

    /**
     * "Copy to New Layer" / "Cut to New Layer" — builds a full-frame-size,
     * otherwise-transparent layer containing just the selected pixels AT
     * THEIR ORIGINAL POSITION (so nothing visually shifts — it just becomes
     * its own layer) and inserts it right above the active layer. Cut also
     * clears those pixels from the layer they came from. One history.commit()
     * covers both the source-clear and the new layer, since a frame's undo
     * snapshot already captures its whole layer stack (see spriteProject.js).
     */
    copySelectionToNewLayer({ cut = false } = {}) {
      const sel = this.selection.get();
      if (!sel) return;
      const frame = this.project.currentFrame;
      const sourceLayer = frame.activeLayer;
      const buf = sourceLayer.buffer;
      const snippet = window.PAE.PixelBuffer.createBlank(frame.width, frame.height);
      for (let y = 0; y < sel.h; y++) {
        for (let x = 0; x < sel.w; x++) {
          const p = buf.getPixel(sel.x + x, sel.y + y);
          if (p && p[3] > 0) snippet.setPixel(sel.x + x, sel.y + y, p);
        }
      }
      this.history.commit();
      if (cut) {
        for (let y = 0; y < sel.h; y++) {
          for (let x = 0; x < sel.w; x++) sourceLayer.buffer.setPixel(sel.x + x, sel.y + y, [0, 0, 0, 0]);
        }
      }
      frame.insertLayerAbove(`${cut ? 'Cut' : 'Copy'} of ${sourceLayer.name}`, snippet);
      this.canvasView.render();
      this.notifyChange();
    }

    // ---- image adjustment filters ------------------------------------------
    // All operate on the ACTIVE LAYER of the current frame (see filters.js).
    // Grayscale/Invert are one-click, parameterless — commit then apply.
    // Brightness/Contrast and Hue/Saturation use a dialog with live preview:
    // open snapshots the pre-filter buffer AND commits history once (so
    // Cancel vs. Apply just decides whether that one committed step ends up
    // a no-op or the real change); every slider move re-applies the filter
    // fresh from that snapshot so repeated adjustment never compounds.

    applyGrayscale() {
      this.history.commit();
      window.PAE.Filters.grayscale(this.buffer);
      this.canvasView.render();
      this.notifyChange();
    }

    applyInvert() {
      this.history.commit();
      window.PAE.Filters.invert(this.buffer);
      this.canvasView.render();
      this.notifyChange();
    }

    openBrightnessContrastDialog() {
      this.history.commit();
      this._filterSnapshot = this.buffer.clone();
      document.getElementById('bc-brightness').value = 0;
      document.getElementById('bc-contrast').value = 0;
      document.getElementById('brightness-contrast-dialog').showModal();
    }

    previewBrightnessContrast() {
      if (!this._filterSnapshot) return;
      const brightness = Number(document.getElementById('bc-brightness').value);
      const contrast = Number(document.getElementById('bc-contrast').value);
      this.buffer.copyFrom(this._filterSnapshot);
      window.PAE.Filters.brightnessContrast(this.buffer, brightness, contrast);
      this.canvasView.render();
    }

    openHueSaturationDialog() {
      this.history.commit();
      this._filterSnapshot = this.buffer.clone();
      document.getElementById('hs-hue').value = 0;
      document.getElementById('hs-saturation').value = 0;
      document.getElementById('hue-saturation-dialog').showModal();
    }

    previewHueSaturation() {
      if (!this._filterSnapshot) return;
      const hue = Number(document.getElementById('hs-hue').value);
      const saturation = Number(document.getElementById('hs-saturation').value);
      this.buffer.copyFrom(this._filterSnapshot);
      window.PAE.Filters.hueSaturation(this.buffer, hue, saturation);
      this.canvasView.render();
    }

    /** Cancel restores the pre-filter snapshot (leaving the earlier history.commit() a no-op step); Apply just keeps whatever's currently previewed. */
    closeFilterDialog({ cancel }) {
      if (cancel && this._filterSnapshot) this.buffer.copyFrom(this._filterSnapshot);
      this._filterSnapshot = null;
      this.canvasView.render();
      this.notifyChange();
    }

    // ---- eyedropper -------------------------------------------------------

    /**
     * Tries the browser's real EyeDropper API first — when supported, this
     * samples ANY pixel currently visible on screen, not just this app's own
     * canvas, exactly like a real eyedropper. Falls back to the canvas-only
     * EyedropperTool (see tools/eyedropperTool.js) when that API doesn't
     * exist (e.g. non-Chromium browsers) or refuses to run here (some
     * sandboxed/embedded contexts block it) — sampling from the canvas
     * itself is still the common case anyway.
     */
    async activateEyedropper() {
      if (window.EyeDropper) {
        try {
          const result = await new window.EyeDropper().open();
          this.setBaseColor(result.sRGBHex);
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return; // user pressed Escape / clicked away — just cancel
          // Anything else (unsupported in this embedding context, etc.) — fall through to the canvas tool.
        }
      }
      this.toolManager.setActive('eyedropper', this.toolCtx);
      const canvasEl = document.getElementById('canvas');
      canvasEl.style.cursor = this.toolManager.getActiveTool().cursor;
    }

    // ---- undo/redo (always act on the CURRENT frame's history) -----------

    undo() {
      if (this.project.history.undo()) {
        this.canvasView.render();
        this.notifyChange();
      }
    }

    redo() {
      if (this.project.history.redo()) {
        this.canvasView.render();
        this.notifyChange();
      }
    }

    // ---- frame navigation & management ------------------------------------
    // A "frame" swap always re-points the canvas at the new frame's buffer
    // and re-renders whatever reference panels are currently visible, since
    // the prev/next neighbors just changed too.

    _afterFrameChange() {
      // A selection's coordinates only make sense on the frame they were
      // drawn on, so switching frames clears it (the clipboard survives,
      // though — copying on one frame and pasting on another is fine).
      this.selection.clear();
      this.canvasView.render();
      this.referenceView.render(this.project);
      this.notifyChange();
    }

    goPrevFrame() {
      this.project.goPrev();
      this._afterFrameChange();
    }

    goNextFrame() {
      this.project.goNext();
      this._afterFrameChange();
    }

    /** Jump straight to a frame by index (the filmstrip's click-to-select). */
    goToFrame(index) {
      this.project.goTo(index);
      this._afterFrameChange();
    }

    /**
     * Insert a new frame at `atIndex` (the filmstrip's hover-to-add gaps —
     * atIndex 0 is before the first frame, frameCount() is after the last).
     * Duplicating picks the frame just before the gap as the source, since
     * that's what "the frame chosen" means for a gap with no frame of its
     * own; the leading gap (nothing before it) falls back to frame 0.
     */
    insertFrameAt(atIndex, { duplicate = false } = {}) {
      const duplicateFromIndex = duplicate ? Math.max(0, atIndex - 1) : undefined;
      this.project.insertFrame(atIndex, duplicateFromIndex);
      this._afterFrameChange();
    }

    deleteFrameAt(index) {
      if (this.project.deleteFrameAt(index)) this._afterFrameChange();
    }

    /** The "Q"/"E" shortcuts (see ui.js): always relative to whatever frame is current right now. */
    quickAddFrame(duplicate) {
      this.insertFrameAt(this.project.currentIndex + 1, { duplicate });
    }

    // ---- File menu actions --------------------------------------------

    promptNewImage() {
      const dialog = document.getElementById('new-image-dialog');
      document.getElementById('new-image-width').value = this.project.frameWidth;
      document.getElementById('new-image-height').value = this.project.frameHeight;
      dialog.showModal();
    }

    confirmNewImage(width, height) {
      width = Math.max(1, Math.min(512, Math.round(width) || DEFAULT_WIDTH));
      height = Math.max(1, Math.min(512, Math.round(height) || DEFAULT_HEIGHT));
      this.project = window.PAE.SpriteProject.blank(width, height);
      this._afterFrameChange();
    }

    openImageFromDisk() {
      document.getElementById('open-file-input').click();
    }

    async loadImageFile(file) {
      try {
        const buffer = await window.PAE.FileIO.openImageFile(file);
        // Opening a file always starts a fresh 1-frame project — the
        // image's own size becomes this project's fixed frame size. Grow
        // it into an animation afterwards with the filmstrip below the canvas.
        this.project = window.PAE.SpriteProject.fromSingleImage(buffer);
        this._afterFrameChange();
      } catch (err) {
        alert(err.message || 'Could not open that file.');
      }
    }

    // ---- Import: multiple separate PNGs -> one multi-frame project --------

    importFramesFromDisk() {
      document.getElementById('import-frames-input').click();
    }

    /**
     * Loads several individually-chosen image files and turns them into a
     * brand-new multi-frame project — one frame per file, in filename
     * order (frame_01.png, frame_02.png, ... rather than whatever order the
     * OS file picker happened to report, which isn't necessarily filename
     * order). Every frame in a SpriteProject must share one fixed size
     * (see spriteProject.js), so if the chosen images aren't all the same
     * size, the LARGEST width and height across all of them becomes that
     * fixed size, and any smaller image is placed in the top-left corner
     * of it and padded with transparency — this never crops/loses a single
     * pixel of what was imported, at the cost of images needing a manual
     * re-align afterwards if they weren't meant to share a top-left origin.
     */
    async importFramesFromFiles(fileList) {
      const files = Array.from(fileList || []);
      if (!files.length) return;
      try {
        const loaded = await window.PAE.FileIO.openImageFiles(files);
        loaded.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: 'base' }));
        const maxWidth = Math.max(...loaded.map((l) => l.buffer.width));
        const maxHeight = Math.max(...loaded.map((l) => l.buffer.height));
        const anyDifferentSize = loaded.some((l) => l.buffer.width !== maxWidth || l.buffer.height !== maxHeight);
        const frames = loaded.map(({ buffer }) => {
          let framebuf = buffer;
          if (buffer.width !== maxWidth || buffer.height !== maxHeight) {
            framebuf = window.PAE.PixelBuffer.createBlank(maxWidth, maxHeight);
            framebuf.blit(buffer, 0, 0);
          }
          return new window.PAE.Frame(maxWidth, maxHeight, [new window.PAE.Layer('Layer 1', framebuf)]);
        });
        this.project = new window.PAE.SpriteProject(maxWidth, maxHeight, frames);
        this._afterFrameChange();
        if (anyDifferentSize) {
          alert(
            `Imported ${frames.length} frames as a ${maxWidth}×${maxHeight} project. Some of those images were a different size, so they were placed in the top-left corner and padded with transparency to match — nudge them into place with the Pixel Selection tool if that's not where they belong.`
          );
        }
      } catch (err) {
        alert(err.message || 'Could not import those files.');
      }
    }

    // ---- Import: one existing sprite-sheet PNG -> sliced into frames ------

    importSpriteSheetFromDisk() {
      document.getElementById('import-spritesheet-input').click();
    }

    async loadSpriteSheetFile(file) {
      try {
        this._pendingSpriteSheet = await window.PAE.FileIO.openImageFile(file);
        this._openImportSpriteSheetDialog();
      } catch (err) {
        alert(err.message || 'Could not open that file.');
      }
    }

    /**
     * Opens the slice-into-frames dialog for whatever image was just loaded
     * into `this._pendingSpriteSheet`. Defaults Frame Width/Height to the
     * image's own HEIGHT for both — a guess that square tiles are the most
     * common sprite-sheet layout, giving a sensible non-trivial starting
     * grid (rather than defaulting to the whole image as "1 frame", which
     * would need every value typed in from scratch) — Roger just adjusts
     * from there if the sheet isn't actually square-tiled.
     */
    _openImportSpriteSheetDialog() {
      const buffer = this._pendingSpriteSheet;
      if (!buffer) return;
      const guess = Math.max(1, Math.min(buffer.width, buffer.height));
      document.getElementById('import-sheet-frame-width').value = guess;
      document.getElementById('import-sheet-frame-height').value = guess;
      this.renderImportSheetPreview();
      document.getElementById('import-spritesheet-dialog').showModal();
    }

    /**
     * Redraws the sheet-slicing dialog's preview canvas (the loaded image,
     * scaled to fit, with red grid lines at every current frame boundary)
     * and its "N × M = frames" hint line. Called once when the dialog opens
     * and again on every Frame Width/Height edit, so the grid always
     * reflects exactly what Import is about to slice.
     */
    renderImportSheetPreview() {
      const buffer = this._pendingSpriteSheet;
      const canvas = document.getElementById('import-sheet-preview-canvas');
      const hint = document.getElementById('import-sheet-hint');
      if (!buffer || !canvas) return;

      const frameWidth = Math.max(1, Math.round(Number(document.getElementById('import-sheet-frame-width').value) || 1));
      const frameHeight = Math.max(1, Math.round(Number(document.getElementById('import-sheet-frame-height').value) || 1));
      const cols = Math.max(0, Math.floor(buffer.width / frameWidth));
      const rows = Math.max(0, Math.floor(buffer.height / frameHeight));

      const MAX_DISPLAY = 260;
      const scale = Math.max(1, Math.min(8, MAX_DISPLAY / Math.max(buffer.width, buffer.height)));
      canvas.width = Math.round(buffer.width * scale);
      canvas.height = Math.round(buffer.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;

      // Draw the loaded sheet itself, scaled up/down via an offscreen
      // native-resolution canvas (putImageData can't target a different
      // size directly).
      const src = document.createElement('canvas');
      src.width = buffer.width;
      src.height = buffer.height;
      src.getContext('2d').putImageData(buffer.toImageData(), 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(src, 0, 0, buffer.width, buffer.height, 0, 0, canvas.width, canvas.height);

      if (cols > 0 && rows > 0) {
        ctx.strokeStyle = 'rgba(230, 57, 70, 0.9)';
        ctx.lineWidth = 1;
        for (let c = 1; c < cols; c++) {
          const x = Math.round(c * frameWidth * scale) + 0.5;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, rows * frameHeight * scale);
          ctx.stroke();
        }
        for (let r = 1; r < rows; r++) {
          const y = Math.round(r * frameHeight * scale) + 0.5;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(cols * frameWidth * scale, y);
          ctx.stroke();
        }
        ctx.strokeRect(0.5, 0.5, cols * frameWidth * scale - 1, rows * frameHeight * scale - 1);
      }

      const total = cols * rows;
      const leftoverX = buffer.width - cols * frameWidth;
      const leftoverY = buffer.height - rows * frameHeight;
      let msg =
        total > 0
          ? `${cols} × ${rows} = ${total} frame${total === 1 ? '' : 's'} out of this ${buffer.width}×${buffer.height}px image.`
          : `Frame size is larger than the image (${buffer.width}×${buffer.height}px) — pick smaller values.`;
      if (total > 0 && (leftoverX > 0 || leftoverY > 0)) {
        msg += ` ${leftoverX > 0 ? leftoverX + 'px on the right' : ''}${leftoverX > 0 && leftoverY > 0 ? ' and ' : ''}${
          leftoverY > 0 ? leftoverY + 'px on the bottom' : ''
        } won't fit a full frame and will be left out.`;
      }
      hint.textContent = msg;
    }

    /** Slices `this._pendingSpriteSheet` into a grid of frameWidth×frameHeight frames (row-major: left-to-right, then top-to-bottom) and makes that the new project. */
    confirmImportSpriteSheet(frameWidth, frameHeight) {
      const buffer = this._pendingSpriteSheet;
      if (!buffer) return;
      frameWidth = Math.max(1, Math.round(frameWidth) || 1);
      frameHeight = Math.max(1, Math.round(frameHeight) || 1);
      const cols = Math.floor(buffer.width / frameWidth);
      const rows = Math.floor(buffer.height / frameHeight);
      if (cols < 1 || rows < 1) {
        alert('That frame size is larger than the image itself — pick smaller Frame Width/Height values.');
        return false; // tells the dialog's submit handler NOT to close — let them adjust and retry without re-choosing the file
      }
      const frames = [];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const region = window.PAE.PixelBuffer.extractRegion(buffer, col * frameWidth, row * frameHeight, frameWidth, frameHeight);
          frames.push(new window.PAE.Frame(frameWidth, frameHeight, [new window.PAE.Layer('Layer 1', region)]));
        }
      }
      this.project = new window.PAE.SpriteProject(frameWidth, frameHeight, frames);
      this._afterFrameChange();
      this._pendingSpriteSheet = null;
      return true;
    }

    cancelImportSpriteSheet() {
      this._pendingSpriteSheet = null;
    }

    /**
     * Opens the Export dialog instead of exporting immediately, so the
     * person can name the file (and, on browsers with the File System
     * Access API, pick WHERE it goes too — see FileIO.exportImage) rather
     * than always getting a fixed "pixel-art"/"sprite-sheet" name dropped
     * into their default downloads folder.
     */
    promptExport(format) {
      const dialog = document.getElementById('export-dialog');
      const multiFrame = this.project.frameCount() > 1;
      document.getElementById('export-filename').value = multiFrame ? 'sprite-sheet' : 'pixel-art';
      dialog.querySelectorAll('[data-export-format]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.exportFormat === format);
      });
      const hint = document.getElementById('export-hint');
      hint.textContent =
        typeof window.showSaveFilePicker === 'function'
          ? 'Your browser will let you choose exactly where to save it.'
          : 'Saves to your browser’s downloads location.';
      dialog.showModal();
      document.getElementById('export-filename').select();
    }

    /** Reads whichever format button is marked `.active` in the Export dialog. */
    _selectedExportFormat() {
      const active = document.querySelector('#export-dialog [data-export-format].active');
      return active ? active.dataset.exportFormat : 'png';
    }

    async confirmExport(filename, format) {
      try {
        // A single-frame project exports exactly as it always did. A
        // multi-frame project is combined left-to-right into one sprite
        // sheet image first — that's the whole "save as a sprite sheet"
        // behavior, no separate export mode needed.
        const multiFrame = this.project.frameCount() > 1;
        // getDisplayBuffer(), not project.buffer (the active layer only) —
        // export always needs every visible layer flattened together.
        const image = multiFrame ? this.project.buildSpriteSheet() : this.project.getDisplayBuffer();
        const safeName = (filename || '').trim() || (multiFrame ? 'sprite-sheet' : 'pixel-art');
        await window.PAE.FileIO.exportImage(image, format, safeName);
      } catch (err) {
        if (err && err.code === 'declined') return; // user backed out of the save dialog/capability prompt, nothing to report
        console.error(err);
        alert('Sorry, exporting failed.');
      }
    }

    // ---- Palettes menu actions ------------------------------------------

    exportPaletteSet() {
      const json = this.palette.exportAll();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'palettes.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    importPaletteSetFromDisk() {
      document.getElementById('open-palette-input').click();
    }

    async loadPaletteFile(file) {
      try {
        const text = await file.text();
        this.palette.importAll(text, { replace: false });
      } catch (err) {
        alert(err.message || 'Could not read that palette file.');
      }
    }

    // ---- pointer wiring --------------------------------------------------

    _wireCanvasEvents(canvasEl) {
      let isPointerDown = false;

      canvasEl.addEventListener('mousedown', (evt) => {
        isPointerDown = true;
        const { x, y } = this.canvasView.eventToPixel(evt);
        this.toolManager.handleMouseDown(this.toolCtx, x, y, evt);
        this.notifyChange(); // a stroke just started -> history.commit() ran, Undo should enable
      });

      canvasEl.addEventListener('mousemove', (evt) => {
        if (!isPointerDown) return;
        const { x, y } = this.canvasView.eventToPixel(evt);
        this.toolManager.handleMouseMove(this.toolCtx, x, y, evt);
      });

      window.addEventListener('mouseup', (evt) => {
        if (!isPointerDown) return;
        isPointerDown = false;
        const { x, y } = this.canvasView.eventToPixel(evt);
        this.toolManager.handleMouseUp(this.toolCtx, x, y, evt);
        this.notifyChange();
      });

      canvasEl.addEventListener('mouseleave', () => {
        this.toolManager.handleLeave(this.toolCtx);
      });

      // Right-click / context menu is reserved for future tool options
      // (e.g. eyedropper-on-right-click); suppress the browser menu for now.
      canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  // ---- Boot -----------------------------------------------------------

  document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    window.PAE.app = app; // handy for debugging from the console

    window.PAE.initMenu(app);
    window.PAE.initUI(app);
    window.PAE.initReferenceBar(app);
    window.PAE.initFilmstrip(app);
    window.PAE.initLayersPanel(app);
    window.PAE.initSelectionOverlay(app);
    window.PAE.initVBrushPipelinePanel(app);

    // File inputs live outside menu.js/ui.js since they're shared plumbing.
    document.getElementById('open-file-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) app.loadImageFile(file);
      e.target.value = '';
    });
    document.getElementById('open-palette-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) app.loadPaletteFile(file);
      e.target.value = '';
    });
    document.getElementById('import-frames-input').addEventListener('change', (e) => {
      const files = e.target.files;
      if (files && files.length) app.importFramesFromFiles(files);
      e.target.value = '';
    });
    document.getElementById('import-spritesheet-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) app.loadSpriteSheetFile(file);
      e.target.value = '';
    });

    // Import Sprite Sheet dialog (see App._openImportSpriteSheetDialog /
    // renderImportSheetPreview / confirmImportSpriteSheet / cancelImportSpriteSheet)
    const importSheetDialog = document.getElementById('import-spritesheet-dialog');
    document.getElementById('import-sheet-frame-width').addEventListener('input', () => app.renderImportSheetPreview());
    document.getElementById('import-sheet-frame-height').addEventListener('input', () => app.renderImportSheetPreview());
    document.getElementById('import-sheet-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const frameWidth = Number(document.getElementById('import-sheet-frame-width').value);
      const frameHeight = Number(document.getElementById('import-sheet-frame-height').value);
      // Only close on success — an invalid (oversized) frame size alerts and
      // leaves the dialog open so the person can just adjust the numbers
      // and retry, rather than having to re-choose the file from scratch.
      if (app.confirmImportSpriteSheet(frameWidth, frameHeight)) {
        importSheetDialog.close();
      }
    });
    document.getElementById('import-sheet-cancel').addEventListener('click', () => {
      app.cancelImportSpriteSheet();
      importSheetDialog.close();
    });

    // New Image dialog
    const dialog = document.getElementById('new-image-dialog');
    document.getElementById('new-image-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const width = Number(document.getElementById('new-image-width').value);
      const height = Number(document.getElementById('new-image-height').value);
      app.confirmNewImage(width, height);
      dialog.close();
    });
    document.getElementById('new-image-cancel').addEventListener('click', () => dialog.close());

    // Export dialog (see App.promptExport/confirmExport/_selectedExportFormat)
    const exportDialog = document.getElementById('export-dialog');
    exportDialog.querySelectorAll('[data-export-format]').forEach((btn) => {
      btn.addEventListener('click', () => {
        exportDialog.querySelectorAll('[data-export-format]').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
    document.getElementById('export-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const filename = document.getElementById('export-filename').value;
      app.confirmExport(filename, app._selectedExportFormat());
      exportDialog.close();
    });
    document.getElementById('export-cancel').addEventListener('click', () => exportDialog.close());

    // Brightness/Contrast and Hue/Saturation dialogs (see App.openBrightnessContrastDialog / openHueSaturationDialog / previewBrightnessContrast / previewHueSaturation / closeFilterDialog) — same "sliders live-preview, Cancel/Apply decide the outcome" shape for both.
    const bcDialog = document.getElementById('brightness-contrast-dialog');
    document.getElementById('bc-brightness').addEventListener('input', () => app.previewBrightnessContrast());
    document.getElementById('bc-contrast').addEventListener('input', () => app.previewBrightnessContrast());
    document.getElementById('bc-cancel').addEventListener('click', () => {
      app.closeFilterDialog({ cancel: true });
      bcDialog.close();
    });
    document.getElementById('bc-apply').addEventListener('click', () => {
      app.closeFilterDialog({ cancel: false });
      bcDialog.close();
    });

    const hsDialog = document.getElementById('hue-saturation-dialog');
    document.getElementById('hs-hue').addEventListener('input', () => app.previewHueSaturation());
    document.getElementById('hs-saturation').addEventListener('input', () => app.previewHueSaturation());
    document.getElementById('hs-cancel').addEventListener('click', () => {
      app.closeFilterDialog({ cancel: true });
      hsDialog.close();
    });
    document.getElementById('hs-apply').addEventListener('click', () => {
      app.closeFilterDialog({ cancel: false });
      hsDialog.close();
    });
  });
})();
