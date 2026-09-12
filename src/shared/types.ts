export type OrderStatus =
  'PENDING' | 'VALIDATING' | 'INVENTORY_RESERVED' | 'PAYMENT_PROCESSING' | 'CONFIRMED' | 'FAILED';

export interface OrderItemInput {
  productId: string;
  quantity: number;
}

export interface CreateOrderRequest {
  /** Optional client-supplied idempotency key; see README "Idempotency". */
  orderId?: string;
  customerId: string;
  items: OrderItemInput[];
}

export interface OrderRecord {
  id: string;
  customerId: string;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItemRecord {
  id: number;
  orderId: string;
  productId: string;
  quantity: number;
}

export interface OrderWithItems extends OrderRecord {
  items: OrderItemRecord[];
}

/**
 * Input passed from the API into the Temporal workflow. Kept separate from
 * OrderRecord because the workflow only needs the data required to run the
 * business process, not persistence metadata like timestamps.
 */
export interface OrderWorkflowInput {
  orderId: string;
  customerId: string;
  items: OrderItemInput[];
}

export interface OrderWorkflowResult {
  orderId: string;
  status: OrderStatus;
  paymentId?: string;
}
