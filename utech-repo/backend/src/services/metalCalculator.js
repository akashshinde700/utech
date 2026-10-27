'use strict';

/**
 * Metal weight & price engine.
 *
 * Ported from "Metal Calculator" v11.2 (com.pixelsdo.metalweightcalculator),
 * the APK that was reverse engineered for this ERP. The formulas, the 22
 * densities and the unit constants below were recovered from the APK's smali
 * (see docs/METAL_CALCULATOR.md for the evidence and the exact constants).
 *
 * Weight model (same as the APK):
 *   kg = volume(mm³) × density(g/cm³) × 1e-6
 * because 1 mm³ = 1e-3 cm³ and 1 g/cm³ = 1e-3 kg/cm³.
 *
 * Deliberate differences from the APK (documented, covered by tests):
 *   - π is used exactly. The APK hard-codes 3.14 for the round-bar screen and
 *     3.1416 elsewhere, so its own numbers disagree by up to 0.05% between
 *     screens. An ERP must not ship a 0.05% weighing error.
 *   - Sheet/plate has no separate "length" input: A × B × thickness is the
 *     whole volume, which is how the APK's Sheet screen works too. (The older
 *     public port treated the thickness as a length and produced NaN.)
 *   - Every result is returned in kg as well as in the selected unit, and money
 *     is rounded with decimal.js, not floating point.
 */

const Decimal = require('decimal.js');
const HttpError = require('../utils/httpError');
const profileData = require('../data/standardProfiles.json');

/** dimension unit → millimetres (APK unit constants) */
const UNIT_TO_MM = Object.freeze({
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
  yd: 914.4,
});

const UNIT_IDS = Object.freeze(Object.keys(UNIT_TO_MM));
const METRIC_UNITS = Object.freeze(['mm', 'cm', 'm']);
const IMPERIAL_UNITS = Object.freeze(['in', 'ft', 'yd']);
const WEIGHT_UNITS = Object.freeze(['kg', 'lb']);

/** APK constant: 1 kg = 2.204622 lb (same value the app multiplies by) */
const KG_TO_LB = 2.204622;
/** APK constant: kg/m per lb/ft (used by the app's imperial tables) */
const LBFT_TO_KGM = 1.48816273;

/** 22 metals + densities — exactly the APK's `metaltypes` / `metalden` arrays */
const METALS = Object.freeze([
  { name: 'Steel', density: 7.85, group: 'Common' },
  { name: 'Aluminum', density: 2.73, group: 'Common' },
  { name: 'Brass', density: 8.55, group: 'Common' },
  { name: 'Copper', density: 8.93, group: 'Common' },
  { name: 'Bronze', density: 8.88, group: 'Common' },
  { name: 'Zinc', density: 7.2, group: 'Common' },
  { name: 'Chromium', density: 7.1, group: 'Common' },
  { name: 'Lead', density: 11.37, group: 'Common' },
  { name: 'Iron', density: 7.86, group: 'Common' },
  { name: 'Gold', density: 19.36, group: 'Precious' },
  { name: 'Magnesium', density: 1.7, group: 'Common' },
  { name: 'Nickel', density: 8.85, group: 'Common' },
  { name: 'Titanium', density: 4.5, group: 'Common' },
  { name: 'Tin', density: 7.26, group: 'Common' },
  { name: 'Teflon', density: 2.2, group: 'Other' },
  { name: 'Silver', density: 10.5, group: 'Precious' },
  { name: 'Platinum', density: 21.45, group: 'Precious' },
  { name: 'SS 304/310', density: 7.92, group: 'Stainless' },
  { name: 'SS 316/321', density: 7.94, group: 'Stainless' },
  { name: 'SS 410/430', density: 7.71, group: 'Stainless' },
  { name: 'Zirconium', density: 6.51, group: 'Other' },
  { name: 'Molybdenum', density: 10.28, group: 'Other' },
]);

const field = (id, label, symbol, extra) => ({ id, label, symbol, ...(extra || {}) });

