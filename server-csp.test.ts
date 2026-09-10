import { describe, it, expect, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import { getCspDirectives, CspDirectives } from './server-auth';
import { createHelmetMiddleware } from './server';

/**
 * Helper to parse a Content-Security-Policy header string into directives and their values.
 */
function parseCspHeader(cspHeader: string): Record<string, string[]> {
  const directives: Record<string, string[]> = {};
  const parts = cspHeader.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [name, ...values] = trimmed.split(/\s+/);
    directives[name] = values;
  }
  return directives;
}

describe('AUDIT-010 — Content Security Policy Hardening', () => {

  // ── AUDIT-010-S01: Production CSP Exists ──
  it('AUDIT-010-S01: Production CSP exists and has all required directives', () => {
    const directives = getCspDirectives(true);
    expect(directives).toBeDefined();
    expect(directives.defaultSrc).toEqual(["'self'"]);
    expect(directives.scriptSrc).toBeDefined();
    expect(Array.isArray(directives.scriptSrc)).toBe(true);
    expect(directives.styleSrc).toBeDefined();
    expect(directives.fontSrc).toBeDefined();
    expect(directives.imgSrc).toBeDefined();
    expect(directives.connectSrc).toBeDefined();
  });

  // ── AUDIT-010-S02: Production script-src does NOT contain 'unsafe-inline' ──
  it('AUDIT-010-S02: Production script-src does NOT contain unsafe-inline', () => {
    const directives = getCspDirectives(true);
    expect(directives.scriptSrc).not.toContain("'unsafe-inline'");
    expect(directives.scriptSrc.some(src => src.includes('unsafe-inline'))).toBe(false);
  });

  // ── AUDIT-010-S03: Production script-src does NOT contain 'unsafe-eval' ──
  it('AUDIT-010-S03: Production script-src does NOT contain unsafe-eval', () => {
    const directives = getCspDirectives(true);
    expect(directives.scriptSrc).not.toContain("'unsafe-eval'");
    expect(directives.scriptSrc.some(src => src.includes('unsafe-eval'))).toBe(false);
  });

  // ── AUDIT-010-S04: Production script-src still permits required same-origin application scripts ──
  it('AUDIT-010-S04: Production script-src permits required same-origin scripts', () => {
    const directives = getCspDirectives(true);
    expect(directives.scriptSrc).toEqual(["'self'"]);
  });

  // ── AUDIT-010-S05: Other existing security headers and directives remain intact ──
  it('AUDIT-010-S05: Other existing CSP directives remain intact and unchanged', () => {
    const directives = getCspDirectives(true);
    expect(directives.defaultSrc).toEqual(["'self'"]);
    expect(directives.styleSrc).toEqual(["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"]);
    expect(directives.fontSrc).toEqual(["'self'", "https://fonts.gstatic.com"]);
    expect(directives.imgSrc).toEqual(["'self'", "data:", "blob:"]);
    expect(directives.connectSrc).toContain("'self'");
    expect(directives.connectSrc).toContain("https://*.firebaseio.com");
    expect(directives.connectSrc).toContain("https://*.googleapis.com");
    expect(directives.connectSrc).toContain("https://firestore.googleapis.com");
  });

  // ── AUDIT-010-S06: Development mode permits unsafe-inline and unsafe-eval for Vite HMR ──
  it('AUDIT-010-S06: Development CSP contains unsafe-inline and unsafe-eval for Vite dev server', () => {
    const devDirectives = getCspDirectives(false);
    expect(devDirectives.scriptSrc).toContain("'self'");
    expect(devDirectives.scriptSrc).toContain("'unsafe-inline'");
    expect(devDirectives.scriptSrc).toContain("'unsafe-eval'");
  });

  // ── Live HTTP Response Tests ──
  describe('Live HTTP Content-Security-Policy Header Verification', () => {
    let prodServer: http.Server;
    let devServer: http.Server;
    let prodPort: number;
    let devPort: number;

    afterAll(async () => {
      await new Promise<void>((resolve) => prodServer ? prodServer.close(() => resolve()) : resolve());
      await new Promise<void>((resolve) => devServer ? devServer.close(() => resolve()) : resolve());
    });

    it('AUDIT-010-S07: Production HTTP response sends CSP where script-src has neither unsafe-inline nor unsafe-eval', async () => {
      const app = express();
      app.use(createHelmetMiddleware(true));
      app.get('/test', (req, res) => res.json({ status: 'ok' }));

      await new Promise<void>((resolve) => {
        prodServer = app.listen(0, () => {
          prodPort = (prodServer.address() as any).port;
          resolve();
        });
      });

      const response = await fetch(`http://127.0.0.1:${prodPort}/test`);
      expect(response.status).toBe(200);

      const cspHeader = response.headers.get('content-security-policy');
      expect(cspHeader).toBeTruthy();

      const parsed = parseCspHeader(cspHeader!);

      // Strict Production script-src check
      expect(parsed['script-src']).toBeDefined();
      expect(parsed['script-src']).toContain("'self'");
      expect(parsed['script-src']).not.toContain("'unsafe-inline'");
      expect(parsed['script-src']).not.toContain("'unsafe-eval'");
      expect(parsed['script-src']).toEqual(["'self'"]);

      // Verify standard Helmet security headers remain intact
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    });

    it('AUDIT-010-S08: Development HTTP response retains unsafe-inline and unsafe-eval for HMR in script-src', async () => {
      const app = express();
      app.use(createHelmetMiddleware(false));
      app.get('/test', (req, res) => res.json({ status: 'ok' }));

      await new Promise<void>((resolve) => {
        devServer = app.listen(0, () => {
          devPort = (devServer.address() as any).port;
          resolve();
        });
      });

      const response = await fetch(`http://127.0.0.1:${devPort}/test`);
      expect(response.status).toBe(200);

      const cspHeader = response.headers.get('content-security-policy');
      expect(cspHeader).toBeTruthy();

      const parsed = parseCspHeader(cspHeader!);
      expect(parsed['script-src']).toBeDefined();
      expect(parsed['script-src']).toContain("'self'");
      expect(parsed['script-src']).toContain("'unsafe-inline'");
      expect(parsed['script-src']).toContain("'unsafe-eval'");
    });

    it('AUDIT-010-S09: createHelmetMiddleware defaults to strict production CSP when NODE_ENV=production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const app = express();
        app.use(createHelmetMiddleware());
        app.get('/test-env', (req, res) => res.json({ status: 'ok' }));

        const server = await new Promise<http.Server>((resolve) => {
          const s = app.listen(0, () => resolve(s));
        });
        const port = (server.address() as any).port;

        const response = await fetch(`http://127.0.0.1:${port}/test-env`);
        const csp = response.headers.get('content-security-policy');
        expect(csp).toBeTruthy();

        const parsed = parseCspHeader(csp!);
        expect(parsed['script-src']).toBeDefined();
        expect(parsed['script-src']).toEqual(["'self'"]);
        expect(parsed['script-src']).not.toContain("'unsafe-inline'");
        expect(parsed['script-src']).not.toContain("'unsafe-eval'");

        await new Promise<void>((resolve) => server.close(() => resolve()));
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });
});
