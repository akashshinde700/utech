import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // installs the @prisma/client stand-in before the app is imported
    setupFiles: ['tests/helpers/prismaMockSetup.js'],
    // one shared Express app + one shared Prisma stub: keep files serial so
    // per-test programming never leaks into another file
    fileParallelism: false,
    testTimeout: 15000,
  },
});
