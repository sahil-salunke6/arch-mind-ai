// Mirrors api/app/units.py: lengths as written on Indian drawings → millimetres.

const MM_PER_FT = 304.8;
const MM_PER_IN = 25.4;

const FT_IN = /^\s*(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*-?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|''|in|inch|inches)?)?\s*$/i;
const INCH = /^\s*(\d+(?:\.\d+)?)\s*(?:"|''|in|inch|inches)\s*$/i;
const METRIC = /^\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\s*$/i;
const NUMBER = /^\s*(\d+(?:\.\d+)?)\s*$/;

/** Returns millimetres, or null when the text isn't a length. Bare numbers are feet. */
export function parseLength(text: string): number | null {
  let m = FT_IN.exec(text);
  if (m) return Number(m[1]) * MM_PER_FT + Number(m[2] ?? 0) * MM_PER_IN;
  if ((m = INCH.exec(text))) return Number(m[1]) * MM_PER_IN;
  if ((m = METRIC.exec(text))) return Number(m[1]) * { mm: 1, cm: 10, m: 1000 }[m[2].toLowerCase() as "mm" | "cm" | "m"];
  if ((m = NUMBER.exec(text))) return Number(m[1]) * MM_PER_FT;
  return null;
}

/** "40x60", "40' x 60'" → [width, depth] in mm. */
export function parseSize(text: string): [number, number] | null {
  const parts = text.split(/\s*[x×*]\s*/i);
  if (parts.length !== 2) return null;
  const [a, b] = parts.map(parseLength);
  return a && b ? [a, b] : null;
}
