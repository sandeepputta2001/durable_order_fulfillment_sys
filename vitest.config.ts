import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    pool: 'forks',
    // Test files share one real Postgres database (rather than a mocked
    // one, to keep the DB layer's SQL genuinely exercised); running them
    // concurrently causes cross-file TRUNCATE deadlocks/races, so they run
    // one file at a time instead.
    fileParallelism: false,
    globalSetup: ['./tests/global-setup.ts'],
    env: {
      DATABASE_URL: 'postgres://order_user:order_pass@localhost:5433/order_system',
      PAYMENT_FAILURE_MODE: 'false',
      LOG_LEVEL: 'silent',
    },
  },
});
