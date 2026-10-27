'use strict';

const fs = require('fs');
const path = require('path');

function toCamel(PascalName) {
  return PascalName.charAt(0).toLowerCase() + PascalName.slice(1);
}

function parseSchema(schemaText) {
  const modelBlocks = [...schemaText.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)];
  const modelNames = new Set(modelBlocks.map((m) => m[1]));
  const models = {};
  const byDelegate = {};

  for (const [, name, body] of modelBlocks) {
    const fields = {};
    const uniques = [];
    let idField = 'id';

    for (const rawLine of body.split('\n')) {
      const line = rawLine.replace(/\/\/.*$/, '').trim();
      if (!line) continue;
      if (line.startsWith('@@unique')) {
        const m = line.match(/@@unique\(\[([^\]]+)\]/);
        if (m) {
          const cols = m[1].split(',').map((s) => s.trim());
          uniques.push({ name: cols.join('_'), fields: cols });
        }
        continue;
      }
      if (line.startsWith('@@')) continue;
      const m = line.match(/^(\w+)\s+(\w+)(\[\]|\?)?(.*)$/);
      if (!m) continue;
      const [, fName, fType, mod, rest] = m;
      const isList = mod === '[]';
      const isOptional = mod === '?';
      const isModel = modelNames.has(fType);
      const isId = /@id\b/.test(rest);
      if (isId) idField = fName;
      const isUpdatedAt = /@updatedAt\b/.test(rest);
      const isAutoIncrement = /@default\(autoincrement\(\)\)/.test(rest);

      let defaultVal = undefined;
      let hasDefault = false;
      const defMatch = rest.match(/@default\((autoincrement\(\)|now\(\)|[^)]+)\)/);
      if (defMatch) {
        const rawDef = defMatch[1].trim();
        if (rawDef === 'autoincrement()') {
          // handled separately
        } else if (rawDef === 'now()') {
          hasDefault = true;
          defaultVal = () => new Date();
        } else if (rawDef === 'true') {
          hasDefault = true;
          defaultVal = () => true;
        } else if (rawDef === 'false') {
          hasDefault = true;
          defaultVal = () => false;
        } else if (/^-?\d+(\.\d+)?$/.test(rawDef)) {
          hasDefault = true;
          const num = Number(rawDef);
          defaultVal = () => num;
        } else if (rawDef.startsWith('"') && rawDef.endsWith('"')) {
          hasDefault = true;
          const str = rawDef.slice(1, -1);
          defaultVal = () => str;
        } else {
          // Enum value
          hasDefault = true;
          defaultVal = () => rawDef;
        }
      }

      let relName = null;
      let fkFields = null;
      let refFields = null;
      let onDelete = null;
      const relMatch = rest.match(/@relation\(([^)]*)\)/);
      if (relMatch) {
        const args = relMatch[1];
        const nameM = args.match(/(?:name:\s*)?"([^"]+)"/);
        if (nameM) relName = nameM[1];
        const fkM = args.match(/fields:\s*\[([^\]]+)\]/);
        if (fkM) fkFields = fkM[1].split(',').map((s) => s.trim());
        const refM = args.match(/references:\s*\[([^\]]+)\]/);
        if (refM) refFields = refM[1].split(',').map((s) => s.trim());
        const delM = args.match(/onDelete:\s*(\w+)/);
        if (delM) onDelete = delM[1];
      }

      if (/@unique\b/.test(rest)) {
        uniques.push({ name: fName, fields: [fName] });
      }

      fields[fName] = {
        name: fName,
        type: fType,
        isList,
        isOptional,
        isModel,
        isId,
        isUpdatedAt,
        isAutoIncrement,
        hasDefault,
        defaultVal,
        relName,
        fkFields,
        refFields,
        onDelete,
      };
    }

    const delegate = toCamel(name);
    const meta = { name, delegate, idField, fields, uniques };
    models[name] = meta;
    byDelegate[delegate] = meta;
  }

  // Pair inverse relations
  for (const m of Object.values(models)) {
    for (const f of Object.values(m.fields)) {
      if (!f.isModel) continue;
      if (f.fkFields) {
        f.relKind = 'owning'; // many-to-one or owning one-to-one
        continue;
      }
      const target = models[f.type];
      const candidates = Object.values(target.fields).filter(
        (tf) =>
          tf.isModel &&
          tf.type === m.name &&
          tf.fkFields &&
          (f.relName ? tf.relName === f.relName : !tf.relName)
      );
      if (candidates.length === 1) {
        f.relKind = 'inverse';
        f.inverseField = candidates[0].name;
        f.inverseFkFields = candidates[0].fkFields;
        f.inverseRefFields = candidates[0].refFields;
      }
    }
  }

  return { models, byDelegate };
}

