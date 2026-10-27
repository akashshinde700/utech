import { describe, it, expect } from 'vitest';
import { quantity } from '../../src/lib/format';
import { hasPermission, allowedKinds, writablePartyTypes } from '../../src/lib/permissions';
import {
  required, email, phone10, normalizePhone, gstin, pincode,
  positiveNumber, gstRate, hsn, passwordStrong, validateAll,
} from '../../src/lib/validation';

describe('permissions.hasPermission', () => {
  it('fails closed when the profile carries no permissions at all', () => {
    expect(hasPermission({ role: 'MANAGER' }, 'invoice.read')).toBe(false);
    expect(hasPermission({ role: 'MANAGER', permissions: [] }, 'invoice.read')).toBe(false);
    expect(hasPermission(null, 'invoice.read')).toBe(false);
  });

  it('grants when the key is present', () => {
    expect(hasPermission({ role: 'MANAGER', permissions: ['invoice.read'] }, 'invoice.read')).toBe(true);
    expect(hasPermission({ role: 'MANAGER', permissions: ['invoice.read'] }, 'invoice.delete')).toBe(false);
  });

  it('lets SUPERADMIN bypass, matching the backend middleware', () => {
    expect(hasPermission({ role: 'SUPERADMIN' }, 'anything.atAll')).toBe(true);
    expect(hasPermission({ role: { name: 'SUPERADMIN' } }, 'anything.atAll')).toBe(true);
  });
});

describe('permissions.allowedKinds / writablePartyTypes', () => {
  const u = (permissions) => ({ role: 'MANAGER', permissions });

  it('separates customer and vendor read access', () => {
    expect(allowedKinds(u(['customerParty.read']), 'Party', 'read')).toEqual(['CUSTOMER']);
    expect(allowedKinds(u(['vendorParty.read']), 'Party', 'read')).toEqual(['VENDOR']);
  });

  it('offers BOTH only when the user can write both sides', () => {
    expect(writablePartyTypes(u(['customerParty.create']), 'create')).toEqual(['CUSTOMER']);
    expect(writablePartyTypes(u(['customerParty.create', 'vendorParty.create']), 'create')).toEqual([
      'CUSTOMER', 'VENDOR', 'BOTH',
    ]);
  });
});

describe('validation.required', () => {
  it('rejects empty, whitespace-only, null and undefined', () => {
    for (const v of ['', '   ', null, undefined]) {
      expect(required(v, 'Name'), JSON.stringify(v)).toBeTruthy();
    }
  });
  it('accepts any non-empty value', () => {
    expect(required('x')).toBeNull();
    expect(required(0)).toBeNull();
  });
});

describe('validation.email', () => {
  it('accepts valid addresses and trims whitespace', () => {
    expect(email('a@b.co')).toBeNull();
    expect(email('  first.last+tag@sub.example.com  ')).toBeNull();
  });
  it('rejects malformed addresses', () => {
    for (const v of ['nope', 'a@b', '@b.co', 'a b@c.co', 'a@b@c.co']) {
      expect(email(v), v).toBeTruthy();
    }
  });
  it('treats empty as valid so it can be paired with required()', () => {
    expect(email('')).toBeNull();
  });
});

describe('validation.phone10 + normalizePhone', () => {
  it('accepts Indian mobiles with common prefixes and separators', () => {
    for (const v of ['9876543210', '+91 98765 43210', '91-9876543210', '09876543210']) {
      expect(phone10(v), v).toBeNull();
    }
  });
  it('rejects numbers that are not a valid 10-digit Indian mobile', () => {
    for (const v of ['1234567890', '987654321', '98765432100', 'abcdefghij']) {
      expect(phone10(v), v).toBeTruthy();
    }
  });
  it('normalizes to bare 10 digits before the value is sent to the API', () => {
    expect(normalizePhone('+91 98765-43210')).toBe('9876543210');
    expect(normalizePhone('09876543210')).toBe('9876543210');
    expect(normalizePhone('')).toBe('');
  });
});

