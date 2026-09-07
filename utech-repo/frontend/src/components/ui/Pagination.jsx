import { ChevronLeft, ChevronRight } from 'lucide-react';
import { styles } from '../../lib/formStyles';

// Pagination — consistent with the DataTable shell (task 6-d).
//
// Props:
//   pagination  { page, totalPages, total } — as returned by the API list pages
//   onPage(n)   called with the target page (1-based)
//   pageSize    optional — enables the "Showing 11–20 of 134 records" range text
//   itemLabel   optional noun for the range/total text (default 'records')
//
// Fully keyboard accessible: Prev/Next are real buttons with visible focus
// rings and disabled states; the current page is marked aria-current="page".
export default function Pagination({ pagination, onPage, pageSize, itemLabel = 'records' }) {
  if (!pagination) return null;
  const { page, totalPages, total } = pagination;
  // an empty list reports 0 total pages — "Page 1 of 1" reads better than "of 0"
  const lastPage = Math.max(1, totalPages || 1);
  const count = Number(total) || 0;

  const range =
    pageSize && count > 0
      ? `Showing ${Math.min((page - 1) * pageSize + 1, count)}–${Math.min(page * pageSize, count)} of ${count}`
      : `${count} ${itemLabel}`;

  const btn = `${styles.secondaryBtn} !h-8 !px-2.5 !text-xs`;

  return (
    <nav
      className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white px-4 py-3 text-sm shadow-sm animate-fade-in"
      aria-label="Table pagination"
    >
      <div className="text-slate-500">
        Page{' '}
        <span className="font-semibold text-brand-700 tabular-nums" aria-current="page">
          {page}
        </span>{' '}
        of <span className="font-semibold text-slate-800">{lastPage}</span>
        <span className="mx-2 text-slate-300">|</span>
        <span className="text-slate-400 tabular-nums">{range}</span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className={btn}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Prev
        </button>
        <button
          type="button"
          className={btn}
          disabled={page >= lastPage}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
