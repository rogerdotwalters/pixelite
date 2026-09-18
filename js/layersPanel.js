/**
 * layersPanel.js
 * ---------------------------------------------------------------------------
 * The sidebar's Layers section: add, delete, reorder (move up/down),
 * show/hide, rename, and pick the active layer, for the CURRENT frame. Every
 * action delegates straight to an App method (see app.js's "layers"
 * section) — this file only builds/rebuilds the DOM.
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

  function makeRow(layer, index, frame) {
    const row = document.createElement('div');
    row.className = 'layer-row' + (index === frame.activeLayerIndex ? ' active' : '');
    row.title = `${layer.name} — click to make this the active layer`;
    row.addEventListener('click', () => app.setActiveLayer(index));

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
  app.onChange(render);
  render();
}

window.PAE = window.PAE || {};
window.PAE.initLayersPanel = initLayersPanel;
