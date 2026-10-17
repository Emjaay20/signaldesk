import { scoreProduct } from '../src/health/score';

describe('scoreProduct', () => {
  it('scores a complete in-stock product as healthy', () => {
    expect(
      scoreProduct({ name: 'Widget', price: 9.99, stock: 12 }),
    ).toEqual({ score: 100, reasons: [], healthy: true });
  });

  it('flags out of stock', () => {
    const result = scoreProduct({ name: 'Gadget', price: 4.5, stock: 0 });
    expect(result.healthy).toBe(false);
    expect(result.reasons).toContain('out_of_stock');
    expect(result.score).toBe(60);
  });

  it('flags missing price', () => {
    const result = scoreProduct({ name: 'Adapter', price: null, stock: 5 });
    expect(result.reasons).toEqual(['missing_price']);
    expect(result.score).toBe(70);
  });

  it('flags missing name', () => {
    const result = scoreProduct({ name: '  ', price: 2, stock: 5 });
    expect(result.reasons).toEqual(['missing_name']);
    expect(result.score).toBe(60);
  });

  it('stacks reasons and never goes below 0', () => {
    const result = scoreProduct({ name: '', price: null, stock: 0 });
    expect(result.healthy).toBe(false);
    expect(result.reasons).toEqual([
      'missing_name',
      'missing_price',
      'out_of_stock',
    ]);
    expect(result.score).toBe(0);
  });
});
