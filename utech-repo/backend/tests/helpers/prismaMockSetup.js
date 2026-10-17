'use strict';

// vitest setupFile — installed before any test file runs.
//
// WHY THIS EXISTS
// `prisma generate` downloads the query engine from binaries.prisma.sh. That
// host is unreachable from the audit sandbox, so the generated client does not
// exist and `require('@prisma/client')` throws:
//   "@prisma/client did not initialize yet. Please run prisma generate..."
// Without a stand-in the backend cannot even be imported, let alone tested.
//
// WHAT IT DOES
// Intercepts `require('@prisma/client')` at the Node module-loader level and
// returns a PrismaClient whose instances are the programmable fake in
// fakePrisma.js. src/config/prisma.js therefore exports the fake to every
// controller, and src/ stays untouched.
//
// WHAT IT DOES NOT DO
// It is not a database: no schema enforcement, no foreign keys, no unique
// indexes, no real transactions, no isolation. Tests that depend on those are
// reported as not executable in this environment rather than as passed.

const Module = require('module');
const { createFakePrisma } = require('./fakePrisma');

const instance = globalThis.__utechFakePrisma || createFakePrisma();
globalThis.__utechFakePrisma = instance;

class PrismaClient {
  constructor() {
    return instance;
  }
}

const stub = { PrismaClient, default: { PrismaClient } };

if (!globalThis.__utechPrismaLoaderPatched) {
  globalThis.__utechPrismaLoaderPatched = true;
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '@prisma/client' || request === '.prisma/client' || request === '@prisma/client/runtime/library') {
      return stub;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
}
