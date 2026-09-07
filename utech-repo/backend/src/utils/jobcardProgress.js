'use strict';

const CHECKLIST_ITEMS = [
  { key: 'material', label: 'Material Ready' },
  { key: 'drawing', label: 'Drawing Approved' },
  { key: 'production', label: 'Production Started' },
  { key: 'quality', label: 'Quality Check Done' },
  { key: 'packing', label: 'Packing Done' },
  { key: 'dispatch', label: 'Dispatched' },
];
const CHECKLIST_KEYS = CHECKLIST_ITEMS.map((i) => i.key);

const WORK_STATUS_PROGRESS = {
  NOT_STARTED: 0,
  IN_PROGRESS: 33,
  TESTING: 66,
  COMPLETED: 100,
};

// jc.checklist may be null (never set) — supply the fixed default so callers
// always get a full 6-item array back.
function effectiveChecklist(jc) {
  if (Array.isArray(jc.checklist) && jc.checklist.length) return jc.checklist;
  return CHECKLIST_ITEMS.map((i) => ({ ...i, done: false }));
}

function computeProgress(jc) {
  const checklist = effectiveChecklist(jc);
  const checked = checklist.filter((i) => i.done).length;
  if (checked > 0) return Math.round((checked / checklist.length) * 100);
  return WORK_STATUS_PROGRESS[jc.workStatus] ?? 0;
}

// Rejects any payload whose key-set doesn't exactly match the fixed checklist —
// the JSON column is flexible in the DB, but the app only ever accepts this set.
function validateChecklistPayload(arr) {
  if (!Array.isArray(arr)) return false;
  if (arr.length !== CHECKLIST_KEYS.length) return false;
  const keys = arr.map((i) => i && i.key).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...CHECKLIST_KEYS].sort())) return false;
  return arr.every((i) => typeof i.done === 'boolean' && typeof i.label === 'string');
}

module.exports = { CHECKLIST_ITEMS, effectiveChecklist, computeProgress, validateChecklistPayload };
