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
   * Tight bounding box of every pixel with alpha > 0 in `buf`, or `null` if
   * the buffer is fully transparent. Used by the Pixel Selection tool's
   * "Layer" mode to grab exactly what's actually drawn on the active layer
   * rather than the whole (possibly mostly-empty) canvas.
   */
  static boundingBoxOfContent(buf) {
    let minX = buf.width;
    let minY = buf.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < buf.height; y++) {
      for (let x = 0; x < buf.width; x++) {
        if (buf.data[buf.indexOf(x, y) + 3] > 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX) return null; // nothing painted at all
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  /**
   * A 0/1 mask, row-major and sized `region.w * region.h`, marking which
   * pixels within `region` are non-transparent in `buf` — the exact shape
   * the Pixel Selection tool's "Layer" mode selects (paired with the
   * bounding box from `boundingBoxOfContent`).
   */
  static alphaMask(buf, region) {
    const mask = new Uint8Array(region.w * region.h);
    for (let ry = 0; ry < region.h; ry++) {
      for (let rx = 0; rx < region.w; rx++) {
        mask[ry * region.w + rx] = buf.data[buf.indexOf(region.x + rx, region.y + ry) + 3] > 0 ? 1 : 0;
      }
    }
    return mask;
  }

  /**
   * A simple 4-connected flood fill ("magic wand") over every non-transparent
   * pixel reachable from (startX, startY) — the Pixel Selection tool's
   * "Object" mode. Returns `null` if the starting pixel itself is transparent
   * (nothing there to select). Otherwise returns `{ region: {x,y,w,h}, mask }`:
   * `region` is the tight bounding box of the WHOLE connected component, and
   * `mask` (sized `region.w * region.h`) marks exactly which pixels within
   * that box actually belong to it — so a non-rectangular shape's bounding
   * box (which may overlap unrelated, unconnected artwork) never fools a
   * downstream copy/cut/resize into touching more than the shape itself.
   * Deliberately 4-connected (not 8-connected): two pixels that only touch
   * diagonally are treated as separate objects, which matches how most
   * pixel art is actually drawn (diagonal-only contact is usually two
   * distinct shapes just grazing corners, not one shape).
   */
  static floodSelect(buf, startX, startY) {
    if (!buf.inBounds(startX, startY) || buf.data[buf.indexOf(startX, startY) + 3] === 0) return null;
    const w = buf.width;
    const h = buf.height;
    const visited = new Uint8Array(w * h);
    const stack = [[startX, startY]];
    visited[startY * w + startX] = 1;
    let minX = startX;
    let maxX = startX;
    let minY = startY;
    let maxY = startY;
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const neighbors = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ];
      for (const [nx, ny] of neighbors) {
        if (!buf.inBounds(nx, ny)) continue;
        const idx = ny * w + nx;
        if (visited[idx]) continue;
        if (buf.data[buf.indexOf(nx, ny) + 3] === 0) continue;
        visited[idx] = 1;
        stack.push([nx, ny]);
      }
    }
    const region = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    const mask = new Uint8Array(region.w * region.h);
    for (let y = region.y; y < region.y + region.h; y++) {
      for (let x = region.x; x < region.x + region.w; x++) {
        if (visited[y * w + x]) mask[(y - region.y) * region.w + (x - region.x)] = 1;
      }
    }
    return { region, mask };
  }

  /**
   * Renders a rotated + translated copy of `source`'s content into `dest`
   * (must be the same pixel dimensions), nearest-neighbor, the same
   * inverse-mapping approach as RotateSelectionTool.applyAngle: for every
   * pixel of `dest`, undo the translation, undo the rotation around
   * (pivotX, pivotY), and sample `source` there. A `dest` pixel whose
   * sample lands outside `source`'s bounds — or lands ON a transparent
   * source pixel — is left EXACTLY AS IT WAS, never cleared to transparent.
   * That's deliberate: it's what lets the Layer Array feature (see
   * App.renderLayerArrayPreview) call this once per copy into the SAME
   * shared preview buffer and have every copy show up together, instead of
   * each call erasing the ones drawn before it. Baking the real array (see
   * App.confirmLayerArray) calls this once per copy too, but into a
   * brand-new blank buffer each time, so there's nothing for it to
   * preserve there anyway.
   * @param {PixelBuffer} dest
   * @param {PixelBuffer} source
   * @param {{pivotX: number, pivotY: number, angleDeg: number, dx: number, dy: number}} opts
   */
  static transformInto(dest, source, { pivotX, pivotY, angleDeg, dx, dy }) {
    const rad = (-angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    for (let y = 0; y < dest.height; y++) {
      for (let x = 0; x < dest.width; x++) {
        // Undo the translation, then undo the rotation around the pivot —
        // same order/sign convention as RotateSelectionTool.applyAngle.
        const ux = x - dx + 0.5 - pivotX;
        const uy = y - dy + 0.5 - pivotY;
        const srcX = Math.floor(pivotX + ux * cos - uy * sin);
        const srcY = Math.floor(pivotY + ux * sin + uy * cos);
        if (!source.inBounds(srcX, srcY)) continue;
        const p = source.getPixel(srcX, srcY);
        if (!p || p[3] === 0) continue;
        dest.setPixel(x, y, p);
      }
    }
  }

  /**
   * Rotates `source`'s own content by `angleDeg` around ITS OWN center,
   * returning a brand-new PixelBuffer of the SAME width/height — a small
   * wrapper around `transformInto` with the pivot fixed at the buffer's
   * own center and no translation. This is what lets a rotate tool always
   * re-derive "the object at angle N" fresh from a single pristine,
   * never-rotated source buffer instead of re-rotating an already-rotated
   * (and therefore already slightly resampled/clipped) result — see
   * `Layer.resolveRotationBase` in layer.js for why that matters.
   * @param {PixelBuffer} source
   * @param {number} angleDeg
   */
  static rotateLocal(source, angleDeg) {
    const dest = PixelBuffer.createBlank(source.width, source.height);
    PixelBuffer.transformInto(dest, source, {
      pivotX: source.width / 2,
      pivotY: source.height / 2,
      angleDeg,
      dx: 0,
      dy: 0,
    });
    return dest;
  }

  /**
   * Byte-for-byte RGBA comparison of two same-sized buffers — `false` on a
   * size mismatch too. Used by `Layer.resolveRotationBase` to verify a
   * stored rotation origin is still trustworthy (nothing else has painted
   * over the object since) before trusting it over the object's current,
   * possibly-already-rotated pixels.
   */
  static equalPixels(a, b) {
    if (a.width !== b.width || a.height !== b.height) return false;
    for (let i = 0; i < a.data.length; i++) {
      if (a.data[i] !== b.data[i]) return false;
    }
    return true;
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
