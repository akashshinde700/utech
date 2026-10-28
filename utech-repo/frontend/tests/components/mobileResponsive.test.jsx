import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DataTable from '../../src/components/ui/DataTable';
import OfflineBanner from '../../src/components/layout/OfflineBanner';

const originalMatchMedia = window.matchMedia;

function mockViewport(matchesMobile) {
  window.matchMedia = (query) => ({
    matches: matchesMobile,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

afterEach(() => { window.matchMedia = originalMatchMedia; });

const columns = [
  { key: 'name', title: 'Name', render: (r) => r.name },
  { key: 'qty', title: 'Qty', render: (r) => r.qty },
  { key: 'actions', title: 'Actions', render: (r) => <button type="button">Edit {r.name}</button> },
];
const rows = [{ id: 1, name: 'Widget', qty: 3 }];

describe('DataTable mobile record cards', () => {
  it('renders a labelled card (not a squeezed table) on a phone viewport', () => {
    mockViewport(true);
    const { container } = render(<DataTable columns={columns} rows={rows} />);
    expect(container.querySelector('table')).toBeNull();
    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByText('Qty')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    // row actions survive the card transformation
    expect(screen.getByRole('button', { name: 'Edit Widget' })).toBeInTheDocument();
  });

  it('keeps the real table on desktop widths', () => {
    mockViewport(false);
    const { container } = render(<DataTable columns={columns} rows={rows} />);
    expect(container.querySelector('table')).not.toBeNull();
  });

  it('mobileCards={false} opts a genuinely tabular screen out', () => {
    mockViewport(true);
    const { container } = render(<DataTable columns={columns} rows={rows} mobileCards={false} />);
    expect(container.querySelector('table')).not.toBeNull();
  });

  it('card tap fires onRowClick, but tapping an action button does not', () => {
    mockViewport(true);
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} rows={rows} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Widget' }));
    expect(onRowClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Widget'));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });
});

describe('OfflineBanner', () => {
  it('is silent while online and warns (without faking success) when offline', () => {
    const { rerender } = render(<OfflineBanner />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent(window, new Event('offline'));
    expect(screen.getByRole('alert')).toHaveTextContent(/offline/i);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    fireEvent(window, new Event('online'));
    rerender(<OfflineBanner />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
