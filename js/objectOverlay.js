/**
 * objectOverlay.js
 * ---------------------------------------------------------------------------
 * Draws the Object tool's (tools/objectTool.js) on-canvas bounding box and
 * drag handles — a move-anywhere-inside box, 4 corner + 4 edge resize
 * handles, and 1 rotate handle above the top edge — on its own small
 * overlay canvas (#object-overlay-canvas), same "own canvas, never
 * touches the real pixel buffer, never receives pointer events" pattern
 * as selectionOverlay.js right next to it in the canvas stack.
 *
 * Only visible while the Object tool is the active tool AND there's
 * something to show handles for (see ObjectTool.getOverlayBox — the
 * active layer's current selection, whether that came from a layer
 * flagged "Acts as Object", a fresh Paste, or the Pixel Selection tool
 * directly). Re-renders on zoom changes, tool switches, selection changes
 * (a layer becoming/un-becoming the active object), frame changes, and —
 * via App.onOverlayRender, the same hook objectTool.js's live drag
 * recompute already fires through ctx.requestRender() — on every single
 * mouse-move while a drag is in progress, so the handles visibly track
 * the object as it's moved/scaled.
 */

function initObjectOverlay(app) {
  const canvas = document.getElementById('object-overlay-canvas');
  const c2d = canvas.getContext('2d');

  function drawHandle(x, y, round) {
    c2d.beginPath();
    if (round) c2d.arc(x, y, 4.5, 0, Math.PI * 2);
    else c2d.rect(x - 4, y - 4, 8, 8);
    c2d.fillStyle = '#ffffff';
    c2d.fill();
    c2d.strokeStyle = '#2f8fff';
    c2d.lineWidth = 1.4;
    c2d.stroke();
  }

  function render() {
    const zoom = app.canvasView.zoom;
    const displayWidth = app.project.frameWidth * zoom;
    const displayHeight = app.project.frameHeight * zoom;
    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
    }
    c2d.clearRect(0, 0, canvas.width, canvas.height);

    const tool = app.toolManager.getActiveTool();
    const isObjectTool = !!tool && tool.id === 'object';
    canvas.hidden = !isObjectTool;
    if (!isObjectTool) return;

    const box = tool.getOverlayBox(app.toolCtx);
    if (!box) return;

    const x = box.x * zoom;
    const y = box.y * zoom;
    const w = box.w * zoom;
    const h = box.h * zoom;
    const cx = x + w / 2;

    c2d.save();
    c2d.strokeStyle = '#2f8fff';
    c2d.lineWidth = 1.5;
    c2d.setLineDash([5, 3]);
    c2d.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1));
    c2d.setLineDash([]);

    // Rotate handle: a short stem up from the top-center, ending in a circle.
    const rotY = y - 18;
    c2d.beginPath();
    c2d.moveTo(cx, y);
    c2d.lineTo(cx, rotY);
    c2d.stroke();
    drawHandle(cx, rotY, true);

    // 4 corner + 4 edge-midpoint resize handles.
    const points = [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
      [cx, y],
      [cx, y + h],
      [x, y + h / 2],
      [x + w, y + h / 2],
    ];
    for (const [hx, hy] of points) drawHandle(hx, hy, false);
    c2d.restore();
  }

  app.toolManager.onChange(render);
  app.selection.onChange(render);
  app.canvasView.onZoomChange(render);
  app.onChange(render);
  app.onOverlayRender(render);
  render();
}

window.PAE = window.PAE || {};
window.PAE.initObjectOverlay = initObjectOverlay;
