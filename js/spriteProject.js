/**
 * spriteProject.js
 * ---------------------------------------------------------------------------
 * A "project" is a sequence of one or more equally-sized frames. A plain
 * single image is just a project with one frame — there's no separate
 * "sprite sheet mode" to switch into. This is what makes the feature simple:
 *   - File > New / Open always creates a 1-frame project, so the default
 *     is always a plain single-frame image.
 *   - The filmstrip below the canvas (see filmstrip.js) grows it into an
 *     animation as needed — hovering between frames offers "insert blank"
 *     or "insert duplicate" right there.
 *   - Export combines every frame into one sprite sheet (stacked left to
 *     right) automatically whenever there's more than one frame; with a
 *     single frame it exports exactly as it always did.
 *
 * Each frame is a `Frame` (below) — a stack of one or more `Layer`s (see
 * layer.js) plus its own `HistoryManager`, so undo/redo never crosses frame
 * boundaries. A history snapshot captures the frame's ENTIRE layer stack
 * (every layer's pixels, name, visibility, and which one is active), not
 * just pixels — so adding/deleting/reordering/hiding a layer is just as
 * undoable as a brush stroke, with no separate undo mechanism needed for
 * "layer operations" vs. "pixel operations."
 */

class Frame {
  /**
   * @param {number} width
   * @param {number} height
   * @param {Array<PAE.Layer>} [layers]  defaults to a single blank layer
   */
  constructor(width, height, layers) {
    this.width = width;
    this.height = height;
    this.layers = layers && layers.length ? layers : [new window.PAE.Layer('Layer 1', window.PAE.PixelBuffer.createBlank(width, height))];
    this.activeLayerIndex = 0;
    this.history = new window.PAE.HistoryManager(
      () => this._snapshot(),
      (snapshot) => this._restore(snapshot)
    );
  }

  get activeLayer() {
    return this.layers[this.activeLayerIndex];
  }

  /** What tools actually paint on — the ACTIVE layer's buffer, never the flattened image. */
  get buffer() {
    return this.activeLayer.buffer;
  }

  /** The flattened, "what this frame actually looks like" image — every visible layer composited bottom to top. Recomputed fresh each call (cheap enough at pixel-art sizes) so it always reflects the latest edit on any layer. */
  getCompositedBuffer() {
    return window.PAE.PixelBuffer.compositeLayers(this.layers, this.width, this.height);
  }

  _snapshot() {
    return { activeLayerIndex: this.activeLayerIndex, layers: this.layers.map((l) => l.clone()) };
  }

  _restore(snapshot) {
    this.activeLayerIndex = snapshot.activeLayerIndex;
    this.layers = snapshot.layers.map((l) => l.clone());
  }

  /** Deep copy — used when duplicating a whole frame (the filmstrip's "insert a copy" gap button). */
  clone() {
    return new Frame(this.width, this.height, this.layers.map((l) => l.clone()));
  }

  // ---- layer management ---------------------------------------------------
  // All of these mutate `this.layers`/`this.activeLayerIndex` directly and
  // are meant to be called right after `history.commit()` (see app.js) so
  // they're undoable — this class itself has no opinion about undo, it just
  // needs to be true that its whole state is captured by `_snapshot()`.

  /** Inserts a brand-new blank layer right above the active one and makes it active. */
  addLayer(name) {
    const layer = new window.PAE.Layer(
      name || `Layer ${this.layers.length + 1}`,
      window.PAE.PixelBuffer.createBlank(this.width, this.height)
    );
    this.layers.splice(this.activeLayerIndex + 1, 0, layer);
    this.activeLayerIndex += 1;
    return layer;
  }

  /** Inserts an already-built layer (e.g. a "Copy to New Layer" snippet — see App.copySelectionToNewLayer) right above the active one and makes it active. */
  insertLayerAbove(name, buffer) {
    const layer = new window.PAE.Layer(name, buffer);
    this.layers.splice(this.activeLayerIndex + 1, 0, layer);
    this.activeLayerIndex += 1;
    return layer;
  }

  /** Removes the layer at `index`. Refuses if it's the only one left (a frame always has >= 1 layer). */
  deleteLayerAt(index) {
    if (this.layers.length <= 1 || index < 0 || index >= this.layers.length) return false;
    this.layers.splice(index, 1);
    if (index < this.activeLayerIndex) this.activeLayerIndex--;
    this.activeLayerIndex = Math.max(0, Math.min(this.activeLayerIndex, this.layers.length - 1));
    return true;
  }

  /** Moves the layer at `index` up (`delta` +1, toward the top of the stack) or down (-1). */
  moveLayerAt(index, delta) {
    const to = index + delta;
    if (to < 0 || to >= this.layers.length) return false;
    const [layer] = this.layers.splice(index, 1);
    this.layers.splice(to, 0, layer);
    if (this.activeLayerIndex === index) this.activeLayerIndex = to;
    else if (this.activeLayerIndex === to) this.activeLayerIndex = index; // it swapped places with the one that moved
    return true;
  }

  toggleLayerVisibilityAt(index) {
    const layer = this.layers[index];
    if (layer) layer.visible = !layer.visible;
  }

