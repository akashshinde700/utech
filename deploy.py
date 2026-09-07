"""
UTech ERP -- deploy to the CloudPanel-managed VPS (www.lastrivon.tech).

Deploys utech-repo/ (Express + Prisma backend on port 4000, serving the Vite
frontend build from backend/public as a single origin).

All credentials come from deploy_config.json (gitignored). Every value in that
file is documented in credential.md -- if the file is missing, recreate it from
the JSON block in credential.md.

Steps:
  0. build the frontend locally (vite build -> utech-repo/frontend/dist)
  1. ensure the MySQL database + user exist   (root SSH session)
  2..8 upload backend src/prisma, write .env + PM2 ecosystem, upload the SPA
  9..11 npm install, prisma generate + migrate deploy, (optional) seed
  12. pm2 start / restart + save

Run:
  python deploy.py            # normal deploy
  python deploy.py --seed     # also run prisma/seed.js (needed on the FIRST
                              # deploy -- creates roles/permissions + the
                              # admin@utech.local / Admin@123 login; idempotent)
"""

import json
import os
import sys
import subprocess
from urllib.parse import quote

import paramiko

os.environ["PYTHONIOENCODING"] = "utf-8"
os.environ["PYTHONUNBUFFERED"] = "1"

LOCAL_ROOT  = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(LOCAL_ROOT, "deploy_config.json")
RUN_SEED    = "--seed" in sys.argv[1:]

# ── Load credentials ──────────────────────────────────────────
if not os.path.exists(CONFIG_PATH):
    print(
        f"[ERROR] {CONFIG_PATH} not found.\n"
        "        Recreate it from the JSON block in credential.md.",
        flush=True,
    )
    sys.exit(1)

with open(CONFIG_PATH, "r", encoding="utf-8") as _f:
    CFG = json.load(_f)

# ── Server (CloudPanel-managed VPS) ───────────────────────────
HOST            = CFG["host"]
USER            = CFG["ssh_user"]
PASSWORD        = CFG["ssh_password"]
MYSQL_ROOT_PASS = CFG["mysql_root_pass"]   # CloudPanel MySQL root (via `clpctl db:show:master-credentials`), NOT the SSH root password

# ── Site (created via CloudPanel "New Node.js Site" wizard) ───
SITE_USER     = CFG["site_user"]
SITE_PASSWORD = CFG["site_password"]   # direct SSH login as the site user -- required:
                                       # `sudo -u <site_user>` on this box breaks PM2's
                                       # daemon fork (EACCES spawning node), but a direct
                                       # SSH session as the site user works fine.
SITE_DOMAIN   = CFG["site_domain"]
APEX_DOMAIN   = SITE_DOMAIN[4:] if SITE_DOMAIN.startswith("www.") else SITE_DOMAIN

NVM_DIR  = f"/home/{SITE_USER}/.nvm"
NVM_INIT = f"source {NVM_DIR}/nvm.sh"

# ── App ───────────────────────────────────────────────────────
PM2_NAME     = CFG["pm2_name"]
BACKEND_PORT = int(CFG["backend_port"])   # must match the CloudPanel site's App Port (nginx proxy_pass target)

# ── Database (already created in the CloudPanel panel) ────────
DB_NAME = CFG["db_name"]
DB_USER = CFG["db_user"]
DB_PASS = CFG["db_pass"]
DB_HOST = CFG["db_host"]

# ── Auth ──────────────────────────────────────────────────────
JWT_SECRET         = CFG["jwt_secret"]
JWT_EXPIRES_IN     = CFG.get("jwt_expires_in", "1d")
REFRESH_EXPIRES_IN = CFG.get("refresh_expires_in", "7d")
BCRYPT_ROUNDS      = int(CFG.get("bcrypt_rounds", 10))

# ── Local paths ───────────────────────────────────────────────
LOCAL_REPO           = os.path.join(LOCAL_ROOT, "utech-repo")
LOCAL_BACKEND        = os.path.join(LOCAL_REPO, "backend")
LOCAL_BACKEND_SRC    = os.path.join(LOCAL_BACKEND, "src")
LOCAL_BACKEND_PRISMA = os.path.join(LOCAL_BACKEND, "prisma")
LOCAL_FRONTEND       = os.path.join(LOCAL_REPO, "frontend")
LOCAL_DIST           = os.path.join(LOCAL_FRONTEND, "dist")

