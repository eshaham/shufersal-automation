import { parsePackSize } from './packSize';

describe('parsePackSize', () => {
  it.each([
    ['2 ליטר', { amount: 2000, unit: 'ml' }],
    ['1.5 ליטר', { amount: 1500, unit: 'ml' }],
    ['500 מ"ל', { amount: 500, unit: 'ml' }],
    ['750 מ״ל', { amount: 750, unit: 'ml' }],
    ['100 מל', { amount: 100, unit: 'ml' }],
    ['1 ק"ג', { amount: 1000, unit: 'g' }],
    ['200 גרם', { amount: 200, unit: 'g' }],
    ['4 * 100 גרם', { amount: 400, unit: 'g' }],
    ['12 יחידות', { amount: 12, unit: 'unit' }],
    ['חלב 3% בקרטון 1 ליטר', { amount: 1000, unit: 'ml' }],
  ])('reads %s', (description, expected) => {
    expect(parsePackSize(description)).toEqual(expected);
  });

  it('returns nothing when there is no size', () => {
    expect(parsePackSize('מחיר לפי משקל')).toBeUndefined();
    expect(parsePackSize('חלב 3%')).toBeUndefined();
    expect(parsePackSize('3 מלפפונים')).toBeUndefined();
    expect(parsePackSize(null)).toBeUndefined();
  });
});
