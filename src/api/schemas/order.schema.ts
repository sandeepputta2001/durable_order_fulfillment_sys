/**
 * JSON Schema definitions used by Fastify for request validation (input
 * boundary security: reject malformed input before it reaches business
 * logic) and response serialization. These same schemas are what
 * @fastify/swagger reads to generate the OpenAPI spec served at /docs -
 * see src/api/docs.ts - so the docs can never drift from what the API
 * actually validates.
 */

const orderItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    orderId: { type: 'string' },
    productId: { type: 'string' },
    quantity: { type: 'integer' },
  },
} as const;

const orderSummarySchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'The order id, also used as the Temporal Workflow ID' },
    customerId: { type: 'string' },
    status: {
      type: 'string',
      enum: [
        'PENDING',
        'VALIDATING',
        'INVENTORY_RESERVED',
        'PAYMENT_PROCESSING',
        'CONFIRMED',
        'FAILED',
      ],
    },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    itemCount: { type: 'integer', description: 'Number of line items on the order' },
  },
} as const;

const errorSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
  },
} as const;

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

const createOrderResultSchema = {
  type: 'object',
  properties: {
    orderId: { type: 'string' },
    status: { type: 'string' },
  },
} as const;

export const createOrderResponseSchema = {
  200: createOrderResultSchema,
  201: createOrderResultSchema,
} as const;

export const getOrderParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1 },
  },
} as const;

export const getOrderResponseSchema = {
  200: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      customerId: { type: 'string' },
      status: orderSummarySchema.properties.status,
      items: { type: 'array', items: orderItemSchema },
    },
  },
  404: errorSchema,
} as const;

export const listOrdersQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 200,
      default: 50,
      description: 'Maximum number of orders to return, newest first',
    },
  },
} as const;

export const listOrdersResponseSchema = {
  200: {
    type: 'object',
    properties: {
      orders: { type: 'array', items: orderSummarySchema },
    },
  },
} as const;
