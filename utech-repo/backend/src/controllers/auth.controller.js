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

async function login(req, res) {
  const email = normalizeEmail(req.body.email);
  const { password } = req.body;
  const user = await prisma.user.findUnique({
    where: { email },
    include: { role: true },
  });
  if (!user || !user.isActive) throw new HttpError(401, 'Invalid credentials');

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new HttpError(401, 'Invalid credentials');

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
  const expiresAt = dayjs().add(10, 'minute').toDate();

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
  const otp = await prisma.otp.findFirst({
    where: { email, code, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { id: 'desc' },
  });
  if (!otp) throw new HttpError(400, 'Invalid or expired OTP');
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
