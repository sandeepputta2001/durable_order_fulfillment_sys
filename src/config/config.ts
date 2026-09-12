import 'dotenv/config';

/**
 * Centralized, env-driven configuration. Nothing here is hardcoded; every
 * value can be overridden by an environment variable so the same compiled
 * artifact runs unmodified in local dev, CI, Docker Compose, and on an
 * exe.dev VM - only the environment changes between them.
 *
 * `dotenv/config` loads variables from a local `.env` file (if present)
 * into `process.env` before we read them below - this only matters for
 * running the API/Worker directly on the host (`npm run dev:*`); in
 * Docker Compose and CI, environment variables are already provided by
 * the orchestrator and a missing `.env` file is a harmless no-op.
 */
export interface AppConfig {
  port: number;
  workerMetricsPort: number;
  databaseUrl: string;
  temporalAddress: string;
  temporalNamespace: string;
  temporalTaskQueue: string;
  paymentFailureMode: boolean;
  logLevel: string;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true' || value === '1';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT ?? 8080),
    workerMetricsPort: Number(env.WORKER_METRICS_PORT ?? 9464),
    databaseUrl: env.DATABASE_URL ?? 'postgres://order_user:order_pass@localhost:5432/order_system',
    temporalAddress: env.TEMPORAL_ADDRESS ?? 'localhost:7233',
    temporalNamespace: env.TEMPORAL_NAMESPACE ?? 'default',
    temporalTaskQueue: env.TEMPORAL_TASK_QUEUE ?? 'order-fulfillment',
    paymentFailureMode: parseBoolean(env.PAYMENT_FAILURE_MODE, false),
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}

export const config = loadConfig();
