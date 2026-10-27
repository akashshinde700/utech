'use strict';

// Unit tests for the request-parsing and progress helpers.

import { describe, it, expect } from 'vitest';
const { parseListQuery, paginated } = require('../../src/utils/pagination');
const { computeProgress, effectiveChecklist, validateChecklistPayload, CHECKLIST_ITEMS } = require('../../src/utils/jobcardProgress');
const { partyTypesFor, quotationTypesFor } = require('../../src/utils/typedAccess');

describe('pagination.parseListQuery', () => {
  it('applies sane defaults', () => {
    const p = parseListQuery({});
    expect(p).toMatchObject({ page: 1, pageSize: 10, skip: 0, take: 10, sortBy: 'createdAt', sortDir: 'desc' });
  });

  it('ignores non-numeric page and pageSize instead of poisoning skip/take', () => {
    const p = parseListQuery({ page: 'abc', pageSize: 'xyz' });
    expect(Number.isNaN(p.skip)).toBe(false);
    expect(p.page).toBe(1);
    expect(p.take).toBe(10);
  });

  it('clamps pageSize to 1..100 so a client cannot ask for the whole table', () => {
    expect(parseListQuery({ pageSize: '100000' }).take).toBe(100);
    expect(parseListQuery({ pageSize: '0' }).take).toBe(10);
    expect(parseListQuery({ pageSize: '-5' }).take).toBe(10);
    expect(parseListQuery({ pageSize: '50' }).take).toBe(50);
  });

  it('rejects negative and zero pages', () => {
    expect(parseListQuery({ page: '-3' }).skip).toBe(0);
    expect(parseListQuery({ page: '0' }).skip).toBe(0);
  });

  it('only allows sort columns the caller whitelisted', () => {
    const p = parseListQuery({ sortBy: 'passwordHash' }, ['createdAt', 'name']);
    expect(p.sortBy).toBe('createdAt');
    expect(parseListQuery({ sortBy: 'name' }, ['createdAt', 'name']).sortBy).toBe('name');
  });

  it('normalises sortDir to asc|desc only', () => {
    expect(parseListQuery({ sortDir: 'asc' }).sortDir).toBe('asc');
    expect(parseListQuery({ sortDir: 'DROP TABLE' }).sortDir).toBe('desc');
  });

  it('computes skip from page and pageSize', () => {
    expect(parseListQuery({ page: '4', pageSize: '25' }).skip).toBe(75);
  });

  it('trims the search term', () => {
    expect(parseListQuery({ q: '   pump  ' }).search).toBe('pump');
  });
});

describe('pagination.paginated', () => {
  it('reports total pages and never divides by zero', () => {
    expect(paginated([], 0, 1, 20).pagination).toEqual({ total: 0, page: 1, pageSize: 20, totalPages: 1 });
    expect(paginated([], 41, 3, 20).pagination.totalPages).toBe(3);
  });
});

describe('jobcardProgress.computeProgress', () => {
  it('uses real task progress once operations exist', () => {
    const jc = {
      operations: [
        { status: 'COMPLETED' },
        { status: 'IN_PROGRESS' },
        { status: 'PENDING' },
        { status: 'CANCELLED' },
      ],
    };
    // 1 of the 3 non-cancelled tasks is complete
    expect(computeProgress(jc)).toBe(33);
  });

  it('falls back to the checklist when there are no operations', () => {
    const checklist = CHECKLIST_ITEMS.map((i) => ({ ...i, done: false }));
    checklist[0].done = true;
    checklist[1].done = true;
    expect(computeProgress({ operations: [], checklist })).toBe(33);
  });

  it('falls back to workStatus when neither exists', () => {
    expect(computeProgress({ workStatus: 'NOT_STARTED' })).toBe(0);
    expect(computeProgress({ workStatus: 'IN_PROGRESS' })).toBe(33);
    expect(computeProgress({ workStatus: 'TESTING' })).toBe(66);
    expect(computeProgress({ workStatus: 'COMPLETED' })).toBe(100);
    expect(computeProgress({})).toBe(0);
  });

  it('supplies the default 6-item checklist when the JSON column is null', () => {
    const cl = effectiveChecklist({ checklist: null });
    expect(cl).toHaveLength(6);
    expect(cl.every((i) => i.done === false)).toBe(true);
  });
});

describe('jobcardProgress.validateChecklistPayload', () => {
  const good = CHECKLIST_ITEMS.map((i) => ({ ...i, done: false }));

  it('accepts exactly the fixed checklist', () => {
    expect(validateChecklistPayload(good)).toBe(true);
  });

  it('rejects a different key set', () => {
    expect(validateChecklistPayload(good.slice(0, 5))).toBe(false);
    expect(validateChecklistPayload([...good, { key: 'extra', label: 'Extra', done: false }])).toBe(false);
  });

  it('rejects non-boolean done flags (a string would silently count as unchecked)', () => {
    const bad = good.map((i, idx) => (idx === 0 ? { ...i, done: 'yes' } : i));
    expect(validateChecklistPayload(bad)).toBe(false);
  });

  it('rejects non-arrays', () => {
    expect(validateChecklistPayload(null)).toBe(false);
    expect(validateChecklistPayload('nope')).toBe(false);
  });
});

describe('typedAccess — customer/vendor permission pairs', () => {
  const req = (permissions, role = 'MANAGER') => ({ user: { role, permissions } });

  it('reads BOTH parties with either side permission', () => {
    expect(partyTypesFor(req(['customerParty.read']), 'read')).toEqual(['CUSTOMER', 'BOTH']);
    expect(partyTypesFor(req(['vendorParty.read']), 'read')).toEqual(['VENDOR', 'BOTH']);
    expect(partyTypesFor(req(['customerParty.read', 'vendorParty.read']), 'read')).toEqual(['CUSTOMER', 'VENDOR', 'BOTH']);
  });

  it('writes BOTH parties only with BOTH side permissions', () => {
    expect(partyTypesFor(req(['customerParty.create']), 'create')).toEqual(['CUSTOMER']);
    expect(partyTypesFor(req(['customerParty.create', 'vendorParty.create']), 'create')).toEqual([
      'CUSTOMER', 'VENDOR', 'BOTH',
    ]);
  });

  it('gives SUPERADMIN everything', () => {
    expect(partyTypesFor(req([], 'SUPERADMIN'), 'delete')).toEqual(['CUSTOMER', 'VENDOR', 'BOTH']);
  });

  it('keeps customer and vendor quotations separate', () => {
    expect(quotationTypesFor(req(['customerQuotation.read']), 'read')).toEqual(['CUSTOMER']);
    expect(quotationTypesFor(req(['vendorQuotation.update']), 'update')).toEqual(['VENDOR']);
    expect(quotationTypesFor(req([]), 'read')).toEqual([]);
  });
});
