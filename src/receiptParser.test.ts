import fs from 'fs';
import path from 'path';

import { parseReceipt } from './receiptParser';
import { ReceiptDetails } from './types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function getFixtureFiles(): string[] {
  const files = fs.readdirSync(FIXTURES_DIR);
  const receiptFiles = files.filter(
    (file) => file.endsWith('.txt') && !file.startsWith('.'),
  );
  return receiptFiles.map((file) => file.replace('.txt', ''));
}

describe('Receipt Parser', () => {
  const fixtures = getFixtureFiles();

  if (fixtures.length === 0) {
    throw new Error('No test fixtures found in tests/receiptParser/fixtures/');
  }

  fixtures.forEach((fixtureName) => {
    describe(fixtureName, () => {
      let receiptText: string;
      let expected: ReceiptDetails;
      let actual: ReceiptDetails;

      beforeAll(() => {
        const txtPath = path.join(FIXTURES_DIR, `${fixtureName}.txt`);
        const expectedPath = path.join(
          FIXTURES_DIR,
          `${fixtureName}.expected.json`,
        );

        receiptText = fs.readFileSync(txtPath, 'utf-8').replace(/\\n/g, '\n');
        expected = JSON.parse(
          fs.readFileSync(expectedPath, 'utf-8'),
        ) as ReceiptDetails;
        actual = parseReceipt(receiptText);
      });

      test('should parse order code correctly', () => {
        expect(actual.orderCode).toBe(expected.orderCode);
      });

      test('should parse order date correctly', () => {
        expect(actual.orderDate).toBe(expected.orderDate);
      });

      test('should parse delivery date correctly', () => {
        expect(actual.deliveryDate).toBe(expected.deliveryDate);
      });

      test('should parse customer name correctly', () => {
        expect(actual.customerName).toBe(expected.customerName);
      });

      test('should parse customer phone correctly', () => {
        expect(actual.customerPhone).toBe(expected.customerPhone);
      });

      test('should parse address correctly', () => {
        expect(actual.address).toBe(expected.address);
      });

      test('should parse correct number of items', () => {
        expect(actual.items).toHaveLength(expected.items.length);
      });

      test('should parse all items correctly', () => {
        expect(actual.items).toEqual(expected.items);
      });

      test('should parse subtotal correctly', () => {
        expect(actual.subtotal).toBe(expected.subtotal);
      });

      test('should parse VAT amount correctly', () => {
        expect(actual.vatAmount).toBe(expected.vatAmount);
      });

      test('should parse delivery fee correctly', () => {
        expect(actual.deliveryFee).toBe(expected.deliveryFee);
      });

      test('should parse total amount correctly', () => {
        expect(actual.totalAmount).toBe(expected.totalAmount);
      });

      test('should have subtotal + delivery = total', () => {
        expect(actual.subtotal + actual.deliveryFee).toBeCloseTo(
          actual.totalAmount,
          2,
        );
      });

      test('should have items total - promotions = subtotal', () => {
        const itemsTotal = actual.items.reduce(
          (sum, item) => sum + item.totalPrice,
          0,
        );
        const promotionsTotal = actual.items.reduce((sum, item) => {
          return (
            sum +
            (item.promotions || []).reduce(
              (psum, promo) => psum + promo.discountAmount,
              0,
            )
          );
        }, 0);

        expect(itemsTotal - promotionsTotal).toBeCloseTo(actual.subtotal, 2);
      });
    });
  });
});
