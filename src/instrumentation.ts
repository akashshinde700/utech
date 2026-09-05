/*
 * UTech ERP service watchdog.
 *
 * The sandbox only keeps processes alive while the managed Next.js dev server
 * (port 3000) is running; plain bash background processes die with their
 * shell session. This instrumentation file runs inside the Next.js server,
 * so any process we spawn here becomes a (long-lived) child of it.
 *
 * Responsibilities:
 *   1. Ensure MariaDB  (user-space install at /home/z/mariadb) is up on 3306.
 *   2. Ensure the UTech ERP Express backend is up on 4000 (Prisma -> MariaDB).
 *   3. Keep watching every 20s and revive either one if it dies
 *      (in-flight guards + 60s per-service cooldown to avoid spawn storms).
 *
 * Next.js proxies all non-/_next traffic to the backend via next.config.ts
 * rewrites (beforeFiles -> http://127.0.0.1:4000).
 */

interface WatchdogState {
  booted: boolean;
  booting: boolean;
  mariadbBusy: boolean;
  backendBusy: boolean;
  mariadbLastSpawn: number;
  backendLastSpawn: number;
  timer?: ReturnType<typeof setInterval>;
}

const globalForWatchdog = globalThis as unknown as {
  __utechErpWatchdog?: WatchdogState;
};

const MARIADB_PORT = 3306;
const BACKEND_PORT = 4000;
const COOLDOWN_MS = 60_000;
const TICK_MS = 20_000;

