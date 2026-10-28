import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AppLayout from '../../src/components/layout/AppLayout.jsx';
import { useAuth } from '../../src/store/auth';

// The desktop sidebar must collapse to an icon rail (labels -> tooltips),
// expand again, and remember the choice across navigation/reloads. Before
// this, the sidebar had no desktop toggle at all — only a mobile drawer.

const ADMIN = { id: 1, name: 'Admin', email: 'a@utech.local', role: 'SUPERADMIN', permissions: [] };

function renderLayout() {
  useAuth.setState({ token: 'test-token', user: ADMIN });
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<div>Overview page</div>} />
          <Route path="items" element={<div>Items page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('sidebar collapse/expand', () => {
  beforeEach(() => localStorage.clear());

  it('starts expanded with readable labels and a Collapse toggle', () => {
    renderLayout();
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
    expect(screen.getAllByText('Overview').length).toBeGreaterThan(0);
    expect(document.querySelector('aside').dataset.collapsed).toBe('false');
  });

  it('collapses to an icon rail: labels become tooltips, state persists', () => {
    renderLayout();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(document.querySelector('aside').dataset.collapsed).toBe('true');
    expect(localStorage.getItem('utech.sidebar.collapsed')).toBe('true');
    // every destination is still reachable as a labelled icon link
    expect(screen.getByRole('link', { name: 'Items' })).toHaveAttribute('title', 'Items');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  it('expands again and persists the expanded choice', () => {
    localStorage.setItem('utech.sidebar.collapsed', 'true');
    renderLayout();
    expect(document.querySelector('aside').dataset.collapsed).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(document.querySelector('aside').dataset.collapsed).toBe('false');
    expect(localStorage.getItem('utech.sidebar.collapsed')).toBe('false');
  });

  it('section headers toggle their submenu without navigating', () => {
    renderLayout();
    const masters = screen.getByRole('button', { name: /Masters/ });
    expect(masters).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(masters);
    expect(masters).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: /Machines/ })).toBeInTheDocument();
  });
});
