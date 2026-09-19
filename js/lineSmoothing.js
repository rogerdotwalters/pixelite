/**
 * lineSmoothing.js
 * ---------------------------------------------------------------------------
 * The pixel-path algorithms behind the Smoothing Pencil (see
 * tools/smoothingPencilTool.js). Every function here is a pure transform —
 * `points in, points out` — on a plain array of `{x, y}` integers in stroke
 * order, exactly like Geometry's shape walkers are pure `visit(x, y)`
 * callbacks. Kept separate from the tool itself so the math is trivial to
 * unit test on its own and easy to reason about without any canvas/buffer
 * plumbing in the way.
 *
 * Four algorithms:
 *   - arcCurveCorrect  runs FIRST, always — no mode/checkbox controls this
 *                      one, it's baked into every mode (Limit Doubling,
 *                      Symmetric Curves, and Both all get it)
 *   - limitDoubling    "Limit Doubling" mode
 *   - evenStepPattern  \_ both live under "Symmetric Curves" mode, each its
 *   - mirrorHalves     /  own independently toggleable checkbox
 * `smoothStroke` combines whichever of these the current settings call for
 * — that's the one entry point the tool actually calls.
 */

const LineSmoothing = {
  /**
   * "Arc Curve Correction" — local curvature averaging. Always runs FIRST,
   * before Limit Doubling or either Symmetric Curves checkbox, on every
   * mode; there's no separate toggle for it. Replaces each interior point
   * with a triangular-weighted moving average of the points around it
   * (endpoints stay exactly where the stroke started/ended) — this pulls
   * any sharp, isolated local wobble toward the average direction of its
   * neighbors, so the curve bends more evenly along its length. Unlike
   * `mirrorHalves`, it doesn't force the stroke onto one exact circle or
   * axis of symmetry — it's a gradual, local smoothing pass, not a global
   * geometric constraint.
   */
  arcCurveCorrect(points, radius = 2) {
    const n = points.length;
    if (n < 5) return points.slice(); // too short a stroke for a meaningful window — nothing to average
    const smoothed = points.map((p) => ({ x: p.x, y: p.y }));
    for (let i = 1; i < n - 1; i++) {
      let sumX = 0;
      let sumY = 0;
      let sumW = 0;
      for (let k = -radius; k <= radius; k++) {
        const j = i + k;
        if (j < 0 || j >= n) continue;
        const w = radius + 1 - Math.abs(k); // triangular weight, peak at the point itself
        sumX += points[j].x * w;
        sumY += points[j].y * w;
        sumW += w;
      }
      smoothed[i] = { x: sumX / sumW, y: sumY / sumW };
    }
    // Round to whole pixels, then re-walk with Bresenham — averaging +
    // rounding can leave small gaps between consecutive smoothed points.
    const rounded = smoothed.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
    return LineSmoothing._connectPath(rounded);
  },

  /**
   * Aseprite-style "pixel perfect" corner fix. A freehand diagonal line
   * walked one grid step at a time (see PencilTool/Geometry.bresenhamLine)
   * naturally produces "elbow" pixels wherever it steps right-then-down (or
   * any other order-dependent pair of orthogonal steps) instead of a single
   * diagonal step — for one instant the line is 2 pixels thick at that
   * corner. This removes the redundant elbow pixel whenever three
   * consecutive points form that L-shape AND the point before the elbow is
   * already a direct diagonal neighbor of the point after it, so the line
   * stays a clean 1-pixel-wide staircase throughout.
   */
  limitDoubling(points) {
    if (points.length < 3) return points.slice();
    const result = [points[0]];
    for (let k = 1; k < points.length; k++) {
      const p = points[k];
      if (result.length >= 2) {
        const a = result[result.length - 2];
        const b = result[result.length - 1];
        const dxAB = b.x - a.x;
        const dyAB = b.y - a.y;
        const dxBP = p.x - b.x;
        const dyBP = p.y - b.y;
        const aToBOrtho = Math.abs(dxAB) + Math.abs(dyAB) === 1;
        const bToPOrtho = Math.abs(dxBP) + Math.abs(dyBP) === 1;
        const isPerpendicularTurn = aToBOrtho && bToPOrtho && (dxAB === 0) !== (dxBP === 0);
        const aToPDiagonal = Math.abs(p.x - a.x) === 1 && Math.abs(p.y - a.y) === 1;
        if (isPerpendicularTurn && aToPDiagonal) {
          result.pop(); // b was just a doubled elbow — a connects straight to p
        }
      }
      result.push(p);
    }
    return result;
  },

  /**
   * Smooths out lumpy run-lengths along the stroke. A hand-drawn diagonal
   * rarely keeps a perfectly consistent step pattern (e.g. "2 right, 1 down,
   * 2 right, 1 down, ..."); mouse jitter makes some runs longer or shorter
   * than they should be for that slope. Uses the standard Ramer-Douglas-
   * Peucker polyline simplification to find the stroke's real corners —
   * keeping only the points that sit further than EPSILON pixels from the
   * straight chord between their neighbors — then re-walks each simplified
   * segment with a genuine Bresenham line. A wobbly-but-basically-straight
   * run has every point within EPSILON of its own chord, so it collapses
   * to one clean line; an actual corner/cusp sits far enough from any
   * chord spanning across it that RDP keeps it as its own vertex, so real
   * right-angle turns are preserved rather than smoothed into a diagonal.
   */
  evenStepPattern(points) {
    if (points.length < 3) return points.slice();
    const EPSILON = 1.0; // pixels
    const vertices = LineSmoothing._rdpSimplify(points, EPSILON);
    const result = [];
    for (let i = 0; i < vertices.length - 1; i++) {
      const start = vertices[i];
      const end = vertices[i + 1];
      const runPts = [];
      window.PAE.Geometry.bresenhamLine(start.x, start.y, end.x, end.y, (x, y) => runPts.push({ x, y }));
      if (i > 0) runPts.shift(); // don't duplicate the vertex shared with the previous segment
      result.push(...runPts);
    }
    return result;
  },

  /** Perpendicular distance from point p to the infinite line through a and b (or to the point a itself, if a === b). */
  _perpDistance(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    return Math.hypot(p.x - projX, p.y - projY);
  },

  /** Classic recursive Ramer-Douglas-Peucker simplification: returns the subset of `points` (always including both endpoints) that are more than `epsilon` pixels from the chord spanning across them. */
  _rdpSimplify(points, epsilon) {
    if (points.length < 3) return points.slice();
    const a = points[0];
    const b = points[points.length - 1];
    let maxDist = -1;
    let maxIdx = -1;
    for (let i = 1; i < points.length - 1; i++) {
      const d = LineSmoothing._perpDistance(points[i], a, b);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > epsilon) {
      const left = LineSmoothing._rdpSimplify(points.slice(0, maxIdx + 1), epsilon);
      const right = LineSmoothing._rdpSimplify(points.slice(maxIdx), epsilon);
      return left.slice(0, -1).concat(right);
    }
    return [a, b];
  },

  /**
   * Forces the stroke to be mirror-symmetric across the perpendicular
   * bisector of its own start-end segment — the classic "does this arc look
   * the same read forwards and backwards" symmetry, so a hand-drawn curve
   * comes out looking deliberate rather than lopsided. For each pair of
   * points equally far from the two ends, this averages what's actually
   * there with what a perfect mirror would put there, then places both
   * points at that averaged, exactly-symmetric position — so neither half
   * of the original stroke is favored over the other. Reflecting can leave
   * small gaps between the newly-placed points, so the result is re-walked
   * with Bresenham lines to stay a fully connected path.
   */
  mirrorHalves(points) {
    const n = points.length;
    if (n < 3) return points.slice();
    const a = points[0];
    const b = points[n - 1];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return points.slice(); // stroke starts and ends at the same pixel — nothing to mirror across

    // Reflects p across the line through (mx,my) perpendicular to (dx,dy):
    // decompose (p - mid) into its component along (dx,dy) and flip only
    // that component. This swaps a<->b and keeps a curve's "bulge" on the
    // same side on both halves (a true mirrored arc, not a rotated S-shape).
    function reflect(p) {
      const vx = p.x - mx;
      const vy = p.y - my;
      const along = (vx * dx + vy * dy) / lenSq;
      return { x: mx + (vx - 2 * along * dx), y: my + (vy - 2 * along * dy) };
    }

    const result = points.map((p) => ({ x: p.x, y: p.y }));
    for (let i = 0; i <= Math.floor((n - 1) / 2); i++) {
      const j = n - 1 - i;
      const reflPj = reflect(points[j]);
      const canonI = { x: (points[i].x + reflPj.x) / 2, y: (points[i].y + reflPj.y) / 2 };
      const canonJ = reflect(canonI);
      result[i] = { x: Math.round(canonI.x), y: Math.round(canonI.y) };
      result[j] = { x: Math.round(canonJ.x), y: Math.round(canonJ.y) };
    }
    return LineSmoothing._connectPath(result);
  },

  /** Re-walks a (possibly gappy, after independent per-point rounding) path with Bresenham lines so every consecutive pair stays 8-connected. */
  _connectPath(points) {
    if (points.length < 2) return points.slice();
    const result = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const cur = points[i];
      if (prev.x === cur.x && prev.y === cur.y) continue;
      const seg = [];
      window.PAE.Geometry.bresenhamLine(prev.x, prev.y, cur.x, cur.y, (x, y) => seg.push({ x, y }));
      seg.shift(); // already have the shared start point
      result.push(...seg);
    }
    return result;
  },

  /**
   * The one entry point the tool actually calls. `opts`:
   *   mode: 'doubling' | 'symmetric' | 'both'
   *   evenStep: bool     — Symmetric Curves' "Even Step Pattern" checkbox
   *   mirrorHalves: bool — Symmetric Curves' "Mirror Halves" checkbox
   * Order: Arc Curve Correction ALWAYS runs first, on every mode, with no
   * toggle of its own — it gently pre-smooths the raw stroke's local
   * bends before anything else looks at it. Then Limit Doubling (cleans up
   * local elbow artifacts), then Even Step Pattern (evens out slopes
   * run-by-run), then Mirror Halves last (a global pass over the whole,
   * by-now-cleaned-up stroke).
   */
  smoothStroke(rawPoints, opts) {
    let pts = LineSmoothing.arcCurveCorrect(rawPoints);
    if (opts.mode === 'doubling' || opts.mode === 'both') {
      pts = LineSmoothing.limitDoubling(pts);
    }
    if (opts.mode === 'symmetric' || opts.mode === 'both') {
      if (opts.evenStep) pts = LineSmoothing.evenStepPattern(pts);
      if (opts.mirrorHalves) pts = LineSmoothing.mirrorHalves(pts);
    }
    return pts;
  },
};

