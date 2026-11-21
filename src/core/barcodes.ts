import type { Product, SearchResults } from './types';

const BARCODE_SEARCH_LIMIT = 5;
const MIN_BARCODE_LENGTH = 8;
const EAN_13_LENGTH = 13;

export function hasValidCheckDigit(barcode: string): boolean {
  if (!/^\d+$/.test(barcode) || barcode.length < MIN_BARCODE_LENGTH) {
    return false;
  }
  const digits = barcode.split('').map(Number);
  const checkDigit = digits.pop();
  const sum = digits
    .reverse()
    .reduce((total, digit, index) => total + digit * (index % 2 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === checkDigit;
}

export function normalizeBarcode(raw: string): string | undefined {
  if (!/^\d+$/.test(raw)) {
    return undefined;
  }
  const trimmed = raw.replace(/^0+/, '');
  if (trimmed.length < MIN_BARCODE_LENGTH) {
    return undefined;
  }
  const barcode =
    trimmed.length > MIN_BARCODE_LENGTH && trimmed.length < EAN_13_LENGTH
      ? trimmed.padStart(EAN_13_LENGTH, '0')
      : trimmed;
  return hasValidCheckDigit(barcode) ? barcode : undefined;
}

export type ProductSearch = (
  query: string,
  limit: number,
) => Promise<SearchResults>;

export async function findProductsByBarcodes(
  search: ProductSearch,
  barcodes: string[],
  queriesFor: (barcode: string) => string[],
): Promise<Map<string, Product>> {
  const found = new Map<string, Product>();
  const unique = barcodes.filter(
    (barcode, index) => barcodes.indexOf(barcode) === index,
  );
  for (const barcode of unique) {
    for (const query of queriesFor(barcode)) {
      const { results } = await search(query, BARCODE_SEARCH_LIMIT);
      const match = results.find((product) => product.barcode === barcode);
      if (match) {
        found.set(barcode, match);
        break;
      }
    }
  }
  return found;
}
