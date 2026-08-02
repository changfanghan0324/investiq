import { describe, expect, it } from 'vitest';

import { evaluateDatabaseHealth } from '@/server/database-health-core';

describe('evaluateDatabaseHealth', () => {
  it('reports not-configured without invoking the database', async () => {
    let called = false;
    const result = await evaluateDatabaseHealth(false, async () => {
      called = true;
    }, 10);

    expect(result).toBe('not-configured');
    expect(called).toBe(false);
  });

  it('reports ready after a successful query', async () => {
    await expect(evaluateDatabaseHealth(true, async () => ({ ok: 1 }), 10)).resolves.toBe('ready');
  });

  it('fails closed when the query rejects', async () => {
    await expect(
      evaluateDatabaseHealth(true, async () => {
        throw new Error('connection failed');
      }, 10),
    ).resolves.toBe('unavailable');
  });

  it('fails closed when the query exceeds the timeout', async () => {
    await expect(
      evaluateDatabaseHealth(
        true,
        () => new Promise(() => undefined),
        1,
      ),
    ).resolves.toBe('unavailable');
  });
});