window.PAE = window.PAE || {};
window.PAE.LineSmoothing = LineSmoothing;

// ---- Presets (save/load the mode + toggle + timing combination) -----------

/**
 * Persists named Smoothing Pencil setting combinations to localStorage —
 * same "name it, reuse it later" idea as VBrushPresetStore/StampPresetStore,
 * just for a handful of settings instead of a node list or pixel grid. Kept
 * in its own storage key for the same reason those are: not tied to any
 * palette, pipeline, or stamp. Same defensive try/catch-around-localStorage
 * shape as those, for the same reasons (private browsing, quota, etc. can
 * all make localStorage throw).
 */
const SmoothingPresetStore = {
  storageKey: 'pixelArtEditor.smoothingPresets',

  _load() {
    try {
      const raw = localStorage.getItem(SmoothingPresetStore.storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn('SmoothingPresetStore: could not read localStorage, starting fresh.', err);
      return [];
    }
  },

  _persist(presets) {
    try {
      localStorage.setItem(SmoothingPresetStore.storageKey, JSON.stringify(presets));
    } catch (err) {
      console.warn('SmoothingPresetStore: could not write localStorage (preset will not survive reload).', err);
    }
  },

  /** `[{id, name, mode, evenStep, mirrorHalves, timing}, ...]`, most-recently-saved last. */
  list() {
    return SmoothingPresetStore._load();
  },

  /**
   * Saves the given settings under `name`. Saving under a name that
   * already exists (case-insensitive) overwrites that preset in place
   * rather than piling up duplicates — same behavior as every other preset
   * library in this app.
   */
  save(name, settings) {
    const presets = SmoothingPresetStore._load();
    const cleanName = (name || '').trim() || 'Preset';
    const existingIndex = presets.findIndex((p) => p.name.toLowerCase() === cleanName.toLowerCase());
    const entry = {
      id: existingIndex >= 0 ? presets[existingIndex].id : 'smooth' + Date.now() + Math.floor(Math.random() * 1000),
      name: cleanName,
      mode: settings.mode,
      evenStep: !!settings.evenStep,
      mirrorHalves: !!settings.mirrorHalves,
      timing: settings.timing,
    };
    if (existingIndex >= 0) presets[existingIndex] = entry;
    else presets.push(entry);
    SmoothingPresetStore._persist(presets);
    return entry;
  },

  /** Returns the named preset's settings, or `null` if it no longer exists (e.g. deleted from another tab). */
  load(id) {
    return SmoothingPresetStore._load().find((p) => p.id === id) || null;
  },

  remove(id) {
    SmoothingPresetStore._persist(SmoothingPresetStore._load().filter((p) => p.id !== id));
  },
};

window.PAE.SmoothingPresetStore = SmoothingPresetStore;
