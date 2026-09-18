/**
 * filmstrip.js
 * ---------------------------------------------------------------------------
 * The frame-management strip below the canvas: a numbered thumbnail per
 * frame you can click to jump to, and a thin hoverable gap before/after/
 * between every frame that reveals two small buttons — "insert a blank
 * frame here" and "insert a copy of the adjacent frame here". This is the
 * primary way to grow a project into an animation; see spriteProject.js's
 * `insertFrame`/`deleteFrameAt` for the underlying model and app.js's
 * `insertFrameAt`/`goToFrame`/`deleteFrameAt` for the app-level wiring.
 *
 * It re-renders from scratch on every `app.onChange` — cheap enough for the
 * frame counts a pixel-art animation realistically has, and it means every
 * thumbnail (including whatever frame you just duplicated FROM) is always
 * showing the current pixels, with no separate "refresh" step to remember.
 */

function initFilmstrip(app) {
  const track = document.getElementById('filmstrip-track');

  function thumbZoom(project) {
    const maxDim = Math.max(project.frameWidth, project.frameHeight);
    return 44 / maxDim;
  }

  // A thin seam between (or before/after) frames. `atIndex` is where a new
  // frame would land if inserted here, in SpriteProject.insertFrame terms.
  function makeGap(atIndex) {
    const gap = document.createElement('div');
    gap.className = 'filmstrip-gap';

    const blankBtn = document.createElement('button');
    blankBtn.type = 'button';
    blankBtn.className = 'gap-btn gap-btn-blank';
    blankBtn.textContent = '+';
    blankBtn.title = 'Insert a blank frame here';
    blankBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      app.insertFrameAt(atIndex, { duplicate: false });
    });

    const dupBtn = document.createElement('button');
    dupBtn.type = 'button';
    dupBtn.className = 'gap-btn gap-btn-duplicate';
    dupBtn.textContent = '⧉'; // ⧉
    dupBtn.title = 'Insert a copy of the adjacent frame here';
    dupBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      app.insertFrameAt(atIndex, { duplicate: true });
    });

    gap.appendChild(blankBtn);
    gap.appendChild(dupBtn);
    return gap;
  }

  function makeTile(frame, index, project) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'filmstrip-tile';
    tile.classList.toggle('active', index === project.currentIndex);
    tile.title = `Frame ${index + 1}${index === project.currentIndex ? ' (current)' : ''}`;
    tile.addEventListener('click', () => app.goToFrame(index));

    const thumbWrap = document.createElement('span');
    thumbWrap.className = 'filmstrip-thumb-wrap';
    const canvas = document.createElement('canvas');
    canvas.className = 'filmstrip-thumb';
    // Composited, not frame.buffer (the active layer only) — the thumbnail
    // should look like the whole frame, every visible layer flattened.
    window.PAE.CanvasView.paintBuffer(canvas, frame.getCompositedBuffer(), thumbZoom(project), 1);
    thumbWrap.appendChild(canvas);
    tile.appendChild(thumbWrap);

    const label = document.createElement('span');
    label.className = 'filmstrip-number';
    label.textContent = String(index + 1);
    tile.appendChild(label);

    // Hover-revealed, same pattern as the palette swatches' delete button.
    const deleteBtn = document.createElement('span');
    deleteBtn.className = 'filmstrip-delete';
    deleteBtn.textContent = '×';
    deleteBtn.title = 'Delete this frame';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (project.frameCount() <= 1) {
        alert('A project needs at least one frame.');
        return;
      }
      if (confirm(`Delete frame ${index + 1}? This cannot be undone.`)) {
        app.deleteFrameAt(index);
      }
    });
    tile.appendChild(deleteBtn);

    return tile;
  }

  function render() {
    const project = app.project;
    track.innerHTML = '';
    track.appendChild(makeGap(0));
    project.frames.forEach((frame, index) => {
      track.appendChild(makeTile(frame, index, project));
      track.appendChild(makeGap(index + 1));
    });
  }

  app.onChange(render);
  render();
}

window.PAE = window.PAE || {};
window.PAE.initFilmstrip = initFilmstrip;
