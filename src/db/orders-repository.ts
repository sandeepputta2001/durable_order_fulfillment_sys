import type { PoolClient } from 'pg';
import { pool, withTransaction } from './client';
import type {
  OrderItemInput,
  OrderItemRecord,
  OrderRecord,
  OrderStatus,
  OrderSummary,
  OrderWithItems,
} from '../shared/types';

interface OrderRow {
  id: string;
  customer_id: string;
  status: OrderStatus;
  created_at: Date;
  updated_at: Date;
}

interface OrderSummaryRow extends OrderRow {
  item_count: string;
}

interface OrderItemRow {
  id: number;
  order_id: string;
  product_id: string;
  quantity: number;
}

function toOrderRecord(row: OrderRow): OrderRecord {
  return {
    id: row.id,
    customerId: row.customer_id,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toOrderItemRecord(row: OrderItemRow): OrderItemRecord {
  return {
    id: row.id,
    orderId: row.order_id,
    productId: row.product_id,
    quantity: row.quantity,
  };
}

/**
 * Inserts the order and its line items atomically. If an order with this id
 * already exists (a duplicate Create Order request retried by a client),
 * the insert is a no-op and the existing row is returned - this is the
 * database half of the idempotent Create Order behavior; the Temporal half
 * is that starting a Workflow with an already-running Workflow ID is
 * rejected by Temporal itself (see order.workflow.ts / orders route).
 */
export async function createOrder(
  orderId: string,
  customerId: string,
  items: OrderItemInput[],
): Promise<{ order: OrderRecord; created: boolean }> {
  return withTransaction(async (client: PoolClient) => {
    const existing = await client.query<OrderRow>('SELECT * FROM orders WHERE id = $1', [orderId]);
    if (existing.rows.length > 0) {
      return { order: toOrderRecord(existing.rows[0]!), created: false };
    }

    const inserted = await client.query<OrderRow>(
      `INSERT INTO orders (id, customer_id, status) VALUES ($1, $2, 'PENDING') RETURNING *`,
      [orderId, customerId],
    );

    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity) VALUES ($1, $2, $3)`,
        [orderId, item.productId, item.quantity],
      );
    }

    return { order: toOrderRecord(inserted.rows[0]!), created: true };
  });
}

export async function getOrderWithItems(orderId: string): Promise<OrderWithItems | null> {
  const orderResult = await pool.query<OrderRow>('SELECT * FROM orders WHERE id = $1', [orderId]);
  const orderRow = orderResult.rows[0];
  if (!orderRow) {
    return null;
  }
  const itemsResult = await pool.query<OrderItemRow>(
    'SELECT * FROM order_items WHERE order_id = $1 ORDER BY id',
    [orderId],
  );
  return {
    ...toOrderRecord(orderRow),
    items: itemsResult.rows.map(toOrderItemRecord),
  };
}

/**
 * Lists orders newest-first, with each order's line-item count (for list
 * views that don't need full item detail - see getOrderWithItems for
 * that). `limit` caps how many rows come back (a real "return every row
 * ever created" endpoint doesn't scale, so this is capped rather than
 * truly unbounded) and defaults to 50.
 */
export async function listOrders(limit = 50): Promise<OrderSummary[]> {
  const result = await pool.query<OrderSummaryRow>(
    `SELECT o.*, count(oi.id) AS item_count
     FROM orders o
     LEFT JOIN order_items oi ON oi.order_id = o.id
     GROUP BY o.id
     ORDER BY o.created_at DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows.map((row) => ({
    ...toOrderRecord(row),
    itemCount: Number(row.item_count),
  }));
}

export async function updateOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
  await pool.query('UPDATE orders SET status = $1, updated_at = now() WHERE id = $2', [
    status,
    orderId,
  ]);
}
