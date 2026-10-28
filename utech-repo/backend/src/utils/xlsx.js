'use strict';

// Excel export helper.
//
// WHY THIS FILE EXISTS (AUD-211)
// The exports used the `xlsx` (SheetJS) npm package. That package is
// abandoned on npm — the project moved to its own CDN — and npm reports
// two permanent high-severity advisories against every published npm
// version (prototype pollution GHSA-4r6h-8v6p-xvw6, ReDoS
// GHSA-5pgg-2g8v-p4x9) with no fix available on the registry. The ERP only
// ever WRITES workbooks (it never parses an uploaded spreadsheet), so the
// vulnerable parser is pure attack surface. `exceljs` is maintained and
// audit-clean, so it replaces SheetJS for the write path.

const ExcelJS = require('exceljs');

// Spreadsheet formula injection: a text cell whose first non-space character
// is =, +, - or @ is evaluated as a formula by Excel/Sheets when the file is
// opened. Party names, descriptions and notes are user-entered, so an export
// is an exfiltration/calc-injection vector (e.g. a party named
// `=HYPERLINK(...)`). Prefixing with a single quote forces text treatment —
// spreadsheet apps hide the quote and show the original string.
function sanitizeCellString(value) {
  if (typeof value !== 'string') return value;
  const first = value.trimStart().charAt(0);
  if (first === '=' || first === '+' || first === '-' || first === '@') {
    return `'${value}`;
  }
  return value;
}

// A cell must never receive `undefined`/`NaN` — exceljs would emit an invalid
// cell, and Excel then refuses to open the whole workbook.
function toCellValue(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  return sanitizeCellString(value);
}

function sheetName(name) {
  const clean = String(name || 'Sheet').replace(/[\\/?*[\]:]/g, ' ').trim() || 'Sheet';
  return clean.slice(0, 31);
}

// rows: array of plain objects, keys become the header row (same contract the
// old `XLSX.utils.json_to_sheet` had).
function addRowsSheet(workbook, name, rows) {
  const worksheet = workbook.addWorksheet(sheetName(name));
  const list = Array.isArray(rows) ? rows : [];
  const columns = list.length ? Object.keys(list[0]) : [];

  worksheet.columns = columns.map((key) => ({
    header: key,
    key,
    width: Math.min(40, Math.max(12, String(key).length + 6)),
  }));
  worksheet.getRow(1).font = { bold: true };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const row of list) {
    const values = {};
    for (const key of columns) values[key] = toCellValue(row[key]);
    worksheet.addRow(values);
  }
  return worksheet;
}

// sheets: [{ name, rows }] — resolves to the .xlsx file bytes.
async function buildXlsx(sheets) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'UTech ERP';
  workbook.created = new Date();
  for (const sheet of sheets || []) {
    addRowsSheet(workbook, sheet.name, sheet.rows);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// Sends the workbook as a download and returns the byte length so callers can
// audit the export size.
async function sendXlsx(res, { filename, sheets, headers = {} }) {
  const buffer = await buildXlsx(sheets);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // A capped export must SAY it was capped: a silently truncated workbook is
  // indistinguishable from a complete one once it leaves the server, and the
  // totals in it then understate the business. Callers set these headers.
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && value !== null) res.setHeader(name, String(value));
  }
  res.send(buffer);
  return buffer.length;
}

module.exports = { buildXlsx, sendXlsx, sanitizeCellString };