  renameLayerAt(index, name) {
    const layer = this.layers[index];
    if (layer && name) layer.name = name;
  }

  setActiveLayerIndex(index) {
    if (index >= 0 && index < this.layers.length) this.activeLayerIndex = index;
  }
}

class SpriteProject {
  /**
   * @param {number} frameWidth   fixed for every frame in this project
   * @param {number} frameHeight
   * @param {Array<Frame>} frames  at least one frame
   */
  constructor(frameWidth, frameHeight, frames) {
    this.frameWidth = frameWidth;
    this.frameHeight = frameHeight;
    this.frames = frames && frames.length ? frames : [new Frame(frameWidth, frameHeight)];
    this.currentIndex = 0;
  }

  static blank(width, height) {
    return new SpriteProject(width, height, [new Frame(width, height)]);
  }

  /** A brand-new project whose first frame's single layer IS the given image (its size becomes the fixed frame size). */
  static fromSingleImage(buffer) {
    return new SpriteProject(buffer.width, buffer.height, [
      new Frame(buffer.width, buffer.height, [new window.PAE.Layer('Layer 1', buffer)]),
    ]);
  }

  // ---- current frame -------------------------------------------------

  get currentFrame() {
    return this.frames[this.currentIndex];
  }

  /** What tools paint on: the current frame's ACTIVE layer's buffer. */
  get buffer() {
    return this.currentFrame.buffer;
  }

  get history() {
    return this.currentFrame.history;
  }

  /** What should actually be SHOWN for the current frame: every visible layer, flattened. */
  getDisplayBuffer() {
    return this.currentFrame.getCompositedBuffer();
  }

  frameCount() {
    return this.frames.length;
  }

  // ---- navigation -------------------------------------------------

  hasPrev() {
    return this.currentIndex > 0;
  }

  hasNext() {
    return this.currentIndex < this.frames.length - 1;
  }

  /** The frame BEFORE the current one, or null at the start — used as the onion-skin/side reference. */
  prevFrame() {
    return this.hasPrev() ? this.frames[this.currentIndex - 1] : null;
  }

  /** The frame AFTER the current one, or null at the end. */
  nextFrame() {
    return this.hasNext() ? this.frames[this.currentIndex + 1] : null;
  }

  goPrev() {
    if (this.hasPrev()) this.currentIndex--;
  }

  goNext() {
    if (this.hasNext()) this.currentIndex++;
  }

  goTo(index) {
    if (index >= 0 && index < this.frames.length) this.currentIndex = index;
  }

  // ---- frame management -------------------------------------------------
  // Both of these are index-based (rather than always "relative to current")
  // so the filmstrip (see filmstrip.js) can insert/delete at whichever gap
  // or tile the user is actually pointing at, not just next to whatever
  // happens to be selected right now.

  /**
   * Inserts a new frame at `atIndex` (0..frameCount) and makes it current.
   * @param {number} atIndex
   * @param {number} [duplicateFromIndex]  if given, copies that frame's ENTIRE layer stack; otherwise a fresh single-layer blank frame.
   */
  insertFrame(atIndex, duplicateFromIndex) {
    const frame =
      duplicateFromIndex !== undefined && this.frames[duplicateFromIndex]
        ? this.frames[duplicateFromIndex].clone()
        : new Frame(this.frameWidth, this.frameHeight);
    const insertAt = Math.max(0, Math.min(atIndex, this.frames.length));
    this.frames.splice(insertAt, 0, frame);
    this.currentIndex = insertAt;
    return frame;
  }

  /** Removes the frame at `index`. Refuses if it's the only one left (a project always has >= 1 frame). */
  deleteFrameAt(index) {
    if (this.frames.length <= 1 || index < 0 || index >= this.frames.length) return false;
    this.frames.splice(index, 1);
    if (index < this.currentIndex) this.currentIndex--;
    this.currentIndex = Math.max(0, Math.min(this.currentIndex, this.frames.length - 1));
    return true;
  }

  /** Convenience: insert after / delete the CURRENT frame (used by keyboard-shortcut-style callers). */
  addFrame(duplicate) {
    return this.insertFrame(this.currentIndex + 1, duplicate ? this.currentIndex : undefined);
  }

  deleteFrame() {
    return this.deleteFrameAt(this.currentIndex);
  }

  // ---- export -------------------------------------------------

  /**
   * Combines every frame into one image, left to right, in frame order —
   * the actual "sprite sheet". Each frame contributes its FLATTENED
   * (composited) image, exactly what it looks like on screen — never just
   * one layer. With a single frame this just returns that one flattened
   * frame (callers typically skip calling this in that case and export the
   * frame directly instead, but it's still correct).
   */
  buildSpriteSheet() {
    const sheet = window.PAE.PixelBuffer.createBlank(this.frameWidth * this.frames.length, this.frameHeight);
    this.frames.forEach((frame, i) => {
      sheet.blit(frame.getCompositedBuffer(), i * this.frameWidth, 0);
    });
    return sheet;
  }
}

window.PAE = window.PAE || {};
window.PAE.Frame = Frame;
window.PAE.SpriteProject = SpriteProject;
