import { create } from 'zustand';
import api from '../lib/api';

const TOKEN_KEY = 'utech.token';
const USER_KEY = 'utech.user';

// one corrupt value in localStorage must not throw at module init and brick
// the whole app — read defensively and clear the bad key so the next login
// starts clean
function readUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
}

export const useAuth = create((set) => ({
  token: localStorage.getItem(TOKEN_KEY) || null,
  user: readUser(),

  async login(email, password) {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    set({ token: data.token, user: data.user });
    // login response has no `permissions` array — hydrate the full profile
    // (role + permissions) right away so role-gating works from the first render
    const full = await api.get('/auth/me').then((r) => r.data.user).catch(() => data.user);
    localStorage.setItem(USER_KEY, JSON.stringify(full));
    set({ user: full });
    return full;
  },

  async refreshMe() {
    const { data } = await api.get('/auth/me');
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    set({ user: data.user });
    return data.user;
  },

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    set({ token: null, user: null });
  },
}));
