/**
 * toolManager.js
 * ---------------------------------------------------------------------------
 * Registry of available tools and dispatcher for pointer events. The canvas
 * view knows nothing about specific tools — it only calls into the active
 * tool through this manager, using the shared ctx object built in app.js.
 *
 * See tools/tool.js for how to add a new tool.
 */

class ToolManager {
  constructor() {
    this.tools = new Map();
    this.activeId = null;
    this._listeners = [];
  }

  register(tool) {
    this.tools.set(tool.id, tool);
    if (this.activeId === null) this.activeId = tool.id;
  }

  getTool(id) {
    return this.tools.get(id);
  }

  getActiveTool() {
    return this.tools.get(this.activeId);
  }

  setActive(id, ctx) {
    if (!this.tools.has(id) || id === this.activeId) return;
    const previous = this.getActiveTool();
    if (previous) previous.onDeactivate(ctx);
    this.activeId = id;
    const next = this.getActiveTool();
    if (next) next.onActivate(ctx);
    this._notify();
  }

  onChange(fn) {
    this._listeners.push(fn);
  }

  _notify() {
    for (const fn of this._listeners) fn(this);
  }

  // ---- pointer event forwarding -------------------------------------------

  // `evt` (the native pointer event) is optional and forwarded as-is so
  // tools can read modifier keys like Shift — see tools/tool.js's header.
  handleMouseDown(ctx, x, y, evt) {
    const tool = this.getActiveTool();
    if (tool) tool.onMouseDown(ctx, x, y, evt);
  }

  handleMouseMove(ctx, x, y, evt) {
    const tool = this.getActiveTool();
    if (tool) tool.onMouseMove(ctx, x, y, evt);
  }

  handleMouseUp(ctx, x, y, evt) {
    const tool = this.getActiveTool();
    if (tool) tool.onMouseUp(ctx, x, y, evt);
  }

  handleLeave(ctx) {
    const tool = this.getActiveTool();
    if (tool) tool.onLeave(ctx);
  }
}

window.PAE = window.PAE || {};
window.PAE.ToolManager = ToolManager;