# ── Remote paths ──────────────────────────────────────────────
# CloudPanel's nginx vhost for this site proxies ALL paths to 127.0.0.1:BACKEND_PORT,
# so the frontend build is served as static files by the Node process itself
# (backend/public), not by a separate nginx root.
REMOTE_SITE_ROOT = f"/home/{SITE_USER}/htdocs/{SITE_DOMAIN}"
REMOTE_BACKEND   = f"{REMOTE_SITE_ROOT}/backend"
REMOTE_PUBLIC    = f"{REMOTE_BACKEND}/public"

BACKEND_FILES = [
    (os.path.join(LOCAL_BACKEND, "package.json"),      f"{REMOTE_BACKEND}/package.json"),
    (os.path.join(LOCAL_BACKEND, "package-lock.json"), f"{REMOTE_BACKEND}/package-lock.json"),
]

SKIP_DIRS = {"node_modules", ".git", "__pycache__", "dist", "uploads", "logs"}
SKIP_EXTS = {".log", ".pid"}

# password goes into a URL -- percent-encode reserved chars (@ / # : etc.)
DB_URL = f"mysql://{DB_USER}:{quote(DB_PASS, safe='')}@{DB_HOST}:3306/{DB_NAME}"

ENV_CONTENT = f"""\
NODE_ENV=production
PORT={BACKEND_PORT}

DATABASE_URL="{DB_URL}"

JWT_SECRET={JWT_SECRET}
JWT_EXPIRES_IN={JWT_EXPIRES_IN}
REFRESH_EXPIRES_IN={REFRESH_EXPIRES_IN}
BCRYPT_ROUNDS={BCRYPT_ROUNDS}

CORS_ORIGIN=https://{SITE_DOMAIN},https://{APEX_DOMAIN}

# Company identity — printed on invoice PDFs; COMPANY_STATE_CODE also decides
# intra- vs inter-state GST when the customer has a GSTIN on file.
COMPANY_NAME=U-Tech Automation Industries
COMPANY_GSTIN=
COMPANY_ADDRESS=Gat no. 1403, Sonawane Wasti Rd, Chikhali, Pimpri-Chinchwad, Pune 411062
COMPANY_STATE=Maharashtra
COMPANY_STATE_CODE=27
COMPANY_BANK=

SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM="UTech ERP <noreply@{APEX_DOMAIN}>"

UPLOAD_DIR=./uploads
MAX_UPLOAD_MB=10
"""

ECOSYSTEM_CONTENT = f"""\
module.exports = {{
  apps: [{{
    name: '{PM2_NAME}',
    script: 'src/server.js',
    cwd: '{REMOTE_BACKEND}',
    env: {{ NODE_ENV: 'production' }},
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
  }}]
}};
"""


def p(text):
    print(text, flush=True)


def safe_print(text):
    if isinstance(text, bytes):
        text = text.decode("utf-8", errors="replace")
    print(text.encode("ascii", errors="replace").decode("ascii"), end="", flush=True)


def banner(title):
    p("=" * 60)
    p(title)
    p("=" * 60)


def run(ssh, command, timeout=300):
    p(f"\n[CMD] {command}")
    _, stdout, stderr = ssh.exec_command(command, timeout=timeout)
    out = stdout.read()
    err = stderr.read()
    code = stdout.channel.recv_exit_status()
    safe_print(out)
    if err:
        safe_print(err)
    p(f"[exit {code}]")
    return out.decode("utf-8", errors="replace"), err.decode("utf-8", errors="replace"), code


def run_site(ssh_site, command, timeout=300):
    """Run a command on the SSH session already authenticated as the site user,
    with its own nvm-managed node/npm/pm2 sourced onto PATH."""
    return run(ssh_site, f"{NVM_INIT}; {command}", timeout=timeout)


def sftp_mkdir(sftp, path):
    try:
        sftp.stat(path)
    except FileNotFoundError:
        parts = path.strip("/").split("/")
        cur = ""
        for part in parts:
            cur += "/" + part
            try:
                sftp.stat(cur)
            except FileNotFoundError:
                sftp.mkdir(cur)


def upload_file(sftp, local_path, remote_path):
    if not os.path.exists(local_path):
        p(f"  [SKIP] missing: {local_path}")
        return
    sftp_mkdir(sftp, "/".join(remote_path.split("/")[:-1]))
    sftp.put(local_path, remote_path)
    p(f"  uploaded: {remote_path}")


def upload_string(sftp, content, remote_path):
    sftp_mkdir(sftp, "/".join(remote_path.split("/")[:-1]))
    with sftp.open(remote_path, "wb") as f:
        f.write(content.encode("utf-8"))
    p(f"  written : {remote_path}")


