import axios from 'axios';
import toast from 'react-hot-toast';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('utech.token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// coalesces the burst of 401s a page full of parallel requests produces —
// toast + redirect once, not once per request
let redirectingToLogin = false;

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err.response?.status;
    const msg = err.response?.data?.message || err.response?.data?.error || err.message;
    if (status === 401) {
      localStorage.removeItem('utech.token');
      localStorage.removeItem('utech.user');
      if (location.pathname !== '/login' && !redirectingToLogin) {
        redirectingToLogin = true;
        toast.error('Session expired, please sign in again');
        location.href = '/login';
      }
    } else if (status >= 400) {
      toast.error(msg);
    }
    return Promise.reject(err);
  }
);

export default api;
