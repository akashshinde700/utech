import { describe, it, expect, beforeEach, vi } from 'vitest';

// The auth store reads localStorage while the module is being evaluated. A
// single corrupt value used to throw during module init, which unmounted the
// whole app for that user until they cleared site data by hand.
describe('auth store — resilient session restore', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('boots with no session', async () => {
    const { useAuth } = await import('../../src/store/auth');
    expect(useAuth.getState().token).toBeNull();
    expect(useAuth.getState().user).toBeNull();
  });

  it('boots with a valid stored session', async () => {
    localStorage.setItem('utech.token', 'tok123');
    localStorage.setItem('utech.user', JSON.stringify({ id: 1, role: 'SUPERADMIN', permissions: [] }));
    const { useAuth } = await import('../../src/store/auth');
    expect(useAuth.getState().token).toBe('tok123');
    expect(useAuth.getState().user.id).toBe(1);
  });

  it('survives corrupt JSON in the stored user and clears the bad key', async () => {
    localStorage.setItem('utech.token', 'tok123');
    localStorage.setItem('utech.user', '{"id":1, "role":');   // truncated
    const { useAuth } = await import('../../src/store/auth');
    expect(useAuth.getState().user).toBeNull();
    expect(localStorage.getItem('utech.user')).toBeNull();
  });

  it('survives the literal strings "undefined" and "null"', async () => {
    localStorage.setItem('utech.user', 'undefined');
    const { useAuth } = await import('../../src/store/auth');
    expect(useAuth.getState().user).toBeNull();
  });

  it('logout clears both keys and the store', async () => {
    localStorage.setItem('utech.token', 'tok123');
    localStorage.setItem('utech.user', JSON.stringify({ id: 1 }));
    const { useAuth } = await import('../../src/store/auth');
    useAuth.getState().logout();
    expect(useAuth.getState().token).toBeNull();
    expect(useAuth.getState().user).toBeNull();
    expect(localStorage.getItem('utech.token')).toBeNull();
    expect(localStorage.getItem('utech.user')).toBeNull();
  });
});
