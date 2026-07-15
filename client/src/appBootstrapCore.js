export const BOOTSTRAP_TIMEOUT_MS = 8000;

export class BootstrapTimeoutError extends Error {
  constructor(ms) {
    super(`App bootstrap timed out after ${ms}ms`);
    this.name = 'BootstrapTimeoutError';
    this.code = 'APP_BOOTSTRAP_TIMEOUT';
  }
}

export function withTimeout(promise, ms = BOOTSTRAP_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new BootstrapTimeoutError(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function runBootstrapTasks({ initialize, restoreSession, finalize, timeoutMs = BOOTSTRAP_TIMEOUT_MS }) {
  try {
    const session = await withTimeout((async () => {
      await initialize?.();
      return restoreSession?.();
    })(), timeoutMs);
    return { session, error: null };
  } catch (error) {
    return {
      session: { state: 'retry', user: null, error },
      error,
    };
  } finally {
    try {
      if (finalize) await withTimeout(Promise.resolve().then(finalize), 500);
    } catch { /* finalizer failure must not strand the UI */ }
  }
}
