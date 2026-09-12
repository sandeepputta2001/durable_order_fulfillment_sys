import { logger } from './logger';

/**
 * Retries connecting to an infrastructure dependency (Postgres, Temporal)
 * with a fixed delay between attempts. This is a startup/connectivity
 * concern, not a business-logic retry decision - it exists so `docker
 * compose up` works correctly even though container start order does not
 * guarantee a dependency is actually ready to accept connections yet.
 */
export async function retryConnect<T>(
  fn: () => Promise<T>,
  options: { label: string; retries?: number; delayMs?: number },
): Promise<T> {
  const { label, retries = 30, delayMs = 2000 } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      logger.warn(
        { attempt, retries, label },
        `waiting for ${label} to become available (attempt ${attempt}/${retries})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Timed out waiting for ${label} to become available: ${message}`);
}
