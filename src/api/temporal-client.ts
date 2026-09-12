import { Client, Connection, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { config } from '../config/config';
import { retryConnect } from '../shared/retry-connect';
import { orderFulfillmentWorkflow } from '../workflows/order.workflow';
import type { OrderWorkflowInput } from '../shared/types';

let client: Client | undefined;

/**
 * Connects once at startup and reuses the same Client/Connection for every
 * request - Temporal Connections are cheap to reuse and expensive to open
 * per-request. Retries because in `docker compose up`, the API container
 * can start before the Temporal server container is ready to accept
 * connections.
 */
export async function connectTemporalClient(): Promise<Client> {
  const connection = await retryConnect(
    () => Connection.connect({ address: config.temporalAddress }),
    {
      label: 'Temporal server',
    },
  );
  client = new Client({ connection, namespace: config.temporalNamespace });
  return client;
}

export function getTemporalClient(): Client {
  if (!client) {
    throw new Error('Temporal client is not connected yet');
  }
  return client;
}

/**
 * Starts the order fulfillment Workflow using the orderId as the Workflow
 * ID. Temporal itself enforces idempotency here: `workflowIdReusePolicy:
 * REJECT_DUPLICATE` means once a Workflow ID has been used, Temporal will
 * never start a second Execution for it (whether the first is still
 * running or already completed/failed). If a caller retries a Create Order
 * request with the same orderId, this call resolves the "duplicate" case by
 * catching WorkflowExecutionAlreadyStartedError and simply returning
 * without starting a second Workflow - the original Execution remains the
 * single source of truth for that order.
 */
export async function startOrderWorkflow(input: OrderWorkflowInput): Promise<{ started: boolean }> {
  const temporal = getTemporalClient();
  try {
    await temporal.workflow.start(orderFulfillmentWorkflow, {
      workflowId: input.orderId,
      taskQueue: config.temporalTaskQueue,
      args: [input],
      workflowIdReusePolicy: 'REJECT_DUPLICATE',
    });
    return { started: true };
  } catch (err) {
    if (err instanceof WorkflowExecutionAlreadyStartedError) {
      return { started: false };
    }
    throw err;
  }
}
