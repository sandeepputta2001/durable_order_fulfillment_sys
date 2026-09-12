import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from '../config/config';

/**
 * A single shared connection pool. We deliberately keep the database access
 * layer thin (plain `pg` + hand-written SQL) instead of an ORM so the SQL
 * driving each business operation is visible and easy to reason about.
 */
export const pool = new Pool({ connectionString: config.databaseUrl });

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return pool.query<T>(text, params);
}

/**
 * Runs `fn` inside a single PostgreSQL transaction. Commits on success,
 * rolls back on any thrown error. Used whenever an operation must update
 * more than one table atomically (e.g. creating an order + its items, or
 * reserving inventory + recording the reservation).
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
