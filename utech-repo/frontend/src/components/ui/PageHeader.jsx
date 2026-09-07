import { ChevronRight } from 'lucide-react';

// PageHeader — breadcrumb eyebrow + title + optional subtitle on the left,
// action buttons pushed right (task 6-d polish: optional icon chip rendered in
// the FormSection style, and `actions` accepted as an alias of `action`).
// Layout wraps on small screens so long action rows don't overflow.
export default function PageHeader({ title, subtitle, action, actions, icon: Icon }) {
  return (
    <div className="animate-fade-in mb-6 flex flex-wrap items-end justify-between gap-3 sm:gap-4">
      <div className="min-w-0">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          <span>ERP</span>
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
          <span className="text-brand-600">{title}</span>
        </div>
        <div className="flex items-center gap-3">
          {Icon && (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600" aria-hidden="true">
              <Icon className="h-4 w-4" />
            </span>
          )}
          <h1 className="truncate text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        </div>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {(action || actions) && (
        <div className="flex flex-wrap items-center gap-2">{action || actions}</div>
      )}
    </div>
  );
}
