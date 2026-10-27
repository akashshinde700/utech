import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GRNForm from '../../src/pages/purchase/GRNForm';
import { useAuth } from '../../src/store/auth';

const USER = { id: 1, role: 'SUPERADMIN', permissions: [] };
const VENDOR = { id: 7, code: 'V-007', name: 'Acme Vendor', type: 'VENDOR' };
const CREATED_ID = 42;
const CREATED_CODE = 'ITM-002';

function stubApi() {
  const api = globalThis.__apiMock;
  api.get.mockReset();
  api.post.mockReset();
  api.put.mockReset();
  api.delete.mockReset();

  api.get.mockImplementation((url) => {
    if (url === '/parties') return Promise.resolve({ data: { items: [VENDOR] } });
    if (url === '/items/lookups') {
      return Promise.resolve({ data: { uoms: [{ id: 1, code: 'PCS', name: 'Pieces' }], categories: [] } });
    }
    return Promise.resolve({ data: { items: [] } });
  });
  api.post.mockImplementation((url, payload) => {
    if (url === '/items') {
      return Promise.resolve({
        data: { id: CREATED_ID, code: CREATED_CODE, name: payload.name, type: payload.type },
      });
    }
    return Promise.resolve({ data: { ok: true } });
  });
  return api;
}

// useRemoteOptions and the SearchableSelect filter both fetch after a short
// delay. Let those promises settle inside act() so React state updates do not
// leak out of the simulated user event.
const settle = () => new Promise((resolve) => setTimeout(resolve, 275));
async function uiEvent(action) {
  await act(async () => {
    action();
    await settle();
  });
}

async function renderForm() {
  await uiEvent(() => render(<MemoryRouter><GRNForm /></MemoryRouter>));
}

describe('New GRN — quick-create item', () => {
  let api;

  beforeEach(() => {
    act(() => useAuth.setState({ user: USER }));
    api = stubApi();
  });

  afterEach(() => {
    act(() => useAuth.setState({ user: null }));
  });

  it('persists the item, selects it on the line, and shows it in every item dropdown', async () => {
    await renderForm();

    await uiEvent(() => fireEvent.click(document.getElementById('line-0-item')));
    const filter = screen.getByRole('combobox', { name: 'Filter options' });
    await uiEvent(() => fireEvent.change(filter, { target: { value: 'Deep Groove Bearing' } }));
    await uiEvent(() => fireEvent.click(screen.getByRole('button', { name: /Create "Deep Groove Bearing"/ })));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/Item Name/i)).toHaveValue('Deep Groove Bearing');
    await uiEvent(() => fireEvent.click(within(dialog).getByRole('button', { name: 'Create item' })));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/items', expect.objectContaining({
      name: 'Deep Groove Bearing',
      type: 'RAW_MATERIAL',
      openingStock: 0,
    })));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.getElementById('line-0-item')).toHaveTextContent(`${CREATED_CODE} — Deep Groove Bearing`);

    await uiEvent(() => fireEvent.click(screen.getByRole('button', { name: /Add line/ })));
    await uiEvent(() => fireEvent.click(document.getElementById('line-1-item')));
    expect(await screen.findByRole('option', { name: new RegExp(`${CREATED_CODE} — Deep Groove Bearing`) })).toBeInTheDocument();
    await uiEvent(() => {});
  });

  it('hides quick-create from users without item.create permission', async () => {
    act(() => useAuth.setState({
      user: { id: 2, role: 'MANAGER', permissions: ['grn.create', 'item.read'] },
    }));
    await renderForm();

    expect(screen.queryByRole('button', { name: /New item/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create new item for line 1/ })).not.toBeInTheDocument();
    await uiEvent(() => fireEvent.click(document.getElementById('line-0-item')));
    expect(screen.queryByRole('button', { name: 'Create new item' })).not.toBeInTheDocument();
  });

  it('sends the created item id with the GRN so its stock is posted to the item master', async () => {
    await renderForm();

    await uiEvent(() => fireEvent.click(document.getElementById('partyId')));
    await uiEvent(() => fireEvent.mouseDown(screen.getByRole('option', { name: /Acme Vendor/ })));
    await uiEvent(() => fireEvent.change(document.getElementById('line-0-qty'), { target: { value: '5' } }));

    await uiEvent(() => fireEvent.click(screen.getByRole('button', { name: /New item/ })));
    const dialog = await screen.findByRole('dialog');
    await uiEvent(() => fireEvent.change(within(dialog).getByLabelText(/Item Name/i), { target: { value: 'Hydraulic Seal' } }));
    await uiEvent(() => fireEvent.click(within(dialog).getByRole('button', { name: 'Create item' })));

    await waitFor(() => expect(document.getElementById('line-0-item')).toHaveTextContent(`${CREATED_CODE} — Hydraulic Seal`));
    await uiEvent(() => fireEvent.click(screen.getByRole('button', { name: 'Save' })));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/grns', expect.objectContaining({
      partyId: VENDOR.id,
      lines: [expect.objectContaining({ itemId: CREATED_ID, qty: 5, qtyAccepted: 5 })],
    })));
    await uiEvent(() => {});
  });
});
