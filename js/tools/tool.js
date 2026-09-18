/**
 * tools/tool.js
 * ---------------------------------------------------------------------------
 * Base class defining the interface every tool must implement.
 *
 * ============================================================
 *  HOW TO ADD A NEW TOOL (this is the extension point!)
 * ============================================================
 *   1. Create a new file in tools/, e.g. tools/lineTool.js
 *   2. Make a class that extends PAE.Tool and implements the hooks below.
 *   3. Register it in app.js:  toolManager.register(new PAE.LineTool());
 *   4. Add a toolbar button in index.html with data-tool="line" and give it
 *      a keyboard shortcut in ui.js's shortcut map if desired.
 * That's it — the canvas, history, and palette systems don't need to know
 * the new tool exists.
 *
 * Every hook receives a `ctx` object (built in app.js) with:
 *   ctx.buffer          the active PAE.PixelBuffer
 *   ctx.history          the active PAE.HistoryManager
 *   ctx.getColor()        -> [r,g,b] currently selected color
 *   ctx.getOpacity()      -> 0-1 current opacity slider value
 *   ctx.getShapeFill()     -> bool, the Shape tools' outline/filled toggle
 *   ctx.getBlenderRadius()   -> pixels, the Blender tool's brush radius
 *   ctx.getBlenderStrength()  -> 0-1, the Blender tool's blend strength
 *   ctx.pickColor(hex)  sets a new base/current color (see tools/eyedropperTool.js)
 *   ctx.requestRender() call after mutating the buffer, to redraw the canvas
 * (x, y) are integer pixel coordinates within the buffer (may be slightly
 * out of bounds during a fast drag; tools should tolerate that). Every hook
 * also receives the native pointer event as an optional last argument
 * (`evt`) so a tool can read modifier keys — e.g. the Line/Shape tools use
 * `evt.shiftKey` to snap to an angle or constrain to a square/circle.
 */

class Tool {
  /**
   * @param {string} id      unique id, matches the toolbar button's data-tool attribute
   * @param {string} name    human readable label (tooltips, status bar)
   * @param {string} cursor  CSS cursor to show while this tool is active
   */
  constructor(id, name, cursor = 'crosshair') {
    this.id = id;
    this.name = name;
    this.cursor = cursor;
  }

  /** Called when this tool becomes the active tool. */
  onActivate(ctx) {}

  /** Called when switching away to a different tool. */
  onDeactivate(ctx) {}

  /** Mouse/pointer pressed down on the canvas at pixel (x, y). */
  onMouseDown(ctx, x, y, evt) {}

  /** Mouse/pointer moved over the canvas at pixel (x, y) (button state tracked by the tool itself). */
  onMouseMove(ctx, x, y, evt) {}

  /** Mouse/pointer released. */
  onMouseUp(ctx, x, y, evt) {}

  /** Pointer left the canvas area entirely (useful to end a stroke safely). */
  onLeave(ctx) {}
}

window.PAE = window.PAE || {};
window.PAE.Tool = Tool;