def upload_dir(sftp, local_dir, remote_dir):
    count = 0
    for root, dirs, files in os.walk(local_dir):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        rel = os.path.relpath(root, local_dir)
        remote_sub = remote_dir if rel == "." else remote_dir + "/" + rel.replace(os.sep, "/")
        sftp_mkdir(sftp, remote_sub)
        for f in files:
            if os.path.splitext(f)[1] in SKIP_EXTS:
                continue
            try:
                sftp.put(os.path.join(root, f), remote_sub + "/" + f)
                count += 1
            except Exception as ex:
                p(f"  [SKIP] {f}: {ex}")
    p(f"  {count} files: {local_dir} -> {remote_dir}")


def build_frontend():
    banner("[LOCAL] Building frontend (vite build)")
    if not os.path.isdir(LOCAL_FRONTEND):
        raise RuntimeError(f"Frontend folder not found: {LOCAL_FRONTEND}")
    subprocess.check_call("npm install", cwd=LOCAL_FRONTEND, shell=True)
    subprocess.check_call("npm run build", cwd=LOCAL_FRONTEND, shell=True)
    if not os.path.isdir(LOCAL_DIST):
        raise RuntimeError(f"Build done but dist missing: {LOCAL_DIST}")
    p("[OK] Frontend built.")


