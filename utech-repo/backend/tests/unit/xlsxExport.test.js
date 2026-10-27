'use strict';

// AUD-213 — the Excel exports must not depend on the abandoned `xlsx`
// (SheetJS) npm package, which carries two unfixable high-severity advisories
// (prototype pollution + ReDoS) against every version published to the
// registry. The ERP only writes workbooks, so the vulnerable parser was pure
// attack surface; `utils/xlsx.js` builds them with exceljs instead.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { buildXlsx } = require('../../src/utils/xlsx');

describe('AUD-213 — audit-clean XLSX export', () => {
  it('builds a real .xlsx (zip container, not an error page)', async () => {
    const buffer = await buildXlsx([{
      name: 'Invoices',
      rows: [
        { Number: 'INV-1', Party: 'Acme', Total: 1180 },
        { Number: 'INV-2', Party: 'Globex', Total: 2360 },
      ],
    }]);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(500);
    // every xlsx is a zip: "PK\x03\x04"
    expect(buffer.subarray(0, 4).toString('binary')).toBe('PK\u0003\u0004');
  });

  it('handles an empty report without throwing', async () => {
    const buffer = await buildXlsx([{ name: 'Items', rows: [] }]);
    expect(buffer.length).toBeGreaterThan(100);
  });

  it('never emits an undefined/NaN cell (Excel refuses to open such files)', async () => {
    const buffer = await buildXlsx([{
      name: 'Ledger',
      rows: [{ Date: '01-01-2026', Balance: undefined, Qty: NaN, Note: null }],
    }]);
    const text = buffer.toString('binary');
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('undefined');
  });

  it('the source tree no longer imports the abandoned xlsx package', () => {
    const root = path.resolve(__dirname, '../../src');
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.js$/.test(entry.name) && /require\(['"]xlsx['"]\)/.test(fs.readFileSync(full, 'utf8'))) {
          offenders.push(full);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  it('package.json does not depend on xlsx', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
    expect(pkg.dependencies.xlsx).toBeUndefined();
    expect(pkg.devDependencies.xlsx).toBeUndefined();
  });
});
