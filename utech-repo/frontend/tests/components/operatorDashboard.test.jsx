import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import OperatorDashboard from '../../src/pages/operator/OperatorDashboard';

// AUD-105 (P2): OperatorDashboard is the operator's landing page. When the
// /jobcards request failed it fell straight through to the empty state, so a
// shop-floor user was told "No projects assigned to you yet" while the real
// answer was "the request failed" — indistinguishable from having no work.

function renderDashboard() {
  return render(
    <MemoryRouter>
      <OperatorDashboard />
    </MemoryRouter>,
  );
}

describe('OperatorDashboard', () => {
  beforeEach(() => {
    globalThis.__apiMock.get.mockReset();
  });

  it('renders the assigned projects', async () => {
    globalThis.__apiMock.get.mockResolvedValue({
      data: { items: [{ id: 1, number: 'JC-26-00001', itemDescription: 'Shaft', qtyOrdered: 5, qtyProduced: 2, status: 'IN_PROGRESS', priority: 'NORMAL', party: { name: 'Acme' }, date: '2026-01-01T00:00:00.000Z' }] },
    });
    renderDashboard();
    expect((await screen.findAllByText('JC-26-00001')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/No projects assigned/)).not.toBeInTheDocument();
  });

  it('AUD-105: a failed request shows an error with a retry, not the empty state', async () => {
    globalThis.__apiMock.get.mockRejectedValue({ response: { data: { message: 'Database unreachable' } } });
    renderDashboard();

    expect(await screen.findByText('Could not load your projects')).toBeInTheDocument();
    expect(screen.getByText('Database unreachable')).toBeInTheDocument();
    expect(screen.queryByText(/No projects assigned to you yet/)).not.toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('AUD-105: retry re-issues the request', async () => {
    globalThis.__apiMock.get.mockRejectedValueOnce({ response: { data: { message: 'boom' } } });
    renderDashboard();
    await screen.findByText('Could not load your projects');

    globalThis.__apiMock.get.mockResolvedValue({ data: { items: [] } });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.getByText(/No projects assigned to you yet/)).toBeInTheDocument());
    expect(globalThis.__apiMock.get).toHaveBeenCalledTimes(2);
  });

  it('still shows the genuine empty state when the request succeeds with no rows', async () => {
    globalThis.__apiMock.get.mockResolvedValue({ data: { items: [] } });
    renderDashboard();
    expect(await screen.findByText(/No projects assigned to you yet/)).toBeInTheDocument();
  });

  it('does not crash when the API returns a payload without an items array', async () => {
    globalThis.__apiMock.get.mockResolvedValue({ data: {} });
    renderDashboard();
    expect(await screen.findByText(/No projects assigned to you yet/)).toBeInTheDocument();
  });
});
