const js = require('@eslint/js');

// This config previously declared only `rules: { 'no-console': 'off' }` with no
// rule set at all, so `npm run lint` exited 0 no matter what was in src/ — an
// undefined variable, an unused import, a duplicate key, all passed. Enabling
// eslint:recommended turns the script into a real gate.
//
// The rule options below match the frontend config's intent: `_`-prefixed names
// and catch bindings are allowed, and destructuring-to-omit
// (`const { id, ...rest } = x`) is not reported as an unused variable.
module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        // language
        console: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'writable',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        globalThis: 'readonly',
        global: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        queueMicrotask: 'readonly',
        structuredClone: 'readonly',
        // Node 18+ builtins used by the app (engines: node >= 18)
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortSignal: 'readonly',
        AbortController: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        Blob: 'readonly',
        FormData: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      // salesReturn.controller and purchaseReturn.controller each export a
      // handler named `process` (matching POST /:id/process). Shadowing the Node
      // global is legal and harmless inside those functions, and renaming the
      // handler would touch the route tables for no behaviour change.
      // Follow-up (AUD-106b): rename to `processReturn` and drop this override.
      'no-redeclare': ['error', { builtinGlobals: false }],
      'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
        ignoreRestSiblings: true,
      }],
    },
  },
  // the automated suite is CommonJS run under vitest, which injects its own
  // globals; keep it out of the src lint pass instead of widening src's scope
  { ignores: ['tests/**', 'node_modules/**'] },
];
