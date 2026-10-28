'use strict';

// Route inventory built by reading the real route files.
//
// The audit's API test matrix is driven by this, so the tests cannot drift out
// of sync with the code: add a route and the security matrix covers it on the
// next run without anyone remembering to update a list.

const fs = require('fs');
const path = require('path');

const BACKEND = path.resolve(__dirname, '..', '..');

// path params that are not integers
const PARAM_VALUES = {
  status: 'DELIVERED',
  refType: 'JOBCARD',
  type: 'invoices',
  code: 'TESTCODE',
  gstin: '27AAPFU0939F1ZV',
};

function substituteParams(routePath) {
  return routePath.replace(/:([A-Za-z_]+)/g, (_m, name) => PARAM_VALUES[name] || '1');
}

function loadInventory() {
  const serverSrc = fs.readFileSync(path.join(BACKEND, 'src/server.js'), 'utf8');

  const varToFile = {};
  for (const m of serverSrc.matchAll(/const (\w+) = require\('\.\/routes\/([\w.]+)'\)/g)) {
    varToFile[m[1]] = m[2];
  }

  const mounts = [...serverSrc.matchAll(/app\.use\('(\/api\/[^']+)',\s*(\w+)\)/g)].map((m) => ({
    mount: m[1],
    varName: m[2],
  }));

  const routes = [];

  for (const { mount, varName } of mounts) {
    const file = varToFile[varName];
    // Not every app.use('/api/...', x) mounts a router — the export rate
    // limiter is mounted the same way. Anything with no require('./routes/...')
    // behind it is middleware, and has no routes to inventory.
    if (!file) continue;
    const rel = path.join('src/routes', `${file}.js`);
    const src = fs.readFileSync(path.join(BACKEND, rel), 'utf8');

    // `router.use(requireAuth)` covers every handler declared after it
    const useAuthAtTop = /router\.use\(requireAuth\)/.test(src);

    for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']*)'\s*,([^;]*)\);/g)) {
      const [, method, routePath, chain] = m;
      const permissions = [...chain.matchAll(/requirePermission\(([^)]*)\)/g)]
        .map((p) => [...p[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))
        .flat();
      const handlerMatch = chain.match(/(?:ctrl|controller)\.(\w+)/);
      routes.push({
        file: rel,
        mount,
        method: method.toUpperCase(),
        routePath,
        path: mount + (routePath === '/' ? '' : routePath),
        concretePath: mount + (routePath === '/' ? '/' : substituteParams(routePath)),
        permissions,
        hasAuth: useAuthAtTop || /requireAuth/.test(chain),
        hasValidation: /validate\(/.test(chain),
        hasUpload: /upload\.(array|single|fields)/.test(chain),
        handler: handlerMatch ? handlerMatch[1] : null,
      });
    }
  }

  return routes;
}

// endpoints that are intentionally reachable without a token
const PUBLIC_ROUTES = [
  'POST /api/auth/login',
  'POST /api/auth/otp/request',
  'POST /api/auth/otp/verify',
];

module.exports = { loadInventory, PUBLIC_ROUTES };
