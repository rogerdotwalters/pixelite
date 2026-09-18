/**
 * pixelBuffer.js
 * ---------------------------------------------------------------------------
 * Core pixel data model. This is the single source of truth for "what does
 * the image actually contain" — completely independent of how it is drawn
 * on screen (see canvasView.js) or how the user interacts with it (see the
 * tools/ folder). Keeping this separation means tools and rendering can
 * change freely without ever touching pixel storage logic.
 *
 * Pixels are stored as a flat Uint8ClampedArray of RGBA bytes, exactly like
 * ImageData, so converting to/from a real <canvas> is cheap.
 */

class PixelBuffer {
  /**
   * @param {number} width
   * @param {number} height
   * @param {Uint8ClampedArray} [data] optional existing RGBA data to wrap
   */
  constructor(width, height, data) {
    this.width = width;
    this.height = height;
    this.data = data || new Uint8ClampedArray(width * height * 4); // fully transparent by default
  }

  /** Byte offset into `data` for pixel (x, y). */
  indexOf(x, y) {
    return (y * this.width + x) * 4;
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Returns [r, g, b, a] (0-255 each) for a pixel, or null if out of bounds. */
  getPixel(x, y) {
    if (!this.inBounds(x, y)) return null;
    const i = this.indexOf(x, y);
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  /** Directly overwrite a pixel with an exact [r,g,b,a] value (no blending). */
  setPixel(x, y, rgba) {
    if (!this.inBounds(x, y)) return;
    const i = this.indexOf(x, y);
    this.data[i] = rgba[0];
    this.data[i + 1] = rgba[1];
    this.data[i + 2] = rgba[2];
    this.data[i + 3] = rgba[3];
  }

  /**
   * Paints a pixel using standard "source-over" alpha compositing, so the
   * opacity slider behaves the way people expect from any paint program.
   * @param {number} x
   * @param {number} y
   * @param {[number,number,number]} rgb  destination color, 0-255
   * @param {number} opacity 0-1 (the *source* alpha for this stroke)
   */
  blendPixel(x, y, rgb, opacity) {
    if (!this.inBounds(x, y)) return;
    const i = this.indexOf(x, y);
    const srcA = Math.max(0, Math.min(1, opacity));
    if (srcA >= 1) {
      // Fully opaque: just overwrite, avoids float rounding for the common case.
      this.data[i] = rgb[0];
      this.data[i + 1] = rgb[1];
      this.data[i + 2] = rgb[2];
      this.data[i + 3] = 255;
      return;
    }
    if (srcA <= 0) return;

    const dstA = this.data[i + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) {
      this.data[i] = 0;
      this.data[i + 1] = 0;
      this.data[i + 2] = 0;
      this.data[i + 3] = 0;
      return;
    }
    this.data[i] = (rgb[0] * srcA + this.data[i] * dstA * (1 - srcA)) / outA;
    this.data[i + 1] = (rgb[1] * srcA + this.data[i + 1] * dstA * (1 - srcA)) / outA;
    this.data[i + 2] = (rgb[2] * srcA + this.data[i + 2] * dstA * (1 - srcA)) / outA;
    this.data[i + 3] = outA * 255;
  }

  /** Fills the whole buffer with a single [r,g,b,a] value. */
  fillAll(rgba) {
    for (let p = 0; p < this.width * this.height; p++) {
      const i = p * 4;
      this.data[i] = rgba[0];
      this.data[i + 1] = rgba[1];
      this.data[i + 2] = rgba[2];
      this.data[i + 3] = rgba[3];
    }
  }

  /**
   * Copies every pixel of `source` into this buffer at offset (dx, dy),
   * clipping anything that falls outside this buffer's bounds. Used by
   * SpriteProject to compose separate frames into one sprite sheet image.
   */
  blit(source, dx, dy) {
    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        this.setPixel(dx + x, dy + y, source.getPixel(x, y));
      }
    }
  }

  /** Deep copy — used heavily by the history/undo system. */
  clone() {
    return new PixelBuffer(this.width, this.height, new Uint8ClampedArray(this.data));
  }

  /** Replaces this buffer's contents with another buffer's data (must match size). */
  copyFrom(other) {
    this.width = other.width;
    this.height = other.height;
    this.data = new Uint8ClampedArray(other.data);
  }

  /** Builds a browser ImageData object from this buffer (for drawing / export). */
  toImageData() {
    return new ImageData(new Uint8ClampedArray(this.data), this.width, this.height);
  }

  /** Creates a PixelBuffer from an existing ImageData (e.g. after loading a file). */
  static fromImageData(imageData) {
    return new PixelBuffer(imageData.width, imageData.height, new Uint8ClampedArray(imageData.data));
  }

  /** Creates a new, fully transparent PixelBuffer of the given size. */
  static createBlank(width, height) {
    return new PixelBuffer(width, height);
  }

  /**
   * Extracts a w×h sub-region of `source` starting at (sx, sy) into a
   * brand-new PixelBuffer — used when slicing an imported sprite sheet
   * into individual frame buffers (see App.confirmImportSpriteSheet).
   * Anything that falls outside `source`'s own bounds (a requested tile
   * that runs past the image's edge) just reads back transparent, same as
   * any other out-of-bounds pixel read.
   */
  static extractRegion(source, sx, sy, w, h) {
    const region = new PixelBuffer(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = source.getPixel(sx + x, sy + y);
        if (px) region.setPixel(x, y, px);
      }
    }
    return region;
  }

  /**
   * Flattens an array of layers (see layer.js) into one PixelBuffer, bottom
   * to top, via standard "source-over" alpha compositing — this is what
   * actually turns a stack of layers into "the picture": the main canvas,
   * onion-skin references, filmstrip thumbnails, and export all call this
   * rather than ever looking at an individual layer's buffer. A hidden
   * layer (`layer.visible === false`) is skipped entirely. Non-mutating —
   * layer buffers are only ever read here, never written.
   * @param {Array<{visible: boolean, buffer: PixelBuffer}>} layers  bottom-to-top
   * @param {number} width
   * @param {number} height
   */
  static compositeLayers(layers, width, height) {
    const result = new PixelBuffer(width, height);
    const dst = result.data;
    for (const layer of layers) {
      if (!layer.visible) continue;
      const src = layer.buffer.data;
      for (let i = 0; i < dst.length; i += 4) {
        const srcA = src[i + 3] / 255;
        if (srcA <= 0) continue;
        const dstA = dst[i + 3] / 255;
        const outA = srcA + dstA * (1 - srcA);
        if (outA <= 0) continue;
        dst[i] = (src[i] * srcA + dst[i] * dstA * (1 - srcA)) / outA;
        dst[i + 1] = (src[i + 1] * srcA + dst[i + 1] * dstA * (1 - srcA)) / outA;
        dst[i + 2] = (src[i + 2] * srcA + dst[i + 2] * dstA * (1 - srcA)) / outA;
        dst[i + 3] = outA * 255;
      }
    }
    return result;
  }
}

// Expose on the shared app namespace (see app.js for why we use a namespace
// object instead of ES modules: it keeps the app working from a plain
// file:// double-click with no build step or server required).
window.PAE = window.PAE || {};
window.PAE.PixelBuffer = PixelBuffer;
