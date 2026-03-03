function rgbToHex(rgb: string): string | null {
  const parts = rgb.match(/\d+/g);
  if (!parts || parts.length < 3) return null;
  const [r, g, b] = parts.slice(0, 3).map((value) => Number(value));
  if ([r, g, b].some((value) => Number.isNaN(value))) return null;
  return `#${[r, g, b]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

export function resolveThemeHex(varName: string, fallback = '#a8664e'): string {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const root = document.documentElement;
  const cssValue = getComputedStyle(root).getPropertyValue(varName).trim();
  if (!cssValue) return fallback;
  if (cssValue.startsWith('#')) return cssValue;
  return rgbToHex(cssValue) ?? fallback;
}
