/**
 * selection.js
 * ---------------------------------------------------------------------------
 * The current pixel selection, if any — always has a bounding rectangle
 * `{x, y, w, h}`, and OPTIONALLY an exact-shape `mask` (a 0/1 Uint8Array
 * sized `w*h`, row-major) when it came from the Pixel Selection tool's
 * "Layer" or "Object" mode rather than an ordinary rectangle drag (see
 * tools/pixelSelectionTool.js / PixelBuffer.boundingBoxOfContent /
 * PixelBuffer.floodSelect). Consumers that don't care about the exact shape
 * — just its bounding box — can ignore `mask` entirely and treat any
 * selection as a plain rectangle; consumers that DO care (Cut/Copy/Paste,
 * "Copy/Cut to New Layer", the Resize Selection tool) check for it and skip
 * pixels outside it when it's present. Read by Cut/Copy/Paste
 * (App.cutSelection/copySelection/pasteSelection), "Copy/Cut to New Layer"
 * (App.copySelectionToNewLayer), and the Rotate/Resize Selection tools. Also
 * drawn on screen as a "marching ants" + mask-highlight overlay — see
 * selectionOverlay.js.
 *
 * Making or clearing a selection is still never its OWN undo-worthy
 * action (it doesn't touch a single pixel, so it never calls
 * `history.commit()` on its own) — but as of Round F it rides along as a
 * bystander field inside every Frame history snapshot (see
 * spriteProject.js's Frame._snapshot/_restore), so undoing/redoing an
 * actual edit (a brush stroke, an Object tool move/scale/rotate, a paste,
 * ...) also restores whichever selection was in effect right before that
 * edit — Roger: "undo should bring the selection box back." It still gets
 * cleared on a frame switch (see App._afterFrameChange) since a
 * selection's coordinates are only meaningful for the frame they were
 * made on, and on switching to any tool that doesn't itself drive a
 * selection (see toolManager.js's SELECTION_PRESERVING_TOOL_IDS) and on
 * pressing Escape (see ui.js) — none of which are undo-worthy edits
 * either, so none of them get their own history entry.
 *
 * `hideMarquee` (optional, on the rect): sees the selection stays a real,
 * live selection — grabbable by the Object tool, etc. — while telling
 * selectionOverlay.js to skip drawing the dashed marquee rectangle for it.
 * Set by App.pasteSelection so a freshly pasted "object" layer doesn't
 * leave the old marquee visibly "stuck" on screen right after paste.
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
