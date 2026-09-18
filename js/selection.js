/**
 * selection.js
 * ---------------------------------------------------------------------------
 * The current rectangular pixel selection, if any — set by the Pixel
 * Selection tool (tools/pixelSelectionTool.js), read by Cut/Copy/Paste
 * (App.cutSelection/copySelection/pasteSelection), "Copy/Cut to New Layer"
 * (App.copySelectionToNewLayer), and the Rotate Selection tool. Also drawn
 * on screen as a "marching ants" overlay — see selectionOverlay.js.
 *
 * Deliberately NOT part of undo history: making or clearing a selection
 * doesn't change the picture, so it isn't a `history.commit()`-worthy
 * action, and it stays in effect across an undo/redo of an actual edit.
 * It DOES get cleared on a frame switch (see App._afterFrameChange) since a
 * selection's coordinates are only meaningful for the frame they were made on.
 */

class Selection {
  constructor() {
    this._rect = null; // {x, y, w, h} in frame pixel coordinates, or null
    this._listeners = [];
  }

  get() {
    return this._rect;
  }

  set(rect) {
    this._rect = rect;
    this._notify();
  }

  clear() {
    if (!this._rect) return;
    this._rect = null;
    this._notify();
  }

  onChange(fn) {
    this._listeners.push(fn);
  }

  _notify() {
    this._listeners.forEach((fn) => fn(this._rect));
  }
}

window.PAE = window.PAE || {};
window.PAE.Selection = Selection;
