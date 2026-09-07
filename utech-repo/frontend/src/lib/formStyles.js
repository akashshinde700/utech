// formStyles.js — the single source of class-string constants for every form in
// the app (task 6-a). Waves B/C/D must style inputs/buttons with these so all
// forms look identical. Tokens follow the existing palette in tailwind.config.js:
// primary = brand (violet), destructive = danger (red), muted = slate.
// Do NOT edit without updating docs/FORMS_UX_PLAN.md — it is a shared contract.

export const styles = {
  // ---- fields -------------------------------------------------------------
  // base text input; concat styles.inputError when the field has an error
  input:
    'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 shadow-sm transition outline-none placeholder:text-slate-400 ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 focus-visible:border-brand-500 ' +
    'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-60',
  inputError:
    'border-danger-500 hover:border-danger-500 focus-visible:border-danger-500 focus-visible:ring-danger-500/25',
  textarea:
    'min-h-[80px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm transition outline-none placeholder:text-slate-400 ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 focus-visible:border-brand-500 ' +
    'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-60',
  label: 'block text-sm font-medium text-slate-700',
  hint: 'mt-1 text-xs text-slate-400',
  errorText: 'mt-1 flex items-center gap-1 text-xs text-danger-600',
  // trigger button look for SearchableSelect (matches styles.input)
  selectBtn:
    'flex h-10 w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 text-left text-sm shadow-sm transition ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 focus-visible:border-brand-500 ' +
    'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-60',

  // ---- buttons --------------------------------------------------------------
  primaryBtn:
    'inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm transition-all ' +
    'hover:bg-brand-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 ' +
    'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
  secondaryBtn:
    'inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition-all ' +
    'hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40 ' +
    'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
  ghostBtn:
    'inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-transparent px-3 text-sm font-medium text-slate-600 transition-all ' +
    'hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40 ' +
    'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
  dangerBtn:
    'inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-danger-600 px-4 text-sm font-medium text-white shadow-sm transition-all ' +
    'hover:bg-danger-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger-500/50 focus-visible:ring-offset-2 ' +
    'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',

  // ---- layout ----------------------------------------------------------------
  formGrid: 'grid grid-cols-1 gap-4 sm:grid-cols-2',
  formGrid3: 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3',
  formGrid4: 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4',
  // sticky save/cancel bar for long forms; sit inside the form's last FormSection
  // or directly at the end of a <form className="card …"> — negative margins let
  // the gradient bleed to the card edges
  actionsBar:
    'sticky bottom-0 z-10 -mx-4 mt-6 flex flex-col-reverse gap-2 border-t border-slate-100 bg-gradient-to-t from-white via-white to-white/70 px-4 py-3 backdrop-blur-sm sm:-mx-5 sm:flex-row sm:justify-end sm:px-5',
  sectionCard: 'card-flat',
};

export default styles;
