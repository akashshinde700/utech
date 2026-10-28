'use strict';

/**
 * MATERIAL WEIGHT FOR AN ITEM
 *
 * The maths lives in ONE place: services/metalCalculator.js (volume × the
 * metal's own density). This file only reads the stock register's free-text
 * size — "OD 60 X 5 mtr.", "1500 x 3000 x 12 th", "OD 60.3 X ID 54 X 6 MTR",
 * "8' x 4' x 3 MM" — and turns it into the shape + dimensions that engine
 * expects, so an item and the calculator page can never disagree.
 *
 * An item therefore needs its metal to have a weight: density is what turns a
 * volume into kilograms. Without it the weight stays unknown rather than being
 * guessed from an average steel.
 */

const { calculate, metalByName, shapeById, UNIT_TO_MM } = require('../services/metalCalculator');

// the register writes millimetres, metres and feet in the same column
const MM_PER = {
  mm: 1, m: 1000, mtr: 1000, mtrs: 1000, meter: 1000, metre: 1000, meters: 1000, metres: 1000,
  ft: 304.8, feet: 304.8, foot: 304.8, "'": 304.8,
  '"': 25.4, in: 25.4, inch: 25.4, inches: 25.4,
};

// (60.3 - 54) / 2 is 3.1499999999999986 in binary floating point; a wall
// thickness is a measurement, so keep it to a sane number of decimals
const mm4 = (n) => Math.round(n * 10000) / 10000;

function parseDimensions(size) {
  if (!size) return [];
  const out = [];
  const re = /([0-9]+(?:\.[0-9]+)?)\s*([a-z'"]*)/g;
  let m;
  while ((m = re.exec(String(size).toLowerCase())) !== null) {
    const value = Number(m[1]);
    if (!Number.isFinite(value) || value <= 0) continue;
    const unit = (m[2] || '').replace(/[^a-z'"]/g, '');
    out.push({ value, mm: value * (MM_PER[unit] || 1) });
  }
  return out;
}

/**
 * Which calculator shape this item is, and the dimensions to feed it.
 * @returns {{ shape: string, values: object, note: string } | null}
 */
function shapeFromSize(size, name = '') {
  // Structured sizes from the item calculator retain every shape and dimension
  // in the same order as the shared calculator catalogue.
  const structured = /^Calculator ([a-z]+): (.+)$/i.exec(String(size || '').trim());
  if (structured) {
    const shape = shapeById(structured[1].toLowerCase());
    const parts = structured[2].split(' X ');
    if (!shape || parts.length !== shape.fields.length) return null;
    const dims = parts.map((part) => {
      const m = /^(\d+(?:\.\d+)?) (mm|cm|m|in|ft|yd)$/i.exec(part);
      if (!m || !UNIT_TO_MM[m[2].toLowerCase()]) return null;
      const value = Number(m[1]) * UNIT_TO_MM[m[2].toLowerCase()];
      return Number.isFinite(value) && value > 0 ? value : null;
    });
    if (dims.some((v) => v === null)) return null;
    return { shape: shape.id, values: Object.fromEntries(shape.fields.map((f, i) => [f.id, dims[i]])), note: '' };
  }

  // Explicit calculator-generated shape takes precedence over the item name.
  // Existing free-text sizes retain the register's name-based interpretation.
  const explicit = /^(round bar|pipe|hex|sheet):/i.test(String(size || '').trim());
  const text = (explicit ? size : `${name} ${size || ''}`).toLowerCase();
  const d = parseDimensions(size);
  if (!d.length) return null;

  const hasBore = /\bid\b|inner|bore/.test(text);
  const isPipe = /pipe|tube/.test(text);
  const isFlange = /flange/.test(text);
  const isHex = /hex/.test(text);
  const isPlate = /plate|sheet|\bth\b|thk/.test(text);

  // pipe: OD, ID and a length -> the engine wants wall thickness
  if ((isPipe || (hasBore && !isFlange)) && d.length >= 3) {
    const [od, id, len] = [d[0].mm, d[1].mm, d[2].mm];
    if (od <= id) return null;
    const wall = mm4((od - id) / 2);
    return { shape: 'pipe', values: { od, t: wall, L: len }, note: `wall ${wall} mm from OD ${od} − ID ${id}` };
  }

  // a flange is a disc: solid (OD × thickness) or with a bore (OD × ID × thickness)
  if (isFlange) {
    if (hasBore && d.length >= 3) {
      const [od, id, th] = [d[0].mm, d[1].mm, d[2].mm];
      if (od <= id) return null;
      return { shape: 'pipe', values: { od, t: mm4((od - id) / 2), L: th }, note: `disc OD ${od} with ${id} bore, ${th} thick` };
    }
    if (d.length >= 2) {
      return { shape: 'roundbar', values: { d: d[0].mm, L: d[1].mm }, note: `solid disc OD ${d[0].mm}, ${d[1].mm} thick` };
    }
    return null;
  }

  if (isHex && d.length >= 2) {
    // the register's hex size is across flats, which is what the engine wants
    return { shape: 'hexagon', values: { af: d[0].mm, L: d[d.length - 1].mm }, note: 'across flats' };
  }

  if (isPlate && d.length >= 3) {
    return { shape: 'sheet', values: { w: d[0].mm, b: d[1].mm, t: d[2].mm }, note: '' };
  }

  // round bar: a diameter and a length
  if (/round|\bod\b|\bø|dia/.test(text) && d.length >= 2) {
    return { shape: 'roundbar', values: { d: d[0].mm, L: d[d.length - 1].mm }, note: '' };
  }

  return null;
}

/**
 * Weight of ONE piece, in kg, using the metal calculator.
 * @returns {{ kg: number, shape: string, metal: string, note: string } | null}
 */
function weightForItem({ size, name, metal } = {}) {
  if (!metal || !metalByName(metal)) return null;
  const parsed = shapeFromSize(size, name);
  if (!parsed) return null;
  try {
    const r = calculate({
      shape: parsed.shape,
      metal,
      unit: 'mm',
      weightUnit: 'kg',
      pieces: 1,
      values: parsed.values,
    });
    return { kg: r.pieceWeightKg, shape: parsed.shape, metal, note: parsed.note };
  } catch {
    // an unreadable size is not an error the caller has to handle — it simply
    // has no weight yet
    return null;
  }
}

module.exports = { parseDimensions, shapeFromSize, weightForItem };
