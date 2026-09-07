import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App.jsx';
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
        <div className="min-h-screen grid place-items-center bg-slate-50 p-6">
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
