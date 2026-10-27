'use strict';
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuid } = require('uuid');
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const env = require('../config/env');
const { audit } = require('../utils/audit');

const baseDir = path.resolve(env.UPLOAD_DIR);
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

const IMAGE_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, baseDir),
  // Separate namespace from document attachments, including for unsaved
  // quotation previews. Existing referenced images remain readable below.
  filename: (_req, file, cb) => cb(null, `quotation-${uuid()}${path.extname(file.originalname).toLowerCase()}`),
});

const upload = multer({
  storage,
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, IMAGE_TYPES[ext] === String(file.mimetype || '').toLowerCase());
  },
});

async function list(_req, res) {
  const templates = await prisma.quotationTemplate.findMany({ orderBy: { name: 'asc' } });
  res.json(templates);
}

async function create(req, res) {
  const { name, headerText, footerText, isDefault, headerImageName, headerImageStoredName, footerImageName, footerImageStoredName } = req.body;
  if (!name || !name.trim()) throw new HttpError(400, 'Name is required');
  if (isDefault) await prisma.quotationTemplate.updateMany({ data: { isDefault: false } });
  const t = await prisma.quotationTemplate.create({
    data: {
      name: name.trim(),
      headerText: headerText || null,
      footerText: footerText || null,
      headerImageName: headerImageName || null,
      headerImageStoredName: headerImageStoredName || null,
      footerImageName: footerImageName || null,
      footerImageStoredName: footerImageStoredName || null,
      isDefault: !!isDefault,
    },
  });
  await audit(req, 'create', 'QuotationTemplate', t.id, { name: t.name });
  res.status(201).json(t);
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const { name, headerText, footerText, isDefault, headerImageName, headerImageStoredName, footerImageName, footerImageStoredName } = req.body;
  if (isDefault) await prisma.quotationTemplate.updateMany({ data: { isDefault: false } });
  const t = await prisma.quotationTemplate.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(headerText !== undefined ? { headerText } : {}),
      ...(footerText !== undefined ? { footerText } : {}),
      ...(headerImageName !== undefined ? { headerImageName } : {}),
      ...(headerImageStoredName !== undefined ? { headerImageStoredName } : {}),
      ...(footerImageName !== undefined ? { footerImageName } : {}),
      ...(footerImageStoredName !== undefined ? { footerImageStoredName } : {}),
      ...(isDefault !== undefined ? { isDefault: !!isDefault } : {}),
    },
  });
  await audit(req, 'update', 'QuotationTemplate', id, { name: t.name });
  res.json(t);
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  await prisma.quotationTemplate.delete({ where: { id } });
  await audit(req, 'delete', 'QuotationTemplate', id);
  res.json({ ok: true });
}

// generic "upload an image, get back a reference" endpoint used for both
// quotation templates and one-off per-quotation header/footer images
async function uploadImage(req, res) {
  if (!req.file) throw new HttpError(400, 'No file uploaded (or unsupported image type)');
  res.status(201).json({
    filename: req.file.originalname,
    storedName: req.file.filename,
    mimeType: req.file.mimetype,
  });
}

async function serveImage(req, res) {
  const storedName = path.basename(req.params.storedName);
  const ext = path.extname(storedName).toLowerCase();
  if (storedName !== req.params.storedName || !IMAGE_TYPES[ext]) throw new HttpError(404, 'Image not found');

  // Attachments share the historical upload directory, but require their own
  // document/ownership checks. Quotation read permission must never bypass them.
  if (await prisma.attachment.findFirst({ where: { storedName }, select: { id: true } })) {
    throw new HttpError(404, 'Image not found');
  }
  const newImage = /^quotation-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|webp|gif)$/i.test(storedName);
  if (!newImage) {
    // Legacy images had plain UUID names. Only files actually referenced by a
    // quotation or template are eligible; do not expose arbitrary old uploads.
    const where = { OR: [{ headerImageStoredName: storedName }, { footerImageStoredName: storedName }] };
    const [quotation, template] = await Promise.all([
      prisma.quotation.findFirst({ where, select: { id: true } }),
      prisma.quotationTemplate.findFirst({ where, select: { id: true } }),
    ]);
    if (!quotation && !template) throw new HttpError(404, 'Image not found');
  }
  const filePath = path.join(baseDir, storedName);
  if (!fs.existsSync(filePath)) throw new HttpError(404, 'Image not found');
  res.type(IMAGE_TYPES[ext]);
  res.sendFile(filePath);
}

module.exports = { list, create, update, remove, upload, uploadImage, serveImage };
