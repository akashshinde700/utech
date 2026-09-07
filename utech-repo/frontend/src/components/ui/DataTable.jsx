import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, FileX, RotateCcw } from 'lucide-react';
import EmptyState from './EmptyState';

// align → tailwind class for optional column header alignment (additive; most
// callers don't pass it and keep the table-th default left alignment)
const ALIGN_CLASS = { left: 'text-left', center: 'text-center', right: 'text-right' };

// Sticky-header classes applied only when `maxHeight` is set — the translucent
// table-th background would let rows bleed through while scrolling, so sticky
// cells get a solid background plus a hairline shadow that reads as the
// existing border-b.
const STICKY_TH =
  'sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]';

// sortable header cell content — a real <button> (keyboard reachable) that
// delegates entirely to the page via onSort(key, nextDir). DataTable never
// sorts rows itself: pages own their data (server pagination stays authoritative).
function SortHeader({ col, sort, onSort }) {
  const active = sort?.key != null && sort.key === col.key;
  const dir = active ? sort.dir || 'asc' : null;
  const Icon = !active ? ArrowUpDown : dir === 'desc' ? ArrowDown : ArrowUp;
  const nextDir = active && dir === 'asc' ? 'desc' : 'asc';
  return (
    <button
      type="button"
      onClick={() => onSort(col.key, nextDir)}
      className="group inline-flex items-center gap-1.5 outline-none transition-colors hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500/40 rounded"
      aria-label={`Sort by ${typeof col.title === 'string' ? col.title : col.key}`}
    >
      {col.title}
      <Icon
        className={`h-3 w-3 shrink-0 transition-colors ${active ? 'text-brand-600' : 'text-slate-400 opacity-60 group-hover:opacity-100'}`}
        aria-hidden="true"
      />
    </button>
  );
}

export default function DataTable({
  columns,
  rows,
  empty = 'No records',
  onRowClick,
  loading = false,
  error = null,
  onRetry,
  filtered = false,
  // ---- additive, fully optional (task 6-d) --------------------------------
  // maxHeight: number(px) or CSS length — makes the scroll container cap its
  // height and pins the header row while the body scrolls. Default: off.
  maxHeight,
  // sortable columns: pass sort={{ key, dir: 'asc'|'desc' }} + onSort(key, dir);
  // a column opts in with sortable: true. Pages that don't pass these are
  // untouched (plain th text as before). No internal sorting ever happens.
  sort,
  onSort,
  // empty-state customization: CTA + copy overrides. Defaults preserve the
  // historic "No records / Create your first record…" text exactly.
  emptyTitle,
  emptyDescription,
  emptyAction, // { label, onClick, icon }
  // zebra striping — default ON so every existing table looks unchanged.
  striped = true,
}) {
  const scrollStyle = maxHeight != null ? { maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight } : undefined;
  const sticky = maxHeight != null;

  const emptyTitleText = filtered
    ? 'No matches found'
    : emptyTitle ?? empty ?? 'No records';
  const emptyDescriptionText = filtered
    ? 'Try clearing filters or search'
    : emptyDescription ?? 'Create your first record to get started';

  const renderTh = (c, idx) => {
    const cls = [
      'table-th',
      idx === 0 ? 'rounded-tl-lg' : '',
      idx === columns.length - 1 ? 'rounded-tr-lg' : '',
      sticky ? STICKY_TH : '',
      c.align ? ALIGN_CLASS[c.align] || '' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const sorted = onSort && c.sortable && sort?.key != null && sort.key === c.key;
    return (
      <th
        key={c.key}
        className={cls}
        style={{ width: c.width }}
        aria-sort={sorted ? (sort.dir === 'desc' ? 'descending' : 'ascending') : undefined}
      >
        {onSort && c.sortable ? <SortHeader col={c} sort={sort} onSort={onSort} /> : c.title}
      </th>
    );
  };

  if (loading) {
    // skeleton rows keep the table layout stable while the first page loads
    return (
      <div className="card-flat overflow-hidden shadow-sm animate-fade-in">
        <div className="overflow-x-auto scroll-x-hint" style={scrollStyle}>
          <table className="min-w-full">
            <thead>
              <tr>{columns.map((c, idx) => renderTh(c, idx))}</tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className={striped && i % 2 === 1 ? 'bg-slate-50/30' : ''}>
                  {columns.map((c) => (
                    <td key={c.key} className="table-td">
                      <div className="h-3.5 rounded bg-slate-200/70 animate-pulse" style={{ width: `${55 + ((i * 13 + c.key.length * 7) % 35)}%` }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="card-flat overflow-hidden shadow-sm animate-fade-in">
      {error && (
        <div className="flex items-center justify-between gap-3 bg-danger-50 border-b border-danger-100 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-danger-700">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          {onRetry && (
            <button className="btn-secondary !px-3 !py-1 text-xs" onClick={onRetry}>
              <RotateCcw className="w-3.5 h-3.5" /> Retry
            </button>
          )}
        </div>
      )}
      <div className={`overflow-x-auto scroll-x-hint ${sticky ? 'overflow-y-auto' : ''}`} style={scrollStyle}>
        <table className="min-w-full">
          <thead>
            <tr>{columns.map((c, idx) => renderTh(c, idx))}</tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState
                    icon={FileX}
                    title={emptyTitleText}
                    description={emptyDescriptionText}
                    action={emptyAction}
                  />
                </td>
              </tr>
            )}
            {rows.map((row, i) => (
              <tr
                key={row.id ?? i}
                className={`transition-colors duration-150 ${onRowClick ? 'cursor-pointer hover:bg-slate-50' : 'hover:bg-slate-50/40'} ${striped && i % 2 === 1 ? 'bg-slate-50/30' : ''}`}
                onClick={() => onRowClick && onRowClick(row)}
              >
                {columns.map((c) => (
                  <td key={c.key} className="table-td">
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
