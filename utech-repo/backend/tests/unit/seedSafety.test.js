'use strict';

import { describe, it, expect, vi, afterEach } from 'vitest';
const { seedDatabase } = require('../../prisma/seed');

afterEach(() => vi.unstubAllEnvs());

describe('production seed safety', () => {
  it('refuses the demo administrator before writing any data in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SEED_CONFIG_ONLY', '');
    const upsert = vi.fn();
    await expect(seedDatabase({ permission: { upsert } })).rejects.toThrow(/Refusing demo seed in production/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('permits an explicitly configuration-only production seed to start', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SEED_CONFIG_ONLY', '1');
    const upsert = vi.fn().mockRejectedValue(new Error('Stopped at first fake write'));
    await expect(seedDatabase({ permission: { upsert } })).rejects.toThrow('Stopped at first fake write');
    expect(upsert).toHaveBeenCalledOnce();
  });
});