function coerceScalar(val, fieldMeta) {
  if (val === undefined) return undefined;
  if (val === null) return null;
  if (!fieldMeta) return val;
  if (fieldMeta.type === 'DateTime') {
    return val instanceof Date ? val : new Date(val);
  }
  if (fieldMeta.type === 'Int') {
    const n = typeof val === 'number' ? val : parseInt(val, 10);
    return Number.isNaN(n) ? val : n;
  }
  if (fieldMeta.type === 'Float' || fieldMeta.type === 'Decimal') {
    const n = typeof val === 'number' ? val : Number(val);
    return Number.isNaN(n) ? val : n;
  }
  if (fieldMeta.type === 'Boolean') {
    return Boolean(val);
  }
  return val;
}

function toComparable(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return v;
}

function createInMemoryPrisma(schemaPath) {
  const resolvedPath = schemaPath || path.resolve(__dirname, '../../prisma/schema.prisma');
  const schemaText = fs.readFileSync(resolvedPath, 'utf8');
  const { models, byDelegate } = parseSchema(schemaText);

  // tables[modelName] = Array of row objects
  const tables = {};
  const sequences = {};
  for (const m of Object.keys(models)) {
    tables[m] = [];
    sequences[m] = 0;
  }

  function cloneRow(row) {
    if (!row) return row;
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      out[k] = v instanceof Date ? new Date(v.getTime()) : v;
    }
    return out;
  }

  function snapshotState() {
    const snapTables = {};
    for (const [m, rows] of Object.entries(tables)) {
      snapTables[m] = rows.map(cloneRow);
    }
    const snapSeq = { ...sequences };
    return { snapTables, snapSeq };
  }

  function restoreState({ snapTables, snapSeq }) {
    for (const m of Object.keys(models)) {
      tables[m] = snapTables[m] || [];
      sequences[m] = snapSeq[m] || 0;
    }
  }

  function matchesScalar(actual, cond) {
    if (cond === null || typeof cond !== 'object' || cond instanceof Date) {
      if (actual instanceof Date && cond instanceof Date) {
        return actual.getTime() === cond.getTime();
      }
      if (actual instanceof Date && typeof cond === 'string') {
        return actual.getTime() === new Date(cond).getTime();
      }
      return actual === cond;
    }

    for (const [op, expected] of Object.entries(cond)) {
      if (expected === undefined) continue;
      switch (op) {
        case 'equals':
          if (!matchesScalar(actual, expected)) return false;
          break;
        case 'not':
          if (matchesScalar(actual, expected)) return false;
          break;
        case 'in': {
          if (!Array.isArray(expected)) return false;
          if (!expected.some((item) => matchesScalar(actual, item))) return false;
          break;
        }
        case 'notIn': {
          if (!Array.isArray(expected)) return false;
          if (expected.some((item) => matchesScalar(actual, item))) return false;
          break;
        }
        case 'lt':
          if (actual == null || !(toComparable(actual) < toComparable(expected))) return false;
          break;
        case 'lte':
          if (actual == null || !(toComparable(actual) <= toComparable(expected))) return false;
          break;
        case 'gt':
          if (actual == null || !(toComparable(actual) > toComparable(expected))) return false;
          break;
        case 'gte':
          if (actual == null || !(toComparable(actual) >= toComparable(expected))) return false;
          break;
        case 'contains':
          if (typeof actual !== 'string' || !actual.toLowerCase().includes(String(expected).toLowerCase())) {
            return false;
          }
          break;
        case 'startsWith':
          if (typeof actual !== 'string' || !actual.toLowerCase().startsWith(String(expected).toLowerCase())) {
            return false;
          }
          break;
        case 'endsWith':
          if (typeof actual !== 'string' || !actual.toLowerCase().endsWith(String(expected).toLowerCase())) {
            return false;
          }
          break;
        default:
          break;
      }
    }
    return true;
  }

  function resolveRelated(modelMeta, row, fieldMeta) {
    const targetRows = tables[fieldMeta.type] || [];
    if (fieldMeta.relKind === 'owning') {
      const fk = fieldMeta.fkFields[0];
      const ref = fieldMeta.refFields[0];
      const fkVal = row[fk];
      if (fkVal == null) return null;
      return targetRows.find((r) => r[ref] === fkVal) || null;
    }
    if (fieldMeta.relKind === 'inverse') {
      const fk = fieldMeta.inverseFkFields[0];
      const ref = fieldMeta.inverseRefFields[0];
      const refVal = row[ref];
      const matches = targetRows.filter((r) => r[fk] === refVal);
      return fieldMeta.isList ? matches : matches[0] || null;
    }
    return fieldMeta.isList ? [] : null;
  }

  function matchesWhere(modelMeta, row, where) {
    if (!where || typeof where !== 'object') return true;

    for (const [key, cond] of Object.entries(where)) {
      if (cond === undefined) continue;
      if (key === 'AND') {
        const list = Array.isArray(cond) ? cond : [cond];
        if (!list.every((sub) => matchesWhere(modelMeta, row, sub))) return false;
        continue;
      }
      if (key === 'OR') {
        const list = Array.isArray(cond) ? cond : [cond];
        if (list.length === 0) return false;
        if (!list.some((sub) => matchesWhere(modelMeta, row, sub))) return false;
        continue;
      }
      if (key === 'NOT') {
        const list = Array.isArray(cond) ? cond : [cond];
        if (list.some((sub) => matchesWhere(modelMeta, row, sub))) return false;
        continue;
      }

      // Check compound unique key e.g. roleId_permissionId: { roleId: 1, permissionId: 2 }
      const compoundUnique = modelMeta.uniques.find((u) => u.fields.length > 1 && u.name === key);
      if (compoundUnique && cond && typeof cond === 'object') {
        if (!compoundUnique.fields.every((f) => matchesScalar(row[f], cond[f]))) return false;
        continue;
      }

      const fieldMeta = modelMeta.fields[key];
      if (fieldMeta && fieldMeta.isModel) {
        const targetMeta = models[fieldMeta.type];
        const related = resolveRelated(modelMeta, row, fieldMeta);
        if (fieldMeta.isList) {
          const list = related || [];
          if (cond.some !== undefined) {
            if (!list.some((r) => matchesWhere(targetMeta, r, cond.some))) return false;
          }
          if (cond.every !== undefined) {
            if (!list.every((r) => matchesWhere(targetMeta, r, cond.every))) return false;
          }
          if (cond.none !== undefined) {
            if (list.some((r) => matchesWhere(targetMeta, r, cond.none))) return false;
          }
        } else {
          if (cond === null) {
            if (related !== null) return false;
          } else if (cond && typeof cond === 'object') {
            if ('is' in cond) {
              if (cond.is === null) {
                if (related !== null) return false;
              } else if (!related || !matchesWhere(targetMeta, related, cond.is)) {
                return false;
              }
            } else if ('isNot' in cond) {
              if (cond.isNot === null) {
                if (related === null) return false;
              } else if (related && matchesWhere(targetMeta, related, cond.isNot)) {
                return false;
              }
            } else {
              if (!related || !matchesWhere(targetMeta, related, cond)) return false;
            }
          }
        }
        continue;
      }

      if (!matchesScalar(row[key], cond)) return false;
    }
    return true;
  }

  function sortRows(modelMeta, rows, orderBy) {
    if (!orderBy) return rows;
    const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
    if (specs.length === 0) return rows;
    return rows.slice().sort((a, b) => {
      for (const spec of specs) {
        if (!spec || typeof spec !== 'object') continue;
        const [field, dirOrNested] = Object.entries(spec)[0] || [];
        if (!field) continue;
        let va;
        let vb;
        let dir = 'asc';
        const fMeta = modelMeta.fields[field];
        if (fMeta && fMeta.isModel && dirOrNested && typeof dirOrNested === 'object') {
          const [subField, subDir] = Object.entries(dirOrNested)[0] || [];
          dir = String(subDir || 'asc').toLowerCase();
          const relA = resolveRelated(modelMeta, a, fMeta);
          const relB = resolveRelated(modelMeta, b, fMeta);
          va = relA ? relA[subField] : null;
          vb = relB ? relB[subField] : null;
        } else {
          dir = String(dirOrNested || 'asc').toLowerCase();
          va = a[field];
          vb = b[field];
        }
        const ca = toComparable(va);
        const cb = toComparable(vb);
        if (ca === cb) continue;
        if (ca == null) return dir === 'asc' ? -1 : 1;
        if (cb == null) return dir === 'asc' ? 1 : -1;
        if (ca < cb) return dir === 'asc' ? -1 : 1;
        if (ca > cb) return dir === 'asc' ? 1 : -1;
      }
      return 0;
    });
  }

  function shapeRow(modelMeta, row, args = {}) {
    if (!row) return null;
    const { include, select } = args;

    if (select) {
      const out = {};
      for (const [k, v] of Object.entries(select)) {
        if (!v) continue;
        if (k === '_count') {
          out._count = computeCountField(modelMeta, row, v);
          continue;
        }
        const fMeta = modelMeta.fields[k];
        if (fMeta && fMeta.isModel) {
          out[k] = resolveRelationProjection(modelMeta, row, fMeta, typeof v === 'object' ? v : {});
        } else {
          out[k] = row[k] instanceof Date ? new Date(row[k].getTime()) : row[k];
        }
      }
      return out;
    }

    const out = cloneRow(row);
    if (include) {
      for (const [k, v] of Object.entries(include)) {
        if (!v) continue;
        if (k === '_count') {
          out._count = computeCountField(modelMeta, row, v);
          continue;
        }
        const fMeta = modelMeta.fields[k];
        if (fMeta && fMeta.isModel) {
          out[k] = resolveRelationProjection(modelMeta, row, fMeta, typeof v === 'object' ? v : {});
        }
      }
    }
    return out;
  }

  function computeCountField(modelMeta, row, countSpec) {
    const out = {};
    const sel = countSpec && typeof countSpec === 'object' && countSpec.select ? countSpec.select : countSpec;
    if (!sel || typeof sel !== 'object') return out;
    for (const [relName, enabled] of Object.entries(sel)) {
      if (!enabled) continue;
      const fMeta = modelMeta.fields[relName];
      if (!fMeta || !fMeta.isModel) {
        out[relName] = 0;
        continue;
      }
      const related = resolveRelated(modelMeta, row, fMeta);
      if (Array.isArray(related)) {
        if (typeof enabled === 'object' && enabled.where) {
          const targetMeta = models[fMeta.type];
          out[relName] = related.filter((r) => matchesWhere(targetMeta, r, enabled.where)).length;
        } else {
          out[relName] = related.length;
        }
      } else {
        out[relName] = related ? 1 : 0;
      }
    }
    return out;
  }

  function resolveRelationProjection(modelMeta, row, fMeta, subArgs = {}) {
    const targetMeta = models[fMeta.type];
    const related = resolveRelated(modelMeta, row, fMeta);
    if (fMeta.isList) {
      let list = related || [];
      if (subArgs.where) {
        list = list.filter((r) => matchesWhere(targetMeta, r, subArgs.where));
      }
      if (subArgs.orderBy) {
        list = sortRows(targetMeta, list, subArgs.orderBy);
      }
      if (typeof subArgs.skip === 'number') list = list.slice(subArgs.skip);
      if (typeof subArgs.take === 'number') list = list.slice(0, subArgs.take);
      return list.map((r) => shapeRow(targetMeta, r, subArgs));
    }
    if (!related) return null;
    return shapeRow(targetMeta, related, subArgs);
  }

  function checkUniqueConstraints(modelMeta, candidate, excludeId = undefined) {
    const rows = tables[modelMeta.name];
    // check @id
    const idField = modelMeta.idField;
    if (candidate[idField] !== undefined) {
      const clash = rows.find((r) => r[idField] !== excludeId && r[idField] === candidate[idField]);
      if (clash) {
        const err = new Error(`Unique constraint failed on the fields: (\`${idField}\`)`);
        err.code = 'P2002';
        err.meta = { target: [idField] };
        throw err;
      }
    }
    for (const u of modelMeta.uniques) {
      // In SQL/Prisma, NULL values in nullable unique columns do not conflict
      if (u.fields.some((f) => candidate[f] == null)) continue;
      const clash = rows.find(
        (r) =>
          (excludeId === undefined || r[idField] !== excludeId) &&
          u.fields.every((f) => r[f] === candidate[f])
      );
      if (clash) {
        const err = new Error(`Unique constraint failed on the fields: (${u.fields.join(', ')})`);
        err.code = 'P2002';
        err.meta = { target: u.fields };
        throw err;
      }
    }
  }

  function insertRow(modelMeta, data = {}) {
    const row = {};
    const nestedWrites = [];

    // Handle parent relation connect first
    for (const [k, v] of Object.entries(data)) {
      const fMeta = modelMeta.fields[k];
      if (fMeta && fMeta.isModel) {
        if (fMeta.relKind === 'owning' && v && typeof v === 'object' && v.connect) {
          const fk = fMeta.fkFields[0];
          const ref = fMeta.refFields[0];
          row[fk] = v.connect[ref];
        } else if (fMeta.relKind === 'inverse' && v && typeof v === 'object') {
          nestedWrites.push({ fMeta, spec: v });
        }
      }
    }

    // Populate scalar fields
    for (const fMeta of Object.values(modelMeta.fields)) {
      if (fMeta.isModel) continue;
      const k = fMeta.name;
      if (data[k] !== undefined) {
        row[k] = coerceScalar(data[k], fMeta);
      } else if (row[k] !== undefined) {
        row[k] = coerceScalar(row[k], fMeta);
      } else if (fMeta.isAutoIncrement) {
        sequences[modelMeta.name] += 1;
        row[k] = sequences[modelMeta.name];
      } else if (fMeta.isUpdatedAt) {
        row[k] = new Date();
      } else if (fMeta.hasDefault) {
        row[k] = fMeta.defaultVal();
      } else if (fMeta.isOptional) {
        row[k] = null;
      } else {
        row[k] = null;
      }
    }

    if (typeof row[modelMeta.idField] === 'number' && row[modelMeta.idField] > sequences[modelMeta.name]) {
      sequences[modelMeta.name] = row[modelMeta.idField];
    }

    checkUniqueConstraints(modelMeta, row);
    tables[modelMeta.name].push(row);

    // Execute nested child writes
    for (const { fMeta, spec } of nestedWrites) {
      const targetMeta = models[fMeta.type];
      const fk = fMeta.inverseFkFields[0];
      const ref = fMeta.inverseRefFields[0];
      const parentKeyVal = row[ref];

      if (spec.create) {
        const items = Array.isArray(spec.create) ? spec.create : [spec.create];
        for (const itemData of items) {
          insertRow(targetMeta, { ...itemData, [fk]: parentKeyVal });
        }
      }
      if (spec.createMany && spec.createMany.data) {
        const items = Array.isArray(spec.createMany.data) ? spec.createMany.data : [spec.createMany.data];
        for (const itemData of items) {
          try {
            insertRow(targetMeta, { ...itemData, [fk]: parentKeyVal });
          } catch (e) {
            if (!(spec.createMany.skipDuplicates && e.code === 'P2002')) throw e;
          }
        }
      }
    }

    return row;
  }

  function applyScalarUpdate(currentVal, updateSpec, fMeta) {
    if (updateSpec !== null && typeof updateSpec === 'object' && !(updateSpec instanceof Date)) {
      if ('increment' in updateSpec) return Number(currentVal || 0) + Number(updateSpec.increment || 0);
      if ('decrement' in updateSpec) return Number(currentVal || 0) - Number(updateSpec.decrement || 0);
      if ('multiply' in updateSpec) return Number(currentVal || 0) * Number(updateSpec.multiply || 0);
      if ('divide' in updateSpec) return Number(currentVal || 0) / Number(updateSpec.divide || 1);
      if ('set' in updateSpec) return coerceScalar(updateSpec.set, fMeta);
    }
    return coerceScalar(updateSpec, fMeta);
  }

  function updateRow(modelMeta, row, data = {}) {
    const candidate = cloneRow(row);
    const nestedWrites = [];

    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      const fMeta = modelMeta.fields[k];
      if (!fMeta) continue;
      if (fMeta.isModel) {
        if (fMeta.relKind === 'owning' && v && typeof v === 'object') {
          const fk = fMeta.fkFields[0];
          const ref = fMeta.refFields[0];
          if (v.connect) candidate[fk] = v.connect[ref];
          else if (v.disconnect) candidate[fk] = null;
        } else if (fMeta.relKind === 'inverse' && v && typeof v === 'object') {
          nestedWrites.push({ fMeta, spec: v });
        }
        continue;
      }
      candidate[k] = applyScalarUpdate(candidate[k], v, fMeta);
    }

    // Update @updatedAt fields
    for (const fMeta of Object.values(modelMeta.fields)) {
      if (fMeta.isUpdatedAt && data[fMeta.name] === undefined) {
        candidate[fMeta.name] = new Date();
      }
    }

    checkUniqueConstraints(modelMeta, candidate, row[modelMeta.idField]);
    Object.assign(row, candidate);

    for (const { fMeta, spec } of nestedWrites) {
      const targetMeta = models[fMeta.type];
      const fk = fMeta.inverseFkFields[0];
      const ref = fMeta.inverseRefFields[0];
      const parentKeyVal = row[ref];

      if (spec.deleteMany !== undefined) {
        const subWhere = typeof spec.deleteMany === 'object' && spec.deleteMany !== null
          ? { ...spec.deleteMany, [fk]: parentKeyVal }
          : { [fk]: parentKeyVal };
        deleteMatchingRows(targetMeta, subWhere);
      }
      if (spec.create) {
        const items = Array.isArray(spec.create) ? spec.create : [spec.create];
        for (const itemData of items) {
          insertRow(targetMeta, { ...itemData, [fk]: parentKeyVal });
        }
      }
    }

    return row;
  }

  function deleteSingleRow(modelMeta, row) {
    const idField = modelMeta.idField;
    const rowId = row[idField];

    // Check referential actions across all models
    for (const otherModel of Object.values(models)) {
      for (const fMeta of Object.values(otherModel.fields)) {
        if (!fMeta.isModel || fMeta.type !== modelMeta.name || fMeta.relKind !== 'owning') continue;
        const fk = fMeta.fkFields[0];
        const ref = fMeta.refFields[0];
        const refVal = row[ref];
        if (fMeta.onDelete === 'Cascade') {
          const children = tables[otherModel.name].filter((r) => r[fk] === refVal);
          for (const child of children) {
            deleteSingleRow(otherModel, child);
          }
        } else if (fMeta.onDelete === 'SetNull' || fMeta.isOptional) {
          for (const child of tables[otherModel.name]) {
            if (child[fk] === refVal) child[fk] = null;
          }
        }
      }
    }

    const idx = tables[modelMeta.name].findIndex((r) => r[idField] === rowId);
    if (idx !== -1) tables[modelMeta.name].splice(idx, 1);
  }

  function deleteMatchingRows(modelMeta, where) {
    const matches = tables[modelMeta.name].filter((r) => matchesWhere(modelMeta, r, where));
    for (const r of matches) {
      deleteSingleRow(modelMeta, r);
    }
    return matches.length;
  }

  function makeNotFoundError(modelName) {
    const err = new Error(`No ${modelName} found`);
    err.code = 'P2025';
    err.meta = { cause: 'Record does not exist.' };
    return err;
  }

  function computeAggregate(modelMeta, rows, args = {}) {
    const result = {};
    if (args._count) {
      if (args._count === true) {
        result._count = rows.length;
      } else if (typeof args._count === 'object') {
        result._count = {};
        for (const [k, v] of Object.entries(args._count)) {
          if (!v) continue;
          result._count[k] = k === '_all' ? rows.length : rows.filter((r) => r[k] != null).length;
        }
      }
    }
    if (args._sum) {
      result._sum = {};
      for (const [k, v] of Object.entries(args._sum)) {
        if (!v) continue;
        result._sum[k] = rows.length
          ? rows.reduce((acc, r) => acc + (Number(r[k]) || 0), 0)
          : null;
      }
    }
    if (args._avg) {
      result._avg = {};
      for (const [k, v] of Object.entries(args._avg)) {
        if (!v) continue;
        const valid = rows.filter((r) => r[k] != null);
        result._avg[k] = valid.length
          ? valid.reduce((acc, r) => acc + Number(r[k]), 0) / valid.length
          : null;
      }
    }
    if (args._min) {
      result._min = {};
      for (const [k, v] of Object.entries(args._min)) {
        if (!v) continue;
        const vals = rows.map((r) => r[k]).filter((x) => x != null);
        result._min[k] = vals.length ? vals.reduce((a, b) => (toComparable(a) <= toComparable(b) ? a : b)) : null;
      }
    }
    if (args._max) {
      result._max = {};
      for (const [k, v] of Object.entries(args._max)) {
        if (!v) continue;
        const vals = rows.map((r) => r[k]).filter((x) => x != null);
        result._max[k] = vals.length ? vals.reduce((a, b) => (toComparable(a) >= toComparable(b) ? a : b)) : null;
      }
    }
    return result;
  }

  function createDelegate(modelMeta) {
    return {
      async findUnique(args = {}) {
        const { where } = args;
        if (!where) return null;
        const row = tables[modelMeta.name].find((r) => matchesWhere(modelMeta, r, where));
        return row ? shapeRow(modelMeta, row, args) : null;
      },
      async findUniqueOrThrow(args = {}) {
        const res = await this.findUnique(args);
        if (!res) throw makeNotFoundError(modelMeta.name);
        return res;
      },
      async findFirst(args = {}) {
        const rows = await this.findMany({ ...args, take: 1 });
        return rows[0] || null;
      },
      async findFirstOrThrow(args = {}) {
        const res = await this.findFirst(args);
        if (!res) throw makeNotFoundError(modelMeta.name);
        return res;
      },
      async findMany(args = {}) {
        let rows = tables[modelMeta.name].filter((r) => matchesWhere(modelMeta, r, args.where));
        if (args.orderBy) rows = sortRows(modelMeta, rows, args.orderBy);
        if (args.distinct) {
          const cols = Array.isArray(args.distinct) ? args.distinct : [args.distinct];
          const seen = new Set();
          rows = rows.filter((r) => {
            const k = cols.map((c) => String(r[c])).join('||');
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
        }
        if (typeof args.skip === 'number') rows = rows.slice(args.skip);
        if (typeof args.take === 'number') rows = rows.slice(0, args.take);
        return rows.map((r) => shapeRow(modelMeta, r, args));
      },
      async count(args = {}) {
        const rows = tables[modelMeta.name].filter((r) => matchesWhere(modelMeta, r, args.where));
        return rows.length;
      },
      async aggregate(args = {}) {
        const rows = tables[modelMeta.name].filter((r) => matchesWhere(modelMeta, r, args.where));
        return computeAggregate(modelMeta, rows, args);
      },
      async groupBy(args = {}) {
        const byCols = Array.isArray(args.by) ? args.by : [args.by];
        const rows = tables[modelMeta.name].filter((r) => matchesWhere(modelMeta, r, args.where));
        const buckets = new Map();
        for (const r of rows) {
          const key = JSON.stringify(byCols.map((c) => r[c]));
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(r);
        }
        let groups = [];
        for (const groupRows of buckets.values()) {
          const sample = groupRows[0];
          const item = {};
          for (const c of byCols) item[c] = sample[c];
          Object.assign(item, computeAggregate(modelMeta, groupRows, args));
          groups.push(item);
        }
        if (args.orderBy) {
          const specs = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
          groups.sort((a, b) => {
            for (const spec of specs) {
              const [k, v] = Object.entries(spec)[0] || [];
              if (k === '_sum' || k === '_count' || k === '_avg' || k === '_min' || k === '_max') {
                const [subK, dir] = Object.entries(v)[0] || [];
                const va = a[k] ? (typeof a[k] === 'object' ? a[k][subK] : a[k]) : 0;
                const vb = b[k] ? (typeof b[k] === 'object' ? b[k][subK] : b[k]) : 0;
                if (va !== vb) return String(dir).toLowerCase() === 'desc' ? vb - va : va - vb;
              } else {
                const va = a[k];
                const vb = b[k];
                if (va !== vb) return String(v).toLowerCase() === 'desc' ? (vb > va ? 1 : -1) : (va > vb ? 1 : -1);
              }
            }
            return 0;
          });
        }
        if (typeof args.skip === 'number') groups = groups.slice(args.skip);
        if (typeof args.take === 'number') groups = groups.slice(0, args.take);
        return groups;
      },
      async create(args = {}) {
        const row = insertRow(modelMeta, args.data || {});
        return shapeRow(modelMeta, row, args);
      },
      async createMany(args = {}) {
        const items = Array.isArray(args.data) ? args.data : [args.data];
        let count = 0;
        for (const item of items) {
          try {
            insertRow(modelMeta, item);
            count += 1;
          } catch (e) {
            if (!(args.skipDuplicates && e.code === 'P2002')) throw e;
          }
        }
        return { count };
      },
      async update(args = {}) {
        const row = tables[modelMeta.name].find((r) => matchesWhere(modelMeta, r, args.where));
        if (!row) throw makeNotFoundError(modelMeta.name);
        updateRow(modelMeta, row, args.data || {});
        return shapeRow(modelMeta, row, args);
      },
      async updateMany(args = {}) {
        const matches = tables[modelMeta.name].filter((r) => matchesWhere(modelMeta, r, args.where));
        for (const row of matches) {
          updateRow(modelMeta, row, args.data || {});
        }
        return { count: matches.length };
      },
      async upsert(args = {}) {
        const existing = tables[modelMeta.name].find((r) => matchesWhere(modelMeta, r, args.where));
        if (existing) {
          updateRow(modelMeta, existing, args.update || {});
          return shapeRow(modelMeta, existing, args);
        }
        const created = insertRow(modelMeta, args.create || {});
        return shapeRow(modelMeta, created, args);
      },
      async delete(args = {}) {
        const row = tables[modelMeta.name].find((r) => matchesWhere(modelMeta, r, args.where));
        if (!row) throw makeNotFoundError(modelMeta.name);
        const shaped = shapeRow(modelMeta, row, args);
        deleteSingleRow(modelMeta, row);
        return shaped;
      },
      async deleteMany(args = {}) {
        const count = deleteMatchingRows(modelMeta, args.where);
        return { count };
      },
    };
  }

  const delegates = {};
  for (const [delegateName, meta] of Object.entries(byDelegate)) {
    delegates[delegateName] = createDelegate(meta);
  }

  // Serialized transaction queue so concurrent $transaction calls don't interleave
  let txChain = Promise.resolve();

  const client = {
    ...delegates,
    async $transaction(arg) {
      const runTx = async () => {
        const snap = snapshotState();
        try {
          if (typeof arg === 'function') {
            return await arg(client);
          }
          if (Array.isArray(arg)) {
            const out = [];
            for (const p of arg) out.push(await p);
            return out;
          }
          return null;
        } catch (err) {
          restoreState(snap);
          throw err;
        }
      };
      const next = txChain.then(runTx, runTx);
      txChain = next.catch(() => {});
      return next;
    },
    async $connect() {},
    async $disconnect() {},
    async $queryRaw() { return []; },
    async $executeRaw() { return 0; },
  };

  return client;
}

module.exports = { createInMemoryPrisma };
