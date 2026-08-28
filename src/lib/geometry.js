// Pure 2D geometry helpers shared by the canvas editors.

/**
 * Normalize two corner points into an axis-aligned rectangle, regardless of
 * drag direction. Width/height are clamped to a minimum so a zero-area
 * selection still yields a valid (1px) crop region.
 *
 * @param {{x:number, y:number}} a
 * @param {{x:number, y:number}} b
 * @param {number} [minSize=1]
 * @returns {{x:number, y:number, width:number, height:number}}
 */
export function rectFromPoints(a, b, minSize = 1) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.max(minSize, Math.abs(a.x - b.x)),
    height: Math.max(minSize, Math.abs(a.y - b.y)),
  };
}
