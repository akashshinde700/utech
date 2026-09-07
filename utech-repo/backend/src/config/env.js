'use strict';

require('dotenv').config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

// Secrets that ship in .env.example and must never survive into production.
const PLACEHOLDER_SECRETS = new Set([
  'dev-only-secret-change-me',
  'change-me-please-use-a-strong-random-string',
  'change-me',
  'secret',
]);

const fatal = [];

const required = (key) => {
  const v = process.env[key];
  if (!v) {
    if (isProd) fatal.push(`${key} is required in production but is not set.`);
    else console.warn(`[env] missing ${key} — using default in dev only`);
  }
  return v;
};

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
if (PLACEHOLDER_SECRETS.has(JWT_SECRET) || JWT_SECRET.length < 32) {
  const why = PLACEHOLDER_SECRETS.has(JWT_SECRET)
    ? 'is still the placeholder value from .env.example'
    : 'is shorter than 32 characters';
  if (isProd) {
    fatal.push(
      `JWT_SECRET ${why}. Anyone who has read the repo can forge a login token. ` +
        'Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    );
  } else {
    console.warn(`[env] WARNING: JWT_SECRET ${why} — fine for local dev, but this will refuse to boot in production.`);
  }
}

const DATABASE_URL = required('DATABASE_URL');

// Fail fast rather than booting a production server that is trivially
// exploitable or that will crash on its first query.
if (fatal.length) {
  console.error('\n[env] Refusing to start — invalid production configuration:');
  for (const m of fatal) console.error('  • ' + m);
  console.error('');
  process.exit(1);
}

// A single origin is fine for most deployments, but a comma-separated list lets
// the API serve, say, an internal hostname and a public domain at once.
const CORS_ORIGIN = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

module.exports = {
  NODE_ENV,
  PORT: parseInt(process.env.PORT || '4000', 10),
  CORS_ORIGIN: CORS_ORIGIN.length > 1 ? CORS_ORIGIN : CORS_ORIGIN[0],

  DATABASE_URL,

  JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '1d',
  REFRESH_EXPIRES_IN: process.env.REFRESH_EXPIRES_IN || '7d',
  BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS || '10', 10),

  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  MAIL_FROM: process.env.MAIL_FROM || 'UTech ERP <noreply@utech.local>',

  UPLOAD_DIR: process.env.UPLOAD_DIR || './uploads',
  MAX_UPLOAD_MB: parseInt(process.env.MAX_UPLOAD_MB || '10', 10),

  // default Tally XML server (HTTP ODBC); syncToTally also accepts private-LAN
  // endpoints, but never arbitrary public URLs (SSRF guard)
  TALLY_ENDPOINT: process.env.TALLY_ENDPOINT || 'http://localhost:9000',
};
