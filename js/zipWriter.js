/**
 * zipWriter.js
 * ---------------------------------------------------------------------------
 * A tiny, dependency-free ZIP file builder — just enough of the ZIP format
 * (STORE/uncompressed entries only, no deflate) to bundle several PNGs into
 * one downloadable .zip for File > Export Frames as PNGs. Written by hand
 * rather than pulling in a library, matching the rest of this app's "plain
 * vanilla JS, no build step, works from a file:// double-click" philosophy.
 *
 * Every real-world zip reader (Explorer, Finder, `unzip`, 7-Zip, Archive
 * Utility, ...) opens a STORE-only zip exactly like a compressed one — it's
 * just bigger on disk, and these are small pixel-art PNGs, so that's a
 * non-issue. Implementing deflate by hand would be a much bigger, riskier
 * undertaking for no real benefit here.
 */

const ZipWriter = {
  /**
   * @param {Array<{name: string, data: Uint8Array}>} files
   * @returns {Blob}  a valid application/zip Blob containing every file
   */
  build(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    // MS-DOS date/time for "now" — every zip entry carries one, and readers
    // just show it as the file's modified time. Nobody exporting pixel-art
    // frames needs that to be meaningful, so "now" is fine.
    const now = new Date();
    const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
    const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

    files.forEach((file) => {
      const nameBytes = encoder.encode(file.name);
      const data = file.data;
      const crc = ZipWriter._crc32(data);

      // Local file header (ZIP spec 4.3.7) immediately followed by the raw
      // (uncompressed) file bytes.
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(localHeader.buffer);
      lv.setUint32(0, 0x04034b50, true); // local file header signature
      lv.setUint16(4, 20, true); // version needed to extract
      lv.setUint16(6, 0, true); // general purpose bit flag
      lv.setUint16(8, 0, true); // compression method: 0 = store
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true); // compressed size (== uncompressed for STORE)
      lv.setUint32(22, data.length, true); // uncompressed size
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true); // extra field length
      localHeader.set(nameBytes, 30);
      localParts.push(localHeader, data);

      // Central directory file header (ZIP spec 4.3.12) — one per entry,
      // written after every local entry, pointing back at its offset.
      const centralHeader = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(centralHeader.buffer);
      cv.setUint32(0, 0x02014b50, true); // central directory header signature
      cv.setUint16(4, 20, true); // version made by
      cv.setUint16(6, 20, true); // version needed to extract
      cv.setUint16(8, 0, true); // general purpose bit flag
      cv.setUint16(10, 0, true); // compression method
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true); // extra field length
      cv.setUint16(32, 0, true); // file comment length
      cv.setUint16(34, 0, true); // disk number start
      cv.setUint16(36, 0, true); // internal file attributes
      cv.setUint32(38, 0, true); // external file attributes
      cv.setUint32(42, offset, true); // offset of this entry's local header
      centralHeader.set(nameBytes, 46);
      centralParts.push(centralHeader);

      offset += localHeader.length + data.length;
    });

    const centralDirStart = offset;
    const centralDirSize = centralParts.reduce((sum, part) => sum + part.length, 0);

    // End of central directory record (ZIP spec 4.3.16) — always last.
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); // end of central directory signature
    ev.setUint16(4, 0, true); // this disk number
    ev.setUint16(6, 0, true); // disk with the start of the central directory
    ev.setUint16(8, files.length, true); // central directory entries on this disk
    ev.setUint16(10, files.length, true); // total central directory entries
    ev.setUint32(12, centralDirSize, true);
    ev.setUint32(16, centralDirStart, true);
    ev.setUint16(20, 0, true); // comment length

    return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
  },

  /** Standard reflected CRC-32 — the same table/polynomial used by zip, gzip, and PNG. Table built once and cached. */
  _crc32(data) {
    if (!ZipWriter._table) {
      const table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
      }
      ZipWriter._table = table;
    }
    const table = ZipWriter._table;
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  },
};

window.PAE = window.PAE || {};
window.PAE.ZipWriter = ZipWriter;