export async function register() {
  // Only run in the Node.js server runtime (not edge), and never during build.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const state: WatchdogState =
    globalForWatchdog.__utechErpWatchdog ??
    (globalForWatchdog.__utechErpWatchdog = {
      booted: false,
      booting: false,
      mariadbBusy: false,
      backendBusy: false,
      mariadbLastSpawn: 0,
      backendLastSpawn: 0,
    });

  // HMR / config-restart can call register() again — register only once.
  if (state.booted || state.booting) return;
  state.booting = true;

  try {
    // Dynamic imports so this file is safe to load in any runtime.
    const { spawn } = await import('node:child_process');
    const net = await import('node:net');
    const fs = await import('node:fs');

    const MARIADB_BIN = '/home/z/mariadb/root/usr/sbin/mariadbd';
    const BACKEND_CWD = '/home/z/my-project/utech-repo/backend';
    const SERVICES_LOG = '/home/z/my-project/erp-services.log';
    const BACKEND_LOG = '/home/z/my-project/utech-repo/backend/backend.log';

    /** Resolve true if something is listening on 127.0.0.1:port (800ms timeout). */
    function portUp(port: number): Promise<boolean> {
      return new Promise((resolve) => {
        let settled = false;
        const done = (up: boolean) => {
          if (settled) return;
          settled = true;
          socket.destroy();
          resolve(up);
        };
        const socket = new net.Socket();
        socket.setTimeout(800);
        socket.once('connect', () => done(true));
        socket.once('timeout', () => done(false));
        socket.once('error', () => done(false));
        try {
          socket.connect({ host: '127.0.0.1', port });
        } catch {
          done(false);
        }
      });
    }

    function appendLog(file: string, line: string) {
      try {
        fs.appendFileSync(file, `[${new Date().toISOString()}] [watchdog] ${line}\n`);
      } catch {
        /* logging must never throw */
      }
    }

    function cooldownExpired(last: number) {
      return Date.now() - last >= COOLDOWN_MS;
    }

    function startMariadb(reason: string) {
      if (state.mariadbBusy || !cooldownExpired(state.mariadbLastSpawn)) return;
      state.mariadbBusy = true;
      state.mariadbLastSpawn = Date.now();
      try {
        appendLog(SERVICES_LOG, `starting mariadbd (reason: ${reason})`);
        const logFd = fs.openSync(SERVICES_LOG, 'a');
        const child = spawn(
          MARIADB_BIN,
          [
            '--no-defaults',
            '--basedir=/home/z/mariadb/root/usr',
            '--datadir=/home/z/mariadb/data',
            '--socket=/home/z/mariadb/mysqld.sock',
            '--port=3306',
            '--bind-address=127.0.0.1',
            '--skip-networking=0',
          ],
          {
            env: {
              ...process.env,
              LD_LIBRARY_PATH:
                '/home/z/mariadb/libs/usr/lib/x86_64-linux-gnu',
            },
            stdio: ['ignore', logFd, logFd],
            detached: false,
          } as any,
        );
        child.on('error', (err: Error) => {
          appendLog(SERVICES_LOG, `mariadbd spawn error: ${err.message}`);
        });
        child.on('exit', (code: number | null, signal: string | null) => {
          appendLog(SERVICES_LOG, `mariadbd exited code=${code} signal=${signal}`);
        });
        child.unref?.();
      } catch (err: any) {
        appendLog(SERVICES_LOG, `startMariadb exception: ${err?.message ?? err}`);
      } finally {
        state.mariadbBusy = false;
      }
    }

    function startBackend(reason: string) {
      if (state.backendBusy || !cooldownExpired(state.backendLastSpawn)) return;
      state.backendBusy = true;
      state.backendLastSpawn = Date.now();
      try {
        appendLog(SERVICES_LOG, `starting utech backend (reason: ${reason})`);
        const logFd = fs.openSync(BACKEND_LOG, 'a');
        const child = spawn('node', ['src/server.js'], {
          cwd: BACKEND_CWD,
          env: {
            ...process.env,
            // Always explicit: the sandbox shell exports a file: DATABASE_URL
            // which would otherwise override backend/.env (dotenv does not
            // override existing env vars).
            DATABASE_URL: 'mysql://utech:utech123@127.0.0.1:3306/utech',
            JWT_SECRET: 'utech-dev-secret-change-in-prod-9f8e7d6c5b4a',
            JWT_EXPIRES_IN: '8h',
            PORT: '4000',
            NODE_ENV: 'development',
          },
          stdio: ['ignore', logFd, logFd],
          detached: false,
        } as any);
        child.on('error', (err: Error) => {
          appendLog(SERVICES_LOG, `backend spawn error: ${err.message}`);
        });
        child.on('exit', (code: number | null, signal: string | null) => {
          appendLog(SERVICES_LOG, `backend exited code=${code} signal=${signal}`);
        });
        child.unref?.();
      } catch (err: any) {
        appendLog(SERVICES_LOG, `startBackend exception: ${err?.message ?? err}`);
      } finally {
        state.backendBusy = false;
      }
    }

    /** Ensure MariaDB is up (waits up to 30s for it), then ensure backend. */
    async function boot(): Promise<void> {
      try {
        if (!(await portUp(MARIADB_PORT))) {
          startMariadb('boot: port down');
          // Poll up to 30s for MariaDB to accept connections.
          for (let waited = 0; waited < 30_000; waited += 500) {
            if (await portUp(MARIADB_PORT)) break;
            await new Promise((r) => setTimeout(r, 500));
          }
        }
        if (!(await portUp(BACKEND_PORT))) {
          startBackend('boot: port down');
        }
        appendLog(
          SERVICES_LOG,
          `boot check done: mariadb=${await portUp(MARIADB_PORT)} backend=${await portUp(BACKEND_PORT)}`,
        );
      } catch (err: any) {
        console.warn('[erp-watchdog] boot error:', err?.message ?? err);
        appendLog(SERVICES_LOG, `boot error: ${err?.message ?? err}`);
      }
    }

    /** Periodic revive pass — never spawns twice in parallel or inside cooldown. */
    async function tick(): Promise<void> {
      try {
        if (!(await portUp(MARIADB_PORT))) {
          startMariadb('watchdog: port down');
        }
        if (
          (await portUp(MARIADB_PORT)) &&
          !(await portUp(BACKEND_PORT))
        ) {
          startBackend('watchdog: port down');
        }
      } catch (err: any) {
        console.warn('[erp-watchdog] tick error:', err?.message ?? err);
      }
    }

    // Kick off without blocking register(); also start the periodic watchdog.
    void boot().then(() => {
      if (state.timer) clearInterval(state.timer);
      state.timer = setInterval(() => void tick(), TICK_MS);
      state.booted = true;
      state.booting = false;
    });
  } catch (err: any) {
    console.warn('[erp-watchdog] register error:', err?.message ?? err);
    state.booting = false;
  }
}
