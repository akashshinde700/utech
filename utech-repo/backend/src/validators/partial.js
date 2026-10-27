'use strict';

// Update-payload helper.
//
// WHY THIS EXISTS (AUD-212)
// Zod v4 changed how `.partial()` interacts with `.default()`: a field that has
// a default now produces that default even when the client never sent the key.
// Every update endpoint in this API is written as "absent key = leave the stored
// value alone", so the new behaviour silently rewrote data — most visibly it
// resurrected AUD-201, where `operations: []` from a jobcard edit deleted every
// Task Progress item on the card.
//
// `partialNoDefaults()` strips the default wrapper from each field BEFORE making
// the object partial, so an omitted key stays `undefined` and the controller's
// `if (field !== undefined)` guard keeps working. Defaults still apply to create
// payloads, where they belong.

const { z } = require('zod');

function stripDefault(schema) {
  // ZodDefault exposes removeDefault() in v3.24+ and v4; older/other wrappers
  // simply pass through.
  return schema && typeof schema.removeDefault === 'function' ? schema.removeDefault() : schema;
}

function partialNoDefaults(schema) {
  const shape = schema.shape || {};
  const stripped = {};
  for (const [key, field] of Object.entries(shape)) stripped[key] = stripDefault(field);
  return z.object(stripped).partial();
}

module.exports = { partialNoDefaults, stripDefault };
