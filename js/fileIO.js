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
   * Hands a Blob to the viewer to save under `fullName`, shared by both
   * `exportImage` and `exportFramesAsZip` below.
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
   * @param {Blob} blob
   * @param {string} fullName  WITH extension (unlike the public methods below, which take a bare filename)
   * @param {{description: string, mime: string, ext: string}} [pickerType]  only used to label/filter the native Save dialog; omit for a generic file
   * @returns {Promise<{status: string}>}
   */
  async _saveBlob(blob, fullName, pickerType) {
    // Path 1: the File System Access API — the only one of the three that
    // can actually ask the person WHERE to save, via the browser/OS's own
    // native picker. Feature-detected, so it's simply skipped (falling
    // through to Path 2/3) anywhere it doesn't exist — including inside a
    // published Artifact's sandboxed iframe, where it's typically blocked
    // by permissions policy even if `window.showSaveFilePicker` exists.
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const opts = { suggestedName: fullName };
        if (pickerType) {
          opts.types = [{ description: pickerType.description, accept: { [pickerType.mime]: [`.${pickerType.ext}`] } }];
        }
        const handle = await window.showSaveFilePicker(opts);
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return { status: 'saved' };
      } catch (err) {
        // The person explicitly cancelled the native picker — respect
        // that and stop, rather than surprising them with a second,
        // silent download via one of the fallback paths below.
        if (err && err.name === 'AbortError') {
          const declined = new Error('Save cancelled.');
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

  /**
   * Exports one buffer as a PNG or JPG — see `_saveBlob` above for how/where
   * it actually lands.
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
    return FileIO._saveBlob(blob, `${filename}.${ext}`, {
      description: format === 'jpg' ? 'JPEG image' : 'PNG image',
      mime,
      ext,
    });
  },

  /**
   * "Break apart" a multi-frame project: renders every frame to its own PNG
   * and bundles all of them into one .zip (via ZipWriter — see that file's
   * header for why this app hand-rolls its own zip writer instead of
   * pulling in a library). One zip, one save/download, rather than N
   * separate native-picker prompts or N simultaneous anchor-click downloads
   * (which browsers throttle/block past a handful anyway).
   * @param {Array<PAE.PixelBuffer>} buffers  one per frame, already flattened/composited
   * @param {string} baseName  without extension — also the prefix for each PNG inside the zip
   * @returns {Promise<{status: string}>}
   */
  async exportFramesAsZip(buffers, baseName = 'frame') {
    const pad = Math.max(2, String(buffers.length).length);
    const files = [];
    for (let i = 0; i < buffers.length; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = buffers[i].width;
      canvas.height = buffers[i].height;
      canvas.getContext('2d').putImageData(buffers[i].toImageData(), 0, 0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const arrayBuffer = await blob.arrayBuffer();
      const num = String(i + 1).padStart(pad, '0');
      files.push({ name: `${baseName}_${num}.png`, data: new Uint8Array(arrayBuffer) });
    }
    const zipBlob = window.PAE.ZipWriter.build(files);
    return FileIO._saveBlob(zipBlob, `${baseName}.zip`, { description: 'ZIP archive', mime: 'application/zip', ext: 'zip' });
  },

  /**
   * Bakes a sequence of already-flattened frame buffers into one animated
   * .gif at `fps` frames per second (see gifEncoder.js for the format
   * itself) and hands it to `_saveBlob` the same way every other export
   * does.
   * @param {Array<PAE.PixelBuffer>} buffers  one per frame, in playback order, all the same size
   * @param {number} fps
   * @param {string} filename  without extension
   * @returns {Promise<{status: string}>}
   */
  async exportGif(buffers, fps, filename = 'animation') {
    const bytes = window.PAE.GifEncoder.encode(buffers, { fps });
    const blob = new Blob([bytes], { type: 'image/gif' });
    return FileIO._saveBlob(blob, `${filename}.gif`, { description: 'GIF image', mime: 'image/gif', ext: 'gif' });
  },

  /**
   * Project Save (see App.serializeProject/saveProjectToDisk) — hands the
   * already-JSON.stringify'd project (every frame's every layer, the
   * personal palette, and the app's own current tool/brush settings — see
   * app.js for exactly what's included) to `_saveBlob` the same way every
   * other export does, so it gets the same native-Save-dialog treatment a
   * PNG/GIF export gets wherever the browser supports it, rather than the
   * plain always-a-download-link shortcut the Palettes menu's "Save/Load
   * palette set" buttons use (a smaller, lower-stakes save that predates
   * this).
   * @param {string} json  already-serialized project data
   * @param {string} filename  without extension
   */
  async exportProject(json, filename = 'pixel-art-project') {
    const blob = new Blob([json], { type: 'application/json' });
    return FileIO._saveBlob(blob, `${filename}.paeproj`, { description: 'Pixel Art Editor project', mime: 'application/json', ext: 'paeproj' });
  },
};

window.PAE = window.PAE || {};
window.PAE.FileIO = FileIO;
