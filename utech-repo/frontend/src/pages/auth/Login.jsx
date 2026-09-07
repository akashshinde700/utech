import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Box, Mail, Lock, ArrowRight, Loader2, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { styles } from '../../lib/formStyles';
import { required, email as emailFormat } from '../../lib/validation';
import FormField from '../../components/ui/FormField';
import toast from 'react-hot-toast';

// Login — full-screen, centered professional card (task 6-d). The auth flow
// itself (store login call, success toast, redirect) is untouched; the
// interceptor still reports failures via toast, and we additionally surface a
// clear inline alert for scanability. Inline field validation (required +
// email format) runs before any network call; errors clear as fields change.
export default function Login() {
  const navigate = useNavigate();
  const login = useAuth((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const validate = () => ({
    email: required(email, 'Email') || emailFormat(email),
    password: required(password, 'Password'),
  });

  function clearField(key) {
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: null } : prev));
  }

  async function submit(e) {
    e.preventDefault();
    const found = validate();
    if (found.email || found.password) {
      setFieldErrors(found);
      const first = document.getElementById(found.email ? 'login-email' : 'login-password');
      first?.focus();
      return;
    }
    setFieldErrors({});
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      toast.success('Welcome back!');
      navigate('/');
    } catch (err) {
      // toast already shown by interceptor — mirror it inline as well
      setError(err?.response?.data?.message || 'Sign-in failed. Check your email and password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-50 via-brand-50/60 to-slate-200 p-4">
      {/* decorative background blobs */}
      <div className="pointer-events-none absolute -top-20 -left-20 h-96 w-96 rounded-full bg-brand-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -right-20 h-80 w-80 rounded-full bg-brand-700/10 blur-3xl" />

      <div className="relative w-full max-w-sm animate-slide-up rounded-2xl border border-slate-200/60 bg-white/90 p-8 shadow-xl backdrop-blur">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-500/20">
            <Box className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">UTech ERP</h1>
          <p className="mt-1 text-sm text-slate-500">U-Tech Automation Industries — Smart Manufacturing Suite</p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-lg border border-danger-100 bg-danger-50 px-3 py-2.5 text-sm text-danger-700"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormField id="login-email" label="Email" error={fieldErrors.email}>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
              <input
                id="login-email"
                className={`${styles.input} pl-9 ${fieldErrors.email ? styles.inputError : ''}`}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearField('email');
                }}
                aria-invalid={!!fieldErrors.email}
                aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
                placeholder="you@company.com"
              />
            </div>
          </FormField>

          <FormField id="login-password" label="Password" error={fieldErrors.password}>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
              <input
                id="login-password"
                className={`${styles.input} pl-9 pr-10 ${fieldErrors.password ? styles.inputError : ''}`}
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearField('password');
                }}
                aria-invalid={!!fieldErrors.password}
                aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2.5 top-2 grid h-6 w-6 place-items-center rounded text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
              </button>
            </div>
          </FormField>

          <button type="submit" className="btn-primary mt-2 w-full" disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Signing in…
              </>
            ) : (
              <>
                Sign in <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </>
            )}
          </button>
        </form>

        <p className="mt-6 border-t border-slate-100 pt-4 text-center text-xs text-slate-400">
          Use the account issued by your administrator. Lost access? Contact your system admin to reset it.
        </p>
      </div>
    </div>
  );
}
