/**
 * Vitest globalSetup runs once, in its own process, before any test file.
 * It does not automatically receive vitest's `test.env` values, so the
 * test database URL is set explicitly here (matching vitest.config.ts)
 * before dynamically importing anything that reads it via config.ts.
 */
export default async function setup(): Promise<void> {
  process.env.DATABASE_URL ??= 'postgres://order_user:order_pass@localhost:5433/order_system';

  const { runMigrations } = await import('../src/db/migrate');
  const { closePool } = await import('../src/db/client');

  await runMigrations();
  await closePool();
}
