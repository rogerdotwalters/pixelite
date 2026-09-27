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
  const ANCHOR_HANDLE_HIT_PX = 8; // screen pixels; divided by zoom for hit-testing in image space — see App.hitTestLayerAnchor

  class App {
    constructor() {
      this.project = window.PAE.SpriteProject.blank(DEFAULT_WIDTH, DEFAULT_HEIGHT);
      this.palette = new window.PAE.PaletteManager();
      // Roger's ask: "a new section that is a personal palette" — one flat,
      // always-visible list of colors, separate from PaletteManager's
      // several named/switchable palettes above. See personalPalette.js.
      this.personalPalette = new window.PAE.PersonalPalette();
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
      // Highlight/Shadow: a combined Dodge/Burn-style brush — Roger's ask,
      // "a highlighter and shadowing brush that is based on pixel size" —
      // see tools/highlightShadowTool.js. `highlightShadowMode` is
      // 'highlight' (lighten, toward white) or 'shadow' (darken, toward black).
      this.highlightShadowRadius = 4;
      this.highlightShadowStrength = 0.5;
      this.highlightShadowMode = 'highlight';
      // Layers panel's ⚓ toggle — Roger's ask: "a toggleable view that
      // turns anchor points on and off on the layers. So that I can easily
      // click and drag all the layers without having to switch." See
      // layerAnchorsOverlay.js (drawing) and this file's "layer anchors"
      // section below (hit-testing + the actual drag, which has to run
      // ahead of whatever tool is currently active — see _wireCanvasEvents).
      this.anchorPointsVisible = false;
      this._anchorDrag = null; // {index, startPt, snapshot} while a layer anchor is being dragged, else null
      // Stamp Brush: the current stamp pattern (painted in its own mini
      // editor — see stampBrush.js's Stamp Editor dialog), plus the two
      // toggles for how it's painted onto the canvas (see
      // tools/stampBrushTool.js for what each actually does). Starts blank
      // — a 4x4 fully transparent buffer — so a fresh session's Stamp
      // Brush tool simply does nothing until something's painted into it.
      this.stamp = { width: 4, height: 4, buffer: window.PAE.PixelBuffer.createBlank(4, 4) };
      this.stampAnchorMode = 'origin'; // 'origin' | 'first-click'
      this.stampBlendMode = 'overwrite'; // 'overwrite' | 'blend'
      // Smoothing Pencil: which algorithm(s) run over a freehand stroke
      // before it's committed — see js/lineSmoothing.js for what each one
      // actually does, tools/smoothingPencilTool.js for how/when they run.
      this.smoothingMode = 'both'; // 'doubling' | 'symmetric' | 'both'
      this.smoothingEvenStep = true; // Symmetric Curves' "Even Step Pattern" checkbox
      this.smoothingMirrorHalves = false; // Symmetric Curves' "Mirror Halves" checkbox
      this.smoothingTiming = 'live'; // 'live' | 'finish'
      this.selection = new window.PAE.Selection(); // Pixel Selection tool's current rectangle, or null
      this.clipboard = null; // { x, y, buffer } from the last Copy/Cut — see copySelection()
      this._filterSnapshot = null; // pre-filter buffer, while a filter dialog is open — see openBrightnessContrastDialog()
      this._changeListeners = [];
      this._settingsRestoredListeners = [];
      // Fired by toolCtx.requestRender() (below), in addition to the main
      // canvas repaint, so a tool's own on-canvas overlay can redraw in
      // lockstep with every mousemove-driven recompute — currently just
      // the Object tool's drag handles (objectOverlay.js), but generic so
      // any future tool with a live canvas overlay can hook in the same way.
      this._overlayRenderers = [];

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
        // See toolManager.js's SELECTION_PRESERVING_TOOL_IDS: fired
        // automatically on switching to any tool that isn't one of the
        // selection-driven ones, so a selection never lingers once you've
        // moved on to a drawing tool. Also wired to the Escape key (ui.js).
        clearSelection: () => this.selection.clear(),
        // Object tool only (tools/objectTool.js): "click directly on a
        // painted pixel to grab it" — no separate select-first trip
        // through the Pixel Selection tool or the Layers panel. See
        // App.pickObjectAt for exactly which layer wins.
        pickObjectAt: (x, y) => this.pickObjectAt(x, y),
        getMixColors: () => this.colorMixer.getGrid().flat().map(window.PAE.PaletteManager.hexToRgb),
        getVBrushRadius: () => this.vbrushRadius,
        getVBrushColorLimit: () => this.vbrushColorLimit,
        getVBrushPipeline: () => this.vbrushPipeline,
        getHighlightShadowRadius: () => this.highlightShadowRadius,
        getHighlightShadowStrength: () => this.highlightShadowStrength,
        getHighlightShadowMode: () => this.highlightShadowMode,
        getStamp: () => this.stamp,
        getStampAnchorMode: () => this.stampAnchorMode,
        getStampBlendMode: () => this.stampBlendMode,
        getSmoothingMode: () => this.smoothingMode,
        getSmoothingEvenStep: () => this.smoothingEvenStep,
        getSmoothingMirrorHalves: () => this.smoothingMirrorHalves,
        getSmoothingTiming: () => this.smoothingTiming,
        // Object tool only (tools/objectTool.js): precise on-canvas handle
        // hit-testing needs the CURRENT zoom (to convert a fixed number of
        // screen pixels' tolerance into image-pixel units) and fractional,
        // un-floored mouse coordinates (an ordinary tool only ever needs
        // "which whole pixel," but a handle a fraction of a pixel wide at
        // low zoom needs sub-pixel precision to hit reliably).
        getZoom: () => this.canvasView.zoom,
        eventToFractionalPixel: (evt) => this.canvasView.eventToFractionalPixel(evt),
        // Rotate Selection / Object tool only: the active Layer OBJECT
        // itself (not just its buffer), so a rotate gesture can read/write
        // its persistent `rotationOrigin` — see Layer.resolveRotationBase/
        // storeRotationBase in layer.js for why a rotate needs more than
        // just the pixel buffer to avoid compounding data loss across
        // separate rotate gestures.
        getActiveLayer: () => this.project.currentFrame.activeLayer,
        pickColor: (hex) => this.setBaseColor(hex),
        requestRender: () => {
          this.canvasView.render();
          this._overlayRenderers.forEach((fn) => fn());
        },
      };

      // ---- Register built-in tools --------------------------------------
      // To add a new tool, register it here (see tools/tool.js for the guide).
      this.toolManager.register(new window.PAE.PencilTool());
      this.toolManager.register(new window.PAE.FillTool());
      this.toolManager.register(new window.PAE.EyedropperTool());
      this.toolManager.register(new window.PAE.LineTool());
      this.toolManager.register(new window.PAE.ShapeTool('rect', 'Rectangle'));
      this.toolManager.register(new window.PAE.ShapeTool('ellipse', 'Ellipse'));
      this.toolManager.register(new window.PAE.ShapeTool('triangle', 'Triangle'));
      this.toolManager.register(new window.PAE.ShapeTool('circle', 'Circle'));
      this.toolManager.register(new window.PAE.ShapeTool('hexagon', 'Hexagon'));
      this.toolManager.register(new window.PAE.ShapeTool('octagon', 'Octagon'));
      this.toolManager.register(new window.PAE.BlenderTool());
      this.toolManager.register(new window.PAE.EraserTool());
      this.toolManager.register(new window.PAE.MirrorPenTool());
      this.toolManager.register(new window.PAE.PixelSelectionTool());
      this.toolManager.register(new window.PAE.ObjectTool());
      this.toolManager.register(new window.PAE.RotateSelectionTool());
      this.toolManager.register(new window.PAE.ResizeSelectionTool());
      this.toolManager.register(new window.PAE.VBrushTool());
      this.toolManager.register(new window.PAE.HighlightShadowTool());
      this.toolManager.register(new window.PAE.StampBrushTool());
      this.toolManager.register(new window.PAE.SmoothingPencilTool());

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

    /** Registers a callback fired every time toolCtx.requestRender() runs — see the constructor's `_overlayRenderers` comment. */
    onOverlayRender(fn) {
      this._overlayRenderers.push(fn);
    }

    /**
     * Fired once, right at the end of Project Open (see restoreProject
     * below) — separate from the much more frequent onChange/notifyChange
     * above (which fires on every brush stroke/layer edit and drives things
     * like the Layers panel and Undo's enabled state) because THIS is only
     * about pushing a bunch of restored slider/segmented-button VALUES back
     * into their DOM controls — ui.js's initToolOptions listens here to do
     * exactly that (see its syncToolOptionsFromApp) — something that only
     * ever needs to happen right after a project file replaces every one of
     * those settings at once, never on an ordinary paint stroke.
     */
    onSettingsRestored(fn) {
      this._settingsRestoredListeners.push(fn);
    }

    _notifySettingsRestored() {
      this._settingsRestoredListeners.forEach((fn) => fn(this));
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

    /**
     * Which layer tools paint on next — doesn't touch the picture, so no
     * history entry. If the layer being made active has `actAsObject` set
     * (see the Layers panel's ◆ icon / layer.js), it also auto-selects that
     * layer's whole painted footprint — the same thing Pixel Selection's
     * "Layer" mode would select — so it behaves like clicking a single
     * object, whether you got here via the ◆ icon (toggleActsAsObject) or
     * just an ordinary click on the row.
     */
    setActiveLayer(index) {
      this.project.currentFrame.setActiveLayerIndex(index);
      const layer = this.project.currentFrame.activeLayer;
      if (layer && layer.actAsObject) this.selectActiveLayerAsObject();
      this.notifyChange();
    }

    /**
     * Flips a layer's "acts as object" flag (the Layers panel's ◆ icon).
     * Also makes that layer the active one either way — turning the flag ON
     * is meant to be a single click that both marks AND selects the layer
     * as an object (see setActiveLayer above for the actual auto-select).
     */
    toggleActsAsObject(index) {
      const layer = this.project.currentFrame.layers[index];
      if (!layer) return;
      layer.actAsObject = !layer.actAsObject;
      this.setActiveLayer(index);
    }

    /**
     * Selects the ACTIVE layer's whole painted footprint — exactly what
     * Pixel Selection's "Layer" mode would select — used automatically by
     * setActiveLayer above whenever an "acts as object" layer becomes
     * active, and by promptLayerArray below to grab the content + pivot
     * for the Layer Array tool. Silently clears the selection if the layer
     * is empty rather than alerting (this can fire just from switching
     * layers, so it shouldn't interrupt with a dialog the way manually
     * choosing Pixel Selection's "Layer" mode does).
     */
    selectActiveLayerAsObject() {
      const buf = this.buffer;
      const region = window.PAE.PixelBuffer.boundingBoxOfContent(buf);
      if (!region) {
        this.selection.clear();
        return;
      }
      const mask = window.PAE.PixelBuffer.alphaMask(buf, region);
      this.selection.set({ x: region.x, y: region.y, w: region.w, h: region.h, mask });
    }

    /**
     * Object tool's "click directly on the canvas to grab an object"
     * (tools/objectTool.js's onMouseDown, called whenever the click didn't
     * land on the CURRENT selection's body/handles) — Roger: "I want to be
     * able to click on the canvas to select object in my layer as well to
     * drag." Checks the ACTIVE layer's own pixel at (x, y) first — "my
     * layer", regardless of whether it's flagged "Acts as Object" — then
     * falls back to every OTHER layer that IS flagged that way, topmost
     * first (matching what you'd expect to grab by looking at the
     * picture). Whichever layer matches becomes the active one (the exact
     * same auto-select-its-footprint behavior as clicking its Layers panel
     * row — see setActiveLayer/selectActiveLayerAsObject above) and its
     * freshly selected footprint is returned so the Object tool can start
     * dragging it in the same mousedown, no separate select-first step.
     * Returns null if (x, y) isn't a painted pixel on any eligible layer.
     */
    pickObjectAt(x, y) {
      const frame = this.project.currentFrame;
      const activeLayer = frame.activeLayer;
      if (activeLayer && activeLayer.buffer.inBounds(x, y) && activeLayer.buffer.getPixel(x, y)[3] > 0) {
        this.selectActiveLayerAsObject();
        return this.selection.get();
      }
      for (let i = frame.layers.length - 1; i >= 0; i--) {
        if (i === frame.activeLayerIndex) continue;
        const layer = frame.layers[i];
        if (!layer.actAsObject) continue;
        const p = layer.buffer.inBounds(x, y) ? layer.buffer.getPixel(x, y) : null;
        if (p && p[3] > 0) {
          this.setActiveLayer(i);
          return this.selection.get();
        }
      }
      return null;
    }

    // ---- layer anchors: drag any layer directly, without switching --------
    // Roger's ask: "a toggleable view that turns anchor points on and off on
    // the layers. So that I can easily click and drag all the layers without
    // having to switch." See layerAnchorsOverlay.js for the actual drawing —
    // this is the hit-testing + drag itself, which App._wireCanvasEvents
    // above runs BEFORE forwarding a mousedown/mousemove/mouseup to whatever
    // tool is currently active, so grabbing an anchor works no matter which
    // tool (Pencil, Fill, anything) you happen to be using — no need to
    // first click that layer's row in the Layers panel or switch tools.
    // Deliberately move-only (no resize/rotate) — same "just click and
    // drag" scope as Roger's own description; that's what the Object tool
    // (plus a layer's "Acts as Object" flag) already covers separately.

    /** The Layers panel's ⚓ toggle. */
    toggleAnchorPoints() {
      this.anchorPointsVisible = !this.anchorPointsVisible;
      this.notifyChange();
    }

    /**
     * Returns the index of whichever layer's anchor dot is under fractional
     * image-pixel point `pt` (see ctx.eventToFractionalPixel), or null.
     * Every layer with any painted content gets a dot at its own bounding
     * box's center (see layerAnchorsOverlay.js — same box, so what's hit-
     * tested here always matches what's drawn). Checked topmost-layer-first,
     * matching what you'd expect to grab by looking at the picture when two
     * layers' anchors happen to overlap.
     */
    hitTestLayerAnchor(pt) {
      if (!this.anchorPointsVisible) return null;
      const zoom = this.canvasView.zoom;
      const tol = ANCHOR_HANDLE_HIT_PX / zoom;
      const frame = this.project.currentFrame;
      for (let i = frame.layers.length - 1; i >= 0; i--) {
        const box = window.PAE.PixelBuffer.boundingBoxOfContent(frame.layers[i].buffer);
        if (!box) continue;
        const hx = box.x + box.w / 2;
        const hy = box.y + box.h / 2;
        if (Math.abs(pt.x - hx) <= tol && Math.abs(pt.y - hy) <= tol) return i;
      }
      return null;
    }

    /** Starts dragging layer `index` — one history.commit() for the whole drag, same "commit once at mousedown" convention as every other drag-based tool (Object tool, Blender, ...). */
    _beginLayerAnchorDrag(index, pt) {
      const layer = this.project.currentFrame.layers[index];
      if (!layer) return;
      this.history.commit();
      this._anchorDrag = { index, startPt: pt, snapshot: layer.buffer.clone() };
      this.notifyChange(); // a drag just started -> history.commit() ran, Undo should enable
    }

    /**
     * Re-derives the dragged layer's ENTIRE buffer fresh from the drag-start
     * snapshot on every move (same "snapshot once, then re-render from
     * scratch" convention as the Object tool's own moves — see
     * tools/objectTool.js's _paintMove) rather than nudging it a little
     * further each call, so rounding error never compounds across a long,
     * wobbly drag.
     */
    _updateLayerAnchorDrag(pt) {
      const drag = this._anchorDrag;
      if (!drag) return;
      const layer = this.project.currentFrame.layers[drag.index];
      if (!layer) return;
      const dx = Math.round(pt.x - drag.startPt.x);
      const dy = Math.round(pt.y - drag.startPt.y);
      const moved = window.PAE.PixelBuffer.createBlank(this.project.frameWidth, this.project.frameHeight);
      moved.blit(drag.snapshot, dx, dy); // PixelBuffer.blit already clips to the destination's bounds, both directions
      layer.buffer = moved;
      this.canvasView.render();
      this._overlayRenderers.forEach((fn) => fn());
    }

    _endLayerAnchorDrag() {
      if (!this._anchorDrag) return;
      this._anchorDrag = null;
      this.notifyChange();
    }

    // ---- pixel selection: clipboard + copy/cut to a new layer -------------
    // See selection.js for why a selection itself isn't part of undo
    // history — only the actual pixel/layer mutations below are.

    /** Snapshots the selected pixels into `this.clipboard`, remembering their original position so Paste can put them back exactly where they were by default. A "Layer"/"Object" mode selection's `.mask` (see selection.js) is respected: pixels outside the exact shape are left transparent in the snippet rather than copied. */
    copySelection() {
      const sel = this.selection.get();
      if (!sel) return;
      const source = this.buffer;
      const snippet = new window.PAE.PixelBuffer(sel.w, sel.h);
      for (let y = 0; y < sel.h; y++) {
        for (let x = 0; x < sel.w; x++) {
          if (sel.mask && !sel.mask[y * sel.w + x]) continue;
          snippet.setPixel(x, y, source.getPixel(sel.x + x, sel.y + y) || [0, 0, 0, 0]);
        }
      }
      this.clipboard = { x: sel.x, y: sel.y, buffer: snippet };
    }

    /** Copy, then clear the selected pixels from the active layer — an ordinary same-layer cut. Also mask-aware (see copySelection above): only pixels within the exact selected shape are cleared. */
    cutSelection() {
      const sel = this.selection.get();
      if (!sel) return;
      this.copySelection();
      this.history.commit();
      const buf = this.buffer;
      for (let y = 0; y < sel.h; y++) {
        for (let x = 0; x < sel.w; x++) {
          if (sel.mask && !sel.mask[y * sel.w + x]) continue;
          buf.setPixel(sel.x + x, sel.y + y, [0, 0, 0, 0]);
        }
      }
      this.canvasView.render();
      this.notifyChange();
    }

    /**
     * Paste (Ctrl+V) — as of this round, ALWAYS lands on a brand-new layer
     * above the active one, flagged "Acts as Object" (same flag as the
     * Layers panel's ◆ icon), containing just the pasted pixels at their
     * original copied position (so nothing visually shifts). Per Roger's
     * request ("convert object I cut and paste... into objects that can
     * be rotated"), this makes every paste immediately grabbable by the
     * new Object tool (tools/objectTool.js) — or by Rotate/Resize
     * Selection, since "acts as object" auto-selects the exact pasted
     * footprint the moment this new layer becomes active (see
     * setActiveLayer/selectActiveLayerAsObject) — instead of blending
     * anonymously into whatever layer happened to be active, the old
     * behavior. One history.commit() covers the whole paste, same as
     * "Copy/Cut to New Layer" below.
     *
     * Roger's follow-up ask: paste should "auto clear the selection box"
     * so it doesn't look stuck on screen — but the Object tool still needs
     * a real selection to show its handles / be grabbable at all. Both are
     * true at once by keeping the selection SET internally but flagging it
     * `hideMarquee` (see selection.js), which selectionOverlay.js checks to
     * skip drawing the old dashed-marquee rectangle for it — the Object
     * tool's own overlay (objectOverlay.js) is unaffected and still shows
     * up the instant you switch to it or click the pasted object.
     */
    pasteSelection() {
      if (!this.clipboard) return;
      this.history.commit();
      const { x, y, buffer } = this.clipboard;
      const frame = this.project.currentFrame;
      const snippet = window.PAE.PixelBuffer.createBlank(frame.width, frame.height);
      for (let dy = 0; dy < buffer.height; dy++) {
        for (let dx = 0; dx < buffer.width; dx++) {
          const p = buffer.getPixel(dx, dy);
          if (p[3] > 0) snippet.setPixel(x + dx, y + dy, p);
        }
      }
      frame.insertLayerAbove('Pasted Object', snippet);
      frame.activeLayer.actAsObject = true;
      this.selectActiveLayerAsObject();
      const sel = this.selection.get();
      if (sel) this.selection.set({ ...sel, hideMarquee: true });
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
     * Also mask-aware, same as copySelection/cutSelection above: a "Layer"/
     * "Object" mode selection only moves its exact shape, not its whole
     * bounding box.
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
          if (sel.mask && !sel.mask[y * sel.w + x]) continue;
          const p = buf.getPixel(sel.x + x, sel.y + y);
          if (p && p[3] > 0) snippet.setPixel(sel.x + x, sel.y + y, p);
        }
      }
      this.history.commit();
      if (cut) {
        for (let y = 0; y < sel.h; y++) {
          for (let x = 0; x < sel.w; x++) {
            if (sel.mask && !sel.mask[y * sel.w + x]) continue;
            sourceLayer.buffer.setPixel(sel.x + x, sel.y + y, [0, 0, 0, 0]);
          }
        }
      }
      frame.insertLayerAbove(`${cut ? 'Cut' : 'Copy'} of ${sourceLayer.name}`, snippet);
      this.canvasView.render();
      this.notifyChange();
    }

    // ---- Layers panel: "Layer Array" ---------------------------------------
    // Repeats the ACTIVE layer's content into a chain of copies, each one
    // orbiting further out from the last: Distance + Rotation combine into
    // an "orbit" (each successive copy is pushed outward by Distance along
    // its OWN accumulated rotation angle, sweeping around in an arc/spiral),
    // while Position Increment X/Y is a separate straight-line nudge added
    // on top of that, per copy. For copy i (1-indexed; i=0 is the untouched
    // original, never touched by this feature):
    //   angle_i  = rotation * i
    //   radius_i = distance * i
    //   dx_i = round(radius_i * cos(angle_i) + posX * i)
    //   dy_i = round(radius_i * sin(angle_i) + posY * i)
    // and copy i is the source content rotated by angle_i around its own
    // bounding-box center (never persisted on Layer — always re-derived
    // fresh from PixelBuffer.boundingBoxOfContent) and translated by
    // (dx_i, dy_i). "Create" BAKES this into `count - 1` brand-new real
    // Layer objects stacked above the source (same "bake, don't modify"
    // convention as Copy/Cut to New Layer above) — fully editable
    // afterward, not a live/reapplyable modifier.

    /**
     * Opens the Layer Array dialog for the ACTIVE layer. Snapshots its
     * buffer and content bounding box ONCE — every subsequent slider move
     * re-renders the whole preview fresh from that one frozen snapshot,
     * same "snapshot-once-then-rederive" pattern as Rotate/Resize
     * Selection, so scrubbing a slider never compounds resample error.
     */
    promptLayerArray() {
      const buf = this.buffer;
      const region = window.PAE.PixelBuffer.boundingBoxOfContent(buf);
      if (!region) {
        alert("This layer is empty — there's nothing to repeat into an array.");
        return;
      }
      this._layerArraySource = buf.clone();
      this._layerArrayPivot = { x: region.x + region.w / 2, y: region.y + region.h / 2 };

      document.getElementById('layer-array-count').value = 4;
      document.getElementById('layer-array-count-value').textContent = '4';
      document.getElementById('layer-array-distance').value = 0;
      document.getElementById('layer-array-distance-value').textContent = '0px';
      document.getElementById('layer-array-rotation').value = 0;
      document.getElementById('layer-array-rotation-value').textContent = '0°';
      document.getElementById('layer-array-pos-x').value = 0;
      document.getElementById('layer-array-pos-x-value').textContent = '0px';
      document.getElementById('layer-array-pos-y').value = 0;
      document.getElementById('layer-array-pos-y-value').textContent = '0px';

      this.renderLayerArrayPreview();
      document.getElementById('layer-array-dialog').showModal();
    }

    /** Cancel just drops the frozen snapshot — nothing was ever written to the real layer stack, so there's nothing to undo. */
    cancelLayerArray() {
      this._layerArraySource = null;
      this._layerArrayPivot = null;
    }

    /** Reads + clamps the dialog's 5 fields. Shared by the live preview and the actual bake, so they can never disagree. */
    _layerArrayParams() {
      const count = Math.max(1, Math.min(64, Math.round(Number(document.getElementById('layer-array-count').value)) || 1));
      const distance = Number(document.getElementById('layer-array-distance').value) || 0;
      const rotation = Number(document.getElementById('layer-array-rotation').value) || 0;
      const posX = Number(document.getElementById('layer-array-pos-x').value) || 0;
      const posY = Number(document.getElementById('layer-array-pos-y').value) || 0;
      return { count, distance, rotation, posX, posY };
    }

    /** Per-copy (dx, dy, angle) for array index `i` (1-indexed) — the orbit + position-increment math described above. Shared by the preview and the real bake. */
    static _layerArrayOffset(i, { distance, rotation, posX, posY }) {
      const angleDeg = rotation * i;
      const radius = distance * i;
      const rad = (angleDeg * Math.PI) / 180;
      const dx = Math.round(radius * Math.cos(rad) + posX * i);
      const dy = Math.round(radius * Math.sin(rad) + posY * i);
      return { angleDeg, dx, dy };
    }

    /**
     * Redraws the dialog's live preview: the untouched original plus every
     * copy 1..count-1, all composited onto one shared buffer via
     * PixelBuffer.transformInto (which leaves pixels a copy doesn't cover
     * untouched, so earlier copies never get erased by later ones), then
     * scaled to fit a fixed on-screen box — the same RENDER_CAP/DISPLAY_BOX
     * idiom as the V Brush pipeline's own preview. Called once when the
     * dialog opens and again on every field's `input` event.
     */
    renderLayerArrayPreview() {
      const source = this._layerArraySource;
      const canvas = document.getElementById('layer-array-preview-canvas');
      if (!source || !canvas) return;
      const params = this._layerArrayParams();
      const pivot = this._layerArrayPivot;

      const preview = window.PAE.PixelBuffer.createBlank(source.width, source.height);
      preview.copyFrom(source); // copy 0: the original, untouched
      for (let i = 1; i < params.count; i++) {
        const { angleDeg, dx, dy } = App._layerArrayOffset(i, params);
        window.PAE.PixelBuffer.transformInto(preview, source, { pivotX: pivot.x, pivotY: pivot.y, angleDeg, dx, dy });
      }

      const MAX_DISPLAY = 260;
      const scale = Math.max(1, Math.min(8, MAX_DISPLAY / Math.max(preview.width, preview.height)));
      canvas.width = Math.round(preview.width * scale);
      canvas.height = Math.round(preview.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      const src = document.createElement('canvas');
      src.width = preview.width;
      src.height = preview.height;
      src.getContext('2d').putImageData(preview.toImageData(), 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(src, 0, 0, preview.width, preview.height, 0, 0, canvas.width, canvas.height);
    }

    /**
     * "Create" — bakes `count - 1` brand-new real layers, stacked above the
     * active layer (each insert lands above the previous copy, so the
     * final stack reads bottom-to-top as original, copy 1, copy 2, ...),
     * each one's pixels built by transformInto against the same frozen
     * snapshot/pivot the preview used. One history.commit() covers the
     * whole array, since a frame's undo snapshot already captures its
     * entire layer stack (see spriteProject.js) — Ctrl+Z undoes the whole
     * array in one step.
     */
    confirmLayerArray() {
      const source = this._layerArraySource;
      if (!source) return;
      const params = this._layerArrayParams();
      if (params.count <= 1) {
        // Nothing to bake — an array of just the original is a no-op.
        this.cancelLayerArray();
        return;
      }
      const pivot = this._layerArrayPivot;
      const frame = this.project.currentFrame;
      const baseName = frame.activeLayer.name;

      this.history.commit();
      for (let i = 1; i < params.count; i++) {
        const { angleDeg, dx, dy } = App._layerArrayOffset(i, params);
        const copyBuf = window.PAE.PixelBuffer.createBlank(frame.width, frame.height);
        window.PAE.PixelBuffer.transformInto(copyBuf, source, { pivotX: pivot.x, pivotY: pivot.y, angleDeg, dx, dy });
        frame.insertLayerAbove(`${baseName} (${i})`, copyBuf);
      }
      this._layerArraySource = null;
      this._layerArrayPivot = null;
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

    // ---- Preview panel / GIF export ---------------------------------------
    // See spriteProject.js's Frame.previewEnabled and animationPreview.js.

    /** The filmstrip's checkmark on a tile (see filmstrip.js). Deliberately no `history.commit()` — this is frame metadata, not a pixel edit, same non-undoable category as inserting/deleting a frame. */
    toggleFramePreview(index) {
      const frame = this.project.frames[index];
      if (!frame) return;
      frame.previewEnabled = !frame.previewEnabled;
      this.notifyChange();
    }

    /**
     * "Export as GIF…" in the Preview panel. Bakes whichever frames are
     * currently checked, in frame order, into one animated .gif at
     * `fps` frames per second — see gifEncoder.js for the format itself
     * and fileIO.js's `_saveBlob` for where the file actually lands.
     * Same try/catch shape as `confirmExport` above: a cancelled native
     * save dialog is not an error worth alerting about.
     */
    async exportPreviewGif(fps) {
      const buffers = this.project.previewFrames();
      if (!buffers.length) {
        alert('Check at least one frame in the filmstrip first.');
        return;
      }
      try {
        await window.PAE.FileIO.exportGif(buffers, fps, 'pixel-art-animation');
      } catch (err) {
        if (err && err.code === 'declined') return; // user backed out of the save dialog/capability prompt, nothing to report
        console.error(err);
        alert('Sorry, exporting the GIF failed.');
      }
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

    // ---- Project menu: Resize Canvas ---------------------------------------
    // Grows or shrinks the WHOLE project's fixed frame size, in place — every
    // frame's every layer is resized, unlike New Image (which throws the
    // whole project away and starts blank). See resizeCanvas() below for why
    // this ISN'T undoable via Ctrl+Z.

    promptResizeCanvas() {
      const dialog = document.getElementById('resize-canvas-dialog');
      document.getElementById('resize-canvas-width').value = this.project.frameWidth;
      document.getElementById('resize-canvas-height').value = this.project.frameHeight;
      dialog.showModal();
    }

    /**
     * Resizes every frame's every layer to `width`x`height`, keeping each
     * layer's existing pixels anchored at whichever of the 9 anchor-grid
     * positions is passed (e.g. `'top-left'`, `'center'`, `'bottom-right'`)
     * — growing adds transparent space on the OTHER sides from the anchor;
     * shrinking crops those other sides away. Uses PixelBuffer.blit, which
     * already clips writes to the destination buffer's bounds, so both
     * directions (and negative offsets, when shrinking) just work.
     *
     * Deliberately NOT wrapped in `history.commit()`: a frame's undo
     * snapshot (see Frame._snapshot in spriteProject.js) only ever captures
     * its LAYER STACK (pixels/name/visibility/active index) — never the
     * frame's own width/height — so there is no way to make a dimension
     * change itself undoable without a bigger rework of the history system.
     * This puts Resize Canvas in the same "structural, not undoable"
     * category as File > New / Import Frames / Import Sprite Sheet, which
     * also fully replace the project with no history entry.
     */
    resizeCanvas(width, height, anchor = 'top-left') {
      width = Math.max(1, Math.min(512, Math.round(width) || this.project.frameWidth));
      height = Math.max(1, Math.min(512, Math.round(height) || this.project.frameHeight));
      const oldWidth = this.project.frameWidth;
      const oldHeight = this.project.frameHeight;
      if (width === oldWidth && height === oldHeight) return;

      const { dx, dy } = App._anchorOffset(anchor, oldWidth, oldHeight, width, height);
      this.project.frames.forEach((frame) => {
        frame.width = width;
        frame.height = height;
        frame.layers.forEach((layer) => {
          const resized = window.PAE.PixelBuffer.createBlank(width, height);
          resized.blit(layer.buffer, dx, dy);
          layer.buffer = resized;
        });
      });
      this.project.frameWidth = width;
      this.project.frameHeight = height;
      this._afterFrameChange();
    }

    /** Where the OLD content's top-left corner should land in the NEW buffer, for one of the 9 anchor-grid positions. */
    static _anchorOffset(anchor, oldWidth, oldHeight, newWidth, newHeight) {
      const [vertical, horizontal] = anchor.split('-'); // 'top'|'middle'|'bottom', 'left'|'center'|'right'
      let dx = 0;
      let dy = 0;
      if (horizontal === 'center') dx = Math.round((newWidth - oldWidth) / 2);
      else if (horizontal === 'right') dx = newWidth - oldWidth;
      if (vertical === 'middle') dy = Math.round((newHeight - oldHeight) / 2);
      else if (vertical === 'bottom') dy = newHeight - oldHeight;
      return { dx, dy };
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
      // "Frames (ZIP)" — break the sprite sheet back apart into one PNG per
      // frame — only makes sense, and only appears, when there's more than
      // one frame to break apart.
      document.getElementById('export-format-frameszip').hidden = !multiFrame;
      this._updateExportHint(format);
      dialog.showModal();
      document.getElementById('export-filename').select();
    }

    /** Reads whichever format button is marked `.active` in the Export dialog. */
    _selectedExportFormat() {
      const active = document.querySelector('#export-dialog [data-export-format].active');
      return active ? active.dataset.exportFormat : 'png';
    }

    /** Updates the Export dialog's hint line for whichever format is now selected — called on open and again on every format-button click. */
    _updateExportHint(format) {
      const hint = document.getElementById('export-hint');
      if (format === 'frames-zip') {
        hint.textContent = 'Each frame will be saved as its own numbered PNG, all bundled into one .zip file.';
      } else {
        hint.textContent =
          typeof window.showSaveFilePicker === 'function'
            ? 'Your browser will let you choose exactly where to save it.'
            : 'Saves to your browser’s downloads location.';
      }
    }

    async confirmExport(filename, format) {
      try {
        if (format === 'frames-zip') {
          await this.confirmExportFramesZip(filename);
          return;
        }
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

    /**
     * "Breaks apart" the sprite sheet: every frame, flattened, saved as its
     * own numbered PNG (see FileIO.exportFramesAsZip for the naming/padding
     * scheme), all bundled into one .zip so it's a single save/download
     * rather than one native-picker prompt (or one anchor-click download)
     * per frame. Left un-wrapped in its own try/catch — the caller,
     * confirmExport, already wraps this the same way it wraps a plain
     * image export, including the same "declined" cancel handling.
     */
    async confirmExportFramesZip(filename) {
      const buffers = this.project.frames.map((frame) => frame.getCompositedBuffer());
      const safeName = (filename || '').trim() || 'sprite-frames';
      await window.PAE.FileIO.exportFramesAsZip(buffers, safeName);
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

    // ---- File menu: Save Project / Open Project ----------------------------
    // Roger's ask: "I want to be able to save the file along with its
    // layers," clarified to mean a full WORKSPACE snapshot, not just the
    // picture — every frame's every layer (see PixelBuffer.toBase64/
    // fromBase64), the personal palette (Roger's other new ask — see
    // personalPalette.js), and every current tool/brush setting + zoom, all
    // in one ".paeproj" JSON file you can reopen later and pick up exactly
    // where you left off. Deliberately separate from File > New/Open (which
    // only ever load a plain flattened PNG/JPG into a brand-new 1-layer
    // project) and Export (which only ever WRITES a flattened image, never
    // reads one back) — this is the only round trip that preserves layers.

    /** Everything a saved project needs, as a plain JS object — shared by saveProjectToDisk and restoreProject's inverse below. */
    serializeProject() {
      return {
        formatVersion: 1,
        savedAt: new Date().toISOString(),
        frameWidth: this.project.frameWidth,
        frameHeight: this.project.frameHeight,
        currentIndex: this.project.currentIndex,
        frames: this.project.frames.map((frame) => ({
          previewEnabled: frame.previewEnabled,
          activeLayerIndex: frame.activeLayerIndex,
          layers: frame.layers.map((layer) => ({
            name: layer.name,
            visible: layer.visible,
            actAsObject: layer.actAsObject,
            width: layer.buffer.width,
            height: layer.buffer.height,
            pixels: layer.buffer.toBase64(),
          })),
        })),
        // A layer's `rotationOrigin` (see layer.js) is deliberately left out
        // here — it's just a safety net so a SECOND rotate gesture resamples
        // from a pristine source instead of an already-rotated one, not
        // meaningful state on its own. Reopening a saved project simply
        // means the very next rotate on any layer re-captures its current
        // pixels as a fresh "0°" reference, exactly as if that layer had
        // just never been rotated before — never lossy, just occasionally
        // (rarely) one rotate-quality "reset" earlier than it would have
        // been in the original unsaved session.
        personalPalette: this.personalPalette.getColors(),
        toolId: this.toolManager.activeId,
        zoom: this.canvasView.zoom,
        settings: {
          opacity: this.opacity,
          shapeFill: this.shapeFill,
          blenderRadius: this.blenderRadius,
          blenderStrength: this.blenderStrength,
          brushSize: this.brushSize,
          mirrorAxis: this.mirrorAxis,
          vbrushRadius: this.vbrushRadius,
          vbrushColorLimit: this.vbrushColorLimit,
          vbrushPipeline: this.vbrushPipeline,
          highlightShadowRadius: this.highlightShadowRadius,
          highlightShadowStrength: this.highlightShadowStrength,
          highlightShadowMode: this.highlightShadowMode,
          stampAnchorMode: this.stampAnchorMode,
          stampBlendMode: this.stampBlendMode,
          stamp: { width: this.stamp.width, height: this.stamp.height, pixels: this.stamp.buffer.toBase64() },
          smoothingMode: this.smoothingMode,
          smoothingEvenStep: this.smoothingEvenStep,
          smoothingMirrorHalves: this.smoothingMirrorHalves,
          smoothingTiming: this.smoothingTiming,
        },
      };
    }

    /** File > Save Project… — no filename dialog (unlike Export): the native Save picker, where the browser supports one, already lets Roger rename/relocate it (see FileIO._saveBlob); everywhere else it just downloads under a fixed default name. */
    async saveProjectToDisk() {
      try {
        const json = JSON.stringify(this.serializeProject());
        await window.PAE.FileIO.exportProject(json, 'pixel-art-project');
      } catch (err) {
        if (err && err.code === 'declined') return; // user backed out of the save dialog/capability prompt, nothing to report
        console.error(err);
        alert('Sorry, saving the project failed.');
      }
    }

    openProjectFromDisk() {
      document.getElementById('open-project-input').click();
    }

    async loadProjectFile(file) {
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        this.restoreProject(data);
      } catch (err) {
        alert(err.message || 'Could not open that project file.');
      }
    }

    /**
     * Rebuilds every real Layer/Frame/SpriteProject object from a
     * serializeProject()-shaped plain object (the inverse of that method),
     * then restores the personal palette and every tool/brush setting +
     * zoom + active tool, and finally fires onSettingsRestored so ui.js can
     * push all of those restored values back into their own slider/
     * checkbox/segmented-button DOM controls (see ui.js's
     * syncToolOptionsFromApp) — without that, the sliders would keep
     * showing whatever they last showed even though app state underneath
     * them just changed out from under them.
     *
     * Deliberately NOT wrapped in history.commit()/undoable — same
     * "structural, replaces the whole project" category as File > New/Open/
     * Import, none of which are undoable either (see resizeCanvas's header
     * comment for why this app draws that line where it does).
     */
    restoreProject(data) {
      if (!data || !Array.isArray(data.frames) || !data.frames.length) {
        throw new Error("That doesn't look like a Pixel Art Editor project file.");
      }
      const frameWidth = Math.max(1, Math.round(data.frameWidth) || DEFAULT_WIDTH);
      const frameHeight = Math.max(1, Math.round(data.frameHeight) || DEFAULT_HEIGHT);
      const frames = data.frames.map((frameData) => {
        const layers = (frameData.layers || []).map((layerData) => {
          const buffer = window.PAE.PixelBuffer.fromBase64(layerData.pixels, layerData.width, layerData.height);
          return new window.PAE.Layer(layerData.name, buffer, layerData.visible !== false, !!layerData.actAsObject);
        });
        const frame = new window.PAE.Frame(frameWidth, frameHeight, layers.length ? layers : undefined);
        frame.activeLayerIndex = Math.max(0, Math.min(frameData.activeLayerIndex || 0, frame.layers.length - 1));
        frame.previewEnabled = frameData.previewEnabled !== false;
        return frame;
      });
      this.project = new window.PAE.SpriteProject(frameWidth, frameHeight, frames);
      this.project.currentIndex = Math.max(0, Math.min(Math.round(data.currentIndex) || 0, frames.length - 1));

      if (Array.isArray(data.personalPalette)) this.personalPalette.replaceAll(data.personalPalette);

      const s = data.settings || {};
      if (typeof s.opacity === 'number') this.opacity = s.opacity;
      if (typeof s.shapeFill === 'boolean') this.shapeFill = s.shapeFill;
      if (typeof s.blenderRadius === 'number') this.blenderRadius = s.blenderRadius;
      if (typeof s.blenderStrength === 'number') this.blenderStrength = s.blenderStrength;
      if (typeof s.brushSize === 'number') this.brushSize = s.brushSize;
      if (typeof s.mirrorAxis === 'string') this.mirrorAxis = s.mirrorAxis;
      if (typeof s.vbrushRadius === 'number') this.vbrushRadius = s.vbrushRadius;
      if (typeof s.vbrushColorLimit === 'number') this.vbrushColorLimit = s.vbrushColorLimit;
      if (s.vbrushPipeline) this.vbrushPipeline = s.vbrushPipeline;
      if (typeof s.highlightShadowRadius === 'number') this.highlightShadowRadius = s.highlightShadowRadius;
      if (typeof s.highlightShadowStrength === 'number') this.highlightShadowStrength = s.highlightShadowStrength;
      if (typeof s.highlightShadowMode === 'string') this.highlightShadowMode = s.highlightShadowMode;
      if (typeof s.stampAnchorMode === 'string') this.stampAnchorMode = s.stampAnchorMode;
      if (typeof s.stampBlendMode === 'string') this.stampBlendMode = s.stampBlendMode;
      if (s.stamp && s.stamp.pixels) {
        this.stamp = {
          width: s.stamp.width,
          height: s.stamp.height,
          buffer: window.PAE.PixelBuffer.fromBase64(s.stamp.pixels, s.stamp.width, s.stamp.height),
        };
      }
      if (typeof s.smoothingMode === 'string') this.smoothingMode = s.smoothingMode;
      if (typeof s.smoothingEvenStep === 'boolean') this.smoothingEvenStep = s.smoothingEvenStep;
      if (typeof s.smoothingMirrorHalves === 'boolean') this.smoothingMirrorHalves = s.smoothingMirrorHalves;
      if (typeof s.smoothingTiming === 'string') this.smoothingTiming = s.smoothingTiming;

      if (typeof data.toolId === 'string' && this.toolManager.getTool(data.toolId)) {
        this.toolManager.setActive(data.toolId, this.toolCtx);
      }
      if (typeof data.zoom === 'number') this.canvasView.setZoom(data.zoom);

      this.selection.clear();
      this.canvasView.render();
      this.referenceView.render(this.project);
      this.notifyChange();
      this._notifySettingsRestored();
    }

    // ---- pointer wiring --------------------------------------------------

    _wireCanvasEvents(canvasEl) {
      let isPointerDown = false;

      canvasEl.addEventListener('mousedown', (evt) => {
        isPointerDown = true;
        // Layer anchors (see this file's "layer anchors" section below) sit
        // ahead of every tool's own mousedown handling — clicking one grabs
        // that layer and drags it directly, no matter which tool is
        // currently active, which is the whole point of the toggle.
        if (this.anchorPointsVisible) {
          const pt = this.canvasView.eventToFractionalPixel(evt);
          const hitIndex = this.hitTestLayerAnchor(pt);
          if (hitIndex !== null) {
            this._beginLayerAnchorDrag(hitIndex, pt);
            return;
          }
        }
        const { x, y } = this.canvasView.eventToPixel(evt);
        this.toolManager.handleMouseDown(this.toolCtx, x, y, evt);
        this.notifyChange(); // a stroke just started -> history.commit() ran, Undo should enable
      });

      canvasEl.addEventListener('mousemove', (evt) => {
        if (!isPointerDown) return;
        if (this._anchorDrag) {
          this._updateLayerAnchorDrag(this.canvasView.eventToFractionalPixel(evt));
          return;
        }
        const { x, y } = this.canvasView.eventToPixel(evt);
        this.toolManager.handleMouseMove(this.toolCtx, x, y, evt);
      });

      window.addEventListener('mouseup', (evt) => {
        if (!isPointerDown) return;
        isPointerDown = false;
        if (this._anchorDrag) {
          this._endLayerAnchorDrag();
          return;
        }
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

      // Touch: makes every tool work by dragging a finger, same as a mouse
      // drag above, plus a two-finger pinch to zoom (there's no Ctrl+scroll-
      // wheel on a touchscreen). Entirely separate listeners from the mouse
      // ones above, so none of this can change mouse/desktop behavior at
      // all — it only ever fires in response to an actual touch event.
      this._wireTouchEvents(canvasEl);
    }

    /**
     * Roger's ask: full finger-drawing support, not just a mobile-friendly
     * layout. One finger draws (forwarded to the SAME ToolManager pointer
     * events the mouse handlers above use, so every existing tool — Pencil,
     * the shape tools, selection, etc. — just works); a second finger
     * landing mid-stroke switches to pinch-to-zoom instead, the same way
     * you'd expect a photo viewer to behave. `evt.preventDefault()` on both
     * touchstart/touchmove is what stops the PAGE from scrolling/zooming
     * itself while a finger is on the canvas — `touch-action: none` in
     * style.css's `@media (pointer: coarse)` block does the same job at the
     * CSS layer so there's no lag before the JS handler runs.
     *
     * There's no touch equivalent of the Shift key, so a finger drag can't
     * constrain the Line/Shape tools to 45°/a perfect square the way a
     * Shift-held mouse drag can — a documented, accepted gap (see the
     * architecture notes), not an oversight.
     */
    _wireTouchEvents(canvasEl) {
      // null | 'draw' | 'pinch' — which gesture is currently in progress.
      let mode = null;
      let pinchStartDist = 0;
      let pinchStartZoom = 1;

      // Touch objects have clientX/clientY but no shiftKey — this shim is
      // what canvasView.eventToPixel and the tool hooks actually read, and
      // shiftKey simply stays falsy (see the header comment above).
      const touchPoint = (touch) => ({ clientX: touch.clientX, clientY: touch.clientY, shiftKey: false });
      const distance = (t0, t1) => Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);

      canvasEl.addEventListener(
        'touchstart',
        (evt) => {
          evt.preventDefault();
          if (evt.touches.length === 1) {
            const touchPt = touchPoint(evt.touches[0]);
            // Same layer-anchor-drag interception as the mouse path above
            // (see App._wireCanvasEvents) — a finger on an anchor dot drags
            // that layer directly, same as a mouse would.
            if (this.anchorPointsVisible) {
              const fpt = this.canvasView.eventToFractionalPixel(touchPt);
              const hitIndex = this.hitTestLayerAnchor(fpt);
              if (hitIndex !== null) {
                mode = 'anchor';
                this._beginLayerAnchorDrag(hitIndex, fpt);
                return;
              }
            }
            mode = 'draw';
            const { x, y } = this.canvasView.eventToPixel(touchPt);
            this.toolManager.handleMouseDown(this.toolCtx, x, y, touchPt);
            this.notifyChange(); // a stroke just started -> history.commit() ran, Undo should enable
          } else if (evt.touches.length === 2) {
            // A second finger landing mid-stroke abandons the draw in
            // progress the same way lifting the mouse would — never leave a
            // half-finished stroke's history.commit() dangling with no
            // matching "up" to close it out.
            if (mode === 'draw') this.toolManager.handleLeave(this.toolCtx);
            mode = 'pinch';
            pinchStartDist = distance(evt.touches[0], evt.touches[1]);
            pinchStartZoom = this.canvasView.zoom;
          }
        },
        { passive: false }
      );

      canvasEl.addEventListener(
        'touchmove',
        (evt) => {
          evt.preventDefault();
          if (mode === 'anchor' && evt.touches.length === 1) {
            this._updateLayerAnchorDrag(this.canvasView.eventToFractionalPixel(touchPoint(evt.touches[0])));
          } else if (mode === 'draw' && evt.touches.length === 1) {
            const pt = touchPoint(evt.touches[0]);
            const { x, y } = this.canvasView.eventToPixel(pt);
            this.toolManager.handleMouseMove(this.toolCtx, x, y, pt);
          } else if (mode === 'pinch' && evt.touches.length === 2 && pinchStartDist > 0) {
            const dist = distance(evt.touches[0], evt.touches[1]);
            this.canvasView.setZoom(pinchStartZoom * (dist / pinchStartDist));
          }
        },
        { passive: false }
      );

      const endTouch = (evt) => {
        if (mode === 'anchor') {
          this._endLayerAnchorDrag();
        } else if (mode === 'draw' && evt.changedTouches.length > 0) {
          // touchend's own `touches` list no longer has the lifted finger,
          // but `changedTouches` still does.
          const pt = touchPoint(evt.changedTouches[0]);
          const { x, y } = this.canvasView.eventToPixel(pt);
          this.toolManager.handleMouseUp(this.toolCtx, x, y, pt);
          this.notifyChange();
        }
        if (evt.touches.length === 0) {
          mode = null;
        } else if (evt.touches.length === 1 && mode === 'pinch') {
          // One finger of a pinch lifted — deliberately does NOT resume
          // drawing from wherever the pinch happened to leave the remaining
          // finger; that would paint an unintended stroke. End the gesture
          // cleanly and require a fresh single-finger touch to draw again.
          mode = null;
        }
      };

      canvasEl.addEventListener('touchend', endTouch, { passive: false });
      canvasEl.addEventListener('touchcancel', endTouch, { passive: false });
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
    window.PAE.initAnimationPreview(app);
    window.PAE.initLayersPanel(app);
    window.PAE.initSelectionOverlay(app);
    window.PAE.initObjectOverlay(app);
    window.PAE.initLayerAnchorsOverlay(app);
    window.PAE.initVBrushPipelinePanel(app);
    window.PAE.initStampEditorPanel(app);

    // Map Generator mode (Round L): a separate tooling mode for painting
    // Perlin-noise-driven terrain maps. Deliberately independent of the
    // pixel-editor App instance — it manages its own project/state and is
    // only shown/hidden via document.body.dataset.mode.
    window.PAE.initMapGen();

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
    document.getElementById('open-project-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) app.loadProjectFile(file);
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

    // Resize Canvas dialog (Project menu — see App.promptResizeCanvas/resizeCanvas)
    const resizeCanvasDialog = document.getElementById('resize-canvas-dialog');
    const resizeCanvasAnchorGrid = document.getElementById('resize-canvas-anchor');
    resizeCanvasAnchorGrid.querySelectorAll('[data-anchor]').forEach((btn) => {
      btn.addEventListener('click', () => {
        resizeCanvasAnchorGrid.querySelectorAll('[data-anchor]').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
    document.getElementById('resize-canvas-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const width = Number(document.getElementById('resize-canvas-width').value);
      const height = Number(document.getElementById('resize-canvas-height').value);
      const anchorBtn = resizeCanvasAnchorGrid.querySelector('[data-anchor].active') || resizeCanvasAnchorGrid.querySelector('[data-anchor]');
      app.resizeCanvas(width, height, anchorBtn.dataset.anchor);
      resizeCanvasDialog.close();
    });
    document.getElementById('resize-canvas-cancel').addEventListener('click', () => resizeCanvasDialog.close());

    // Layer Array dialog (Layers panel header's "Array…" button — see
    // App.promptLayerArray/renderLayerArrayPreview/confirmLayerArray/cancelLayerArray)
    const layerArrayDialog = document.getElementById('layer-array-dialog');
    document.getElementById('layer-array-add').addEventListener('click', () => app.promptLayerArray());
    [
      ['layer-array-count', 'layer-array-count-value', (v) => `${Math.round(Number(v))}`],
      ['layer-array-distance', 'layer-array-distance-value', (v) => `${v}px`],
      ['layer-array-rotation', 'layer-array-rotation-value', (v) => `${v}°`],
      ['layer-array-pos-x', 'layer-array-pos-x-value', (v) => `${v}px`],
      ['layer-array-pos-y', 'layer-array-pos-y-value', (v) => `${v}px`],
    ].forEach(([inputId, valueId, format]) => {
      const input = document.getElementById(inputId);
      const value = document.getElementById(valueId);
      input.addEventListener('input', () => {
        value.textContent = format(input.value);
        app.renderLayerArrayPreview();
      });
    });
    document.getElementById('layer-array-form').addEventListener('submit', (e) => {
      e.preventDefault();
      app.confirmLayerArray();
      layerArrayDialog.close();
    });
    document.getElementById('layer-array-cancel').addEventListener('click', () => {
      app.cancelLayerArray();
      layerArrayDialog.close();
    });

    // Export dialog (see App.promptExport/confirmExport/_selectedExportFormat/_updateExportHint)
    const exportDialog = document.getElementById('export-dialog');
    exportDialog.querySelectorAll('[data-export-format]').forEach((btn) => {
      btn.addEventListener('click', () => {
        exportDialog.querySelectorAll('[data-export-format]').forEach((b) => b.classList.toggle('active', b === btn));
        const format = btn.dataset.exportFormat;
        app._updateExportHint(format);
        // Smart-default the filename between the sheet-as-one-image name and
        // the frames-as-a-zip name as the format toggles — but only while
        // the field still holds one of those two DEFAULTS, so a name Roger
        // actually typed himself is never overwritten out from under him.
        const filenameInput = document.getElementById('export-filename');
        if (format === 'frames-zip' && filenameInput.value === 'sprite-sheet') {
          filenameInput.value = 'sprite-frames';
        } else if (format !== 'frames-zip' && filenameInput.value === 'sprite-frames') {
          filenameInput.value = 'sprite-sheet';
        }
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
