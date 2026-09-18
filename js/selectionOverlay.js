/**
 * selectionOverlay.js
 * ---------------------------------------------------------------------------
 * Draws the current pixel selection (see selection.js) as an animated
 * "marching ants" dashed rectangle on top of the main canvas — a small
 * dedicated overlay canvas (`#selection-overlay-canvas`, same pattern as
 * the onion-skin overlay canvases in referenceView.js/index.html), so the
 * main canvas's own pixel data is never touched just to show a selection.
 * Purely cosmetic: never receives pointer events, never part of history.
 */

function initSelectionOverlay(app) {
  const canvas = document.getElementById('selection-overlay-canvas');
  const ctx = canvas.getContext('2d');
  let dashOffset = 0;

  function render() {
    const zoom = app.canvasView.zoom;
    const displayWidth = app.project.frameWidth * zoom;
    const displayHeight = app.project.frameHeight * zoom;
    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const sel = app.selection.get();
    canvas.hidden = !sel;
    if (!sel) return;

    const rectX = sel.x * zoom + 0.5;
    const rectY = sel.y * zoom + 0.5;
    const rectW = Math.max(1, sel.w * zoom - 1);
    const rectH = Math.max(1, sel.h * zoom - 1);

    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#ffffff';
    ctx.lineDashOffset = dashOffset;
    ctx.strokeRect(rectX, rectY, rectW, rectH);
    ctx.strokeStyle = '#000000';
    ctx.lineDashOffset = dashOffset + 4; // offset by half a dash so black fills white's gaps
    ctx.strokeRect(rectX, rectY, rectW, rectH);
    ctx.restore();
  }

  app.selection.onChange(render);
  app.canvasView.onZoomChange(render);
  app.onChange(render); // frame switches clear the selection — reflect that too
  render();

  // The "marching" part — advance the dash phase on a timer, but only
  // bother re-rendering while a selection actually exists.
  setInterval(() => {
    if (!app.selection.get()) return;
    dashOffset = (dashOffset + 1) % 8;
    render();
  }, 120);
}

window.PAE = window.PAE || {};
window.PAE.initSelectionOverlay = initSelectionOverlay;
