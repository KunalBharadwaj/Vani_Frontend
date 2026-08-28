import { describe, it, expect } from "vitest";
import { computePanelStyle, BUTTON_SIZE, GAP } from "./panelPosition";

const VW = 1920;
const VH = 1080;

describe("computePanelStyle", () => {
  it("anchors by bottom (not top) when opening upward, so the panel hugs the button", () => {
    // Default button position: 24 from right, 96 from bottom — plenty of room above.
    const style = computePanelStyle({ right: 24, bottom: 96 }, VW, VH);
    expect(style.bottom).toBeDefined();
    expect(style.top).toBeUndefined();
    // Panel bottom sits GAP above the button's top edge.
    expect(style.bottom).toBe(96 + BUTTON_SIZE + GAP);
  });

  it("aligns the panel's right edge with the button's when near the right edge", () => {
    const style = computePanelStyle({ right: 24, bottom: 96 }, VW, VH);
    expect(style.right).toBe(24);
    expect(style.left).toBeUndefined();
  });

  it("opens downward when the button is near the top of the viewport", () => {
    // bottom large => button sits high up => little room above => open downward.
    const style = computePanelStyle({ right: 24, bottom: VH - 100 }, VW, VH);
    expect(style.top).toBeDefined();
    expect(style.bottom).toBeUndefined();
  });

  it("opens to the right (left edge aligned) when the button is near the left edge", () => {
    const style = computePanelStyle({ right: VW - 80, bottom: 96 }, VW, VH);
    expect(style.left).toBeDefined();
    expect(style.right).toBeUndefined();
  });

  it("never positions the panel off-screen (keeps an 8px margin)", () => {
    const style = computePanelStyle({ right: 24, bottom: 96 }, VW, VH);
    for (const k of ["top", "bottom", "left", "right"]) {
      if (style[k] !== undefined) expect(style[k]).toBeGreaterThanOrEqual(8);
    }
  });

  it("caps width to the panel max and height to half the viewport", () => {
    const style = computePanelStyle({ right: 24, bottom: 96 }, VW, VH);
    expect(style.width).toBe(384);
    expect(style.maxHeight).toBe(Math.min(VH * 0.5, 520));
  });

  it("shrinks width on narrow viewports", () => {
    const style = computePanelStyle({ right: 8, bottom: 8 }, 320, 640);
    expect(style.width).toBe(320 - 32);
  });

  it("always sets exactly one vertical and one horizontal anchor", () => {
    const style = computePanelStyle({ right: 24, bottom: 96 }, VW, VH);
    expect([style.top, style.bottom].filter((v) => v !== undefined).length).toBe(1);
    expect([style.left, style.right].filter((v) => v !== undefined).length).toBe(1);
  });
});
