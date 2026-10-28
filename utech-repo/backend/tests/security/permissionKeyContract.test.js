'use strict';

// AUD-113. Roles are edited by ticking permission keys in the UI, and the keys
// come from the seed. 17 of the seeded keys gate nothing at all: the admin
// ticks "Stock -> Create" or "BOM -> Update" and nothing changes, which is a
// worse kind of wrong than a missing checkbox — it reads as a decision that
// was made and enforced.
//
// This test pins the exact list, for three reasons: it documents which keys are
// decorative, it fails if a NEW dead key is added, and it fails if one of these
// is wired up without the list being updated on purpose.
//
// None of the 17 leaves anything under-protected: every one of them names an
// action no endpoint performs. They are decorative, not dangerous.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const BACKEND = path.resolve(__dirname, '..', '..');

function seededKeys() {
  const seed = fs.readFileSync(path.join(BACKEND, 'prisma/seed.js'), 'utf8');
  const modules = [...seed.matchAll(/const MODULES = \[([\s\S]*?)\];/g)][0][1]
    .match(/'([^']+)'/g).map((s) => s.replace(/'/g, ''));
  const actionsBlock = [...seed.matchAll(/const ACTIONS = \[([\s\S]*?)\];/g)];
  const actions = actionsBlock.length
    ? actionsBlock[0][1].match(/'([^']+)'/g).map((s) => s.replace(/'/g, ''))
    : [];
  const explicit = [...seed.matchAll(/key: '([\w.]+)'/g)].map((m) => m[1]);
  return new Set([...modules.flatMap((m) => actions.map((a) => `${m}.${a}`)), ...explicit]);
}

function enforcedKeys() {
  const dir = path.join(BACKEND, 'src/routes');
  const keys = new Set();
  for (const file of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const call of src.matchAll(/requirePermission\(([^)]*)\)/g)) {
      for (const key of call[1].matchAll(/'([^']+)'/g)) keys.add(key[1]);
    }
  }
  return keys;
}

// Why each of these gates nothing today:
//
//   attachment.*        attachment routes take their permission from the
//                       document being attached to (assertRefPermission), so
//                       uploading to a job card needs jobcard.update
//   bom.*               the BOM routes are gated on item.* (see AUD-104)
//   report.create       exports are reads; there is no write endpoint
//   report.delete
//   stock.create        the only stock write is POST /adjust -> stock.adjust
//   stock.update
//   stock.delete
//   dispatch.delete     there is no DELETE route; a challan is cancelled
//                       through its status endpoint
//   customerMaterial.delete  same — a lot is disposed of, never deleted
//
//   assignment.delete        both DELETE routes call cancel(), not a delete:
//   vendorWorkOrder.delete   they move the record to CANCELLED and keep it, so
//                            .update is the right gate and these two keys stay
//                            reserved for a hard delete the API does not offer
const KNOWN_DEAD_KEYS = [
  'assignment.delete',
  'attachment.create',
  'attachment.delete',
  'attachment.read',
  'attachment.update',
  'bom.create',
  'bom.delete',
  'bom.read',
  'bom.update',
  'customerMaterial.delete',
  'dispatch.delete',
  'report.create',
  'report.delete',
  'stock.create',
  'stock.delete',
  'stock.update',
  'vendorWorkOrder.delete',
];

describe('every permission key the UI can grant', () => {
  const seeded = seededKeys();
  const enforced = enforcedKeys();

  it('is either enforced by a route or on the known-decorative list', () => {
    const dead = [...seeded].filter((k) => !enforced.has(k)).sort();
    expect(dead).toEqual(KNOWN_DEAD_KEYS);
  });

  it('covers every key the routes actually check', () => {
    // the mirror image: a route must never require a key no role can be
    // granted, which would lock the action away from everyone but SUPERADMIN
    const unseeded = [...enforced].filter((k) => !seeded.has(k)).sort();
    expect(unseeded).toEqual([]);
  });

  it('keeps the decorative list from growing', () => {
    expect(KNOWN_DEAD_KEYS).toHaveLength(17);
    expect(seeded.size).toBeGreaterThan(100);
  });
});
