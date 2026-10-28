import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import JobcardsPage from '../../src/pages/jobcards/JobcardsPage';
import { useAuth } from '../../src/store/auth';

// The console on the live site showed `api/jobcards/1 400` twice. The cause was
// not a bug in the API: job card 1 had two drawing assignments still ASSIGNED,
// so the delete was refused — correctly, because cancelling it would have left
// work pointing at nothing.
//
// The defect was what the user got back. The reason arrived as a toast that
// faded, the confirm dialog stayed open still offering "Mark as cancelled", and
// nothing said where to go to clear the blocker. Pressing the button again gave
// the same 400 — which is exactly the pair of console lines that was reported.

const JOBCARD = {
  id: 1,
  number: 'JC-26-00001',
  date: '2026-10-01T00:00:00.000Z',
  status: 'DRAFT',
  party: { id: 2, name: 'TP Vendor Co' },
  qtyOrdered: 1,
  progressPercent: 0,
};

const OWNER = { id: 1, name: 'Owner', role: 'OWNER', permissions: ['jobcard.read', 'jobcard.delete'] };

function renderPage() {
  // the store reads localStorage once at module load, which already happened
  // when this file imported the page — so set the session on the store itself
  useAuth.setState({ token: 'test-token', user: OWNER });
  return render(
    <MemoryRouter>
      <JobcardsPage />
    </MemoryRouter>,
  );
}

async function openDeleteDialog() {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText('JC-26-00001');
  await user.click(screen.getByRole('button', { name: /delete/i }));
  return user;
}

describe('a refused job-card delete', () => {
  beforeEach(() => {
    localStorage.clear();
    globalThis.__apiMock.get.mockReset();
    globalThis.__apiMock.delete.mockReset();
    globalThis.__apiMock.get.mockResolvedValue({
      data: { items: [JOBCARD], pagination: { total: 1, page: 1, pageSize: 10, totalPages: 1 } },
    });
  });

  it('keeps the reason on screen instead of letting a toast carry it away', async () => {
    globalThis.__apiMock.delete.mockRejectedValue({
      response: {
        status: 400,
        data: { message: 'Finish or cancel the 2 open drawing assignments on this job card before cancelling it' },
      },
    });

    const user = await openDeleteDialog();
    await user.click(screen.getByRole('button', { name: 'Mark as cancelled' }));

    expect(await screen.findByText(/Finish or cancel the 2 open drawing assignments/)).toBeInTheDocument();
    // and it says plainly that nothing happened to the record
    expect(screen.getByText(/has not been changed/)).toBeInTheDocument();
  });

  it('points at the screen where the blocker can be cleared', async () => {
    globalThis.__apiMock.delete.mockRejectedValue({
      response: {
        status: 400,
        data: { message: 'Finish or cancel the 2 open drawing assignments on this job card before cancelling it' },
      },
    });

    const user = await openDeleteDialog();
    await user.click(screen.getByRole('button', { name: 'Mark as cancelled' }));

    const link = await screen.findByRole('link', { name: 'Open Drawing Assignments' });
    expect(link).toHaveAttribute('href', '/assignments');
  });

  it('sends a customer-material refusal to the customer-material screen', async () => {
    globalThis.__apiMock.delete.mockRejectedValue({
      response: {
        status: 400,
        data: { message: 'Release the 1 customer-material reservation on this job card before cancelling it' },
      },
    });

    const user = await openDeleteDialog();
    await user.click(screen.getByRole('button', { name: 'Mark as cancelled' }));

    const link = await screen.findByRole('link', { name: 'Open Customer Material' });
    expect(link).toHaveAttribute('href', '/customer-material');
  });

  it('stops inviting the same click, and offers a retry once the blocker is cleared', async () => {
    globalThis.__apiMock.delete.mockRejectedValueOnce({
      response: { status: 400, data: { message: 'Finish or cancel the 1 open drawing assignment on this job card before cancelling it' } },
    });

    const user = await openDeleteDialog();
    await user.click(screen.getByRole('button', { name: 'Mark as cancelled' }));
    await screen.findByText(/Finish or cancel the 1 open drawing assignment/);

    // the button no longer promises an action that was just refused
    expect(screen.queryByRole('button', { name: 'Mark as cancelled' })).not.toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Try again' });

    // once the assignment is dealt with, the retry succeeds and the refusal goes
    globalThis.__apiMock.delete.mockResolvedValueOnce({ data: { deleted: false, number: 'JC-26-00001' } });
    await user.click(retry);
    await vi.waitFor(() => {
      expect(screen.queryByText(/Finish or cancel/)).not.toBeInTheDocument();
    });
  });

  it('closing the dialog forgets the refusal', async () => {
    globalThis.__apiMock.delete.mockRejectedValue({
      response: { status: 400, data: { message: 'Finish or cancel the 2 open drawing assignments on this job card before cancelling it' } },
    });

    const user = await openDeleteDialog();
    await user.click(screen.getByRole('button', { name: 'Mark as cancelled' }));
    await screen.findByText(/Finish or cancel the 2 open drawing assignments/);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: /delete/i }));

    expect(screen.queryByText(/Finish or cancel/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark as cancelled' })).toBeInTheDocument();
  });
});
