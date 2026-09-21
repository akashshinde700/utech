'use strict';
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const prisma = require('../config/prisma');

function unauthorized(res, msg = 'Unauthorized') {
  return res.status(401).json({ error: 'Unauthorized', message: msg });
}

// What this user may actually do: their role's grants, minus anything revoked
// for them personally, plus anything granted to them personally. Lets one
// Department Head hold a capability the rest of the role doesn't (and vice
// versa) without cloning the role. Expects role.permissions and
// permissionOverrides to be included on `user`.
function effectivePermissions(user) {
  const fromRole = user.role ? user.role.permissions.map((rp) => rp.permission.key) : [];
  const overrides = user.permissionOverrides || [];
  const revoked = new Set(overrides.filter((o) => !o.allow).map((o) => o.permission.key));
  const granted = overrides.filter((o) => o.allow).map((o) => o.permission.key);
  return [...new Set([...fromRole.filter((k) => !revoked.has(k)), ...granted])];
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return unauthorized(res, 'Missing bearer token');

    const payload = jwt.verify(token, env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        permissionOverrides: { include: { permission: true } },
      },
    });
    if (!user || !user.isActive) return unauthorized(res, 'User inactive or missing');

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role && user.role.name,
      departmentId: user.departmentId,
      scopeToDepartment: !!(user.role && user.role.scopeToDepartment),
      hierarchyLevel: user.role ? user.role.hierarchyLevel : null,
      permissions: effectivePermissions(user),
    };
    return next();
  } catch (e) {
    return unauthorized(res, 'Invalid or expired token');
  }
}

// require any of the given permission keys, OR superadmin role
function requirePermission(...keys) {
  return function (req, res, next) {
    if (!req.user) return unauthorized(res);
    if (req.user.role === 'SUPERADMIN') return next();
    const has = keys.some((k) => req.user.permissions.includes(k));
    if (!has) {
      return res.status(403).json({ error: 'Forbidden', message: `Missing permission: ${keys.join(' | ')}` });
    }
    return next();
  };
}

module.exports = { requireAuth, requirePermission };
