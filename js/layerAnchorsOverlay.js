/**
 * layerAnchorsOverlay.js
 * ---------------------------------------------------------------------------
 * Roger's ask: "a toggleable view that turns anchor points on and off on the
 * layers, so I can easily click and drag all the layers without having to
 * switch." Turning the Layers panel's new ⚓ toggle on draws one small
 * draggable dot per layer — at that layer's own painted content's center —
 * directly on the canvas, all at once, on their own overlay canvas
 * (#anchor-overlay-canvas), same "own canvas, never touches the real pixel
 * buffer" pattern as selectionOverlay.js/objectOverlay.js right next to it
 * in the canvas stack.
 *
 * Unlike the Object tool's handles (only shown while the Object tool itself
 * is active, for the one current selection), these are deliberately tool-
 * agnostic: they're visible — and, per App._wireCanvasEvents/hitTestLayerAnchor,
 * draggable — no matter which tool is currently active, which is the whole
 * point (grab any layer's anchor without first clicking its row in the
 * Layers panel or switching away from whatever tool you're using). The
 * actual hit-testing and drag logic lives in App (see app.js's "layer
 * anchors" section) since it has to run BEFORE the active tool's own
 * mousedown handling, not through this file or a Tool subclass — this file
 * only draws.
 *
 * A layer with no painted content at all (PixelBuffer.boundingBoxOfContent
 * returns null) gets no anchor — there'd be nothing meaningful to grab or
 * show a handle for. The active layer's anchor is drawn in the app's accent
 * color; every other layer's in a muted amber, so it's obvious at a glance
 * which one you're about to be moving if you click near where several
 * overlap. The layer currently mid-drag (if any) is drawn larger/filled.
 */

function initLayerAnchorsOverlay(app) {
  const canvas = document.getElementById('anchor-overlay-canvas');
  const c2d = canvas.getContext('2d');

  function drawAnchor(x, y, { active, dragging }) {
    const r = dragging ? 6 : 4.5;
    c2d.beginPath();
    c2d.arc(x, y, r, 0, Math.PI * 2);
    c2d.fillStyle = dragging ? '#ffb347' : active ? '#2f8fff' : 'rgba(255, 179, 71, 0.85)';
    c2d.fill();
    c2d.strokeStyle = '#ffffff';
    c2d.lineWidth = 1.4;
    c2d.stroke();
    // A tiny crosshair through the dot makes it read as "grab point" rather
    // than just a generic marker, at a glance and at any zoom level.
    c2d.beginPath();
    c2d.moveTo(x - r - 3, y);
    c2d.lineTo(x + r + 3, y);
    c2d.moveTo(x, y - r - 3);
    c2d.lineTo(x, y + r + 3);
    c2d.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    c2d.lineWidth = 1;
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

    canvas.hidden = !app.anchorPointsVisible;
    if (!app.anchorPointsVisible) return;

    const frame = app.project.currentFrame;
    const dragIndex = app._anchorDrag ? app._anchorDrag.index : null;
    frame.layers.forEach((layer, index) => {
      const box = window.PAE.PixelBuffer.boundingBoxOfContent(layer.buffer);
      if (!box) return;
      const cx = (box.x + box.w / 2) * zoom;
      const cy = (box.y + box.h / 2) * zoom;
      drawAnchor(cx, cy, { active: index === frame.activeLayerIndex, dragging: index === dragIndex });
    });
  }

  app.onChange(render);
  app.canvasView.onZoomChange(render);
  app.onOverlayRender(render);
  render();
}

window.PAE = window.PAE || {};
window.PAE.initLayerAnchorsOverlay = initLayerAnchorsOverlay;
