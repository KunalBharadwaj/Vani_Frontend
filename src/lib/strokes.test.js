import { describe, it, expect } from "vitest";
import { getSvgPathFromStroke, strokeHitTest, compactStrokes } from "./strokes";

describe("getSvgPathFromStroke", () => {
  it("returns an empty string for an empty stroke", () => {
    expect(getSvgPathFromStroke([])).toBe("");
  });

  it("builds a closed quadratic path", () => {
    const d = getSvgPathFromStroke([[0, 0], [10, 0], [10, 10]]);
    expect(d.startsWith("M 0 0 Q")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
  });
});

describe("strokeHitTest", () => {
  const freehand = { type: "freehand", size: 10, points: [[0, 0], [10, 10]] };
  const rect = { type: "shape", tool: "rectangle", start: { x: 0, y: 0 }, end: { x: 10, y: 10 } };

  it("detects a hit near a freehand point", () => {
    expect(strokeHitTest(freehand, 0, 0, 5)).toBe(true);
  });

  it("misses a freehand stroke that is far away", () => {
    expect(strokeHitTest(freehand, 100, 100, 5)).toBe(false);
  });

  it("detects a hit inside a shape's bounding box", () => {
    expect(strokeHitTest(rect, 5, 5, 2)).toBe(true);
  });

  it("misses a point outside a shape's bounding box", () => {
    expect(strokeHitTest(rect, 100, 100, 2)).toBe(false);
  });

  it("returns false for unknown stroke types", () => {
    expect(strokeHitTest({ type: "snapshot" }, 0, 0, 5)).toBe(false);
  });
});

describe("compactStrokes", () => {
  it("strips the internal path cache and quantizes points", () => {
    const input = [{ type: "freehand", _path: "cached", color: "#000", points: [[1.3, 2.7, 0.555]] }];
    const out = compactStrokes(input);
    expect("_path" in out[0]).toBe(false);
    expect(out[0].points).toEqual([[1.5, 2.5, 0.56]]);
  });

  it("passes non-freehand strokes through unchanged", () => {
    const shape = { type: "shape", tool: "rectangle", start: { x: 0, y: 0 }, end: { x: 1, y: 1 } };
    expect(compactStrokes([shape])[0]).toBe(shape);
  });
});
