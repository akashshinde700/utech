import { useEffect, useState } from 'react';
import { WifiOff, RotateCcw } from 'lucide-react';

// OfflineBanner — factory Wi-Fi drops are routine, and an ERP must never let
// a user believe a stock/invoice transaction saved when it did not. This
// banner makes the connection state unmissable, and the app shell (cached by
// the service worker) keeps rendering it while offline. Transactions are NOT
// queued or replayed: inventory movements are not idempotent, so the user
// retries explicitly once the connection is back.
export default function OfflineBanner() {
  const [online, setOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine !== false,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div
      role="alert"
      className="no-print sticky top-0 z-40 flex flex-wrap items-center gap-x-3 gap-y-1 bg-amber-500 px-3 py-2 text-[13px] font-semibold text-amber-950 sm:px-5"
    >
      <span className="flex items-center gap-2">
        <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        You are offline. Live stock, billing and production data cannot load or save right now.
      </span>
      <button
        type="button"
        className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-amber-950/10 px-3 py-1.5 text-xs font-bold text-amber-950 transition-colors hover:bg-amber-950/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-950/50"
        onClick={() => window.location.reload()}
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
      </button>
    </div>
  );
}
