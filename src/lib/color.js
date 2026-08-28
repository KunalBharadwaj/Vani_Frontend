// Theme-aware color helpers for the notes canvas.

/** Convert a #rgb or #rrggbb hex color to HSL components ({ h:0-360, s/l:0-100 }). */
export function hexToHsl(hex) {
  let r = 0, g = 0, b = 0;
  const cleaned = hex.replace('#', '');
  if (cleaned.length === 3) {
    r = parseInt(cleaned[0] + cleaned[0], 16);
    g = parseInt(cleaned[1] + cleaned[1], 16);
    b = parseInt(cleaned[2] + cleaned[2], 16);
  } else {
    r = parseInt(cleaned.slice(0, 2), 16);
    g = parseInt(cleaned.slice(2, 4), 16);
    b = parseInt(cleaned.slice(4, 6), 16);
  }
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

/** Convert HSL (h:0-360, s/l:0-100) back to a #rrggbb hex string. */
export function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

const themeColorCache = new Map();

/**
 * Return a variant of `color` that stays visible on the current theme
 * background: dark strokes are lightened on dark mode, light strokes are
 * darkened on light mode. Non-hex values are returned unchanged. Cached.
 */
export function adaptColorForTheme(color, isDark) {
  if (!color || !color.startsWith('#')) return color;
  const cacheKey = color + (isDark ? '-dark' : '-light');
  if (themeColorCache.has(cacheKey)) return themeColorCache.get(cacheKey);

  let result = color;
  try {
    const { h, s, l } = hexToHsl(color);
    if (isDark) {
      if (l < 45) result = hslToHex(h, Math.min(s + 10, 100), Math.max(l + 55, 75));
    } else {
      if (l > 75) result = hslToHex(h, Math.min(s + 10, 100), Math.min(l - 50, 35));
    }
  } catch { /* malformed color — fall through */ }

  themeColorCache.set(cacheKey, result);
  return result;
}
