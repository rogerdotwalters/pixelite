/**
 * referenceView.js
 * ---------------------------------------------------------------------------
 * Draws the previous/next frame as a non-interactive reference, in one of
 * three modes (set from the frame bar's three-way switch — see frameBar.js):
 *
 *   'normal'  — no reference shown at all, just the current frame.
 *   'side'    — prev and next are drawn as separate small panels beside
 *               the main canvas.
 *   'overlay' — ONE of prev/next (whichever is selected via setOverlayTarget,
 *               next to the opacity slider) is drawn as a semi-transparent
 *               layer directly on top of the main canvas, so you can see
 *               through it onto the frame you're editing (classic "onion
 *               skinning", useful for lining up an animation). Only one
 *               reference frame is ever shown at once in this mode — never
 *               both stacked together — so it's unambiguous whether you're
 *               looking at what the pose *was* (prev) or what it's
 *               *becoming* (next).
 *
 * The reference canvases never receive pointer events (see the
 * `pointer-events: none` rule on .ref-overlay-canvas / .ref-pane canvas in
 * style.css, and the fact that this file never attaches mouse listeners to
 * them) — they're look-only.
 */

class ReferenceView {
  /**
   * @param {Object} els  DOM elements, all required:
   *   prevPane, nextPane            — the side-by-side panel containers
   *   prevCanvas, nextCanvas        — canvases inside those panels
   *   prevPlaceholder, nextPlaceholder — "no frame" placeholders inside those panels
   *   prevOverlayCanvas, nextOverlayCanvas — canvases stacked on top of the main canvas
   * @param {() => number} getZoom  returns the current zoom level to render at
   */
  constructor(els, getZoom) {
    Object.assign(this, els);
    this.getZoom = getZoom;
    this.mode = 'normal';
    this.opacity = 0.4;
    this.overlayTarget = 'prev'; // 'prev' | 'next' — which single frame Overlay mode shows
    this._lastProject = null;
    this._applyVisibility();
  }

  setMode(mode) {
    this.mode = mode;
    this._applyVisibility();
    this.render(this._lastProject);
  }

  setOpacity(opacity) {
    this.opacity = Math.max(0, Math.min(1, opacity));
    this.render(this._lastProject);
  }

  /** Overlay mode shows exactly one reference frame at a time — this picks which. */
  setOverlayTarget(target) {
    this.overlayTarget = target === 'next' ? 'next' : 'prev';
    this.render(this._lastProject);
  }

  /** Show/hide the panels and overlay canvases for the active mode. Frame-existence is handled separately in render(). */
  _applyVisibility() {
    const isSide = this.mode === 'side';
    const isOverlay = this.mode === 'overlay';
    this.prevPane.hidden = !isSide;
    this.nextPane.hidden = !isSide;
    if (!isOverlay) {
      this.prevOverlayCanvas.hidden = true;
      this.nextOverlayCanvas.hidden = true;
    }
  }

  /** Re-draws whichever reference panels the current mode needs. Safe to call often (e.g. on every frame switch). */
  render(project) {
    this._lastProject = project;
    if (!project) return;
    const zoom = this.getZoom();
    const prev = project.prevFrame();
    const next = project.nextFrame();

    if (this.mode === 'side') {
      this._paintPane(this.prevCanvas, this.prevPlaceholder, prev, zoom);
      this._paintPane(this.nextCanvas, this.nextPlaceholder, next, zoom);
    } else if (this.mode === 'overlay') {
      // Only ever paint ONE overlay canvas — the other stays hidden — so
      // prev and next are never stacked/blended together on screen.
      if (this.overlayTarget === 'next') {
        this.prevOverlayCanvas.hidden = true;
        this._paintOverlay(this.nextOverlayCanvas, next, zoom);
      } else {
        this.nextOverlayCanvas.hidden = true;
        this._paintOverlay(this.prevOverlayCanvas, prev, zoom);
      }
    }
  }

  _paintPane(canvas, placeholder, frame, zoom) {
    canvas.hidden = !frame;
    placeholder.hidden = !!frame;
    // getCompositedBuffer(), not frame.buffer (the ACTIVE layer only) — a
    // reference frame should show everything it actually looks like, every
    // visible layer flattened, not just whichever layer happened to be
    // active on it last.
    if (frame) window.PAE.CanvasView.paintBuffer(canvas, frame.getCompositedBuffer(), zoom, 1);
  }

  _paintOverlay(canvas, frame, zoom) {
    canvas.hidden = !frame;
    if (frame) window.PAE.CanvasView.paintBuffer(canvas, frame.getCompositedBuffer(), zoom, this.opacity);
  }
}

window.PAE = window.PAE || {};
window.PAE.ReferenceView = ReferenceView;
