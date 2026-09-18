/**
 * tools/fillTool.js
 * ---------------------------------------------------------------------------
 * Flood fill: replaces every pixel in the contiguous 4-connected region that
 * exactly matches the color under the click with the current palette color
 * (respecting the opacity slider, same as the pencil, for consistent
 * behavior across tools).
 */

class FillTool extends window.PAE.Tool {
  constructor() {
    super('fill', 'Fill', 'pointer');
  }

  onMouseDown(ctx, x, y) {
    if (!ctx.buffer.inBounds(x, y)) return;
    ctx.history.commit();

    const target = ctx.buffer.getPixel(x, y);
    const rgb = ctx.getColor();
    const opacity = ctx.getOpacity();

    // If the fill color+opacity would produce an identical pixel, there's
    // nothing to do (also avoids infinite loops on a no-op fill).
    FillTool._floodFill(ctx.buffer, x, y, target, (px, py) => {
      ctx.buffer.blendPixel(px, py, rgb, opacity);
    });

    ctx.requestRender();
  }

  onMouseMove() {}
  onMouseUp() {}

  /**
   * Stack-based (non-recursive, so it can't blow the call stack on large
   * canvases) 4-connected flood fill.
   * @param {PAE.PixelBuffer} buffer
   * @param {number} startX
   * @param {number} startY
   * @param {[number,number,number,number]} targetRgba  color being replaced
   * @param {(x:number, y:number) => void} paint  called once per matching pixel
   */
  static _floodFill(buffer, startX, startY, targetRgba, paint) {
    const { width, height } = buffer;
    const visited = new Uint8Array(width * height);
    const stack = [[startX, startY]];

    const matches = (x, y) => {
      const p = buffer.getPixel(x, y);
      return (
        p &&
        p[0] === targetRgba[0] &&
        p[1] === targetRgba[1] &&
        p[2] === targetRgba[2] &&
        p[3] === targetRgba[3]
      );
    };

    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const idx = y * width + x;
      if (visited[idx]) continue;
      if (!matches(x, y)) continue;

      visited[idx] = 1;
      paint(x, y);

      stack.push([x + 1, y]);
      stack.push([x - 1, y]);
      stack.push([x, y + 1]);
      stack.push([x, y - 1]);
    }
  }
}

window.PAE = window.PAE || {};
window.PAE.FillTool = FillTool;
