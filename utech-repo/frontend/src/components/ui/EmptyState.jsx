// EmptyState — centered "nothing here" block with optional CTA (task 6-a).
// Pass a lucide icon component, copy, and optionally:
//   action={{ label: 'New GRN', onClick: fn, icon: Plus }}
export default function EmptyState({ icon: Icon, title, description, action, className = '' }) {
  const ActionIcon = action?.icon;
  return (
    <div className={`flex flex-col items-center justify-center px-6 py-12 text-center ${className}`}>
      {Icon && (
        <span className="grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-400">
          <Icon className="h-7 w-7" aria-hidden="true" />
        </span>
      )}
      <h3 className="mt-4 text-sm font-semibold text-slate-800">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action?.onClick && (
        <button type="button" className="btn-primary mt-5 h-9 px-3.5 text-sm" onClick={action.onClick}>
          {ActionIcon && <ActionIcon className="h-4 w-4" aria-hidden="true" />}
          {action.label}
        </button>
      )}
    </div>
  );
}
