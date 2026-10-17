'use strict';

// Shared harness: boots the REAL Express app from src/server.js and hands out
// JWTs signed with the same secret the app reads, so requireAuth() executes for
// real. The Prisma client is the programmable stub installed through the
// vitest alias (tests/helpers/prismaClientStub.js).

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-automated-audit-suite';
process.env.JWT_EXPIRES_IN = '1d';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/utech-audit-uploads';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://stub:stub@localhost:3306/stub';

const jwt = require('jsonwebtoken');

// published by prismaClientStub.js as soon as @prisma/client is first required
function getDb() {
  return globalThis.__utechFakePrisma;
}

// Shape returned by the `include` in requireAuth(): role.permissions[].permission.key
// drives effectivePermissions(), which drives every requirePermission() check.
function makeUser({
  id = 1,
  role = 'SUPERADMIN',
  permissions = [],
  scopeToDepartment = false,
  hierarchyLevel = 0,
  departmentId = null,
  departmentName = null,
  isActive = true,
  email = 'u@utech.local',
  name = 'Test User',
} = {}) {
  return {
    id,
    email,
    name,
    isActive,
    departmentId,
    scopeToDepartment,
    hierarchyLevel,
    role: {
      name: role,
      scopeToDepartment,
      hierarchyLevel,
      permissions: permissions.map((key, i) => ({ permission: { id: i + 1, key } })),
    },
    permissionOverrides: [],
    department: departmentName ? { name: departmentName } : null,
  };
}

// Programs prisma.user.findUnique (what requireAuth resolves) and returns a
// bearer token for that identity.
function signInAs(user) {
  getDb().when('user.findUnique', user);
  return jwt.sign({ sub: user.id, email: user.email, role: user.role.name }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
}

async function loadApp() {
  const mod = await import('../../src/server.js');
  return mod.default;
}

module.exports = { getDb, makeUser, signInAs, loadApp };