/**
 * Shape catalogue. `areaMm2` = cross-section (mm²), `lengthField` = the only
 * field that scales with the bar, `volumeMm3` = the full displaced volume.
 * Shapes without `areaMm2` (sheet) only support the "by weight" direction.
 */
const SHAPES = Object.freeze([
  {
    id: 'roundbar',
    label: 'Round Bar',
    fields: [field('d', 'Diameter (D)', 'D'), field('L', 'Length (L)', 'L', { isLength: true })],
    areaMm2: (v) => (Math.PI / 4) * v.d * v.d,
    volumeMm3: (v) => (Math.PI / 4) * v.d * v.d * v.L,
    formula: 'π/4 × D² × L × ρ',
  },
  {
    id: 'pipe',
    label: 'Round Tube / Pipe',
    fields: [
      field('od', 'Outer Diameter (D)', 'D'),
      field('t', 'Wall Thickness (t)', 't'),
      field('L', 'Length (L)', 'L', { isLength: true }),
    ],
    areaMm2: (v) => {
      const inner = v.od - 2 * v.t;
      return (Math.PI / 4) * (v.od * v.od - inner * inner);
    },
    volumeMm3: (v) => {
      const inner = v.od - 2 * v.t;
      return (Math.PI / 4) * (v.od * v.od - inner * inner) * v.L;
    },
    formula: 'π/4 × (D² − (D−2t)²) × L × ρ',
  },
  {
    id: 'squarebar',
    label: 'Square Bar',
    fields: [field('a', 'Side (A)', 'A'), field('L', 'Length (L)', 'L', { isLength: true })],
    areaMm2: (v) => v.a * v.a,
    volumeMm3: (v) => v.a * v.a * v.L,
    formula: 'A² × L × ρ',
  },
  {
    id: 'squaretube',
    label: 'Square Tube',
    fields: [
      field('a', 'Side (A)', 'A'),
      field('t', 'Wall Thickness (t)', 't'),
      field('L', 'Length (L)', 'L', { isLength: true }),
    ],
    areaMm2: (v) => v.a * v.a - (v.a - 2 * v.t) * (v.a - 2 * v.t),
    volumeMm3: (v) => (v.a * v.a - (v.a - 2 * v.t) * (v.a - 2 * v.t)) * v.L,
    formula: '(A² − (A−2t)²) × L × ρ',
  },
  {
    id: 'flatbar',
    label: 'Flat Bar',
    fields: [
      field('w', 'Width (A)', 'A'),
      field('t', 'Thickness (B)', 'B'),
      field('L', 'Length (L)', 'L', { isLength: true }),
    ],
    areaMm2: (v) => v.w * v.t,
    volumeMm3: (v) => v.w * v.t * v.L,
    formula: 'A × B × L × ρ',
  },
  {
    id: 'hexagon',
    label: 'Hexagon Bar',
    fields: [
      field('af', 'Across Flats (A)', 'A'),
      field('L', 'Length (L)', 'L', { isLength: true }),
    ],
    // APK constant is exactly 0.866 (not √3/2 = 0.8660254); kept for parity
    areaMm2: (v) => 0.866 * v.af * v.af,
    volumeMm3: (v) => 0.866 * v.af * v.af * v.L,
    formula: '0.866 × A² × L × ρ',
  },
  {
    id: 'sheet',
    label: 'Sheet / Plate',
    fields: [
      field('w', 'Width (A)', 'A'),
      field('b', 'Length (B)', 'B'),
      field('t', 'Thickness (t)', 't'),
    ],
    // no cross-section/length split: the whole block is A × B × t
    areaMm2: null,
    volumeMm3: (v) => v.w * v.b * v.t,
    formula: 'A × B × t × ρ',
  },
  {
    id: 'angle',
    label: 'Angle (L)',
    fields: [
      field('a', 'Side A', 'A'),
      field('b', 'Side B', 'B'),
      field('t', 'Thickness (t)', 't'),
      field('L', 'Length (L)', 'L', { isLength: true }),
    ],
    areaMm2: (v) => v.t * (v.a + v.b - v.t),
    volumeMm3: (v) => v.t * (v.a + v.b - v.t) * v.L,
    formula: 't × (A + B − t) × L × ρ',
    standard: true,
    profileShape: 'angle',
  },
  {
    id: 'beam',
    label: 'Beam (H / I)',
    fields: [
      field('h', 'Height (H)', 'H'),
      field('b', 'Flange Width (B)', 'B'),
      field('tw', 'Web Thickness (tw)', 'tw'),
      field('tf', 'Flange Thickness (tf)', 'tf'),
      field('L', 'Length (L)', 'L', { isLength: true }),
    ],
    areaMm2: (v) => 2 * v.b * v.tf + (v.h - 2 * v.tf) * v.tw,
    volumeMm3: (v) => (2 * v.b * v.tf + (v.h - 2 * v.tf) * v.tw) * v.L,
    formula: '[2·B·tf + (H−2·tf)·tw] × L × ρ',
    standard: true,
    profileShape: 'beam',
  },
  {
    id: 'channel',
    label: 'Channel (U)',
    fields: [
      field('h', 'Height (H)', 'H'),
      field('b', 'Flange Width (B)', 'B'),
      field('tw', 'Web Thickness (tw)', 'tw'),
      field('tf', 'Flange Thickness (tf)', 'tf'),
      field('L', 'Length (L)', 'L', { isLength: true }),
    ],
    areaMm2: (v) => 2 * v.b * v.tf + (v.h - v.tf) * v.tw,
    volumeMm3: (v) => (2 * v.b * v.tf + (v.h - v.tf) * v.tw) * v.L,
    formula: '[2·B·tf + (H−tf)·tw] × L × ρ',
    standard: true,
    profileShape: 'channel',
  },
  {
    id: 'tprofile',
    label: 'T Profile',
    fields: [
      field('h', 'Height (H)', 'H'),
      field('b', 'Flange Width (B)', 'B'),
      field('tw', 'Web Thickness (tw)', 'tw'),
      field('tf', 'Flange Thickness (tf)', 'tf'),
      field('L', 'Length (L)', 'L', { isLength: true }),
    ],
    areaMm2: (v) => v.b * v.tf + (v.h - v.tf) * v.tw,
    volumeMm3: (v) => (v.b * v.tf + (v.h - v.tf) * v.tw) * v.L,
    formula: '[B·tf + (H−tf)·tw] × L × ρ',
  },
]);

