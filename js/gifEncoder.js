/**
 * gifEncoder.js
 * ---------------------------------------------------------------------------
 * A tiny, dependency-free animated GIF (GIF89a) encoder — just enough to
 * turn an array of already-flattened PixelBuffers (see animationPreview.js
 * / App.exportPreviewGif) into a downloadable, looping .gif. Written by
 * hand, no library, matching zipWriter.js's "plain vanilla JS, no build
 * step" philosophy for exactly the same reason.
 *
 * GIF has no real alpha channel — a pixel is either one of the frame's
 * palette colors, or (optionally) fully "transparent," meaning the
 * previous frame's pixel there shows through instead. This encoder always
 * declares a transparent index and gives it to every pixel with alpha
 * below 128 (a plain on/off cutoff — GIF can't represent this app's
 * partial alpha at all), and sets each frame's disposal method to
 * "restore to background" (2) so a transparent pixel always reveals a
 * clean background rather than whatever the PREVIOUS frame happened to
 * leave there — the right behavior here since every buffer passed in is
 * already a full, flattened frame (never a delta against the one before
 * it), so there is nothing worth preserving underneath it.
 *
 * One GLOBAL color table is shared by every frame (rather than a fresh
 * local table per frame) — simpler, and animated pixel art typically
 * reuses most of its colors across frames anyway. It always has exactly
 * 256 entries: up to 255 real colors (found by scanning every frame once)
 * plus one reserved slot for "transparent." If more than 255 distinct
 * opaque colors show up across all frames (unusual for pixel art, but not
 * impossible with the Blender/V Brush tools), the least-used ones are
 * remapped to their nearest surviving neighbor by plain RGB distance —
 * a real loss for that edge case, but a bounded, predictable one, rather
 * than failing the export outright.
 */

