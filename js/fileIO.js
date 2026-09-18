/**
 * fileIO.js
 * ---------------------------------------------------------------------------
 * Everything related to getting pixel data in and out of the app:
 * creating a new blank image, opening a PNG/JPG from disk, and exporting
 * the current image back out as PNG or JPG. Kept as a set of small,
 * independent functions rather than a class since there's no shared state.
 */

const FileIO = {
  /** Returns a brand-new, fully transparent PixelBuffer. */
  createBlank(width, height) {
    return window.PAE.PixelBuffer.createBlank(width, height);
  },

  /**
   * Reads an image file (PNG or JPG) chosen via an <input type="file"> and
   * resolves with a PixelBuffer sized to the image's natural dimensions.
   * @param {File} file
   * @returns {Promise<PAE.PixelBuffer>}
   */
  openImageFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('No file provided.'));
      if (!/^image\/(png|jpeg|jpg)$/.test(file.type)) {
        return reject(new Error('Please choose a PNG or JPG image.'));
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Could not decode that image.'));
        img.onload = () => {
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = img.naturalWidth;
          tempCanvas.height = img.naturalHeight;
          const tempCtx = tempCanvas.getContext('2d');
          tempCtx.imageSmoothingEnabled = false;
          tempCtx.drawImage(img, 0, 0);
          const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
          resolve(window.PAE.PixelBuffer.fromImageData(imageData));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  },

  /**
   * Reads several image files at once (e.g. a multi-select `<input>`, for
   * File > Import Frames) in parallel and resolves with `{file, buffer}`
   * pairs in the SAME order the FileList gave them — a plain FileList's
   * own order is whatever the OS picker returned, not necessarily filename
   * order, so callers that care about a specific sequence (frame 1, frame
   * 2, ...) should sort the resolved array themselves.
   * @param {FileList|File[]} fileList
   * @returns {Promise<Array<{file: File, buffer: PAE.PixelBuffer}>>}
   */
  openImageFiles(fileList) {
    return Promise.all(
      Array.from(fileList).map((file) => FileIO.openImageFile(file).then((buffer) => ({ file, buffer })))
    );
  },

  /**
   * Exports the buffer and hands it to the viewer to save.
   *
   * This app can run three ways, tried in order of how much control they
   * give the person over WHERE the file lands, not just its name:
   *   1. A normal browser tab in a browser with the File System Access
   *      API (most desktop Chromium browsers) — `showSaveFilePicker`
   *      opens the OS's own native Save dialog, seeded with the chosen
   *      filename, so the person picks the exact folder too.
   *   2. Hosted as a published Claude Artifact page (a sandboxed viewer
   *      where a plain `<a download>` click is inert, and the File System
   *      Access API is typically unavailable inside the sandbox) — the
   *      platform's `downloads` capability (see the artifact-capabilities
   *      runtime) hands the named file to the person through the host app
   *      instead.
   *   3. Any other browser tab (Firefox, Safari, or Chromium with the API
   *      unsupported/blocked) — the classic hidden-link download trick,
   *      which still uses the chosen filename but lands wherever that
   *      browser's own downloads setting/prompt puts it.
   *
   * @param {PAE.PixelBuffer} buffer
   * @param {'png'|'jpg'} format
   * @param {string} filename  without extension
   * @returns {Promise<{status: string}>}
   */
  async exportImage(buffer, format, filename = 'pixel-art') {
    const canvas = document.createElement('canvas');
    canvas.width = buffer.width;
    canvas.height = buffer.height;
    const ctx = canvas.getContext('2d');

    if (format === 'jpg') {
      // JPG has no alpha channel — composite over white first so transparent
      // areas export as white instead of undefined/black.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.putImageData(buffer.toImageData(), 0, 0);

    const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
    const ext = format === 'jpg' ? 'jpg' : 'png';
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, 0.92));
    const fullName = `${filename}.${ext}`;

    // Path 1: the File System Access API — the only one of the three that
    // can actually ask the person WHERE to save, via the browser/OS's own
    // native picker. Feature-detected, so it's simply skipped (falling
    // through to Path 2/3) anywhere it doesn't exist — including inside a
    // published Artifact's sandboxed iframe, where it's typically blocked
    // by permissions policy even if `window.showSaveFilePicker` exists.
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fullName,
          types: [{ description: format === 'jpg' ? 'JPEG image' : 'PNG image', accept: { [mime]: [`.${ext}`] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return { status: 'saved' };
      } catch (err) {
        // The person explicitly cancelled the native picker — respect
        // that and stop, rather than surprising them with a second,
        // silent download via one of the fallback paths below.
        if (err && err.name === 'AbortError') {
          const declined = new Error('Export cancelled.');
          declined.code = 'declined';
          throw declined;
        }
        console.warn('FileIO: showSaveFilePicker failed, falling back.', err);
      }
    }

    // Path 2: running as a hosted artifact page with the downloads capability.
    if (window.claude && typeof window.claude.use === 'function') {
      try {
        const downloads = await window.claude.use('downloads');
        if (downloads) {
          return await downloads.save({ filename: fullName, data: blob });
        }
      } catch (err) {
        // A declined save or any capability error: fall through to the
        // classic method below rather than leaving the user with nothing.
        if (err && err.code === 'declined') throw err;
        console.warn('FileIO: downloads capability failed, falling back.', err);
      }
    }

    // Path 3: plain browser tab (opened locally, or hosted outside the
    // capability sandbox) — the classic hidden-link download trick.
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fullName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { status: 'saved' };
  },
};

window.PAE = window.PAE || {};
window.PAE.FileIO = FileIO;
