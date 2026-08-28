import { describe, it, expect } from "vitest";
import { rectFromPoints } from "./geometry";

describe("rectFromPoints", () => {
  it("builds a rect from top-left to bottom-right", () => {
    expect(rectFromPoints({ x: 10, y: 20 }, { x: 40, y: 60 })).toEqual({
      x: 10, y: 20, width: 30, height: 40,
    });
  });

  it("normalizes a bottom-right to top-left drag (negative direction)", () => {
    expect(rectFromPoints({ x: 40, y: 60 }, { x: 10, y: 20 })).toEqual({
      x: 10, y: 20, width: 30, height: 40,
    });
  });

  it("clamps a zero-area selection to a minimum 1px region", () => {
    expect(rectFromPoints({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({
      x: 5, y: 5, width: 1, height: 1,
    });
  });

  it("respects a custom minimum size", () => {
    const r = rectFromPoints({ x: 0, y: 0 }, { x: 1, y: 1 }, 4);
    expect(r.width).toBe(4);
    expect(r.height).toBe(4);
  });
});
