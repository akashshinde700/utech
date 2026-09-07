import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const SIZES = {
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'h-[92vh] max-w-[96vw] w-[96vw]',
};

// ref-counted body scroll lock so stacked modals restore correctly
let openModalCount = 0;

function lockBodyScroll() {
  openModalCount += 1;
  if (openModalCount === 1) document.body.style.overflow = 'hidden';
}

function unlockBodyScroll() {
  openModalCount = Math.max(0, openModalCount - 1);
  if (openModalCount === 0) document.body.style.overflow = '';
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Modal — portal dialog with focus trap, Escape close and body scroll lock
// (task 6-a). Sizes: md | lg | xl | full.
export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnOverlay = true,
  disableEscape = false,
}) {
  const panelRef = useRef(null);
  const previouslyFocused = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    previouslyFocused.current = document.activeElement;
    lockBodyScroll();

    // initial focus: first focusable element in the panel, else the panel itself
    const t = setTimeout(() => {
      const el = panelRef.current;
      if (!el) return;
      const first = el.querySelector(FOCUSABLE);
      (first || el).focus?.();
    }, 0);

    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !disableEscape) {
        e.stopPropagation();
        onClose?.();
      } else if (e.key === 'Tab') {
        // focus trap — cycle within the panel
        const el = panelRef.current;
        if (!el) return;
        const focusables = Array.from(el.querySelectorAll(FOCUSABLE)).filter((n) => n.offsetParent !== null || n === document.activeElement);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKeyDown, true);
      unlockBodyScroll();
      // restore focus to whatever had it before the modal opened
      if (previouslyFocused.current && previouslyFocused.current.focus) {
        try {
          previouslyFocused.current.focus();
        } catch {
          /* element may have been removed */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, disableEscape]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] grid animate-fade-in place-items-center bg-black/50 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(e) => {
        if (closeOnOverlay && e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={`flex max-h-[92vh] w-full ${SIZES[size] || SIZES.md} animate-scale-in flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl outline-none`}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            {title && <h2 id={titleId} className="text-base font-bold text-slate-900">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
          </div>
          <button
            type="button"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">{children}</div>

        {footer && (
          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
