/**
 * animationPreview.js
 * ---------------------------------------------------------------------------
 * Roger's ask: "select the slides on the bottom with a checkmark and view a
 * gif in a window on the side using the frames with a frames per second
 * slider." This is that window — the panel on the right of the canvas (see
 * index.html's `#preview-panel`) that loops through whichever frames are
 * checked in the filmstrip below (`frame.previewEnabled` — see
 * spriteProject.js / filmstrip.js's `.filmstrip-check`), at an adjustable
 * frames-per-second, plus a button that bakes those same checked frames
 * into a real downloadable .gif at that FPS (App.exportPreviewGif ->
 * FileIO.exportGif -> gifEncoder.js).
 *
 * The loop itself is a plain `setInterval`, not requestAnimationFrame —
 * this is a fixed-fps slideshow (pixel art frames, not smooth motion), and
 * `setInterval` matches exactly what the FPS slider means: a frame every
 * `1000 / fps` ms, restarted from scratch whenever the slider moves so a
 * change takes effect immediately rather than waiting out whatever period
 * was already in progress. Playback position (`frameIndex`) is kept in
 * this module's own state rather than on `app`, since it's transient
 * "what the preview happens to be showing right now" — nothing else in the
 * app needs to read it, and it shouldn't survive/matter across reloads.
 */

function initAnimationPreview(app) {
  const canvas = document.getElementById('preview-canvas');
  const emptyHint = document.getElementById('preview-empty-hint');
  const playToggle = document.getElementById('preview-play-toggle');
  const fpsSlider = document.getElementById('preview-fps');
  const fpsValue = document.getElementById('preview-fps-value');
  const exportBtn = document.getElementById('preview-export-gif');

  const PLAY_ICON = '&#9654;'; // ▶
  const PAUSE_ICON = '&#10074;&#10074;'; // ❙❙

  let fps = Number(fpsSlider.value) || 8;
  let playing = true; // the desired state — independent of whether there's currently anything to actually play (see render())
  let frameIndex = 0;
  let timer = null;

  /** The checked frames, flattened, in frame order — see SpriteProject.previewFrames(). Re-read fresh every time rather than cached, so an edit to a checked frame's pixels (or a checkbox toggle) shows up on the very next tick/render with no extra wiring. */
  function previewBuffers() {
    return app.project.previewFrames();
  }

  /**
   * Scales the preview up to a comfortable size while staying crisp:
   * an INTEGER multiple of the frame's own size (never a fractional
   * zoom, which would blur/uneven pixel-art edges), picked so the longer
   * side lands close to `TARGET_PX` without exceeding it.
   */
  function zoomFor(buffer) {
    const TARGET_PX = 176;
    const maxDim = Math.max(buffer.width, buffer.height);
    return Math.max(1, Math.min(16, Math.floor(TARGET_PX / maxDim)));
  }

  function stopTimer() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  /** (Re)starts the interval at the CURRENT fps — called on play, and again every time the fps slider moves, so a change is felt immediately rather than finishing out the old period first. */
  function startTimer() {
    stopTimer();
    timer = setInterval(tick, 1000 / fps);
  }

  function tick() {
    const buffers = previewBuffers();
    if (!buffers.length) return; // nothing checked right now — render() already paused/hid the canvas for this
    frameIndex = (frameIndex + 1) % buffers.length;
    render();
  }

  /** Redraws whatever the preview should show RIGHT NOW, without advancing playback — called after every app change (a checkbox toggled, a checked frame's pixels changed, frames added/removed) as well as by `tick()`. */
  function render() {
    const buffers = previewBuffers();
    if (!buffers.length) {
      stopTimer();
      canvas.hidden = true;
      emptyHint.hidden = false;
      exportBtn.disabled = true;
      return;
    }
    canvas.hidden = false;
    emptyHint.hidden = true;
    exportBtn.disabled = false;
    if (frameIndex >= buffers.length) frameIndex = 0; // the checked set shrank out from under the current position
    const buf = buffers[frameIndex];
    window.PAE.CanvasView.paintBuffer(canvas, buf, zoomFor(buf));
    // A timer that was stopped because the checked set was momentarily
    // empty (or this is first boot) should resume on its own once there's
    // something to actually play again, as long as Play (not Pause) is
    // still the desired state.
    if (playing && timer === null) startTimer();
  }

  function setPlaying(next) {
    playing = next;
    playToggle.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
    playToggle.title = playing ? 'Pause the preview' : 'Play the preview';
    playToggle.setAttribute('aria-label', playToggle.title);
    if (playing) startTimer();
    else stopTimer();
  }

  playToggle.addEventListener('click', () => setPlaying(!playing));

  fpsSlider.addEventListener('input', () => {
    fps = Math.max(1, Number(fpsSlider.value) || 1);
    fpsValue.textContent = `${fps} fps`;
    if (playing) startTimer(); // restart at the new rate immediately, per the header comment
  });

  exportBtn.addEventListener('click', async () => {
    const original = exportBtn.textContent;
    exportBtn.disabled = true;
    exportBtn.textContent = 'Exporting…';
    try {
      await app.exportPreviewGif(fps);
    } finally {
      exportBtn.textContent = original;
      exportBtn.disabled = !previewBuffers().length;
    }
  });

  app.onChange(render);

  // Initial paint + icon state, then start looping (if there's anything
  // checked yet — a brand-new project's very first frame starts checked
  // by default, so there almost always is).
  playToggle.innerHTML = PAUSE_ICON;
  playToggle.title = 'Pause the preview';
  fpsValue.textContent = `${fps} fps`;
  render();
}

window.PAE = window.PAE || {};
window.PAE.initAnimationPreview = initAnimationPreview;
