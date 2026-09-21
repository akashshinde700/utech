'use strict';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../config/prisma');
const env = require('../config/env');
const HttpError = require('../utils/httpError');
const dayjs = require('dayjs');
const { audit } = require('../utils/audit');

// emails are stored/compared lowercase-trimmed — 'Admin@Utech.local' must find
// the same account as 'admin@utech.local'
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role && user.role.name },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
}

// A real bcrypt hash of a random secret, computed once at the configured cost.
// An unknown email is compared against this instead of returning early, so a
// login for an account that doesn't exist costs the same wall-clock time as
// one with a wrong password — otherwise the response time alone tells an
// attacker which emails are registered.
let decoyHashPromise = null;
function decoyHash() {
  if (!decoyHashPromise) {
    decoyHashPromise = bcrypt.hash(crypto.randomBytes(32).toString('hex'), env.BCRYPT_ROUNDS);
  }
  return decoyHashPromise;
}

// length-safe constant-time compare for short secrets (OTP codes)
function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''), 'utf8');
  const bb = Buffer.from(String(b ?? ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

async function login(req, res) {
  const email = normalizeEmail(req.body.email);
  const { password } = req.body;
  const user = await prisma.user.findUnique({
    where: { email },
    include: { role: true },
  });

  // always run one bcrypt compare, present account or not (see decoyHash)
  const ok = await bcrypt.compare(password, user ? user.passwordHash : await decoyHash());
  if (!user || !user.isActive || !ok) throw new HttpError(401, 'Invalid credentials');

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const token = signToken(user);
  await audit(req, 'login', 'User', user.id, { email });
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role && user.role.name },
  });
}

async function me(req, res) {
  res.json({ user: req.user });
}

async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) throw new HttpError(404, 'User not found');

  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) throw new HttpError(400, 'Current password is incorrect');

  const passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  await audit(req, 'changePassword', 'User', user.id);
  res.json({ ok: true });
}

// --- OTP scaffold (no email sending wired by default — logs to console) ---

function generateOtp() {
  // cryptographically random 6-digit code — Math.random() is predictable
  return String(crypto.randomInt(100000, 1000000));
}

async function requestOtp(req, res) {
  const email = normalizeEmail(req.body.email);
  const { purpose } = req.body;
  const code = generateOtp();
  const expiresAt = dayjs().add(env.OTP_EXPIRY_MINUTES, 'minute').toDate();

  const user = await prisma.user.findUnique({ where: { email } });
  // any OTP still outstanding for this email+purpose is dead the moment a new
  // one is requested — otherwise old codes stay valid for their full TTL
  await prisma.otp.updateMany({
    where: { email, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  await prisma.otp.create({
    data: { email, code, purpose, expiresAt, userId: user ? user.id : null },
  });

  // TODO: integrate nodemailer / SMS provider here.
  // For now, log in dev only so QA can test — OTPs must never hit production logs.
  if (env.NODE_ENV !== 'production') {
    console.log(`[OTP] ${purpose} for ${email}: ${code}`);
  }

  res.json({ ok: true, devCode: env.NODE_ENV !== 'production' ? code : undefined });
}

async function verifyOtp(req, res) {
  const email = normalizeEmail(req.body.email);
  const { code, purpose } = req.body;

  // Look the code up by email+purpose, NOT by the submitted code: matching on
  // the code meant a wrong guess found no row at all, so there was nothing to
  // count attempts against and the 6-digit space stayed probeable for the
  // code's whole lifetime. requestOtp consumes any earlier outstanding code,
  // so there is at most one live row per email+purpose.
  const otp = await prisma.otp.findFirst({
    where: { email, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { id: 'desc' },
  });
  if (!otp) throw new HttpError(400, 'Invalid or expired OTP');

  if (otp.attempts >= env.OTP_MAX_ATTEMPTS) {
    // burn it — otherwise the limit just resets on the next request
    await prisma.otp.updateMany({
      where: { id: otp.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    throw new HttpError(429, 'Too many incorrect attempts — request a new code');
  }

  if (!timingSafeEqual(otp.code, code)) {
    await prisma.otp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw new HttpError(400, 'Invalid or expired OTP');
  }

  // conditional consume: only the first concurrent claim flips consumedAt
  // (check-then-update let a single OTP be used twice in a race)
  const consumed = await prisma.otp.updateMany({
    where: { id: otp.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count === 0) throw new HttpError(400, 'Invalid or expired OTP');

  // If purpose is login and user exists -> issue token
  if (purpose === 'login') {
    const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
    if (!user || !user.isActive) throw new HttpError(401, 'User not found / inactive');
    const token = signToken(user);
    await audit(req, 'otp.login', 'User', user.id, { email });
    return res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role && user.role.name },
    });
  }
  res.json({ ok: true });
}

module.exports = { login, me, changePassword, requestOtp, verifyOtp };
