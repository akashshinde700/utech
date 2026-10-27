'use strict';

/**
 * MATERIAL WEIGHT FROM SIZE — the shop's own formulas (supplied 27 Oct 2026):
 *
 *   Plate : Width × Length × Thickness × 0.0000085
 *   Round : Ø × Ø × Length × 0.0000065        (hex bar is measured the same way)
 *
 * Every dimension is in millimetres and the result is kilograms. The factors
 * are the plant's, not a textbook's — keep them here, in one place, so a change
 * is a one-line change. Pipe and flange have no agreed formula yet, so their
 * weight is deliberately left unknown rather than guessed.
 */

const FACTORS = { plate: 0.0000085, round: 0.0000065 };

// "OD 60 X 5 mtr." / "8' x 4' x 3 MM" / "1500 x 3000 x 12 th" — the register
// mixes millimetres, metres and feet, so a unit that travels with a number wins
// over the default.
const MM_PER = { mm: 1, m: 1000, mtr: 1000, meter: 1000, metre: 1000, ft: 304.8, feet: 304.8, foot: 304.8, "'": 304.8, '"': 25.4, in: 25.4, inch: 25.4 };

function parseDimensions(size) {
  if (!size) return [];
  const text = String(size).toLowerCase();
  const out = [];
  // a number, then anything up to the next number: the unit, if one was written
  const re = /([0-9]+(?:\.[0-9]+)?)\s*([a-z'"]*)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const value = Number(m[1]);
    if (!Number.isFinite(value)) continue;
    const unit = (m[2] || '').replace(/[^a-z'"]/g, '');
    out.push({ value, unit });
  }
  return out;
}

// Dimensions are millimetres unless the number carried its own unit. A trailing
// unit on the LAST number (e.g. "OD 60 X 5 mtr.") applies only to that number.
function toMm(dim, fallbackUnit) {
  const unit = dim.unit || fallbackUnit || 'mm';
  const factor = MM_PER[unit];
  return factor ? dim.value * factor : dim.value;
}

/**
 * @returns {{ kg: number, formula: string, dimensionsMm: number[] } | null}
 *          null when the size cannot be read with the agreed formulas.
 */
function weightFromSize(size, kind) {
  const dims = parseDimensions(size);
  if (!dims.length) return null;

  if (kind === 'plate') {
    if (dims.length < 3) return null;
    const [w, l, t] = dims.slice(0, 3).map((d) => toMm(d));
    if (![w, l, t].every((n) => n > 0)) return null;
    return {
      kg: round3(w * l * t * FACTORS.plate),
      formula: `${w} × ${l} × ${t} × ${FACTORS.plate}`,
      dimensionsMm: [w, l, t],
    };
  }

  if (kind === 'round') {
    // "OD 60 X 5 mtr." and "Hex 38 X 8 mtr." are both diameter-then-length.
    // A size that also states an inner diameter (a pipe) is not a round bar.
    if (dims.length < 2) return null;
    const d = toMm(dims[0]);
    const l = toMm(dims[dims.length - 1]);
    if (!(d > 0 && l > 0)) return null;
    return {
      kg: round3(d * d * l * FACTORS.round),
      formula: `${d} × ${d} × ${l} × ${FACTORS.round}`,
      dimensionsMm: [d, l],
    };
  }

  return null;
}

// Which formula a given item is measured by. Anything else (pipe, flange,
// bought-out parts) has no agreed formula and stays unknown.
function kindFor({ size, name, categoryName } = {}) {
  const text = `${name || ''} ${categoryName || ''} ${size || ''}`.toLowerCase();
  // pipe and flange have no agreed formula — never fall through to 'plate'
  if (/\bid\b|inner|pipe|tube|flange/.test(text)) return null;
  if (/plate|sheet|\bth\b|thk|thickness/.test(text)) return 'plate';
  if (/round|\bod\b|hex|bar|\bø/.test(text)) return 'round';
  return null;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

module.exports = { FACTORS, parseDimensions, weightFromSize, kindFor };
