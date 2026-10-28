import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API proxy timeout used to be 10s while the axios client waits up to 30s,
// so big XLSX report exports died at the dev proxy first. Keep the proxy more
// patient than the client.
const proxy = {
  '/api': {
    target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:4000',
    changeOrigin: true,
    secure: false,
    ws: false,
    timeout: 60000,
  },
  '/uploads': {
    target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:4000',
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
  build: {
    // No manualChunks. Routes are loaded with lazy(import(...)) (see
    // src/App.jsx) and Rollup splits on those boundaries by itself.
    //
    // Hand-grouping used to work against that. Grouping application code per
    // page folder meant a module shared between the shell and a page landed in
    // that page's chunk, so the entry depended on it and index.html preloaded
    // the page regardless. Grouping node_modules into a "vendor" chunk had the
    // same effect one level down: vendor ended up importing the "charts" chunk,
    // which pulled 526 kB of charting code into the first load of the login
    // screen. Letting the bundler follow the real import graph keeps the
    // initial download to the shell.
    chunkSizeWarningLimit: 700,
  },
});
