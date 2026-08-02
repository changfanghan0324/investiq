export type DatabaseHealth = 'ready' | 'unavailable' | 'not-configured';

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const rejected = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Database health check timed out.')), timeoutMs);
  });
  try {
    return await Promise.race([work, rejected]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function evaluateDatabaseHealth(
  configured: boolean,
  query: () => Promise<unknown>,
  timeoutMs: number,
): Promise<DatabaseHealth> {
  if (!configured) return 'not-configured';
  try {
    const queryResult = query();
    // The query may settle after the timeout. Keeping it inside the raced promise
    // installs rejection handling even when the timeout wins first.
    await withTimeout(queryResult.catch((error) => Promise.reject(error)), timeoutMs);
    return 'ready';
  } catch {
    return 'unavailable';
  }
}
