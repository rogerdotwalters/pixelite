/**
 * canvasView.js
 * ---------------------------------------------------------------------------
 * Everything about *drawing* the pixel buffer to the screen and turning
 * mouse events into pixel coordinates. It never mutates the buffer itself —
 * that's the tools' job — it only reads from it.
 *
 * Pixel-perfect rendering strategy:
 *   - An offscreen canvas is kept at the image's NATIVE resolution
 *     (one canvas pixel per image pixel) and updated via putImageData.
 *   - The visible canvas is scaled up by `zoom` and drawn with
 *     imageSmoothingEnabled = false, plus the CSS `image-rendering: pixelated`
 *     rule (see style.css), so zooming never introduces blur or anti-aliasing.
 *
 * Since a frame can now hold multiple layers (see layer.js/spriteProject.js),
 * "what to draw" is a live CALLBACK (`getBuffer`) rather than a stored
 * buffer reference — it's called fresh on every render() and typically
 * returns a freshly-flattened composite of every visible layer, so editing
 * ANY layer (not just switching frames) is reflected immediately without
 * this view needing to know layers exist at all.
 */

class CanvasView {
  /**
   * @param {HTMLCanvasElement} canvasEl  the visible on-screen canvas
   * @param {HTMLElement} viewportEl      the scrollable container around it (for centering/panning)
   * @param {() => PAE.PixelBuffer} getBuffer  returns the buffer to display, called fresh each render
   */
  constructor(canvasEl, viewportEl, getBuffer) {
    this.canvas = canvasEl;
    this.viewport = viewportEl;
    this.ctx = canvasEl.getContext('2d');
    this.getBuffer = getBuffer;
    this.zoom = 12; // screen pixels per image pixel
    this.minZoom = 1;
    this.maxZoom = 48;

    this._resizeListeners = [];
  }

  onZoomChange(fn) {
    this._resizeListeners.push(fn);
  }

  setZoom(zoom) {
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, Math.round(zoom)));
    this.render();
    this._resizeListeners.forEach((fn) => fn(this.zoom));
  }

  zoomIn() {
    this.setZoom(this.zoom + (this.zoom < 8 ? 1 : 4));
  }

  zoomOut() {
    this.setZoom(this.zoom - (this.zoom <= 8 ? 1 : 4));
  }

  /** Redraws the visible canvas from whatever `getBuffer()` currently returns. */
  render() {
    CanvasView.paintBuffer(this.canvas, this.getBuffer(), this.zoom);
  }

  /**
   * Converts a mouse/pointer event's client coordinates into integer pixel
   * coordinates within the image buffer.
   */
  eventToPixel(evt) {
    const rect = this.canvas.getBoundingClientRect();
    // getBoundingClientRect() includes the canvas's CSS border, but the
    // drawing surface (canvas.width/height) does not — so we have to
    // subtract the border before scaling, or every click lands slightly
    // off from where it visually looks like it should (worst near the
    // top/left edge, exactly where precise pixel art work happens most).
    // clientWidth/clientHeight/clientLeft/clientTop are border-exclusive,
    // which is exactly what we need here.
    const contentX = evt.clientX - rect.left - this.canvas.clientLeft;
    const contentY = evt.clientY - rect.top - this.canvas.clientTop;
    const scaleX = this.canvas.width / this.canvas.clientWidth;
    const scaleY = this.canvas.height / this.canvas.clientHeight;
    const x = Math.floor((contentX * scaleX) / this.zoom);
    const y = Math.floor((contentY * scaleY) / this.zoom);
    return { x, y };
  }

  /**
   * Same math as eventToPixel, but WITHOUT the final Math.floor — returns
   * fractional image-pixel coordinates. Ordinary tools never need this
   * (a brush stroke always targets one whole pixel), but the Object tool
   * (tools/objectTool.js) does: it hit-tests small on-canvas handles by a
   * fixed number of SCREEN pixels' tolerance, which only translates to a
   * consistent image-pixel tolerance (tolerance / zoom) if the underlying
   * mouse position isn't already rounded away first.
   */
  eventToFractionalPixel(evt) {
    const rect = this.canvas.getBoundingClientRect();
    const contentX = evt.clientX - rect.left - this.canvas.clientLeft;
    const contentY = evt.clientY - rect.top - this.canvas.clientTop;
    const scaleX = this.canvas.width / this.canvas.clientWidth;
    const scaleY = this.canvas.height / this.canvas.clientHeight;
    const x = (contentX * scaleX) / this.zoom;
    const y = (contentY * scaleY) / this.zoom;
    return { x, y };
  }
}

/**
 * Shared pixel-perfect painter: draws `buffer` onto `canvas` at `zoom`
 * screen-pixels-per-image-pixel, with optional transparency. Used by the
 * main interactive CanvasView above AND by referenceView.js's read-only
 * prev/next panels and onion-skin overlay canvases, so every place that
 * shows pixel art scales it identically (no smoothing, no drift between
 * views).
 * @param {HTMLCanvasElement} canvas
 * @param {PAE.PixelBuffer} buffer
 * @param {number} zoom
 * @param {number} [opacity] 0-1, defaults to fully opaque
 */
CanvasView.paintBuffer = function paintBuffer(canvas, buffer, zoom, opacity = 1) {
  if (!CanvasView._scratch) CanvasView._scratch = document.createElement('canvas');
  const scratch = CanvasView._scratch;
  scratch.width = buffer.width;
  scratch.height = buffer.height;
  scratch.getContext('2d', { willReadFrequently: true }).putImageData(buffer.toImageData(), 0, 0);

  const displayWidth = buffer.width * zoom;
  const displayHeight = buffer.height * zoom;
  if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
    canvas.width = displayWidth;
    canvas.height = displayHeight;
  }

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, displayWidth, displayHeight);
  ctx.globalAlpha = opacity;
  ctx.drawImage(scratch, 0, 0, displayWidth, displayHeight);
  ctx.globalAlpha = 1;
};

window.PAE = window.PAE || {};
window.PAE.CanvasView = CanvasView;
