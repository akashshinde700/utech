// FormSection — carded section of a form with icon/title/description/actions
// (task 6-a). Leave the inner layout to the consumer: drop a
// `styles.formGrid*` div of `FormField`s into children. Stack sections with a
// `space-y-5` wrapper; end the form with a `styles.actionsBar`.
export default function FormSection({ icon: Icon, title, description, actions, children, className = '' }) {
  return (
    <section className={`card-flat ${className}`}>
      {(title || actions) && (
        <div className="flex items-start gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
          {Icon && (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-sm font-semibold text-slate-800">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-4 pt-4 sm:p-5 sm:pt-4">{children}</div>
    </section>
  );
}