describe('validation.gstin / pincode / hsn', () => {
  it('accepts a valid GSTIN case-insensitively', () => {
    expect(gstin('27AAPFU0939F1ZV')).toBeNull();
    expect(gstin('27aapfu0939f1zv')).toBeNull();
  });
  it('rejects a malformed GSTIN', () => {
    expect(gstin('27AAPFU0939F1Y5')).toBeTruthy();
    expect(gstin('12345')).toBeTruthy();
  });
  it('rejects a pincode that starts with 0 or is the wrong length', () => {
    expect(pincode('411018')).toBeNull();
    expect(pincode('011018')).toBeTruthy();
    expect(pincode('41101')).toBeTruthy();
  });
  it('accepts 4/6/8-digit HSN codes only', () => {
    expect(hsn('8471')).toBeNull();
    expect(hsn('847130')).toBeNull();
    expect(hsn('84713010')).toBeNull();
    expect(hsn('84713')).toBeTruthy();
  });
});

describe('validation.positiveNumber', () => {
  it('rejects empty, non-numeric, zero and negative', () => {
    expect(positiveNumber('', 'Qty')).toMatch(/required/);
    expect(positiveNumber('abc', 'Qty')).toMatch(/must be a number/);
    expect(positiveNumber('0', 'Qty')).toMatch(/greater than 0/);
    expect(positiveNumber('-4', 'Qty')).toMatch(/greater than 0/);
  });
  it('enforces inclusive min/max bounds', () => {
    expect(positiveNumber('5', 'Qty', { min: 5 })).toBeNull();
    expect(positiveNumber('4', 'Qty', { min: 5 })).toBeTruthy();
    expect(positiveNumber('10', 'Qty', { max: 10 })).toBeNull();
    expect(positiveNumber('11', 'Qty', { max: 10 })).toBeTruthy();
  });
});

describe('validation.gstRate', () => {
  it('allows 0 and the real Indian slabs', () => {
    for (const v of ['0', '5', '12', '18', '28']) expect(gstRate(v), v).toBeNull();
  });
  it('rejects out-of-range and over-precise values', () => {
    expect(gstRate('29')).toBeTruthy();
    expect(gstRate('-1')).toBeTruthy();
    expect(gstRate('18.123')).toBeTruthy();
  });
});

describe('validation.passwordStrong', () => {
  it('requires 8+ characters with a letter and a digit', () => {
    expect(passwordStrong('Abcdefg1')).toBeNull();
    expect(passwordStrong('Abc1')).toBeTruthy();
    expect(passwordStrong('abcdefgh')).toBeTruthy();
    expect(passwordStrong('12345678')).toBeTruthy();
  });
});

describe('validation.validateAll', () => {
  it('collects every field error and reports ok only when there are none', () => {
    const schema = {
      name: (v) => required(v, 'Name'),
      email: (v) => email(v),
      qty: (v) => positiveNumber(v, 'Qty'),
    };
    const bad = validateAll({ name: '', email: 'nope', qty: '0' }, schema);
    expect(bad.ok).toBe(false);
    expect(Object.keys(bad.errors).sort()).toEqual(['email', 'name', 'qty']);

    const good = validateAll({ name: 'Acme', email: 'a@b.co', qty: '3' }, schema);
    expect(good.ok).toBe(true);
    expect(good.errors).toEqual({});
  });

  it('passes all values to each validator so cross-field rules work', () => {
    const schema = {
      confirm: (v, all) => (v === all.password ? null : 'Passwords do not match'),
    };
    expect(validateAll({ password: 'x', confirm: 'y' }, schema).ok).toBe(false);
    expect(validateAll({ password: 'x', confirm: 'x' }, schema).ok).toBe(true);
  });
});


describe('inventory quantity formatting', () => {
  it('keeps millesimal balances visible', () => {
    expect(quantity(0.001)).toBe('0.001');
    expect(quantity(12.345)).toBe('12.345');
    expect(quantity(10)).toBe('10');
  });
});
