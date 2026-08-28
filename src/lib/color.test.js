import { describe, it, expect } from "vitest";
import { hexToHsl, hslToHex, adaptColorForTheme } from "./color";

describe("hexToHsl", () => {
  it("converts primary colors", () => {
    expect(hexToHsl("#ff0000")).toMatchObject({ h: 0, s: 100, l: 50 });
    const white = hexToHsl("#ffffff");
    expect(white.l).toBeCloseTo(100);
    expect(white.s).toBeCloseTo(0);
    const black = hexToHsl("#000000");
    expect(black.l).toBeCloseTo(0);
  });

  it("supports 3-digit shorthand hex", () => {
    expect(hexToHsl("#f00")).toMatchObject({ h: 0, s: 100, l: 50 });
  });
});

describe("hslToHex", () => {
  it("round-trips with hexToHsl", () => {
    for (const hex of ["#ff0000", "#00ff00", "#3366cc"]) {
      const { h, s, l } = hexToHsl(hex);
      expect(hslToHex(h, s, l).toLowerCase()).toBe(hex);
    }
  });
});

describe("adaptColorForTheme", () => {
  it("lightens a dark stroke on a dark background", () => {
    const out = adaptColorForTheme("#000000", true);
    expect(out).not.toBe("#000000");
    expect(hexToHsl(out).l).toBeGreaterThan(50);
  });

  it("darkens a light stroke on a light background", () => {
    const out = adaptColorForTheme("#ffffff", false);
    expect(out).not.toBe("#ffffff");
    expect(hexToHsl(out).l).toBeLessThan(50);
  });

  it("leaves a mid-tone color unchanged", () => {
    expect(adaptColorForTheme("#ff0000", true)).toBe("#ff0000");
  });

  it("returns non-hex values untouched", () => {
    expect(adaptColorForTheme("rgb(0,0,0)", true)).toBe("rgb(0,0,0)");
  });
});
