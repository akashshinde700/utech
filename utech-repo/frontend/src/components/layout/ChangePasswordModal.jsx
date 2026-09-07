import { useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import { styles } from '../../lib/formStyles';
import { required, passwordStrong } from '../../lib/validation';
import FormField from '../ui/FormField';
import Modal from '../ui/Modal';
import toast from 'react-hot-toast';

function PasswordInput({ id, value, onChange, error, autoComplete = 'current-password' }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        className={`${styles.input} pr-10 ${error ? styles.inputError : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-2.5 top-2 grid h-6 w-6 place-items-center rounded text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
      >
        {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  );
}

// ChangePasswordModal — migrated to the shared Modal/FormField primitives
// (task 6-d). Validation: current password required, new password must pass
// passwordStrong (≥8 chars with a letter + number), confirm must match.
// Submission endpoint and toasts are unchanged.
export default function ChangePasswordModal({ onClose }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const found = {
      currentPassword: required(currentPassword, 'Current password'),
      newPassword: passwordStrong(newPassword) ?? 'New password must be at least 8 characters with at least one letter and one number',
      confirmPassword: confirmPassword !== newPassword ? 'New password and confirmation do not match' : null,
    };
    const clean = Object.fromEntries(Object.entries(found).filter(([, v]) => v));
    if (Object.keys(clean).length > 0) {
      setErrors(clean);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      toast.success('Password changed successfully');
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to change password');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Change Password"
      description="Choose a strong password you don't use elsewhere."
      size="md"
      footer={
        <>
          <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="change-password-form" className={styles.primaryBtn} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {saving ? 'Saving…' : 'Change Password'}
          </button>
        </>
      }
    >
      <form id="change-password-form" onSubmit={submit} noValidate className="space-y-4">
        <FormField id="cp-current" label="Current Password" required error={errors.currentPassword}>
          <PasswordInput
            id="cp-current"
            value={currentPassword}
            onChange={(v) => setCurrentPassword(v)}
            error={errors.currentPassword}
            autoComplete="current-password"
          />
        </FormField>
        <FormField
          id="cp-new"
          label="New Password"
          required
          error={errors.newPassword}
          hint="At least 8 characters, with at least one letter and one number"
        >
          <PasswordInput
            id="cp-new"
            value={newPassword}
            onChange={(v) => setNewPassword(v)}
            error={errors.newPassword}
            autoComplete="new-password"
          />
        </FormField>
        <FormField id="cp-confirm" label="Confirm New Password" required error={errors.confirmPassword}>
          <PasswordInput
            id="cp-confirm"
            value={confirmPassword}
            onChange={(v) => setConfirmPassword(v)}
            error={errors.confirmPassword}
            autoComplete="new-password"
          />
        </FormField>
      </form>
    </Modal>
  );
}
