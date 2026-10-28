import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { lineHasContent, linesToSave } from '../../src/lib/jobcardLines';

// A job-card save was coming back 400 with nothing highlighted on the form.
// The form decided which lines to VALIDATE with a predicate whose quantity
// clause was inverted ("in play if the quantity is empty"), while the payload
// sent every row. A row holding only a quantity therefore skipped validation
// and was sent — and a quantity of 0, or a typo like "1o", is rejected by the
// API's own line schema (`qty: z.number().positive()`), which is correct of the
// API and useless to the person looking at the screen.

const FRONTEND = path.resolve(__dirname, '..', '..');
const line = (over = {}) => ({ itemId: null, itemName: '', qty: '', uomCode: '', notes: '', ...over });

describe('does this line hold anything', () => {
  it('an untouched row holds nothing', () => {
    expect(lineHasContent(line())).toBe(false);
    expect(lineHasContent({})).toBe(false);
    expect(lineHasContent(line({ itemName: '   ', notes: '  ' }))).toBe(false);
  });

  it('a typed quantity counts — this is the clause that was inverted', () => {
    expect(lineHasContent(line({ qty: '5' }))).toBe(true);
    expect(lineHasContent(line({ qty: 5 }))).toBe(true);
    // the values that made the API answer 400: they must be IN play, so the
    // form validates them and says which field is wrong
    expect(lineHasContent(line({ qty: '0' }))).toBe(true);
    expect(lineHasContent(line({ qty: 0 }))).toBe(true);
    expect(lineHasContent(line({ qty: '1o' }))).toBe(true);
    expect(lineHasContent(line({ qty: '-2' }))).toBe(true);
  });

  it('any other field counts too', () => {
    expect(lineHasContent(line({ itemId: 7 }))).toBe(true);
    expect(lineHasContent(line({ itemName: 'Bracket' }))).toBe(true);
    expect(lineHasContent(line({ uomCode: 'PCS' }))).toBe(true);
    expect(lineHasContent(line({ notes: 'as per drawing' }))).toBe(true);
  });
});

describe('which lines get sent', () => {
  it('drops a row nobody touched, so an accidental Add line cannot block the save', () => {
    expect(linesToSave([line({ itemId: 3, qty: 2 }), line()])).toEqual([line({ itemId: 3, qty: 2 })]);
  });

  it('keeps a row that is already saved even when it has been cleared', () => {
    // the update applies the array as the COMPLETE list of lines, so leaving a
    // saved line out deletes it — that has to stay the user's explicit action
    const existing = line({ id: 11 });
    expect(linesToSave([existing])).toEqual([existing]);
  });

  it('keeps everything that holds content', () => {
    const rows = [line({ itemId: 1, qty: 1 }), line({ qty: '0' }), line({ notes: 'x' })];
    expect(linesToSave(rows)).toEqual(rows);
  });

  it('survives an empty list', () => {
    expect(linesToSave()).toEqual([]);
    expect(linesToSave([])).toEqual([]);
  });
});

describe('the form uses these, and not its own copy of the rule', () => {
  const src = fs.readFileSync(path.join(FRONTEND, 'src/pages/jobcards/JobcardForm.jsx'), 'utf8');

  it('imports them instead of redefining the predicate', () => {
    expect(src).toMatch(/import \{ lineHasContent, linesToSave \} from '\.\.\/\.\.\/lib\/jobcardLines'/);
    expect(src).not.toMatch(/const lineInPlay/);
  });

  it('validates the same rows it sends', () => {
    expect(src).toMatch(/if \(!lineHasContent\(l\)\) return;/);
    expect(src).toMatch(/lines: linesToSave\(form\.lines\)\.map\(/);
  });
});
