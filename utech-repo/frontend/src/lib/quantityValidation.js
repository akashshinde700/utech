import Decimal from 'decimal.js';
import { positiveNumber } from './validation';

export function numericPrecision(value, label, places, maximum) {
  if (String(value ?? '').trim() === '' || !Number.isFinite(Number(value))) return null;
  const number = new Decimal(String(value).trim());
  if (number.decimalPlaces() > places) return `${label} must have at most ${places} decimal places`;
  if (number.greaterThan(maximum)) return `${label} exceeds the supported limit`;
  return null;
}

// Values saved in customer-material/stock DECIMAL(14,3) columns.
export function trackedQuantity(value, label = 'Quantity', { optional = false } = {}) {
  if (optional && String(value ?? '').trim() === '') return null;
  return positiveNumber(value, label) || numericPrecision(value, label, 3, '99999999999.999');
}
