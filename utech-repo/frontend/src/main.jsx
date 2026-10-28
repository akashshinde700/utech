import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import App from './App.jsx';
import '@fontsource-variable/manrope';
import './styles.css';

// Last line of defense: a render-time exception anywhere in the tree would
// otherwise unmount React and leave a blank white page with no recovery path.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled render error:', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-dvh grid place-items-center bg-slate-50 p-6">
          <div className="card p-8 max-w-md w-full text-center">
            <div className="text-3xl mb-3">⚠️</div>
            <div className="text-lg font-bold text-slate-900 mb-1">Something went wrong</div>
            <div className="text-sm text-slate-500 mb-5 break-words">
              {this.state.error?.message || 'An unexpected error occurred while rendering this page.'}
            </div>
            <button className="btn-primary w-full" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// PWA: register the service worker (public/sw.js) in production builds only.
// Dev stays SW-free so Vite's module server can never serve a stale shell.
// The worker never caches /api responses — see sw.js.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // If a previous worker controls this page, a controllerchange means the
    // user just accepted an update — reload once into the fresh shell.
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    });

    const promptToUpdate = (registration) => {
      if (!registration.waiting) return;
      toast('A new version of U-Tech ERP is available.', {
        duration: Infinity,
        id: 'sw-update',
        action: {
          label: 'Reload',
          onClick: () => registration.waiting.postMessage({ type: 'SKIP_WAITING' }),
        },
      });
    };

    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        promptToUpdate(registration);
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              promptToUpdate(registration);
            }
          });
        });
      })
      .catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 3000,
          style: {
            borderRadius: '12px',
            padding: '12px 16px',
            fontSize: '13px',
            fontWeight: 500,
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          },
          success: { iconTheme: { primary: '#16a34a', secondary: '#fff' } },
          error: { iconTheme: { primary: '#dc2626', secondary: '#fff' }, duration: 4000 },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>
);
