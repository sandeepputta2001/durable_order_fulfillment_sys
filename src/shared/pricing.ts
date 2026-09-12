import type { OrderItemInput } from './types';

/**
 * Simulated product catalog pricing. In a real system this would be a
 * lookup against a product/catalog service; for this POC a static table is
 * enough to demonstrate the payment Activity computing a real total.
 */
const UNIT_PRICES: Record<string, number> = {
  'product-1': 19.99,
  'product-2': 9.99,
  'product-3': 49.99,
  'product-oos': 5.0,
};

const DEFAULT_UNIT_PRICE = 9.99;

export function calculateOrderTotal(items: OrderItemInput[]): number {
  const total = items.reduce((sum, item) => {
    const unitPrice = UNIT_PRICES[item.productId] ?? DEFAULT_UNIT_PRICE;
    return sum + unitPrice * item.quantity;
  }, 0);
  return Math.round(total * 100) / 100;
}
