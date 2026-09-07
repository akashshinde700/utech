/*
 * UTech ERP service watchdog (v3 — self-healing + DB backups, Task-10/13-b).
 *
 *
 * The sandbox only keeps processes alive while the managed Next.js dev server
 * (port 3000) is running; plain bash background processes die with their
 * shell session. This instrumentation file runs inside the Next.js server,
 * so any process we spawn here becomes a (long-lived) child of it.
 *
 * Responsibilities:
 *   1. Ensure MariaDB (user-space install at /home/z/my-project/mariadb) is up
 *      on 3306. SELF-HEAL: if the mariadbd binary is missing (wiped runtime),
 *      run scripts/rebuild-mariadb.sh `build` (extract debs + init an
 *      EMPTY/missing datadir only — never touches populated data), then spawn
 *      mariadbd as a direct child, then run the `ensure` stage exactly once
 *      (db/user + prisma migrate deploy + idempotent seed).
 *   2. Ensure the UTech ERP Express backend is up on 4000 (Prisma -> MariaDB).
 *   3. Keep watching every 20s and revive either one if it dies
 *      (in-flight guards + 60s per-service cooldown to avoid spawn storms).
 *   4. DB BACKUPS (Task 13-b): every ~6h (and once shortly after boot / a
 *      successful mariadbd spawn), IF 3306 is up, dump `utech` via
 *      mariadb-dump | gzip into /home/z/my-project/backups/utech-<ts>.sql.gz
 *      and keep ONLY the newest 5 dumps. Fully try/catch-wrapped: a backup
 *      failure can never break the watchdog loop.
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
  rebuildBusy: boolean;
  ensurePending: boolean;
  ensureBusy: boolean;
  backupBusy: boolean;
  backupLastAttempt: number;
  timer?: ReturnType<typeof setInterval>;
  backupTimer?: ReturnType<typeof setInterval>;
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
      rebuildBusy: false,
      ensurePending: false,
      ensureBusy: false,
      backupBusy: false,
      backupLastAttempt: 0,
    });

  // HMR / config-restart can call register() again — register only once.
  if (state.booted || state.booting) return;
  state.booting = true;

  try {
    // Dynamic imports so this file is safe to load in any runtime.
    const { spawn } = await import('node:child_process');
    const net = await import('node:net');
    const fs = await import('node:fs');

    const MARIADB_DIR = '/home/z/my-project/mariadb';
    const MARIADB_BIN = `${MARIADB_DIR}/root/usr/sbin/mariadbd`;
    const REBUILD_SCRIPT = '/home/z/my-project/scripts/rebuild-mariadb.sh';
    const BACKEND_CWD = '/home/z/my-project/utech-repo/backend';
    const SERVICES_LOG = '/home/z/my-project/erp-services.log';
    const BACKEND_LOG = '/home/z/my-project/utech-repo/backend/backend.log';
    const BACKUPS_DIR = '/home/z/my-project/backups';
    const DUMP_BIN = `${MARIADB_DIR}/root/usr/bin/mariadb-dump`;
    const BACKUP_KEEP = 5; // keep only the newest 5 dumps
    const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // ~6 hours
    const BACKUP_MIN_GAP_MS = 2 * 60_000; // dedupe boot vs post-spawn triggers

    appendLog(
      SERVICES_LOG,
      'watchdog v3 register (Task 13-b: + mariadb-dump backups ~6h/boot, keep newest 5)',
    );

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

    /** Keep only the newest BACKUP_KEEP utech-*.sql.gz dumps in BACKUPS_DIR. */
    function pruneBackups(): void {
      try {
        const files = fs
          .readdirSync(BACKUPS_DIR)
          .filter((f: string) => /^utech-.*\.sql\.gz$/.test(f))
          .map((f: string) => {
            const p = `${BACKUPS_DIR}/${f}`;
            return { f, p, m: fs.statSync(p).mtimeMs };
          })
          .sort((a: { m: number }, b: { m: number }) => b.m - a.m);
        for (const old of files.slice(BACKUP_KEEP)) {
          try {
            fs.unlinkSync(old.p);
            appendLog(SERVICES_LOG, `backup prune: removed ${old.f} (keep newest ${BACKUP_KEEP})`);
          } catch {
            /* ignore individual unlink failures */
          }
        }
      } catch {
        /* pruning must never break the watchdog */
      }
    }

    /**
     * Task 13-b: dump `utech` -> backups/utech-<ts>.sql.gz. Skips when 3306 is
     * down; prunes old dumps afterwards. Never throws — a backup failure can
     * never take the watchdog down.
     */
    async function runBackup(reason: string): Promise<void> {
      if (state.backupBusy) return;
      if (Date.now() - state.backupLastAttempt < BACKUP_MIN_GAP_MS) return;
      state.backupBusy = true;
      state.backupLastAttempt = Date.now();
      try {
        if (!(await portUp(MARIADB_PORT))) {
          appendLog(SERVICES_LOG, `backup skipped (3306 down): ${reason}`);
          return;
        }
        try {
          fs.mkdirSync(BACKUPS_DIR, { recursive: true });
        } catch {
          /* dir exists */
        }
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const outFile = `${BACKUPS_DIR}/utech-${stamp}.sql.gz`;
        appendLog(SERVICES_LOG, `backup start (${reason}) -> ${outFile}`);
        const dumpCmd =
          `${DUMP_BIN} --no-defaults --socket=${MARIADB_DIR}/mysqld.sock -uroot ` +
          `--single-transaction --routines --databases utech | gzip > ${outFile}`;
        const code = await new Promise<number>((resolve) => {
          try {
            const child = spawn('/bin/bash', ['-c', dumpCmd], {
              env: {
                ...process.env,
                LD_LIBRARY_PATH: `${MARIADB_DIR}/libs/usr/lib/x86_64-linux-gnu`,
              },
              stdio: ['ignore', 'ignore', 'pipe'],
            } as any);
            let errTail = '';
            child.stderr?.on('data', (d: Buffer) => {
              errTail = (errTail + d.toString()).slice(-300);
            });
            child.on('error', (err: Error) => {
              appendLog(SERVICES_LOG, `backup spawn error: ${err.message}`);
              resolve(-1);
            });
            child.on('exit', (c: number | null) => resolve(c ?? -1));
          } catch (err: any) {
            appendLog(SERVICES_LOG, `backup exception: ${err?.message ?? err}`);
            resolve(-1);
          }
        });
        let size = 0;
        try {
          size = fs.statSync(outFile).size;
        } catch {
          /* file missing */
        }
        if (code === 0 && size > 0) {
          appendLog(SERVICES_LOG, `backup OK: ${outFile} (${size} bytes)`);
        } else {
          appendLog(SERVICES_LOG, `backup FAILED (code=${code}, size=${size}): ${outFile}`);
          try {
            fs.unlinkSync(outFile); // drop broken/partial dump so it never counts as newest
          } catch {
            /* ignore */
          }
        }
        pruneBackups();
      } catch (err: any) {
        appendLog(SERVICES_LOG, `backup error (ignored by watchdog): ${err?.message ?? err}`);
      } finally {
        state.backupBusy = false;
      }
    }

    /** Schedule a one-shot backup shortly in the future (e.g. after boot/spawn). */
    function scheduleBackup(reason: string, delayMs: number) {
      setTimeout(() => void runBackup(reason).catch(() => undefined), delayMs);
    }

    /** Run one stage of scripts/rebuild-mariadb.sh as a child of this server. */
    function runRebuildStage(
      stage: 'build' | 'ensure',
      label: string,
      onExit?: (ok: boolean) => void,
    ) {
      try {
        appendLog(SERVICES_LOG, `${label}: bash ${REBUILD_SCRIPT} ${stage}`);
        const logFd = fs.openSync(SERVICES_LOG, 'a');
        const child = spawn('bash', [REBUILD_SCRIPT, stage], {
          cwd: '/home/z/my-project',
          env: {
            ...process.env,
            DATABASE_URL: 'mysql://utech:utech123@127.0.0.1:3306/utech',
          },
          stdio: ['ignore', logFd, logFd],
          detached: false,
        } as any);
        child.on('error', (err: Error) => {
          appendLog(SERVICES_LOG, `${label} spawn error: ${err.message}`);
          onExit?.(false);
        });
        child.on('exit', (code: number | null) => {
          appendLog(SERVICES_LOG, `${label} exited code=${code}`);
          onExit?.(code === 0);
        });
        child.unref?.();
      } catch (err: any) {
        appendLog(SERVICES_LOG, `${label} exception: ${err?.message ?? err}`);
        onExit?.(false);
      }
    }

    function startMariadb(reason: string) {
      if (state.mariadbBusy || !cooldownExpired(state.mariadbLastSpawn)) return;
      // SELF-HEAL: binary gone (wiped runtime/dead snapshot) -> rebuild first.
      if (!fs.existsSync(MARIADB_BIN)) {
        if (state.rebuildBusy) return;
        state.rebuildBusy = true;
        state.mariadbLastSpawn = Date.now();
        appendLog(
          SERVICES_LOG,
          `mariadbd binary missing — self-heal rebuild starting (reason: ${reason})`,
        );
        runRebuildStage('build', 'rebuild-build', (ok) => {
          state.rebuildBusy = false;
          if (ok) state.ensurePending = true;
        });
        return;
      }
      state.mariadbBusy = true;
      state.mariadbLastSpawn = Date.now();
      try {
        appendLog(SERVICES_LOG, `starting mariadbd (reason: ${reason})`);
        const logFd = fs.openSync(SERVICES_LOG, 'a');
        const child = spawn(
          MARIADB_BIN,
          [
            '--no-defaults',
            `--basedir=${MARIADB_DIR}/root/usr`,
            `--datadir=${MARIADB_DIR}/data`,
            `--socket=${MARIADB_DIR}/mysqld.sock`,
            '--port=3306',
            '--bind-address=127.0.0.1',
            '--skip-networking=0',
          ],
          {
            env: {
              ...process.env,
              LD_LIBRARY_PATH: `${MARIADB_DIR}/libs/usr/lib/x86_64-linux-gnu`,
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
        // Task 13-b: one backup shortly after a (re)spawned mariadbd comes up.
        // runBackup re-checks the port, so a failed spawn just logs a skip.
        scheduleBackup('post-mariadbd-spawn', 45_000);
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
        // Task 13-b: one backup shortly after boot / successful mariadbd spawn.
        if (await portUp(MARIADB_PORT)) {
          scheduleBackup('boot', 20_000);
        }
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
        if (await portUp(MARIADB_PORT)) {
          // Post-start stage after a self-heal rebuild: ensure db/user,
          // migrations and seed exactly once per rebuild.
          if (state.ensurePending && !state.ensureBusy) {
            state.ensureBusy = true;
            state.ensurePending = false;
            runRebuildStage('ensure', 'rebuild-ensure', () => {
              state.ensureBusy = false;
            });
          }
          if (!(await portUp(BACKEND_PORT))) {
            startBackend('watchdog: port down');
          }
        }
      } catch (err: any) {
        console.warn('[erp-watchdog] tick error:', err?.message ?? err);
      }
    }

    // Kick off without blocking register(); also start the periodic watchdog.
    void boot().then(() => {
      if (state.timer) clearInterval(state.timer);
      state.timer = setInterval(() => void tick(), TICK_MS);
      // Task 13-b: lightweight second timer — periodic 6h backups.
      if (state.backupTimer) clearInterval(state.backupTimer);
      state.backupTimer = setInterval(
        () => void runBackup('interval-6h').catch(() => undefined),
        BACKUP_INTERVAL_MS,
      );
      state.booted = true;
      state.booting = false;
    });
  } catch (err: any) {
    console.warn('[erp-watchdog] register error:', err?.message ?? err);
    state.booting = false;
  }
}
