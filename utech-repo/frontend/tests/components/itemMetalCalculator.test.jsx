import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ItemForm from '../../src/pages/items/ItemForm';

const shape = { id: 'roundbar', label: 'Round Bar', formula: 'π/4 × D² × L × ρ', supportsLengthMode: true,
  fields: [{ id: 'd', label: 'Diameter (D)', symbol: 'D' }, { id: 'L', label: 'Length (L)', symbol: 'L', isLength: true }] };
const metal = { name: 'Steel', density: 7.85, group: 'Steel' };
const catalog = { shapes: [shape], metals: [metal], units: { metric: ['mm', 'cm', 'm'], imperial: ['in', 'ft', 'yd'] }, weightUnits: ['kg', 'lb'], constants: { kgToLb: 2.204622 } };

beforeEach(() => {
  const api = globalThis.__apiMock;
  api.get.mockReset(); api.post.mockReset(); api.put.mockReset();
  api.get.mockImplementation((url) => {
    if (url === '/metal-calculator/catalog') return Promise.resolve({ data: catalog });
    if (url === '/metal-calculator/profiles') return Promise.resolve({ data: { families: [] } });
    if (url === '/items/lookups') return Promise.resolve({ data: { uoms: [], categories: [] } });
    if (url === '/projects') return Promise.resolve({ data: { items: [] } });
    throw new Error(`Unexpected GET ${url}`);
  });
  api.post.mockImplementation((url, body) => {
    if (url === '/items/weight-preview') return Promise.resolve({ data: { weightKg: 61.654, shape: 'roundbar' } });
    if (url === '/items') return Promise.resolve({ data: { id: 1 } });
    if (url === '/metal-calculator/calculate') {
      return Promise.resolve({ data: {
        mode: body.mode, shape, metal, density: body.density ?? metal.density, standardProfile: null,
        dimensions: shape.fields.map((f) => ({ ...f, value: body.values[f.id] ?? null, unit: body.unit })),
        lengthMm: body.mode === 'length' ? 1000 : 1000,
        lengthUnit: body.unit, totalLength: 1000,
        weightUnit: body.weightUnit, rateUnit: body.weightUnit,
        pieces: body.pieces, pieceWeight: 61.654, totalWeight: 61.654, rate: body.rate, totalPrice: null,
      } });
    }
    throw new Error(`Unexpected POST ${url}`);
  });
});

async function openCalculator() {
  render(<MemoryRouter><ItemForm /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText(/Item Name/), { target: { value: 'Steel round bar' } });
  fireEvent.click(screen.getByRole('button', { name: 'Calculate material size' }));
  await screen.findByLabelText('Material shape');
  fireEvent.change(document.getElementById('mc-d'), { target: { value: '100' } });
}

describe('item metal calculator', () => {
  it('applies the size and explicit converted kg rate, then saves the item', async () => {
    await openCalculator();
    fireEvent.change(document.getElementById('mc-L'), { target: { value: '1000' } });
    fireEvent.change(document.getElementById('mc-weight-unit'), { target: { value: 'lb' } });
    fireEvent.change(document.getElementById('mc-rate'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate', exact: true }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use size and rate per kg' }));
    await waitFor(() => expect(screen.getByLabelText('Material Size')).toHaveValue('Calculator roundbar: 100 mm X 1000 mm'));
    expect(document.getElementById('item-metal')).toHaveValue('Steel');
    expect(document.getElementById('item-rate-per-kg')).toHaveValue(22.05);
    await waitFor(() => expect(screen.getByText('61.654 kg')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Use as purchase rate' }));
    expect(document.getElementById('item-purchase-rate')).toHaveValue(1359.47);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(globalThis.__apiMock.post).toHaveBeenCalledWith('/items', expect.objectContaining({
      name: 'Steel round bar', size: 'Calculator roundbar: 100 mm X 1000 mm', metal: 'Steel', ratePerKg: 22.05, purchaseRate: 1359.47,
    })));
  });

  it('calculates length from weight and saves the rounded length in millimetres', async () => {
    await openCalculator();
    fireEvent.change(screen.getByLabelText('Calculate'), { target: { value: 'length' } });
    fireEvent.change(document.getElementById('mc-total-weight'), { target: { value: '61.654' } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate', exact: true }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use this material size' }));
    await waitFor(() => expect(screen.getByLabelText('Material Size')).toHaveValue('Calculator roundbar: 100 mm X 1000 mm'));
    expect(globalThis.__apiMock.post).toHaveBeenCalledWith('/metal-calculator/calculate', expect.objectContaining({ mode: 'length', totalWeight: 61.654 }));
  });

  it('does not apply a result based on a custom density', async () => {
    await openCalculator();
    fireEvent.change(document.getElementById('mc-L'), { target: { value: '1000' } });
    fireEvent.change(document.getElementById('mc-density'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate', exact: true }));
    expect(await screen.findByText(/Custom density or standard profile results cannot be saved/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use this material size' })).not.toBeInTheDocument();
  });
});
