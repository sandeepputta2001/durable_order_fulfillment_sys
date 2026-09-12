/**
 * JSON Schema definitions used by Fastify for request validation (input
 * boundary security: reject malformed input before it reaches business
 * logic) and response serialization.
 */
export const createOrderBodySchema = {
  type: 'object',
  required: ['customerId', 'items'],
  additionalProperties: false,
  properties: {
    orderId: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      description:
        'Optional client-supplied idempotency key. Reusing the same orderId on a retried request is what makes Create Order idempotent - see README "Idempotency" section.',
    },
    customerId: { type: 'string', minLength: 1, maxLength: 128 },
    items: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['productId', 'quantity'],
        additionalProperties: false,
        properties: {
          productId: { type: 'string', minLength: 1, maxLength: 128 },
          quantity: { type: 'integer', minimum: 1 },
        },
      },
    },
  },
} as const;

export const createOrderResponseSchema = {
  200: {
    type: 'object',
    properties: {
      orderId: { type: 'string' },
      status: { type: 'string' },
    },
  },
} as const;

export const getOrderParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1 },
  },
} as const;

export const listOrdersQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
  },
} as const;
