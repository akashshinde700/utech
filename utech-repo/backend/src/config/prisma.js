'use strict';

let prisma;

if (global.__prisma) {
  prisma = global.__prisma;
} else if (process.env.USE_IN_MEMORY_DB === '1') {
  if (process.env.NODE_ENV === 'production') throw new Error('In-memory database is disabled in production. Configure MySQL.');
  const { createInMemoryPrisma } = require('./inMemoryPrisma');
  prisma = createInMemoryPrisma();
  prisma._isInMemory = true;
} else {
  try {
    const { PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  } catch (err) {
    if (process.env.NODE_ENV === 'production') throw new Error(`Prisma initialization failed; refusing temporary storage in production: ${err.message}`);
    console.warn('[database] Prisma is unavailable; using temporary in-memory storage. Data will be lost on restart.');
    // Fallback to schema-driven in-memory Prisma when the native query engine
    // has not been generated (e.g. offline/sandbox environments).
    const { createInMemoryPrisma } = require('./inMemoryPrisma');
    prisma = createInMemoryPrisma();
    prisma._isInMemory = true;
  }
}

if (process.env.NODE_ENV !== 'production') global.__prisma = prisma;

module.exports = prisma;
