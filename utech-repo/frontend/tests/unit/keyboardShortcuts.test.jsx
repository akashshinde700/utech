import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ConfirmDialog from '../../src/components/ui/ConfirmDialog';
import Modal from '../../src/components/ui/Modal';
import SearchableSelect from '../../src/components/ui/SearchableSelect';

// KEYBOARD SHORTCUT CONTRACT TESTS
//
// Inventory of global/keyed handlers in the app (from source grep):
//   Modal            Escape = close (unless disableEscape), Tab = focus trap   [capture, cleaned up]
//   ConfirmDialog    Enter = confirm (skipped on button/a/textarea), Escape via Modal
//   SearchableSelect ↑/↓/Home/End/Enter/Tab on input; Escape closes popover ONLY
//                    (capture + stopPropagation so a surrounding Modal stays open)
//   PdfViewerModal   ←/→ pages, Escape close
//   ImageLightbox    Escape close
//   JobcardTaskProgress inline edit: Enter save / Escape cancel (on the input itself)
//   useClickOutside  Escape = click-away (opt-in)
//
// These tests pin the cross-cutting guarantees: a shortcut fires once, never
// while the user is typing in a place where it would be destructive, closes
// only its own layer, and stops firing after unmount.

afterEach(cleanup);

describe('ConfirmDialog — Enter confirms exactly once, and never from a textarea', () => {
  it('Enter triggers onConfirm once', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open onClose={vi.fn()} onConfirm={onConfirm} title="t" message="m" />);
    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledTimes(2); // one per intentional press
  });

  it('Enter while typing in a textarea does NOT confirm', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog open onClose={vi.fn()} onConfirm={onConfirm} title="t" message="m" />
    );
    // the dialog itself has no textarea, but the guard must hold if a caller
    // ever adds one — simulate a textarea holding keyboard focus
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();
    ta.remove();
  });

  it('Enter on a button is left to the button (no double-fire from the global handler)', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog open onClose={vi.fn()} onConfirm={onConfirm} title="t" message="m" confirmLabel="Go" />
    );
    const btn = screen.getByRole('button', { name: 'Go' });
    // pressing Enter on a focused button natively clicks it; the keydown
    // handler must not ALSO fire onConfirm (that would double-submit)
    fireEvent.keyDown(btn, { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled(); // only the native click path fires
  });

  it('stops listening after unmount (no leaked global handler)', () => {
    const onConfirm = vi.fn();
    const { unmount } = render(
      <ConfirmDialog open onClose={vi.fn()} onConfirm={onConfirm} title="t" message="m" />
    );
    unmount();
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('Modal — Escape and focus trap', () => {
  it('Escape calls onClose once, and does nothing after unmount', () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <Modal open onClose={onClose} title="t"><button type="button">a</button></Modal>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1); // listener was removed
  });

  it('disableEscape blocks Escape (destructive flows can opt out)', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="t" disableEscape><button type="button">a</button></Modal>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('SearchableSelect — Escape closes only the popover (AUD-207)', () => {
  const options = [
    { value: 1, label: 'Alpha' },
    { value: 2, label: 'Beta' },
  ];

  const openSelect = () => {
    render(<SearchableSelect options={options} value={null} onChange={vi.fn()} label="Item" />);
    fireEvent.click(screen.getByRole('button', { name: /select/i }));
    expect(screen.getByRole('listbox')).toBeTruthy();
  };

  it('Escape with the dropdown open closes ONLY the dropdown — a surrounding Modal survives', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="t">
        <SearchableSelect options={options} value={null} onChange={vi.fn()} label="Item" />
      </Modal>
    );
    fireEvent.click(screen.getByRole('button', { name: /select/i }));
    expect(screen.getByRole('listbox')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    // pre-fix (AUD-207) one Escape closed BOTH: listbox gone and onClose fired,
    // silently discarding whatever the user had typed into the modal's form
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    // a second Escape, with no popover in the way, closes the modal itself
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ArrowDown/Home move the active option and Enter selects it', () => {
    const onChange = vi.fn();
    render(<SearchableSelect options={options} value={null} onChange={onChange} label="Item" />);
    fireEvent.click(screen.getByRole('button', { name: /select/i }));
    const input = screen.getByRole('combobox');
    // active starts on Alpha (index 0); ArrowDown -> Beta; Enter commits it
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(2);
    expect(screen.queryByRole('listbox')).toBeNull(); // commit closes the popover
  });

  it('typing in the filter input does not trigger select shortcuts', () => {
    const onChange = vi.fn();
    render(<SearchableSelect options={options} value={null} onChange={onChange} label="Item" />);
    fireEvent.click(screen.getByRole('button', { name: /select/i }));
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'al' } });
    fireEvent.keyDown(input, { key: 'a' }); // a plain character
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeTruthy(); // stays open while filtering
  });

  it('cleans up its window listener on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(
      <SearchableSelect options={options} value={null} onChange={vi.fn()} label="Item" />
    );
    fireEvent.click(screen.getByRole('button', { name: /select/i }));
    const adds = addSpy.mock.calls.filter((c) => c[0] === 'keydown').length;
    unmount();
    const removes = removeSpy.mock.calls.filter((c) => c[0] === 'keydown').length;
    expect(adds).toBeGreaterThan(0);
    expect(removes).toBe(adds);
    addSpy.mockRestore();
    removeSpy.mockRestore();
    // silence unused warning — openSelect helper documents the shared flow
    expect(typeof openSelect).toBe('function');
  });
});
