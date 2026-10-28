import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ItemForm from '../../src/pages/items/ItemForm';

// Defining an item through the material size calculator already says what kind
// of material it is, and this plant's categories are those kinds. So the
// category is filled from the shape — but only when it is empty, and only with
// a category this site actually has.

const shape = {
  id: 'roundbar', label: 'Round Bar', formula: 'π/4 × D² × L × ρ', supportsLengthMode: true,
  fields: [{ id: 'd', label: 'Diameter (D)', symbol: 'D' }, { id: 'L', label: 'Length (L)', symbol: 'L', isLength: true }],
};
const metal = { name: 'Steel', density: 7.85, group: 'Steel' };
const catalog = {
  shapes: [shape], metals: [metal],
  units: { metric: ['mm', 'cm', 'm'], imperial: ['in', 'ft', 'yd'], factorsToMm: { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8, yd: 914.4 } },
  weightUnits: ['kg', 'lb'], constants: { kgToLb: 2.204622 },
};
// the live site's own list
const CATEGORIES = [
  { id: 3, name: 'Pipe' }, { id: 5, name: 'Plate' }, { id: 6, name: 'Round Bar & Hex' }, { id: 8, name: 'Steel' },
];

function mockApi({ categories = CATEGORIES } = {}) {
  const api = globalThis.__apiMock;
  api.get.mockReset(); api.post.mockReset(); api.put.mockReset();
  api.get.mockImplementation((url) => {
    if (url === '/metal-calculator/catalog') return Promise.resolve({ data: catalog });
    if (url === '/metal-calculator/profiles') return Promise.resolve({ data: { families: [] } });
    if (url === '/items/lookups') return Promise.resolve({ data: { uoms: [], categories } });
    if (url === '/projects') return Promise.resolve({ data: { items: [] } });
    throw new Error(`Unexpected GET ${url}`);
  });
  api.post.mockImplementation((url, body) => {
    if (url === '/items/weight-preview') return Promise.resolve({ data: { weightKg: 61.654, shape: 'roundbar' } });
    if (url === '/items') return Promise.resolve({ data: { id: 1 } });
    if (url === '/metal-calculator/calculate') {
      return Promise.resolve({ data: {
        mode: body.mode, shape, metal, density: metal.density, standardProfile: null,
        dimensions: shape.fields.map((f) => ({ ...f, value: body.values[f.id] ?? null, unit: body.unit })),
        lengthMm: 1000, lengthUnit: body.unit, totalLength: 1000,
        weightUnit: body.weightUnit, rateUnit: body.weightUnit,
        pieces: body.pieces, pieceWeight: 61.654, totalWeight: 61.654, rate: body.rate, totalPrice: null,
      } });
    }
    throw new Error(`Unexpected POST ${url}`);
  });
  return api;
}

async function calculateARoundBar() {
  render(<MemoryRouter><ItemForm /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText(/Item Name/), { target: { value: 'Steel round bar' } });
  fireEvent.click(screen.getByRole('button', { name: 'Calculate material size' }));
  await screen.findByLabelText('Material shape');
  fireEvent.change(document.getElementById('mc-d'), { target: { value: '100' } });
  fireEvent.change(document.getElementById('mc-L'), { target: { value: '1000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Calculate', exact: true }));
  await waitFor(() => expect(screen.getByLabelText('Material Size')).toHaveValue('Calculator roundbar: 100 mm X 1000 mm'));
}

describe('the category follows the calculated shape', () => {
  beforeEach(() => { mockApi(); });

  it('fills an empty category from the shape, and says where it came from', async () => {
    await calculateARoundBar();
    await waitFor(() => expect(screen.getByText(/Set from the material shape you calculated/)).toBeInTheDocument());
    expect(screen.getByText('Round Bar & Hex')).toBeInTheDocument();
  });

  it('saves that category with the item', async () => {
    await calculateARoundBar();
    await waitFor(() => expect(screen.getByText(/Set from the material shape you calculated/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(globalThis.__apiMock.post).toHaveBeenCalledWith('/items', expect.objectContaining({
      categoryId: 6,
    })));
  });

  it('leaves a category alone when this site does not have one for the shape', async () => {
    mockApi({ categories: [{ id: 1, name: 'Consumables' }] });
    await calculateARoundBar();
    expect(screen.queryByText(/Set from the material shape you calculated/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(globalThis.__apiMock.post).toHaveBeenCalledWith('/items', expect.anything()));
    const call = globalThis.__apiMock.post.mock.calls.find((c) => c[0] === '/items');
    expect(call[1].categoryId).toBeFalsy(); // left as the user had it: unset
  });
});
