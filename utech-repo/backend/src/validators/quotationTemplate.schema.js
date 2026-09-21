'use strict';
const { z } = require('zod');

// the controller calls name.trim() — a non-string name used to throw a 500
const templateBase = {
  name: z.string().min(1),
  headerText: z.string().optional().nullable(),
  footerText: z.string().optional().nullable(),
  headerImageName: z.string().optional().nullable(),
  headerImageStoredName: z.string().optional().nullable(),
  footerImageName: z.string().optional().nullable(),
  footerImageStoredName: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
};

const createTemplateSchema = z.object(templateBase);
const updateTemplateSchema = z.object(templateBase).partial();

module.exports = { createTemplateSchema, updateTemplateSchema };