const GifEncoder = {
  /**
   * @param {Array<PAE.PixelBuffer>} buffers  one per frame, in playback order, all the same width/height
   * @param {{fps: number}} opts
   * @returns {Uint8Array} the complete GIF89a file
   */
  encode(buffers, { fps = 8 } = {}) {
    const width = buffers[0].width;
    const height = buffers[0].height;
    const { colorToKey, palette } = GifEncoder._buildPalette(buffers);
    const TRANSPARENT_INDEX = 255;
    const delayCentiseconds = Math.max(1, Math.round(100 / Math.max(1, fps)));

    const out = new GifEncoder._ByteWriter();
    out.writeAscii('GIF89a');

    // Logical Screen Descriptor: width, height, then a packed byte —
    // global color table present (0x80) | color resolution (7, i.e. 8
    // bits, in bits 4-6) | sort flag (0) | size of global color table
    // (7 -> 2^(7+1) = 256 entries, in bits 0-2) = 0xF7.
    out.writeUint16(width);
    out.writeUint16(height);
    out.writeByte(0xf7);
    out.writeByte(TRANSPARENT_INDEX); // background color index
    out.writeByte(0); // pixel aspect ratio: unused

    // Global Color Table: 256 * 3 bytes RGB. `palette` holds up to 255
    // real colors; anything unused (including index 255, "transparent")
    // is left as black, which never actually renders since every pixel
    // that lands on it is flagged transparent in the Graphic Control
    // Extension below.
    for (let i = 0; i < 256; i++) {
      const rgb = palette[i] || [0, 0, 0];
      out.writeByte(rgb[0]);
      out.writeByte(rgb[1]);
      out.writeByte(rgb[2]);
    }

    // Application Extension (NETSCAPE2.0): loop count 0 = loop forever —
    // an animation preview/export should always loop, there's no UI for
    // "play once" anywhere else in this app either.
    out.writeByte(0x21);
    out.writeByte(0xff);
    out.writeByte(0x0b);
    out.writeAscii('NETSCAPE2.0');
    out.writeByte(0x03);
    out.writeByte(0x01);
    out.writeUint16(0);
    out.writeByte(0x00);

    for (const buffer of buffers) {
      const indices = GifEncoder._bufferToIndices(buffer, colorToKey, TRANSPARENT_INDEX);

      // Graphic Control Extension: disposal method 2 ("restore to
      // background") in bits 2-4, transparent color flag (0x01) — see the
      // header comment for why both of those specific choices.
      out.writeByte(0x21);
      out.writeByte(0xf9);
      out.writeByte(0x04);
      out.writeByte((2 << 2) | 0x01);
      out.writeUint16(delayCentiseconds);
      out.writeByte(TRANSPARENT_INDEX);
      out.writeByte(0x00);

      // Image Descriptor: left, top, width, height, then a packed byte —
      // no local color table, not interlaced.
      out.writeByte(0x2c);
      out.writeUint16(0);
      out.writeUint16(0);
      out.writeUint16(width);
      out.writeUint16(height);
      out.writeByte(0x00);

      // Image Data: LZW minimum code size (8, matching the fixed 256-entry
      // table above), then the LZW-compressed, block-chunked pixel
      // indices themselves, then the mandatory zero-length block that
      // terminates a GIF image data section (every sub-block `_flushBlock`
      // writes below is a SIZED block; this one's the empty one after).
      out.writeByte(8);
      new GifEncoder._LzwEncoder(indices, 8).encode(out);
      out.writeByte(0x00);
    }

    out.writeByte(0x3b); // trailer
    return out.toBytes();
  },

  /**
   * Scans every frame once to build a shared palette: every distinct
   * opaque RGB triple (alpha >= 128), most-used first, capped at 255
   * entries. Anything beyond the cap is mapped to whichever kept color is
   * closest by plain squared RGB distance — see the header comment.
   * @returns {{colorToKey: Map<number, number>, palette: Array<[number,number,number]>}}  `colorToKey` maps a packed 0xRRGGBB int to its final palette INDEX
   */
  _buildPalette(buffers) {
    const counts = new Map(); // packed RGB int -> pixel count
    for (const buf of buffers) {
      const data = buf.data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue; // transparent — not a palette color
        const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }

    const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const keptKeys = entries.slice(0, 255).map(([key]) => key);
    const palette = keptKeys.map((key) => [(key >> 16) & 0xff, (key >> 8) & 0xff, key & 0xff]);

    const colorToKey = new Map();
    keptKeys.forEach((key, index) => colorToKey.set(key, index));

    // Anything that didn't make the cut gets remapped to its nearest
    // surviving neighbor — brute-force distance against `palette`, which
    // is at most 255 entries, against however many EXCESS colors exist
    // (only ever non-empty for genuinely huge, blended palettes).
    for (let i = 255; i < entries.length; i++) {
      const [key] = entries[i];
      const r = (key >> 16) & 0xff;
      const g = (key >> 8) & 0xff;
      const b = key & 0xff;
      let best = 0;
      let bestDist = Infinity;
      for (let p = 0; p < palette.length; p++) {
        const dr = r - palette[p][0];
        const dg = g - palette[p][1];
        const db = b - palette[p][2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          best = p;
        }
      }
      colorToKey.set(key, best);
    }

    return { colorToKey, palette };
  },

  /** Converts one buffer's RGBA pixels into palette-index bytes (row-major), using `transparentIndex` for anything with alpha < 128. */
  _bufferToIndices(buffer, colorToKey, transparentIndex) {
    const data = buffer.data;
    const count = buffer.width * buffer.height;
    const indices = new Uint8Array(count);
    for (let p = 0, i = 0; p < count; p++, i += 4) {
      if (data[i + 3] < 128) {
        indices[p] = transparentIndex;
        continue;
      }
      const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      indices[p] = colorToKey.get(key);
    }
    return indices;
  },

  /** A plain growable byte buffer with the handful of little-endian/ASCII writers a GIF's fixed-format headers need. */
  _ByteWriter: class {
    constructor() {
      this._chunks = [];
    }
    writeByte(b) {
      this._chunks.push(b & 0xff);
    }
    writeUint16(n) {
      this.writeByte(n & 0xff);
      this.writeByte((n >> 8) & 0xff);
    }
    writeAscii(str) {
      for (let i = 0; i < str.length; i++) this.writeByte(str.charCodeAt(i));
    }
    writeBytes(bytes) {
      for (let i = 0; i < bytes.length; i++) this._chunks.push(bytes[i] & 0xff);
    }
    toBytes() {
      return new Uint8Array(this._chunks);
    }
  },

  /**
   * The standard variable-bit-width GIF LZW compressor — the same
   * well-known algorithm (originally Steve Rimmer's GIFCOMPR.C, the basis
   * for essentially every hand-rolled GIF encoder since, including the
   * classic "jsgif") that every GIF file in the wild is built on: codes
   * start at `minCodeSize + 1` bits, grow by a bit whenever the string
   * table fills the current width, and reset (via a Clear code) if the
   * table would otherwise exceed the format's 12-bit code limit. Output
   * is packed into the GIF's own "sub-block" framing (each sub-block up
   * to 255 bytes, size-prefixed) as it goes.
   */
  _LzwEncoder: class {
    constructor(pixels, minCodeSize) {
      this.pixels = pixels;
      this.minCodeSize = minCodeSize;
      this.clearCode = 1 << minCodeSize;
      this.eofCode = this.clearCode + 1;
      this.BITS = 12;
      this.HSIZE = 5003; // prime > 80% load factor of 2^12 entries, same constant every GIF encoder derived from GIFCOMPR.C uses
      this.maxMaxCode = 1 << this.BITS;
    }

    encode(out) {
      this._out = out;
      this._accum = [];
      this._curAccum = 0;
      this._curBits = 0;
      this._pos = 0;

      const initBits = this.minCodeSize + 1;
      this.nBits = initBits;
      this.maxCode = (1 << this.nBits) - 1;
      this.freeEnt = this.clearCode + 2;
      this.clearFlag = false;

      this.hTab = new Int32Array(this.HSIZE).fill(-1);
      this.codeTab = new Int32Array(this.HSIZE);

      // The hash-table shift trick from the reference implementation:
      // picks how many low bits of the combined (nextColor, prevCode) key
      // to fold into the initial hash slot, derived once from HSIZE.
      let hshift = 0;
      for (let fcode = this.HSIZE; fcode < 65536; fcode *= 2) hshift++;
      this._hshift = 8 - hshift;

      this._output(this.clearCode);

      let ent = this._nextPixel();
      while (true) {
        const c = this._nextPixel();
        if (c === -1) break;
        const fcode = (c << this.BITS) + ent;
        let i = ((c << this._hshift) ^ ent) & 0x7fffffff;
        i %= this.HSIZE;
        let found = false;

        if (this.hTab[i] === fcode) {
          ent = this.codeTab[i];
          continue;
        }
        if (this.hTab[i] >= 0) {
          const disp = i === 0 ? 1 : this.HSIZE - i;
          while (true) {
            i -= disp;
            if (i < 0) i += this.HSIZE;
            if (this.hTab[i] === fcode) {
              ent = this.codeTab[i];
              found = true;
              break;
            }
            if (this.hTab[i] < 0) break;
          }
          if (found) continue;
        }

        this._output(ent);
        ent = c;
        if (this.freeEnt < this.maxMaxCode) {
          this.codeTab[i] = this.freeEnt++;
          this.hTab[i] = fcode;
        } else {
          this.hTab.fill(-1);
          this.freeEnt = this.clearCode + 2;
          this.clearFlag = true;
          this._output(this.clearCode);
        }
      }
      this._output(ent);
      this._output(this.eofCode);
      this._flushBlock();
    }

    _nextPixel() {
      if (this._pos >= this.pixels.length) return -1;
      return this.pixels[this._pos++];
    }

    _output(code) {
      this._curAccum |= code << this._curBits;
      this._curBits += this.nBits;
      while (this._curBits >= 8) {
        this._charOut(this._curAccum & 0xff);
        this._curAccum >>= 8;
        this._curBits -= 8;
      }
      if (this.freeEnt > this.maxCode || this.clearFlag) {
        if (this.clearFlag) {
          this.nBits = this.minCodeSize + 1;
          this.maxCode = (1 << this.nBits) - 1;
          this.clearFlag = false;
        } else {
          this.nBits++;
          this.maxCode = this.nBits === this.BITS ? this.maxMaxCode : (1 << this.nBits) - 1;
        }
      }
      if (code === this.eofCode) {
        while (this._curBits > 0) {
          this._charOut(this._curAccum & 0xff);
          this._curAccum >>= 8;
          this._curBits -= 8;
        }
        this._flushBlock();
      }
    }

    _charOut(byte) {
      this._accum.push(byte);
      if (this._accum.length >= 254) this._flushBlock();
    }

    /** Writes one SIZED sub-block (size byte + up to 254 data bytes) if anything's queued. The one mandatory zero-length block that actually TERMINATES an image data section is written by the caller (see `encode()`'s main loop above) right after this encoder finishes — every call here only ever fires with real data. */
    _flushBlock() {
      if (this._accum.length === 0) return;
      this._out.writeByte(this._accum.length);
      this._out.writeBytes(this._accum);
      this._accum = [];
    }
  },
};

window.PAE = window.PAE || {};
window.PAE.GifEncoder = GifEncoder;
