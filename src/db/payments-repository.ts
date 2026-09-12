import { pool } from './client';

export interface PaymentRecord {
  id: number;
  orderId: string;
  amount: string;
  status: 'SUCCEEDED';
  createdAt: string;
}

interface PaymentRow {
  id: number;
  order_id: string;
  amount: string;
  status: 'SUCCEEDED';
  created_at: Date;
}

function toPaymentRecord(row: PaymentRow): PaymentRecord {
  return {
    id: row.id,
    orderId: row.order_id,
    amount: row.amount,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

export async function findPaymentByOrderId(orderId: string): Promise<PaymentRecord | null> {
  const result = await pool.query<PaymentRow>('SELECT * FROM payments WHERE order_id = $1', [
    orderId,
  ]);
  const row = result.rows[0];
  return row ? toPaymentRecord(row) : null;
}

/**
 * Records a successful payment keyed by orderId (UNIQUE in the schema).
 * `ON CONFLICT DO NOTHING` makes this call idempotent: if the payment
 * Activity is retried by Temporal after it already succeeded once (e.g. the
 * Activity's success response was lost before Temporal recorded it), this
 * insert is a harmless no-op instead of a double charge. The caller should
 * check `findPaymentByOrderId` first to short-circuit the "charge" itself,
 * but this insert is the last line of defense.
 */
export async function recordPayment(orderId: string, amount: number): Promise<PaymentRecord> {
  const result = await pool.query<PaymentRow>(
    `INSERT INTO payments (order_id, amount, status)
     VALUES ($1, $2, 'SUCCEEDED')
     ON CONFLICT (order_id) DO UPDATE SET order_id = EXCLUDED.order_id
     RETURNING *`,
    [orderId, amount],
  );
  return toPaymentRecord(result.rows[0]!);
}
