import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { stubApi } from '../helpers/apiStubs';

// Regression test for AUD-101 (P1): every sidebar link a restricted user can
// SEE must be a route they may actually OPEN. The nav is built from
// RESTRICTED_NAV_SECTIONS in AppLayout, but the route guard whitelisted a
// separate, shorter list — any link missing from that list silently bounced the
// user back to the dashboard, which looks exactly like a dead menu item.
//
// Before the fix these two failed:
//   OPERATOR        /my-tasks  -> redirected to /  ("My Projects")
//   Department Head /tasks     -> redirected to /  ("My Projects")

const OPERATOR = {
  id: 10,
  name: 'Shop Floor',
  email: 'op@utech.local',
  role: 'OPERATOR',
  scopeToDepartment: false,
  hierarchyLevel: 6,
  permissions: ['jobcard.read', 'jobcard.update', 'jobcard.progress', 'item.read', 'assignment.read', 'assignment.update', 'task.read', 'task.progress'],
};

const DEPT_HEAD = {
  id: 11,
  name: 'Dept Head',
  email: 'dh@utech.local',
  role: 'Department Head',
  scopeToDepartment: true,
  hierarchyLevel: 4,
  permissions: ['jobcard.read', 'task.read', 'task.create', 'task.progress', 'process.read', 'assignment.read', 'item.read'],
};

const MANAGER = {
  id: 12,
  name: 'Manager',
  email: 'm@utech.local',
  role: 'MANAGER',
  scopeToDepartment: false,
  permissions: ['invoice.read', 'item.read', 'jobcard.read', 'task.read', 'task.create', 'process.read'],
};

function seedSession(user) {
  localStorage.setItem('utech.token', 'test-token');
  localStorage.setItem('utech.user', JSON.stringify(user));
}

// Routes are lazy (App.jsx), so a page arrives after a tick -- wait for the
// heading the caller is actually asking about rather than for "some h1", which
// a previous render in the same test would satisfy immediately.
async function renderAt(user, path, expectedHeading) {
  cleanup(); // these tests render twice in one case; start from an empty DOM
  vi.resetModules();
  seedSession(user);
  stubApi(user); // /auth/me must echo the same profile or Protected's refresh overwrites it
  const { default: App } = await import('../../src/App.jsx');
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { level: 1, name: expectedHeading });
  return screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent);
}

describe('restricted users: every visible sidebar link opens a real page', () => {
  beforeEach(() => localStorage.clear());

  it('AUD-101: an OPERATOR can open /my-tasks (the sidebar offers it)', async () => {
    expect(await renderAt(OPERATOR, '/my-tasks', 'My Tasks')).toContain('My Tasks');
  });

  it('an OPERATOR can open their dashboard and their assignments', async () => {
    expect(await renderAt(OPERATOR, '/', 'My Projects')).toContain('My Projects');
    expect(await renderAt(OPERATOR, '/assignments', 'Assignments')).toContain('Assignments');
  });

  it('AUD-101: a Department Head can open /tasks (the sidebar offers it)', async () => {
    expect(await renderAt(DEPT_HEAD, '/tasks', 'Task Progress')).toContain('Task Progress');
  });

  it('AUD-101: a Department Head can open /processes (the sidebar offers it)', async () => {
    expect(await renderAt(DEPT_HEAD, '/processes', 'Process Master')).toContain('Process Master');
  });

  it('still blocks a restricted user from modules they have no business in', async () => {
    const headings = await renderAt(OPERATOR, '/invoices', 'My Projects');
    expect(headings).not.toContain('Invoices');
    expect(headings).toContain('My Projects');
  });

  it('does not restrict a normal manager role', async () => {
    expect(await renderAt(MANAGER, '/invoices', 'Invoices')).toContain('Invoices');
  });
});

describe('unknown routes and unauthenticated access', () => {
  beforeEach(() => localStorage.clear());

  it('shows a 404 page for an unknown URL instead of silently bouncing home', async () => {
    // the 404 card has no h1, so render directly instead of using renderAt()
    vi.resetModules();
    seedSession(MANAGER);
    stubApi(MANAGER);
    const { default: App } = await import('../../src/App.jsx');
    render(
      <MemoryRouter initialEntries={['/this-page-does-not-exist']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Invoices' })).not.toBeInTheDocument();
  });

  it('redirects to the login page when there is no token', async () => {
    vi.resetModules();
    localStorage.clear();
    stubApi(MANAGER);
    const { default: App } = await import('../../src/App.jsx');
    render(
      <MemoryRouter initialEntries={['/invoices']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'UTech ERP' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Invoices' })).not.toBeInTheDocument();
  });
});
