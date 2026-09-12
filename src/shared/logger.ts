import pino from 'pino';
import { config } from '../config/config';

/**
 * Structured JSON logging. Every important operation logs with consistent
 * field names (orderId, workflowId, activity, status, error, duration) so
 * logs can be filtered/correlated in any log aggregator without parsing
 * free-text messages. Never log secrets or full request bodies here.
 */
export const logger = pino({
  level: config.logLevel,
  base: { service: 'durable-order-system' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
