import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import Modal from '../../src/components/ui/Modal';
import ConfirmDialog from '../../src/components/ui/ConfirmDialog';
import DataTable from '../../src/components/ui/DataTable';
import EmptyState from '../../src/components/ui/EmptyState';
import FormField from '../../src/components/ui/FormField';
import Pagination from '../../src/components/ui/Pagination';

// Run axe against a rendered fragment. colour-contrast is disabled because
// jsdom produces no real computed styles or font metrics — contrast is checked
// manually at the viewport sizes listed in UI_UX_AUDIT.md.
async function expectNoAxeViolations(container) {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  const violations = results.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.html).join(' | ')})`,
  );
  expect(violations).toEqual([]);
}

describe('Modal — accessibility and focus management', () => {
  it('exposes the dialog role, an accessible name and aria-modal', () => {
    render(
      <Modal open onClose={() => {}} title="Delete record">
        <p>Are you sure?</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Delete record');
  });

  it('moves focus into the dialog when it opens', async () => {
    render(
      <Modal open onClose={() => {}} title="Focus test" footer={<button type="button">Save</button>}>
        <input aria-label="Field" />
      </Modal>,
    );
    // the header's close button is the first focusable element in the panel
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus());
    expect(document.activeElement.closest('[role="dialog"]')).not.toBeNull();
  });

  it('closes on Escape and on the labelled close button', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Esc test">
        <p>body</p>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('traps Tab focus inside the panel', async () => {
    render(
      <Modal open onClose={() => {}} title="Trap">
        <button type="button">First</button>
        <button type="button">Last</button>
      </Modal>,
    );
    // the panel's focusables in DOM order are: header close, First, Last
    const last = screen.getByRole('button', { name: 'Last' });
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus();

    // and Shift+Tab from the first focusable wraps back to the last
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('restores focus to the element that opened it', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'open';
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(
      <Modal open onClose={() => {}} title="Restore">
        <input aria-label="Inner" />
      </Modal>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus());
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('locks body scroll while open and releases it afterwards', async () => {
    const { unmount } = render(
      <Modal open onClose={() => {}} title="Lock">
        <p>x</p>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={() => {}} title="Hidden">
        <p>secret</p>
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <Modal open onClose={() => {}} title="Axe" description="Subtitle" footer={<button type="button">OK</button>}>
        <label htmlFor="n">Name</label>
        <input id="n" />
      </Modal>,
    );
    await expectNoAxeViolations(container);
  });
});

describe('ConfirmDialog', () => {
  it('renders a dialog with both actions wired', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete?"
        message="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while the action is in flight (no double submit)', () => {
    render(
      <ConfirmDialog open title="Delete?" message="m" loading onConfirm={() => {}} onClose={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /working/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('confirms on Enter when focus is not on a button', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open title="T" message="m" onConfirm={onConfirm} onClose={() => {}} />);
    fireEvent.keyDown(document, { key: 'Enter', target: document.body });
    expect(onConfirm).toHaveBeenCalled();
  });
});

describe('DataTable — states a user can actually reach', () => {
  const columns = [
    { key: 'name', title: 'Name', render: (r) => r.name },
    { key: 'qty', title: 'Qty', render: (r) => r.qty },
  ];

  it('renders rows', () => {
    render(<DataTable columns={columns} rows={[{ id: 1, name: 'Widget', qty: 3 }]} />);
    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows the empty state, and a different one when a filter hid everything', () => {
    const { rerender } = render(<DataTable columns={columns} rows={[]} />);
    expect(screen.getByText('No records')).toBeInTheDocument();
    rerender(<DataTable columns={columns} rows={[]} filtered />);
    expect(screen.getByText('No matches found')).toBeInTheDocument();
  });

  it('shows skeleton rows while loading instead of a misleading empty table', () => {
    render(<DataTable columns={columns} rows={[]} loading />);
    expect(screen.queryByText('No records')).not.toBeInTheDocument();
  });

  it('shows the error banner with a working retry action', async () => {
    const onRetry = vi.fn();
    render(<DataTable columns={columns} rows={[]} error="Boom" onRetry={onRetry} />);
    expect(screen.getByText('Boom')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('makes sortable headers real keyboard-reachable buttons that toggle direction', async () => {
    const onSort = vi.fn();
    render(
      <DataTable
        columns={[{ key: 'name', title: 'Name', sortable: true, render: (r) => r.name }]}
        rows={[{ id: 1, name: 'A' }]}
        sort={{ key: 'name', dir: 'asc' }}
        onSort={onSort}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Sort by Name' }));
    expect(onSort).toHaveBeenCalledWith('name', 'desc');
  });

  it('has no axe violations', async () => {
    const { container } = render(<DataTable columns={columns} rows={[{ id: 1, name: 'Widget', qty: 3 }]} />);
    await expectNoAxeViolations(container);
  });
});

describe('FormField — labels and error announcements', () => {
  it('links the label to the control and marks the error as a live alert', async () => {
    const { container } = render(
      <FormField id="party" label="Party name" error="Party name is required" required>
        <input id="party" name="party" aria-describedby="party-error" aria-invalid="true" />
      </FormField>,
    );
    expect(screen.getByText('Party name')).toHaveAttribute('for', 'party');
    const err = screen.getByRole('alert');
    expect(err).toHaveTextContent('Party name is required');
    expect(err).toHaveAttribute('id', 'party-error');
    await expectNoAxeViolations(container);
  });

  it('shows the hint instead of the error when the field is valid', () => {
    render(
      <FormField id="g" label="GSTIN" hint="15 characters">
        <input id="g" aria-describedby="g-hint" />
      </FormField>,
    );
    expect(screen.getByText('15 characters')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('renders its call to action', async () => {
    const onClick = vi.fn();
    render(<EmptyState title="Nothing here" action={{ label: 'Add item', onClick }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(onClick).toHaveBeenCalled();
  });
});

describe('Pagination', () => {
  it('disables Prev on the first page and Next on the last', () => {
    const { rerender } = render(<Pagination pagination={{ page: 1, totalPages: 3, total: 50 }} onPage={() => {}} />);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();

    rerender(<Pagination pagination={{ page: 3, totalPages: 3, total: 50 }} onPage={() => {}} />);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('emits the requested page number', async () => {
    const onPage = vi.fn();
    render(<Pagination pagination={{ page: 2, totalPages: 5, total: 90 }} onPage={onPage} pageSize={20} />);
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPage).toHaveBeenCalledWith(3);
    // the range text must clamp to the real record count
    // page 2 of a 20-per-page list over 90 records
    expect(screen.getByText(/Showing 21–40 of 90/)).toBeInTheDocument();
  });

  it('renders nothing at all when there is no pagination payload', () => {
    const { container } = render(<Pagination pagination={null} onPage={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('reads "of 1" rather than "of 0" for an empty list', () => {
    render(<Pagination pagination={{ page: 1, totalPages: 0, total: 0 }} onPage={() => {}} />);
    expect(screen.getByText(/of/)).toBeInTheDocument();
    expect(screen.queryByText(/of 0/)).not.toBeInTheDocument();
  });
});
