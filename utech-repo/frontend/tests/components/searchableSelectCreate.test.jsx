import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SearchableSelect from '../../src/components/ui/SearchableSelect';

describe('SearchableSelect — quick-create action', () => {
  it('passes the unmatched filter text to onCreate and closes the popover', () => {
    const onCreate = vi.fn();
    render(
      <SearchableSelect
        options={[]}
        value=""
        onChange={vi.fn()}
        onCreate={onCreate}
        createLabel="Create new item"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Select/ }));
    const filter = screen.getByRole('combobox', { name: 'Filter options' });
    fireEvent.change(filter, { target: { value: '  Deep Groove Bearing  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Create "Deep Groove Bearing"/ }));

    expect(onCreate).toHaveBeenCalledWith('Deep Groove Bearing');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('Enter starts the create flow when no option matches', () => {
    const onCreate = vi.fn();
    render(
      <SearchableSelect
        options={[{ value: 1, label: 'Alpha' }]}
        value=""
        onChange={vi.fn()}
        onCreate={onCreate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Select/ }));
    const filter = screen.getByRole('combobox', { name: 'Filter options' });
    fireEvent.change(filter, { target: { value: 'Beta' } });
    fireEvent.keyDown(filter, { key: 'Enter' });

    expect(onCreate).toHaveBeenCalledWith('Beta');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('Tab reaches the create action instead of dismissing the popover', () => {
    render(
      <SearchableSelect
        options={[]}
        value=""
        onChange={vi.fn()}
        onCreate={vi.fn()}
        createLabel="Create new item"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Select/ }));
    const filter = screen.getByRole('combobox', { name: 'Filter options' });
    filter.focus();
    fireEvent.keyDown(filter, { key: 'Tab' });

    expect(screen.getByRole('button', { name: 'Create new item' })).toHaveFocus();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });
});
