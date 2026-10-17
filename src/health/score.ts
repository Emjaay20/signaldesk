export type HealthReason = 'missing_name' | 'missing_price' | 'out_of_stock';

export type HealthInput = {
  name: string;
  price: number | null;
  stock: number | null;
};

export type HealthScore = {
  score: number;
  reasons: HealthReason[];
  healthy: boolean;
};

const PENALTY: Record<HealthReason, number> = {
  missing_name: 40,
  missing_price: 30,
  out_of_stock: 40,
};

export function scoreProduct(input: HealthInput): HealthScore {
  const reasons: HealthReason[] = [];

  if (!input.name.trim()) {
    reasons.push('missing_name');
  }
  if (input.price === null) {
    reasons.push('missing_price');
  }
  if (input.stock === 0) {
    reasons.push('out_of_stock');
  }

  const deducted = reasons.reduce((sum, reason) => sum + PENALTY[reason], 0);
  const score = Math.max(0, 100 - deducted);
  return { score, reasons, healthy: reasons.length === 0 };
}
