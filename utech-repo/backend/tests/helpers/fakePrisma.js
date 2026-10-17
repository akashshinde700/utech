'use strict';

// ---------------------------------------------------------------------------
// fakePrisma — a programmable stand-in for the generated Prisma client.
//
// The real client cannot be generated in a sandbox without network access to
// binaries.prisma.sh, so tests inject this in place of src/config/prisma.
//
// What it is FOR: exercising the real Express stack — route tables, requireAuth,
// requirePermission, zod validate(), controllers and errorHandler — and letting a
// test assert on the exact Prisma calls a controller made.
//
// What it is NOT: a database. It does not enforce the schema, foreign keys,
// unique indexes, transactions or isolation. Anything that depends on those is
// reported as "not executable in this environment", never as "passed".
//
// Usage:
//   const db = createFakePrisma();
//   db.when('user.findUnique').resolve({ id: 1, ... });
//   db.calls('invoice.create');   // -> array of the args passed
// ---------------------------------------------------------------------------

const MODEL_METHODS = [
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany',
  'count', 'aggregate', 'groupBy', 'create', 'createMany', 'update', 'updateMany',
  'upsert', 'delete', 'deleteMany',
];

// Sensible "empty database" answer per method, used when a test has not
// programmed a response. Returning undefined here would make controllers blow up
// in ways that say nothing about the code under test.
function defaultResult(method, args) {
  switch (method) {
    case 'findMany': return [];
    case 'count': return 0;
    case 'aggregate': return { _sum: {}, _avg: {}, _min: {}, _max: {}, _count: 0 };
    case 'groupBy': return [];
    case 'createMany': case 'updateMany': case 'deleteMany': return { count: 0 };
    case 'create': case 'update': case 'upsert': return (args && args[0] && args[0].data) || {};
    case 'delete': return {};
    case 'findUniqueOrThrow': case 'findFirstOrThrow': {
      const err = new Error('Record not found');
      err.code = 'P2025';
      err.meta = { cause: 'Record to delete does not exist.' };
      throw err;
    }
    default: return null; // findUnique / findFirst
  }
}

function createFakePrisma() {
  const responses = new Map();   // 'model.method' -> fn(args)
  const log = [];                // { key, args }
  const models = new Map();

  function key(model, method) {
    return `${model}.${method}`;
  }

  function record(k, args) {
    log.push({ key: k, args });
  }

  const api = {
    // --- test-facing API (not part of Prisma) ---
    // program a canned answer; `value` may be a value or a function(args)
    when(k, value) {
      responses.set(k, typeof value === 'function' ? value : () => value);
      return api;
    },
    // program an error (instance or { code, message, meta })
    failWith(k, errLike) {
      responses.set(k, () => {
        const e = errLike instanceof Error ? errLike : new Error(errLike.message || 'prisma error');
        if (errLike && errLike.code) e.code = errLike.code;
        if (errLike && errLike.meta) e.meta = errLike.meta;
        throw e;
      });
      return api;
    },
    calls(k) {
      if (k) return log.filter((c) => c.key === k).map((c) => c.args);
      return log.slice();
    },
    reset() {
      responses.clear();
      log.length = 0;
      return api;
    },

    // prisma.$transaction(async (tx) => ...) and prisma.$transaction([...])
    async $transaction(arg) {
      record('$transaction', []);
      if (typeof arg === 'function') return arg(tx);
      const out = [];
      for (const p of arg) out.push(await p);
      return out;
    },
    async $queryRaw() { record('$queryRaw', Array.from(arguments)); return []; },
    async $queryRawUnsafe() { record('$queryRawUnsafe', Array.from(arguments)); return []; },
    async $executeRaw() { record('$executeRaw', Array.from(arguments)); return 0; },
    async $executeRawUnsafe() { record('$executeRawUnsafe', Array.from(arguments)); return 0; },
    async $connect() { return undefined; },
    async $disconnect() { return undefined; },
  };

  function modelProxy(modelName) {
    const target = {};
    for (const method of MODEL_METHODS) {
      target[method] = async function (...args) {
        const k = key(modelName, method);
        record(k, args);
        const programmed = responses.get(k) || responses.get(`${modelName}.*`);
        if (programmed) return programmed(args);
        return defaultResult(method, args);
      };
    }
    return target;
  }

  // any prisma.<model> resolves to the stub; known Prisma internals are skipped
  const clientProxy = new Proxy(api, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (typeof prop !== 'string') return undefined;
      if (prop.startsWith('$') || prop.startsWith('_')) return undefined;
      if (!models.has(prop)) models.set(prop, modelProxy(prop));
      return models.get(prop);
    },
  });

  // The interactive-transaction handle shares the response table, the model
  // stubs and the call log, so tx.* calls inside a controller are programmable
  // and assertable exactly like prisma.* calls.
  const txApi = {
    async $queryRaw() { record('$queryRaw', Array.from(arguments)); return []; },
    async $executeRaw() { record('$executeRaw', Array.from(arguments)); return 0; },
    async $queryRawUnsafe() { record('$queryRawUnsafe', Array.from(arguments)); return []; },
    async $executeRawUnsafe() { record('$executeRawUnsafe', Array.from(arguments)); return 0; },
  };
  const tx = new Proxy(txApi, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (typeof prop !== 'string') return undefined;
      if (prop.startsWith('$') || prop.startsWith('_')) return undefined;
      if (!models.has(prop)) models.set(prop, modelProxy(prop));
      return models.get(prop);
    },
  });

  return clientProxy;
}

module.exports = { createFakePrisma };
