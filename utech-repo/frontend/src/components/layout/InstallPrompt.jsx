import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';

// "Install app" button for the PWA. Chromium fires `beforeinstallprompt`
// when the app is installable (manifest + service worker + icons); we stash
// the event and only then show the button — so it never appears in a plain
// browser tab where installing is impossible, and disappears once installed.
// iOS Safari has no such event: there the user installs via Share ->
// "Add to Home Screen" (the apple-touch meta tags in index.html cover it).
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);

  useEffect(() => {
    const onPrompt = (event) => {
      event.preventDefault();
      setDeferred(event);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!deferred) return null;

  return (
    <button
      type="button"
      className="btn-icon relative"
      aria-label="Install U-Tech ERP app"
      title="Install U-Tech ERP app"
      onClick={async () => {
        deferred.prompt();
        await deferred.userChoice;
        setDeferred(null);
      }}
    >
      <Download className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
