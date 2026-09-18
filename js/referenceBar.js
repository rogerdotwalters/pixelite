/**
 * referenceBar.js
 * ---------------------------------------------------------------------------
 * Wires the three-way reference-view switch (Normal / Side-by-side /
 * Overlay), its opacity slider, and — for Overlay mode specifically — the
 * Prev/Next target selector that decides which single frame gets onion-
 * skinned (never both at once; see referenceView.js). Frame navigation/add/
 * duplicate/delete used to live in this same bar too, but that's now the
 * filmstrip's job (see filmstrip.js) — this file is just the onion-skin
 * control surface.
 */

function initReferenceBar(app) {
  const modeButtons = document.querySelectorAll('.ref-mode-btn');
  const opacityRow = document.getElementById('ref-opacity-row');
  const opacitySlider = document.getElementById('ref-opacity-slider');
  const opacityValue = document.getElementById('ref-opacity-value');
  const targetButtons = document.querySelectorAll('.ref-target-btn');

  // Three-way reference switch. Only one mode is active at a time; the
  // opacity slider (and, within it, the Prev/Next target selector) is only
  // meaningful — and only shown — in Overlay mode.
  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      modeButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      opacityRow.hidden = mode !== 'overlay';
      app.referenceView.setMode(mode);
    });
  });

  opacitySlider.addEventListener('input', () => {
    opacityValue.textContent = `${opacitySlider.value}%`;
    app.referenceView.setOpacity(Number(opacitySlider.value) / 100);
  });

  // Prev = "what it was", Next = "what it's becoming" — pick one at a time.
  // This one function is the single place that keeps the button highlight
  // and the actual referenceView state in sync, so both the click handler
  // below and the "R" keyboard shortcut (see ui.js) can drive it.
  function applyOverlayTarget(target) {
    targetButtons.forEach((b) => b.classList.toggle('active', b.dataset.target === target));
    app.referenceView.setOverlayTarget(target);
  }

  targetButtons.forEach((btn) => {
    btn.addEventListener('click', () => applyOverlayTarget(btn.dataset.target));
  });

  // Exposed so the "R" shortcut can flip Prev<->Next without knowing
  // anything about the DOM buttons or the referenceView internals.
  app.toggleOverlayTarget = () => {
    applyOverlayTarget(app.referenceView.overlayTarget === 'prev' ? 'next' : 'prev');
  };
}

window.PAE = window.PAE || {};
window.PAE.initReferenceBar = initReferenceBar;