const SHAPE_IDS = Object.freeze(SHAPES.map((s) => s.id));

const shapeById = (id) => SHAPES.find((s) => s.id === id) || null;
const metalByName = (name) => METALS.find((m) => m.name === name) || null;
const lengthFieldOf = (shape) => shape.fields.find((f) => f.isLength) || null;

/** round half away from zero, so 61.6545 never reports as 61.654 */
function round(value, digits = 3) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Math.sign(value) * Number.EPSILON) * factor) / factor;
}

function money(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

function catalog() {
  return {
    metals: METALS,
    shapes: SHAPES.map((s) => ({
      id: s.id,
      label: s.label,
      fields: s.fields,
      formula: s.formula,
      standard: !!s.standard,
      profileShape: s.profileShape || null,
      supportsLengthMode: !!s.areaMm2,
    })),
    units: {
      metric: METRIC_UNITS,
      imperial: IMPERIAL_UNITS,
      factorsToMm: UNIT_TO_MM,
    },
    weightUnits: WEIGHT_UNITS,
    constants: {
      kgToLb: KG_TO_LB,
      lbFtToKgM: LBFT_TO_KGM,
      densityUnit: 'g/cm³',
      pi: Math.PI,
    },
    standardProfiles: {
      shapeKeys: ['angle', 'beam', 'channel'],
      familyCount: profileData.families.length,
      profileCount: profileData.families.reduce((n, f) => n + f.profiles.length, 0),
      source: profileData.source,
      note: profileData.note,
    },
  };
}

/**
 * @param {{shape?:string,region?:string,family?:string,search?:string}} query
 */
function profiles(query = {}) {
  // express turns ?shape=a&shape=b into an array — never let that reach
  // .trim()/comparisons
  const str = (value) => (typeof value === 'string' ? value : '');
  const shape = str(query.shape) || null;
  const region = str(query.region) || null;
  const family = str(query.family) || null;
  const search = str(query.search).trim().toLowerCase();

  let families = profileData.families;
  if (shape) families = families.filter((f) => f.shape === shape);
  if (region) families = families.filter((f) => f.region === region);
  if (family) families = families.filter((f) => f.family === family);
  if (search) {
    families = families
      .map((f) => {
        const hits = f.profiles.filter((p) => p.name.toLowerCase().includes(search));
        return hits.length ? { ...f, profiles: hits, count: hits.length } : null;
      })
      .filter(Boolean);
  }

  return {
    source: profileData.source,
    note: profileData.note,
    families,
  };
}

function positiveField(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new HttpError(400, `${label} must be greater than 0`);
  }
  return n;
}

