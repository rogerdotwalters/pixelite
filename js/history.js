/**
 * history.js
 * ---------------------------------------------------------------------------
 * A small, generic undo/redo stack. It knows nothing about pixels, tools, or
 * the UI — it just stores whatever "snapshot" objects it is given and hands
 * them back in order. This keeps undo/redo reusable if, in the future,
 * something other than raw pixel data needs history (e.g. palette edits).
 *
 * Usage pattern used by tools (see tools/tool.js):
 *   1. A tool calls history.commit() ONCE at the very start of an action
 *      (e.g. on mousedown), capturing the state *before* the change.
 *   2. The tool freely mutates the buffer.
 *   3. Undo restores the pre-action snapshot; redo re-applies the change.
 */

class HistoryManager {
  /**
   * @param {() => any} getSnapshot   returns a deep-copyable snapshot of current state
   * @param {(snapshot: any) => void} applySnapshot   restores a snapshot
   * @param {number} [maxSize]  maximum number of undo steps kept in memory
   */
  constructor(getSnapshot, applySnapshot, maxSize = 50) {
    this.getSnapshot = getSnapshot;
    this.applySnapshot = applySnapshot;
    this.maxSize = maxSize;
    this.undoStack = [];
    this.redoStack = [];
    this._listeners = [];
  }

  /** Call before mutating state, to record what it looked like beforehand. */
  commit() {
    this.undoStack.push(this.getSnapshot());
    if (this.undoStack.length > this.maxSize) this.undoStack.shift();
    this.redoStack.length = 0; // a new action invalidates the redo branch
    this._notify();
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    if (!this.canUndo()) return false;
    this.redoStack.push(this.getSnapshot());
    const previous = this.undoStack.pop();
    this.applySnapshot(previous);
    this._notify();
    return true;
  }

  redo() {
    if (!this.canRedo()) return false;
    this.undoStack.push(this.getSnapshot());
    const next = this.redoStack.pop();
    this.applySnapshot(next);
    this._notify();
    return true;
  }

  /** Wipes all history (used when opening/creating a new image). */
  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this._notify();
  }

  /** Subscribe to be told whenever undo/redo availability changes (for menu enabling). */
  onChange(fn) {
    this._listeners.push(fn);
  }

  _notify() {
    for (const fn of this._listeners) fn(this);
  }
}

window.PAE = window.PAE || {};
window.PAE.HistoryManager = HistoryManager;
