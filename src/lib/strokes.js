// Stroke geometry & canvas rendering for the notes canvas.
import { getStroke } from "perfect-freehand";
import { adaptColorForTheme } from "./color";

/** Build an SVG path string from a perfect-freehand outline. */
export function getSvgPathFromStroke(stroke) {
  if (!stroke.length) return "";
  const d = stroke.reduce((acc, [x0, y0], i, arr) => {
    const [x1, y1] = arr[(i + 1) % arr.length];
    acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    return acc;
  }, ["M", stroke[0][0], stroke[0][1], "Q"]);
  d.push("Z");
  return d.join(" ");
}

/**
 * Render an array of strokes onto a 2D canvas context.
 * @param skipFill true when the caller fills the background separately
 *        (e.g. under a viewport transform).
 */
export function renderStrokes(ctx, canvas, strokes, bgColor, isDark = false, skipFill = false) {
  if (!skipFill) {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  for (const s of strokes) {
    const drawColor = adaptColorForTheme(s.color, isDark);
    if (s.type === "freehand") {
      if (!s._path) {
        const drawn = getStroke(s.points, { size: s.size, thinning: s.tool === "highlighter" ? 0 : 0.6, smoothing: 0.5, streamline: 0.5, simulatePressure: true });
        s._path = getSvgPathFromStroke(drawn);
      }
      if (!s._path) continue;
      ctx.save(); ctx.globalAlpha = s.opacity ?? 1; ctx.fillStyle = drawColor; ctx.fill(new Path2D(s._path)); ctx.restore();
    } else if (s.type === "shape") {
      ctx.save(); ctx.strokeStyle = drawColor; ctx.lineWidth = s.size; ctx.lineCap = "round"; ctx.lineJoin = "round";
      const { start, end } = s;
      if (s.tool === "rectangle") ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
      else if (s.tool === "circle") { const r = Math.hypot(end.x - start.x, end.y - start.y); ctx.beginPath(); ctx.arc(start.x, start.y, r, 0, Math.PI * 2); ctx.stroke(); }
      else { ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke(); }
      ctx.restore();
    } else if (s.type === "snapshot") {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.src = s.data;
      // If already cached by the browser, onload may not fire — handle both
      if (img.complete && img.naturalWidth > 0) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }
  }
}

/** True if the point (px,py) is within eraserRadius of a stroke. */
export function strokeHitTest(stroke, px, py, eraserRadius) {
  if (stroke.type === "freehand") {
    const threshold = eraserRadius + stroke.size / 2;
    return stroke.points.some(([x, y]) => Math.hypot(x - px, y - py) < threshold);
  }
  if (stroke.type === "shape") {
    const { start, end } = stroke;
    const minX = Math.min(start.x, end.x) - eraserRadius, maxX = Math.max(start.x, end.x) + eraserRadius;
    const minY = Math.min(start.y, end.y) - eraserRadius, maxY = Math.max(start.y, end.y) + eraserRadius;
    return px >= minX && px <= maxX && py >= minY && py <= maxY;
  }
  return false;
}

/** Strip the internal path cache and quantize points before syncing over the wire. */
export function compactStrokes(strokes) {
  return strokes.map((s) => {
    if (s.type === "freehand") {
      const { _path, ...rest } = s;
      return { ...rest, points: rest.points.map(([x, y, p]) => [Math.round(x * 2) / 2, Math.round(y * 2) / 2, Math.round(p * 100) / 100]) };
    }
    return s;
  });
}
