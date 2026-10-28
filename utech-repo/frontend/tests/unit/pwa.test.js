import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// PWA contract: without a valid manifest, PNG icons at the declared sizes, a
// theme colour and a service worker, mobile browsers show the ERP as a plain
// browser tab (no install, no standalone chrome) — the "PWA mobile me proper
// nahi dikh raha" complaint. These tests pin the pieces in place.
const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(FRONTEND, rel), 'utf8');

function pngSize(file) {
  const buf = fs.readFileSync(file);
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); // PNG magic
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('PWA manifest & icons', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'));

  it('declares an installable standalone app', () => {
    expect(manifest.name).toContain('U-Tech');
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#7c3aed'); // violet brand
  });

  it('every declared icon exists on disk at exactly the declared size', () => {
    const purposes = manifest.icons.map((i) => i.purpose);
    expect(purposes).toContain('maskable');
    for (const icon of manifest.icons) {
      const [w, h] = icon.sizes.split('x').map(Number);
      const file = path.join(FRONTEND, 'public', icon.src);
      expect(fs.existsSync(file), `${icon.src} missing`).toBe(true);
      expect(pngSize(file)).toEqual({ width: w, height: h });
    }
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });
});

describe('PWA wiring in index.html / main.jsx / sw.js', () => {
  it('index.html links the manifest, theme colour and apple touch icon', () => {
    const html = read('index.html');
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('name="theme-color" content="#7c3aed"');
    expect(html).toContain('apple-touch-icon');
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('apple-mobile-web-app-capable');
  });

  it('the service worker never caches business data', () => {
    const sw = read('public/sw.js');
    expect(sw).toContain("url.pathname.startsWith('/api/')");
    expect(sw).toContain("url.pathname.startsWith('/uploads/')");
    expect(sw).toContain("request.mode === 'navigate'");
    expect(sw).toContain('CACHE_VERSION');
  });

  it('the worker is registered in production builds only', () => {
    const main = read('src/main.jsx');
    expect(main).toContain("navigator.serviceWorker.register('/sw.js')");
    expect(main).toContain('import.meta.env.PROD');
  });
});
