// Operators are one role (OPERATOR — one permission set, one set of access
// rules); their department is what makes them a "Fabrication Operator" or a
// "Quality Operator". Everywhere a role is shown, show it that way.
export function roleLabel(roleName, departmentName) {
  if (!roleName) return '—';
  if (roleName === 'OPERATOR') return departmentName ? `${departmentName} Operator` : 'Operator';
  return roleName;
}