def main():
    banner(f"UTech ERP -- Deploy to https://{SITE_DOMAIN} ({HOST}, CloudPanel)")

    if not os.path.isdir(LOCAL_BACKEND):
        p(f"[ERROR] Backend folder not found: {LOCAL_BACKEND}")
        sys.exit(1)

    try:
        build_frontend()
    except Exception as e:
        p(f"\n[ERROR] Frontend build failed: {e}")
        sys.exit(1)

    p(f"\n[CONNECT] {HOST} ...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(HOST, username=USER, password=PASSWORD, timeout=30,
                    look_for_keys=False, allow_agent=False)
        p("[OK] Connected.")
    except Exception as e:
        p(f"[ERROR] SSH failed: {e}")
        sys.exit(1)

    ssh_site = None
    sftp_site = None
    try:
        # Step 1: MySQL database + user (idempotent; normally already created via
        # the CloudPanel "Add Database" form, but this is safe to re-run). Uses
        # the root SSH session -- the mysql client itself just needs the DB
        # credentials, not any particular linux user.
        banner("[STEP 1] Ensuring MySQL database + user")
        sql = (
            f"CREATE DATABASE IF NOT EXISTS {DB_NAME} "
            f"CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; "
            f"CREATE USER IF NOT EXISTS '{DB_USER}'@'%' IDENTIFIED BY '{DB_PASS}'; "
            f"GRANT ALL PRIVILEGES ON {DB_NAME}.* TO '{DB_USER}'@'%'; "
            f"FLUSH PRIVILEGES;"
        )
        out, err, code = run(
            ssh,
            f'mysql -h{DB_HOST} -uroot -p"{MYSQL_ROOT_PASS}" -e "{sql}" 2>&1',
            timeout=30
        )
        if code != 0:
            p(f"[WARN] DB setup returned non-zero: {err[:300]}")
        else:
            p(f"[OK] DB {DB_NAME} ready, user {DB_USER} ready.")

        # From here on connect directly as the site's linux user -- `sudo -u`
        # from the root session breaks PM2's daemon fork on this box (EACCES
        # spawning node), but a direct SSH session as the site user does not.
        p(f"\n[CONNECT] {HOST} as {SITE_USER} ...")
        ssh_site = paramiko.SSHClient()
        ssh_site.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh_site.connect(HOST, username=SITE_USER, password=SITE_PASSWORD, timeout=30,
                         look_for_keys=False, allow_agent=False)
        p("[OK] Connected.")
        sftp_site = ssh_site.open_sftp()

        # Step 2: directories under the site's htdocs
        banner("[STEP 2] Creating backend directory structure")
        run(ssh_site,
            f"mkdir -p {REMOTE_BACKEND}/uploads "
            f"{REMOTE_BACKEND}/logs "
            f"{REMOTE_PUBLIC}",
            timeout=30)

        # Step 3: backend package files
        banner("[STEP 3] Uploading backend package files")
        for local_path, remote_path in BACKEND_FILES:
            upload_file(sftp_site, local_path, remote_path)

        # Step 4: backend/src
        banner("[STEP 4] Uploading backend/src")
        run(ssh_site, f"rm -rf {REMOTE_BACKEND}/src", timeout=120)
        upload_dir(sftp_site, LOCAL_BACKEND_SRC, f"{REMOTE_BACKEND}/src")

        # Step 5: backend/prisma
        banner("[STEP 5] Uploading backend/prisma")
        run(ssh_site, f"rm -rf {REMOTE_BACKEND}/prisma", timeout=120)
        upload_dir(sftp_site, LOCAL_BACKEND_PRISMA, f"{REMOTE_BACKEND}/prisma")

        # Step 6: .env
        banner("[STEP 6] Writing .env")
        upload_string(sftp_site, ENV_CONTENT, f"{REMOTE_BACKEND}/.env")
        run(ssh_site, f"chmod 600 {REMOTE_BACKEND}/.env", timeout=10)

        # Step 7: PM2 ecosystem config
        banner("[STEP 7] Writing ecosystem.config.js")
        upload_string(sftp_site, ECOSYSTEM_CONTENT, f"{REMOTE_BACKEND}/ecosystem.config.js")

        # Step 8: frontend dist -> backend/public (served by Express, since the
        # CloudPanel nginx vhost proxies everything to this one Node process)
        banner("[STEP 8] Uploading frontend dist")
        run(ssh_site, f"rm -rf {REMOTE_PUBLIC}", timeout=120)
        upload_dir(sftp_site, LOCAL_DIST, REMOTE_PUBLIC)
        p("[OK] Frontend dist uploaded.")

        # Step 9: npm install (full -- the prisma CLI is a devDependency and is
        # needed for generate/migrate below)
        banner("[STEP 9] npm install (backend)")
        run_site(ssh_site, f"cd {REMOTE_BACKEND} && npm install 2>&1 | tail -15", timeout=600)

        # Step 10: ensure pm2 is available for the site user
        banner("[STEP 10] Ensuring pm2 installed")
        run_site(ssh_site, "which pm2 || npm install -g pm2", timeout=120)

        # Step 11: Prisma generate + migrate deploy (+ optional seed)
        banner("[STEP 11] Prisma generate + migrate deploy")
        run_site(ssh_site, f"cd {REMOTE_BACKEND} && npx prisma generate 2>&1 | tail -5", timeout=180)
        _, _, mcode = run_site(
            ssh_site, f"cd {REMOTE_BACKEND} && npx prisma migrate deploy 2>&1", timeout=300
        )
        if mcode != 0:
            raise RuntimeError("prisma migrate deploy failed -- aborting before restart")

        if RUN_SEED:
            banner("[STEP 11b] Seeding database (prisma/seed.js)")
            run_site(ssh_site, f"cd {REMOTE_BACKEND} && node prisma/seed.js 2>&1 | tail -20", timeout=300)
        else:
            p("[INFO] Skipping seed (pass --seed on the first deploy to create "
              "roles/permissions + admin@utech.local / Admin@123).")

        # Step 12: PM2 start or restart
        banner("[STEP 12] PM2 start/restart")
        out, _, _ = run_site(ssh_site, f"pm2 id {PM2_NAME} 2>&1 | cat", timeout=15)
        process_exists = out.strip() not in ("", "[]", "[ ]")
        if process_exists:
            run_site(ssh_site, f"pm2 restart {PM2_NAME} --update-env 2>&1 | cat", timeout=60)
        else:
            p("[INFO] Starting new PM2 process...")
            run_site(ssh_site, f"cd {REMOTE_BACKEND} && pm2 start ecosystem.config.js 2>&1 | cat", timeout=60)
        run_site(ssh_site, f"sleep 3 && pm2 show {PM2_NAME} 2>&1 | cat | head -30", timeout=30)
        run_site(ssh_site, "pm2 save 2>&1 | cat", timeout=30)

        # health check through the local node port
        run_site(ssh_site, f"sleep 2 && curl -s -o /dev/null -w 'health: %{{http_code}}\\n' "
                           f"http://127.0.0.1:{BACKEND_PORT}/health 2>&1 | cat", timeout=20)

        banner("[SUCCESS] Deploy complete.")
        p(f"  URL     : https://{SITE_DOMAIN}")
        p(f"  Backend : {REMOTE_BACKEND}  (port {BACKEND_PORT})")
        p(f"  Frontend: {REMOTE_PUBLIC}  (served by the Node process)")
        p(f"  DB      : {DB_NAME}  (user: {DB_USER})")
        p(f"  PM2     : {PM2_NAME}  (as user {SITE_USER})")
        p("  NOTE    : nginx/SSL is managed by CloudPanel for this site -- not touched here.")

    except Exception as e:
        p(f"\n[ERROR] Deploy failed: {e}")
        sys.exit(1)
    finally:
        if sftp_site:
            try:
                sftp_site.close()
            except Exception:
                pass
        if ssh_site:
            try:
                ssh_site.close()
            except Exception:
                pass
        ssh.close()
        p("\n[INFO] SSH connections closed.")


if __name__ == "__main__":
    main()
