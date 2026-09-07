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
