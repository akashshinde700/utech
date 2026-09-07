import { AlertCircle } from 'lucide-react';
import { styles } from '../../lib/formStyles';

// FormField — label + hint + error wrapper for any control (task 6-a).
// ARIA ids are deterministic: hint → `${id}-hint`, error → `${id}-error`;
// wire them manually on the control with aria-describedby / aria-invalid.
export default function FormField({ id, htmlFor, label, required = false, hint, error, children, className = '' }) {
  const hintId = id ? `${id}-hint` : undefined;
  const errorId = id ? `${id}-error` : undefined;
  return (
    <div className={className}>
      {label != null && (
        <label htmlFor={htmlFor || id} className={styles.label}>
          {label}
          {required && <span className="ml-0.5 text-danger-500"> *</span>}
        </label>
      )}
      <div className={label != null ? 'mt-1.5' : ''}>{children}</div>
      {error ? (
        <p id={errorId} role="alert" className={styles.errorText}>
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : (
        hint && (
          <p id={hintId} className={styles.hint}>
            {hint}
          </p>
        )
      )}
    </div>
  );
}