/**
 * Calculate a piece/consignment.
 *
 * @param {object} input validated body (see validators/metalCalculator.schema.js)
 */
function calculate(input) {
  const shape = shapeById(input.shape);
  if (!shape) throw new HttpError(400, `Unknown shape "${input.shape}"`);

  const unit = input.unit || 'mm';
  const factor = UNIT_TO_MM[unit];
  if (!factor) throw new HttpError(400, `Unknown dimension unit "${unit}"`);

  const weightUnit = input.weightUnit || 'kg';
  if (!WEIGHT_UNITS.includes(weightUnit)) {
    throw new HttpError(400, `Unknown weight unit "${weightUnit}"`);
  }

  const mode = input.mode || 'weight';
  const hasLength = !!shape.areaMm2;
  if (mode === 'length' && !hasLength) {
    throw new HttpError(400, `${shape.label} has no length dimension — calculate it by weight instead`);
  }

  const metal = input.metal ? metalByName(input.metal) : null;
  if (input.metal && !metal) throw new HttpError(400, `Unknown metal "${input.metal}"`);

  const density = Number(input.density ?? (metal ? metal.density : NaN));
  if (!Number.isFinite(density) || density <= 0 || density > 30) {
    throw new HttpError(400, 'Density must be between 0 and 30 g/cm³');
  }

  const profile = input.standardProfile || null;
  if (profile && !shape.standard) {
    throw new HttpError(400, `Standard profile values are only available for angle, beam and channel`);
  }
  if (profile && !(Number(profile.kgm) > 0)) {
    throw new HttpError(400, 'Standard profile kg/m must be greater than 0');
  }

  const rawValues = input.values || {};
  const lengthField = lengthFieldOf(shape);

  // convert every supplied dimension to mm; section values may be omitted when
  // the weight comes from a standard-profile table
  const mm = {};
  for (const f of shape.fields) {
    if (mode === 'length' && f.isLength) continue; // length is the answer, not an input
    if (profile && !f.isLength) continue; // section comes from the table
    const value = positiveField(rawValues[f.id], `${f.label} (${unit})`);
    mm[f.id] = value * factor;
  }

  const lengthMm = lengthField ? mm[lengthField.id] : null;
  const pieces = mode === 'length' ? 1 : Math.max(1, Math.trunc(Number(input.pieces) || 1));

  let areaMm2 = null;
  let kgPerMeter = null;
  let volumeMm3 = null;
  let pieceWeightKg = null;

  if (profile) {
    kgPerMeter = Number(profile.kgm);
    // section area implied by the table's kg/m at this density
    areaMm2 = kgPerMeter / (density * 1e-3);
    pieceWeightKg = (kgPerMeter * lengthMm) / 1000;
  } else {
    areaMm2 = shape.areaMm2 ? shape.areaMm2(mm) : null;
    volumeMm3 = shape.volumeMm3(mm);
    if (mode === 'weight') pieceWeightKg = volumeMm3 * density * 1e-6;
    if (areaMm2) kgPerMeter = areaMm2 * density * 1e-3;
  }

  let totalWeightKg;
  let resultLengthMm = null;
  let totalLengthMm = null;

  if (mode === 'weight') {
    totalWeightKg = pieceWeightKg * pieces;
    if (lengthMm) {
      resultLengthMm = lengthMm;
      totalLengthMm = lengthMm * pieces;
    }
  } else {
    const inputWeight = positiveField(input.totalWeight, `Total weight (${weightUnit})`);
    const weightKg = weightUnit === 'lb' ? inputWeight / KG_TO_LB : inputWeight;
    if (!kgPerMeter || kgPerMeter <= 0) {
      throw new HttpError(400, 'A positive kg/m value is required to calculate length');
    }
    resultLengthMm = (weightKg / kgPerMeter) * 1000;
    totalLengthMm = resultLengthMm;
    totalWeightKg = weightKg;
    pieceWeightKg = null;
    volumeMm3 = (totalWeightKg / density) * 1e6;
  }

  const toWeightUnit = (kg) => (kg == null ? null : weightUnit === 'lb' ? kg * KG_TO_LB : kg);

  const rate = input.rate == null || input.rate === '' ? null : Number(input.rate);
  if (rate != null && (!Number.isFinite(rate) || rate < 0)) {
    throw new HttpError(400, 'Rate cannot be negative');
  }
  const billableWeight = toWeightUnit(totalWeightKg);
  const totalPrice = rate == null ? null : money(billableWeight * rate);

  const toDimUnit = (mmValue) => (mmValue == null ? null : mmValue / factor);

  const dimensions = shape.fields
    .filter((f) => !(profile && !f.isLength))
    .map((f) => ({
      id: f.id,
      label: f.label,
      symbol: f.symbol,
      isLength: !!f.isLength,
      value: rawValues[f.id] == null || rawValues[f.id] === '' ? null : Number(rawValues[f.id]),
      unit,
      valueMm: mm[f.id] == null ? null : round(mm[f.id], 4),
    }));

  const notes = [];
  if (profile) {
    notes.push(`Section taken from the standard-profile table (${profile.name || 'selected profile'}): ${kgPerMeter} kg/m.`);
  }
  if (metal && Math.abs(density - metal.density) > 1e-9) {
    notes.push(`Custom density ${density} g/cm³ used instead of ${metal.name}'s ${metal.density} g/cm³.`);
  }
  if (weightUnit === 'lb') {
    notes.push(`Weights converted with the APK constant 2.204622 kg → lb.`);
  }
  if (mode === 'length' && weightUnit === 'lb') {
    notes.push('Length is computed from the weight converted back to kg.');
  }

  return {
    mode,
    shape: { id: shape.id, label: shape.label, formula: shape.formula },
    metal: metal ? { name: metal.name, density: metal.density, group: metal.group } : null,
    density,
    unit,
    weightUnit,
    pieces,
    standardProfile: profile ? { name: profile.name || null, kgm: kgPerMeter } : null,
    dimensions,
    areaMm2: round(areaMm2, 2),
    volumeMm3: round(volumeMm3, 2),
    kgPerMeter: round(kgPerMeter, 3),
    lbPerFoot: kgPerMeter == null ? null : round(kgPerMeter / LBFT_TO_KGM, 3),
    pieceWeightKg: round(pieceWeightKg, 3),
    totalWeightKg: round(totalWeightKg, 3),
    pieceWeight: round(toWeightUnit(pieceWeightKg), 3),
    totalWeight: round(billableWeight, 3),
    lengthUnit: unit,
    length: round(toDimUnit(resultLengthMm), 3),
    totalLength: round(toDimUnit(totalLengthMm), 3),
    lengthMm: round(resultLengthMm, 2),
    totalLengthMm: round(totalLengthMm, 2),
    rate,
    rateUnit: weightUnit,
    currency: 'INR',
    totalPrice,
    notes,
  };
}

module.exports = {
  METALS,
  SHAPES,
  SHAPE_IDS,
  UNIT_IDS,
  UNIT_TO_MM,
  METRIC_UNITS,
  IMPERIAL_UNITS,
  WEIGHT_UNITS,
  KG_TO_LB,
  LBFT_TO_KGM,
  catalog,
  profiles,
  calculate,
  shapeById,
  metalByName,
  round,
};
