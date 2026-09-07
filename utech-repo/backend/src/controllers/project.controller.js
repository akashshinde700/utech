'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { nextCode } = require('../utils/numbering');
const { audit } = require('../utils/audit');

async function list(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'createdAt', 'name', 'code',
  ]);
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (search) where.OR = [{ name: { contains: search } }, { code: { contains: search } }];
  const [items, total] = await Promise.all([
    prisma.project.findMany({ where, skip, take, orderBy: { [sortBy]: sortDir } }),
    prisma.project.count({ where }),
  ]);
  res.json(paginated(items, total, page, pageSize));
}

const PROJECT_ITEM_SELECT = {
  id: true, code: true, name: true, type: true,
  currentStock: true, minStock: true, purchaseRate: true,
  uom: { select: { code: true } },
};

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const p = await prisma.project.findUnique({
    where: { id },
    include: {
      tasks: { orderBy: { id: 'asc' } },
      items: { where: { isActive: true }, orderBy: { name: 'asc' }, select: PROJECT_ITEM_SELECT },
    },
  });
  if (!p) throw new HttpError(404, 'Project not found');
  res.json(p);
}

async function create(req, res) {
  // explicit whitelist — raw req.body could otherwise carry id/createdAt
  const data = {};
  for (const key of ['code', 'name', 'partyId', 'budget', 'startDate', 'endDate', 'status']) {
    if (req.body[key] !== undefined) data[key] = req.body[key];
  }
  const code = data.code || (await nextCode('project', 'project'));
  const p = await prisma.project.create({ data: { ...data, code } });
  audit(req, 'create', 'Project', p.id, { code: p.code, name: p.name });
  res.status(201).json(p);
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  // explicit whitelist — a generic edit must never reach id/code/createdAt
  const data = {};
  for (const key of ['name', 'partyId', 'budget', 'startDate', 'endDate', 'status']) {
    if (req.body[key] !== undefined) data[key] = req.body[key];
  }
  const p = await prisma.project.update({ where: { id }, data });
  audit(req, 'update', 'Project', id, { code: p.code, name: p.name });
  res.json(p);
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  await prisma.project.delete({ where: { id } });
  audit(req, 'delete', 'Project', id);
  res.json({ ok: true });
}

// --- Items (real link that replaces the free-text Item.projectNumber) ---
async function listItems(req, res) {
  const projectId = parseInt(req.params.id, 10);
  const items = await prisma.item.findMany({
    where: { projectId, isActive: true },
    orderBy: { name: 'asc' },
    select: PROJECT_ITEM_SELECT,
  });
  res.json(items);
}

async function addItem(req, res) {
  const projectId = parseInt(req.params.id, 10);
  const itemId = parseInt(req.body.itemId, 10);
  if (!itemId) throw new HttpError(400, 'itemId is required');
  const [project, item] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }),
    prisma.item.findUnique({ where: { id: itemId }, select: { id: true, projectId: true } }),
  ]);
  if (!project) throw new HttpError(404, 'Project not found');
  if (!item) throw new HttpError(404, 'Item not found');
  if (item.projectId && item.projectId !== projectId) {
    throw new HttpError(409, 'Item is already linked to another project');
  }
  const updated = await prisma.item.update({
    where: { id: itemId }, data: { projectId }, select: PROJECT_ITEM_SELECT,
  });
  audit(req, 'update', 'Item', itemId, { linkedToProject: projectId });
  res.status(201).json(updated);
}

async function removeItem(req, res) {
  const projectId = parseInt(req.params.id, 10);
  const itemId = parseInt(req.params.itemId, 10);
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { projectId: true } });
  if (!item || item.projectId !== projectId) throw new HttpError(404, 'Item is not linked to this project');
  await prisma.item.update({ where: { id: itemId }, data: { projectId: null } });
  audit(req, 'update', 'Item', itemId, { unlinkedFromProject: projectId });
  res.json({ ok: true });
}

// --- Tasks ---
async function listTasks(req, res) {
  const projectId = parseInt(req.params.id, 10);
  const tasks = await prisma.projectTask.findMany({
    where: { projectId },
    orderBy: { id: 'asc' },
  });
  res.json(tasks);
}

async function createTask(req, res) {
  const projectId = parseInt(req.params.id, 10);
  const data = {};
  for (const key of ['parentId', 'name', 'assignedTo', 'status', 'startDate', 'dueDate', 'completedAt']) {
    if (req.body[key] !== undefined) data[key] = req.body[key];
  }
  const t = await prisma.projectTask.create({ data: { ...data, projectId } });
  audit(req, 'create', 'ProjectTask', t.id);
  res.status(201).json(t);
}

async function updateTask(req, res) {
  const taskId = parseInt(req.params.taskId, 10);
  const data = {};
  for (const key of ['parentId', 'name', 'assignedTo', 'status', 'startDate', 'dueDate', 'completedAt']) {
    if (req.body[key] !== undefined) data[key] = req.body[key];
  }
  const t = await prisma.projectTask.update({ where: { id: taskId }, data });
  audit(req, 'update', 'ProjectTask', taskId);
  res.json(t);
}

async function deleteTask(req, res) {
  const taskId = parseInt(req.params.taskId, 10);
  await prisma.projectTask.delete({ where: { id: taskId } });
  audit(req, 'delete', 'ProjectTask', taskId);
  res.json({ ok: true });
}

module.exports = {
  list, get, create, update, remove,
  listItems, addItem, removeItem,
  listTasks, createTask, updateTask, deleteTask,
};
