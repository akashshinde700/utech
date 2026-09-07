import { useEffect, useRef } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import Modal from './Modal';
import { styles } from '../../lib/formStyles';

// ConfirmDialog — confirmation modal on top of Modal (task 6-a).
// variant 'destructive' renders a red badge + danger confirm button.
// Keyboard: Enter = confirm, Escape = cancel (Escape handled by Modal).
export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  loading = false,
}) {
  const destructive = variant === 'destructive';
  const busyRef = useRef(false);
  busyRef.current = loading;

  // Enter confirms — unless focus is already on a button/link/textarea (those
  // handle Enter themselves) or the dialog is mid-flight
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== 'Enter' || busyRef.current) return;
      const t = e.target;
      const tag = (t?.tagName || '').toLowerCase();
      if (['button', 'a', 'textarea'].includes(tag)) return;
      e.preventDefault();
      onConfirm?.();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onConfirm]);

  return (
    <Modal open={open} onClose={onClose} title={title} size="md" disableEscape={false}>
      <div className="flex items-start gap-3">
        <span
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${
            destructive ? 'bg-danger-50 text-danger-600' : 'bg-brand-50 text-brand-600'
          }`}
        >
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 pt-0.5 text-sm text-slate-600">{message}</div>
      </div>

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={loading}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={destructive ? styles.dangerBtn : styles.primaryBtn}
          onClick={onConfirm}
          disabled={loading}
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {loading ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
