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
    // A freshly-pasted "object" layer (see App.pasteSelection) is selected
    // internally so the Object tool can grab it immediately, but flags
    // itself `hideMarquee` so the old dashed marquee doesn't also show up
    // and look "stuck" — the Object tool's own overlay (objectOverlay.js)
    // draws its handles independently of this file.
    const showMarquee = !!sel && !sel.hideMarquee;
    canvas.hidden = !showMarquee;
    if (!showMarquee) return;

    const rectX = sel.x * zoom + 0.5;
    const rectY = sel.y * zoom + 0.5;
    const rectW = Math.max(1, sel.w * zoom - 1);
    const rectH = Math.max(1, sel.h * zoom - 1);

    ctx.save();

    // A "Layer"/"Object" mode selection (see pixelSelectionTool.js) carries
    // an exact-shape mask, not just a bounding box — highlight precisely
    // those pixels too, underneath the marching ants, so it's obvious an
    // L-shaped sprite's selection doesn't also cover its empty corner even
    // though the dashed rectangle below still traces its full bounding box.
    if (sel.mask) {
      ctx.fillStyle = 'rgba(74, 163, 255, 0.35)';
      for (let ry = 0; ry < sel.h; ry++) {
        for (let rx = 0; rx < sel.w; rx++) {
          if (sel.mask[ry * sel.w + rx]) {
            ctx.fillRect((sel.x + rx) * zoom, (sel.y + ry) * zoom, zoom, zoom);
          }
        }
      }
    }

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
