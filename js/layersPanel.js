/**
 * layersPanel.js
 * ---------------------------------------------------------------------------
 * The sidebar's Layers section: add, delete, reorder (move up/down),
 * show/hide, rename, toggle "acts as object", and pick the active layer,
 * for the CURRENT frame. Every action delegates straight to an App method
 * (see app.js's "layers" section) — this file only builds/rebuilds the DOM.
 *
 * The new first icon in each row (◆) is `layer.actAsObject` (see layer.js):
 * toggling it on both flips the flag AND makes that row's layer active,
 * which auto-selects the layer's whole footprint (App.setActiveLayer) —
 * one click to get a layer ready for the Layer Array tool (see the Layers
 * header's "Array…" button, wired in App.promptLayerArray).
 *
 * Rendered TOP-TO-BOTTOM in on-screen stacking order (the topmost, last-
 * composited layer appears at the TOP of the list, matching every other
 * layers panel out there), even though `frame.layers[0]` is the BOTTOM of
 * the stack internally (see spriteProject.js) — this file reverses the
 * array only for display; every index used here is still the real array
 * index the rest of the app expects.
 */

function initLayersPanel(app) {
  const list = document.getElementById('layers-list');
  const addBtn = document.getElementById('layer-add');
  const anchorsToggle = document.getElementById('layer-anchors-toggle');

  function makeRow(layer, index, frame) {
    const row = document.createElement('div');
    row.className = 'layer-row' + (index === frame.activeLayerIndex ? ' active' : '');
    row.title = `${layer.name} — click to make this the active layer`;
    row.addEventListener('click', () => app.setActiveLayer(index));

    const objectBtn = document.createElement('button');
    objectBtn.type = 'button';
    objectBtn.className = 'layer-object-btn' + (layer.actAsObject ? ' active' : '');
    objectBtn.textContent = '◆';
    objectBtn.title = layer.actAsObject
      ? 'Acts as object — becoming active auto-selects its whole footprint (click to turn off)'
      : 'Act as object — becoming active will auto-select its whole footprint, ready for the Layer Array tool';
    objectBtn.setAttribute('aria-label', objectBtn.title);
    objectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      app.toggleActsAsObject(index);
    });
    row.appendChild(objectBtn);

    const visBtn = document.createElement('button');
    visBtn.type = 'button';
    visBtn.className = 'layer-visibility-btn';
    visBtn.textContent = layer.visible ? '●' : '○'; // filled / open circle
    visBtn.title = layer.visible ? 'Hide this layer' : 'Show this layer';
    visBtn.setAttribute('aria-label', visBtn.title);
    visBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      app.toggleLayerVisibility(index);
    });
    row.appendChild(visBtn);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'layer-name';
    nameSpan.textContent = layer.name;
    nameSpan.title = 'Double-click to rename this layer';
    nameSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const name = prompt('Rename layer:', layer.name);
      if (name) app.renameLayer(index, name);
    });
    row.appendChild(nameSpan);

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'layer-move-btn';
    upBtn.textContent = '↑';
    upBtn.title = 'Move layer up (toward the top of the stack)';
    upBtn.disabled = index === frame.layers.length - 1;
    upBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      app.moveLayer(index, 1);
    });
    row.appendChild(upBtn);

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'layer-move-btn';
    downBtn.textContent = '↓';
    downBtn.title = 'Move layer down (toward the bottom of the stack)';
    downBtn.disabled = index === 0;
    downBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      app.moveLayer(index, -1);
    });
    row.appendChild(downBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'layer-delete-btn';
    deleteBtn.textContent = '×';
    deleteBtn.title = 'Delete this layer';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (frame.layers.length <= 1) {
        alert('A frame needs at least one layer.');
        return;
      }
      if (confirm(`Delete layer "${layer.name}"? This cannot be undone.`)) {
        app.deleteLayer(index);
      }
    });
    row.appendChild(deleteBtn);

    return row;
  }

  function render() {
    const frame = app.project.currentFrame;
    list.innerHTML = '';
    const rows = frame.layers.map((layer, index) => makeRow(layer, index, frame));
    rows.reverse().forEach((row) => list.appendChild(row));
  }

  addBtn.addEventListener('click', () => app.addLayer());

  // Roger's ask: "a toggleable view that turns anchor points on and off on
  // the layers" — see app.js's toggleAnchorPoints/layerAnchorsOverlay.js.
  // This button's own "active" state is the only thing about the toggle
  // that lives here; the actual overlay drawing and drag logic live in
  // those other two files.
  anchorsToggle.addEventListener('click', () => app.toggleAnchorPoints());
  function syncAnchorsToggle() {
    anchorsToggle.classList.toggle('active', app.anchorPointsVisible);
  }
  app.onChange(syncAnchorsToggle);
  syncAnchorsToggle();

  app.onChange(render);
  render();
}

window.PAE = window.PAE || {};
window.PAE.initLayersPanel = initLayersPanel;
