import { createServer } from 'node:http';
import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from '../activities';
import { config } from '../config/config';
import { logger } from '../shared/logger';
import { register } from '../shared/metrics';
import { retryConnect } from '../shared/retry-connect';
import { runMigrations } from '../db/migrate';

function startMetricsServer(): void {
  const server = createServer((req, res) => {
    if (req.url === '/metrics') {
      register
        .metrics()
        .then((body) => {
          res.writeHead(200, { 'Content-Type': register.contentType });
          res.end(body);
        })
        .catch((err: Error) => {
          res.writeHead(500);
          res.end(err.message);
        });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(config.workerMetricsPort, () => {
    logger.info({ port: config.workerMetricsPort }, 'worker metrics server listening');
  });
}

async function main(): Promise<void> {
  // The Worker also ensures migrations are applied so `docker compose up`
  // works from a completely empty database with no manual steps. Retries
  // because Postgres may still be starting when this container starts.
  await retryConnect(() => runMigrations(), { label: 'Postgres (migrations)' });
  startMetricsServer();

  const connection = await retryConnect(
    () => NativeConnection.connect({ address: config.temporalAddress }),
    { label: 'Temporal server' },
  );

  const worker = await Worker.create({
    connection,
    namespace: config.temporalNamespace,
    taskQueue: config.temporalTaskQueue,
    workflowsPath: require.resolve('../workflows/order.workflow'),
    activities,
  });

  logger.info(
    {
      taskQueue: config.temporalTaskQueue,
      temporalAddress: config.temporalAddress,
      namespace: config.temporalNamespace,
    },
    'Temporal worker starting',
  );

  await worker.run();
}

main().catch((err) => {
  logger.error({ error: (err as Error).message }, 'worker failed to start');
  process.exit(1);
});
