// Single source of truth for "may this user see/do X" in the UI.
//
// The server is always the real authority — every API call re-checks the same
// permission key. This exists so we don't render buttons and nav links that are
// guaranteed to 403.
//
// It FAILS CLOSED when the profile carries no permission array at all: the
// backend also fails closed, so showing enabled controls that always 403 is
// worse than hiding them. SUPERADMIN always bypasses (matching the backend
// middleware, which also short-circuits on the SUPERADMIN role).
export function hasPermission(user, key) {
  if (!user) return false;
  if (user.role === 'SUPERADMIN' || user.role?.name === 'SUPERADMIN') return true;
  if (!Array.isArray(user.permissions) || user.permissions.length === 0) return false;
  return user.permissions.includes(key);
}

// Parties and quotations each have a customer and a vendor permission set.
// Which of the two kinds may this user do `action` on?
export function allowedKinds(user, base, action) {
  const kinds = [];
  if (hasPermission(user, `customer${base}.${action}`)) kinds.push('CUSTOMER');
  if (hasPermission(user, `vendor${base}.${action}`)) kinds.push('VENDOR');
  return kinds;
}

// Party types this user may create/edit: BOTH needs both permission sets.
export function writablePartyTypes(user, action = 'create') {
  const k = allowedKinds(user, 'Party', action);
  return k.length === 2 ? ['CUSTOMER', 'VENDOR', 'BOTH'] : k;
}
