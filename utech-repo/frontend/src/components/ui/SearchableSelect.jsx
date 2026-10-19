import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react';
import { styles } from '../../lib/formStyles';
import useClickOutside from '../../lib/useClickOutside';

// values may arrive as strings (inputs) or numbers (api ids) — compare loosely
const same = (a, b) => String(a) === String(b);

// SearchableSelect — button-triggered, filterable listbox replacing raw
// <select> for entity pickers (task 6-a). Dependency-free.
//
// Props:
//   value                 currently selected raw value (string or number)
//   onChange(value)       called with the RAW option value ('' when cleared)
//   options               [{ value, label, subtitle? }]
//   placeholder           trigger text when nothing selected
//   disabled / error      state styling
//   loading               shows a spinner row while options load
//   allowClear            show the × clear button (default true)
//   emptyText             text when the filter matches nothing
//   className / id        wrapper class + ARIA/id wiring
export default function SearchableSelect({
  value,
  onChange,
  options = [],
  placeholder = 'Select…',
  disabled = false,
  error = null,
  loading = false,
  allowClear = true,
  emptyText = 'No matches found',
  className = '',
  id,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [fixedStyle, setFixedStyle] = useState(null);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const optionRefs = useRef([]);
  const reactId = useId();
  const baseId = id || `sselect-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const listboxId = `${baseId}-listbox`;
  const errorId = id ? `${id}-error` : undefined;

  const sameValue = (v) => same(v, value);
  const selected = useMemo(() => options.find((o) => sameValue(o.value)) || null, [options, value]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        String(o.label ?? '').toLowerCase().includes(q) ||
        (o.subtitle != null && String(o.subtitle).toLowerCase().includes(q))
    );
  }, [options, query]);

  useClickOutside(rootRef, () => setOpen(false), { active: open });

  // Escape must close ONLY the popover (topmost layer wins). The listener is
  // registered on `window` in the capture phase — one node ABOVE the
  // surrounding Modal's `document` capture listener — so stopPropagation()
  // actually keeps the event from reaching the Modal at all.
  //
  // AUD-207: this used to listen on `document` like the Modal does. Two
  // same-node listeners both run regardless of stopPropagation(), and the
  // Modal's handler registered first (it mounts before the popover opens), so
  // one Escape closed the dropdown AND the whole modal — throwing away the
  // user's unsaved form input.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyCapture = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', onKeyCapture, true);
    return () => window.removeEventListener('keydown', onKeyCapture, true);
  }, [open]);

  // Reposition on scroll/resize when open; only close if the trigger scrolled out of view
  // Only use fixed positioning when inside a horizontal-scroll table wrapper
  // outside a dialog so the listbox is never clipped by overflow-x-auto
  const updatePosition = useCallback(() => {
    const el = rootRef.current;
    if (!el || typeof el.getBoundingClientRect !== 'function') return;
    const inScrollTable = el.closest?.('.overflow-x-auto') && !el.closest?.('[role="dialog"]');
    if (!inScrollTable) {
      setFixedStyle(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const vh = window.innerHeight || 900;
      const spaceBelow = vh - rect.bottom;
      const openUpward = spaceBelow < 260 && rect.top > spaceBelow;
      setFixedStyle({
        position: 'fixed',
        ...(openUpward
          ? { bottom: `${vh - rect.top + 4}px` }
          : { top: `${rect.bottom + 4}px` }),
        left: `${rect.left}px`,
        width: `${Math.max(rect.width, 220)}px`,
      });
    } else {
      setFixedStyle(null);
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    updatePosition();
    const onScroll = (e) => {
      if (listRef.current && listRef.current.contains(e.target)) return;
      if (rootRef.current && rootRef.current.contains(e.target)) return;
      updatePosition();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, updatePosition]);

  const openPopover = useCallback(() => {
    if (disabled || loading) return;
    setQuery('');
    // start keyboard navigation on the selected entry, else the first option
    const idx = Math.max(0, options.findIndex((o) => same(o.value, value)));
    setActiveIndex(options.length ? idx : 0);
    updatePosition();
    setOpen(true);
  }, [disabled, loading, options, value, updatePosition]);

  useEffect(() => {
    if (!open) return;
    // focus the filter input on the next frame without scrolling ancestor containers
    const t = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(t);
  }, [open]);

  // keep the active option visible inside the listbox without scrolling page/table ancestors
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const el = optionRefs.current[activeIndex];
    if (list && el && list.clientHeight > 0) {
      const top = el.offsetTop;
      const bottom = top + el.offsetHeight;
      if (top < list.scrollTop) {
        list.scrollTop = top;
      } else if (bottom > list.scrollTop + list.clientHeight) {
        list.scrollTop = bottom - list.clientHeight;
      }
    }
  }, [activeIndex, open]);

  const commit = (option) => {
    onChange(option.value);
    setOpen(false);
  };

  const clear = (e) => {
    e.stopPropagation();
    onChange('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        openPopover();
        return;
      }
      if (!filtered.length) return;
      setActiveIndex((i) => {
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        return (i + dir + filtered.length) % filtered.length;
      });
    } else if (e.key === 'Home' && open && filtered.length) {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End' && open && filtered.length) {
      e.preventDefault();
      setActiveIndex(filtered.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!open) {
        openPopover();
      } else if (filtered[activeIndex]) {
        commit(filtered[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      // normally handled (and stopped) by the capture listener above while open
      if (open) setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const triggerClasses = [styles.selectBtn, error ? styles.inputError : 'border-slate-300', open ? 'ring-2 ring-brand-500/30 border-brand-500' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={`relative ${className}`} ref={rootRef}>
      <button
        type="button"
        id={id}
        className={triggerClasses}
        onClick={() => (open ? setOpen(false) : openPopover())}
        onKeyDown={onKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-invalid={!!error}
        aria-describedby={errorId}
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? 'text-slate-800' : 'text-slate-400'}`}>
          {selected ? selected.label : placeholder}
        </span>
        {allowClear && selected && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear selection"
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            onClick={clear}
          >
            <X className="h-3.5 w-3.5" />
          </span>
        )}
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div
          style={fixedStyle || undefined}
          className={`${fixedStyle ? 'z-[100]' : 'absolute z-50 mt-1 w-full'} rounded-lg border border-slate-200 bg-white shadow-lg animate-fade-in`}
        >
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
              placeholder="Type to filter…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-controls={listboxId}
              aria-expanded="true"
              aria-autocomplete="list"
              aria-activedescendant={filtered[activeIndex] ? `${listboxId}-opt-${activeIndex}` : undefined}
              aria-label="Filter options"
            />
            {filtered.length > 50 && (
              <span className="shrink-0 text-[11px] font-medium text-slate-400">{filtered.length} matches</span>
            )}
          </div>

          <ul id={listboxId} role="listbox" ref={listRef} className="max-h-60 overflow-y-auto py-1">
            {loading ? (
              <li className="flex items-center gap-2 px-3 py-2.5 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
              </li>
            ) : filtered.length === 0 ? (
              <li className="px-3 py-2.5 text-sm text-slate-400">{emptyText}</li>
            ) : (
              filtered.map((opt, i) => {
                const isSelected = same(opt.value, value);
                const isActive = i === activeIndex;
                return (
                  <li
                    key={String(opt.value)}
                    id={`${listboxId}-opt-${i}`}
                    role="option"
                    aria-selected={isSelected}
                    ref={(el) => {
                      optionRefs.current[i] = el;
                    }}
                    className={`flex cursor-pointer items-start gap-2 px-3 py-2 text-sm ${
                      isActive ? 'bg-brand-50 text-brand-900' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                    onMouseEnter={() => setActiveIndex(i)}
                    // mousedown so the choice lands before any outside-click handler fires
                    onMouseDown={(e) => {
                      e.preventDefault();
                      commit(opt);
                    }}
                  >
                    <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center">
                      {isSelected && <Check className="h-4 w-4 text-brand-600" aria-hidden="true" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{opt.label}</span>
                      {opt.subtitle && <span className="block truncate text-xs text-slate-400">{opt.subtitle}</span>}
                    </span>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
