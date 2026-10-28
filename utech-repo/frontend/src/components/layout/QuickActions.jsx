import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Command, Search, X } from 'lucide-react';

/** Permission-filtered keyboard navigation and common create actions. */
export default function QuickActions({ items, open, onOpenChange }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    setActiveIndex(0);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    const onEscape = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onOpenChange(false);
      }
    };
    window.addEventListener('keydown', onEscape, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onEscape, true);
    };
  }, [open, onOpenChange]);

  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return items;
    return items.filter((item) => `${item.label} ${item.description || ''} ${item.keywords || ''}`.toLocaleLowerCase().includes(needle));
  }, [items, query]);

  useEffect(() => setActiveIndex((index) => Math.min(index, Math.max(results.length - 1, 0))), [results.length]);

  const choose = (item) => {
    onOpenChange(false);
    navigate(item.to);
  };

  const onInputKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => results.length ? (index + 1) % results.length : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => results.length ? (index - 1 + results.length) % results.length : 0);
    } else if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault();
      choose(results[activeIndex]);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        aria-label="Search pages and actions (Ctrl or Command Shift K)"
        className="hidden md:flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 hover:border-slate-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        <span>Search pages and actions</span>
        <kbd className="ml-2 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">Ctrl ⇧ K</kbd>
      </button>
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        aria-label="Search pages and actions (Ctrl or Command Shift K)"
        className="md:hidden grid h-10 w-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
      >
        <Search className="h-5 w-5" aria-hidden="true" />
      </button>

      {open && (
        <div className="no-print fixed inset-0 z-[100] flex items-start justify-center bg-slate-950/45 px-3 pt-[12vh] backdrop-blur-[2px] sm:px-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onOpenChange(false); }}>
          <section role="dialog" aria-modal="true" aria-label="Quick navigation" className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-slide-up">
            <div className="flex items-center gap-3 border-b border-slate-100 px-4">
              <Search className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
                onKeyDown={onInputKeyDown}
                placeholder="Find a page or action…"
                aria-label="Search pages and actions"
                aria-controls="quick-actions-results"
                aria-activedescendant={results[activeIndex] ? `quick-action-${activeIndex}` : undefined}
                className="h-14 min-w-0 flex-1 border-0 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:ring-0"
              />
              <button type="button" aria-label="Close quick navigation" onClick={() => onOpenChange(false)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>
            </div>
            <div id="quick-actions-results" role="listbox" aria-label="Pages and actions" className="max-h-[min(55vh,420px)] overflow-y-auto p-2">
              {results.length ? results.map((item, index) => (
                <button
                  id={`quick-action-${index}`}
                  key={`${item.label}-${item.to}`}
                  type="button"
                  role="option"
                  aria-selected={activeIndex === index}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(item)}
                  className={`flex w-full items-center justify-between gap-4 rounded-xl px-3 py-3 text-left transition-colors ${activeIndex === index ? 'bg-brand-50 text-brand-900' : 'text-slate-700 hover:bg-slate-50'}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{item.label}</span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500">{item.description}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                </button>
              )) : <p className="px-4 py-8 text-center text-sm text-slate-500">No matching pages or actions. Try a different search.</p>}
            </div>
            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/80 px-4 py-3 text-[11px] text-slate-500">
              <span className="flex items-center gap-1.5"><Command className="h-3.5 w-3.5" /> Ctrl/⌘ ⇧ K to open <span className="px-1">·</span> / to search <span className="px-1">·</span> ? for shortcuts</span>
              <span>↑ ↓ move <span className="px-1">·</span> Enter open <span className="px-1">·</span> Esc close</span>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
