import { hasValidCheckDigit, normalizeBarcode } from './core/barcodes';

const SHUFERSAL_CODE = /^P_(\d+)$/;
const ISRAELI_PREFIX = '729';
const SHORTENED_LENGTH = 10;
const EAN_8_LENGTH = 8;

export function barcodeFromShufersalCode(code: string): string | undefined {
  const digits = SHUFERSAL_CODE.exec(code)?.[1];
  if (!digits) {
    return undefined;
  }
  if (digits.length === EAN_8_LENGTH) {
    return normalizeBarcode(digits);
  }
  if (digits.length <= SHORTENED_LENGTH) {
    const israeli = ISRAELI_PREFIX + digits.padStart(SHORTENED_LENGTH, '0');
    return hasValidCheckDigit(israeli) ? israeli : undefined;
  }
  return normalizeBarcode(digits);
}

export function shufersalSearchQueries(barcode: string): string[] {
  const shortened = barcode.startsWith(ISRAELI_PREFIX)
    ? barcode.slice(ISRAELI_PREFIX.length).replace(/^0+/, '')
    : barcode.replace(/^0+/, '');
  return shortened === barcode ? [barcode] : [barcode, shortened];
}
