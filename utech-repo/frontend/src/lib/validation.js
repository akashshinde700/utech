// validation.js — form field validators (task 6-a).
// Every validator returns an error string or null (null = valid). Format
// validators treat empty input as valid — pair them with `required` when the
// field is mandatory. Schema composition via validateAll(values, schema).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export function required(v, label = 'This field') {
  if (v == null || String(v).trim() === '') return `${label} is required`;
  return null;
}

export function email(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!EMAIL_RE.test(s)) return 'Enter a valid email address';
  return null;
}

// Indian 10-digit mobile. Accepts optional +91 / 91 / 0 prefixes, ignores
// spaces and dashes. Use normalizePhone() on the value before sending it to
// the API so stored numbers are always bare 10-digit.
export function phone10(v) {
  let s = String(v ?? '').trim().replace(/[\s-]/g, '');
  if (!s) return null;
  s = s.replace(/^\+91/, '').replace(/^91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '');
  if (!/^[6-9]\d{9}$/.test(s)) return 'Enter a valid 10-digit mobile number';
  return null;
}

export function normalizePhone(v) {
  let s = String(v ?? '').trim().replace(/[\s-]/g, '');
  if (!s) return '';
  s = s.replace(/^\+91/, '').replace(/^91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(s) ? s : String(v ?? '').trim();
}

export function gstin(v) {
  const s = String(v ?? '').trim().toUpperCase();
  if (!s) return null;
  if (!GSTIN_RE.test(s)) return 'Enter a valid GSTIN (e.g. 27AAPFU0939F1ZV)';
  return null;
}

export function pincode(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!/^[1-9][0-9]{5}$/.test(s)) return 'Enter a valid 6-digit pincode';
  return null;
}

// positive number; optional { min, max } bounds (inclusive). Empty fails —
// callers who want an optional numeric field should guard before calling.
export function positiveNumber(v, label = 'This field', { min, max } = {}) {
  const s = String(v ?? '').trim();
  if (!s) return `${label} is required`;
  const n = Number(s);
  if (!Number.isFinite(n)) return `${label} must be a number`;
  if (n <= 0) return `${label} must be greater than 0`;
  if (min != null && n < min) return `${label} must be at least ${min}`;
  if (max != null && n > max) return `${label} must be at most ${max}`;
  return null;
}

// GST rate: 0–28 inclusive, up to 2 decimals. 0 itself is valid; empty is
// allowed (pair with required() when the field is mandatory).
export function gstRate(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(s)) return 'GST rate must be a number with up to 2 decimals';
  const n = Number(s);
  if (n < 0 || n > 28) return 'GST rate must be between 0 and 28';
  return null;
}

// HSN code: empty allowed, else 4 / 6 / 8 digits.
export function hsn(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!/^\d{4}$|^\d{6}$|^\d{8}$/.test(s)) return 'HSN code must be 4, 6 or 8 digits';
  return null;
}

export function passwordStrong(v) {
  const s = String(v ?? '');
  if (!s) return null;
  if (s.length < 8) return 'Password must be at least 8 characters';
  if (!/[a-zA-Z]/.test(s) || !/\d/.test(s)) return 'Password must contain at least one letter and one number';
  return null;
}

// schema = { field: (value, allValues) => errorStringOrNull }
export function validateAll(values, schema) {
  const errors = {};
  for (const [field, fn] of Object.entries(schema || {})) {
    if (typeof fn !== 'function') continue;
    const msg = fn(values?.[field], values);
    if (msg) errors[field] = msg;
  }
  return { errors, ok: Object.keys(errors).length === 0 };
}

export const validators = {
  required,
  email,
  phone10,
  normalizePhone,
  gstin,
  pincode,
  positiveNumber,
  gstRate,
  hsn,
  passwordStrong,
  validateAll,
};

export default validators;
