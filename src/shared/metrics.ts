import { Registry, Counter, Histogram, collectDefaultMetrics } from 'prom-client';

/**
 * The API and Worker are independently-runnable processes (see
 * docs/ARCHITECTURE.md), so each has its own in-memory Prometheus registry and
 * its own /metrics endpoint - there is no shared metrics backend in this
 * POC. In a real deployment both endpoints would simply be added as
 * separate Prometheus scrape targets.
 */
export const register = new Registry();
collectDefaultMetrics({ register });

// --- API/HTTP metrics --------------------------------------------------

/** How many requests hit the API, broken down by outcome - the base signal for traffic and error-rate dashboards. */
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests, labeled by method, route and status code',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

/** Request latency distribution - used to answer "how slow is /orders at p95/p99?" */
export const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds, labeled by method, route and status code',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// --- Business / order metrics ------------------------------------------

/** Counts every order accepted by POST /orders - the top of the fulfillment funnel. */
export const ordersCreatedTotal = new Counter({
  name: 'orders_created_total',
  help: 'Total number of orders created via POST /orders',
  registers: [register],
});

/** Counts orders that made it all the way to CONFIRMED - the bottom of the funnel; compare against orders_created_total for a conversion rate. */
export const ordersConfirmedTotal = new Counter({
  name: 'orders_confirmed_total',
  help: 'Total number of orders that reached CONFIRMED status',
  registers: [register],
});

/** Counts orders that ended in FAILED (business rejection or exhausted retries) - the key alerting signal for fulfillment health. */
export const ordersFailedTotal = new Counter({
  name: 'orders_failed_total',
  help: 'Total number of orders that ended in FAILED status',
  registers: [register],
});

/** Per-Activity success/failure counts - pinpoints which step in the workflow is unhealthy (e.g. payment vs inventory). */
export const activityExecutionsTotal = new Counter({
  name: 'activity_executions_total',
  help: 'Total number of Temporal Activity executions, labeled by activity name and outcome',
  labelNames: ['activity', 'outcome'],
  registers: [register],
});

/**
 * Wraps an Activity implementation to record activity_executions_total
 * without cluttering each Activity's business logic with metrics code.
 */
export function withActivityMetrics<Args extends unknown[], R>(
  name: string,
  fn: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
  return async (...args: Args): Promise<R> => {
    try {
      const result = await fn(...args);
      activityExecutionsTotal.inc({ activity: name, outcome: 'success' });
      return result;
    } catch (err) {
      activityExecutionsTotal.inc({ activity: name, outcome: 'failure' });
      throw err;
    }
  };
}
