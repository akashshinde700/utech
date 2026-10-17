import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API proxy timeout used to be 10s while the axios client waits up to 30s,
// so big XLSX report exports died at the dev proxy first. Keep the proxy more
// patient than the client.
const proxy = {
  '/api': {
    target: 'http://127.0.0.1:4000',
    changeOrigin: true,
    secure: false,
    ws: false,
    timeout: 60000,
  },
  '/uploads': {
    target: 'http://127.0.0.1:4000',
    changeOrigin: true,
    secure: false,
    ws: false,
    timeout: 60000,
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Dev/preview runs behind the Arena proxy (and may be reached through a
    // LAN hostname or Cloudflared tunnel). Vite blocks unknown Host headers by
    // default, which turned every non-localhost preview into a 403.
    allowedHosts: true,
    proxy,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
    proxy,
  },
});
