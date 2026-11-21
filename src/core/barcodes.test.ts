import { barcodeFromShufersalCode, shufersalSearchQueries } from '../barcode';
import { findProductsByBarcodes, normalizeBarcode } from './barcodes';
import { Product, SellingMethod } from './types';

function product(code: string, barcode?: string): Product {
  return {
    code,
    name: code,
    description: '',
    brand: null,
    mainCategory: null,
    subCategory: null,
    sellingMethod: SellingMethod.Unit,
    inStock: true,
    purchasable: true,
    price: 1,
    formattedPrice: '₪1.00',
    priceWithoutDiscount: 1,
    promotionCodes: [],
    barcode,
    rawData: {},
  };
}

function results(products: Product[]) {
  return {
    results: products,
    totalResults: products.length,
    currentPage: 0,
    totalPages: 1,
    pageSize: 5,
  };
}

describe('findProductsByBarcodes', () => {
  it('keeps only results whose barcode matches exactly', async () => {
    const search = jest.fn((query: string) =>
      Promise.resolve(
        results([product('similar', `${query}9`), product('exact', query)]),
      ),
    );

    const found = await findProductsByBarcodes(
      search,
      ['111', '222', '111'],
      (barcode) => [barcode],
    );

    expect(found.get('111')?.code).toBe('exact');
    expect(found.get('222')?.code).toBe('exact');
    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenCalledWith('111', 5);
  });

  it('tries each query until one finds the barcode', async () => {
    const search = jest.fn((query: string) =>
      Promise.resolve(
        results(
          query === '4131074'
            ? [product('P_4131074', '7290004131074')]
            : [product('other', '999')],
        ),
      ),
    );

    const found = await findProductsByBarcodes(
      search,
      ['7290004131074'],
      shufersalSearchQueries,
    );

    expect(search.mock.calls.map(([query]) => query)).toEqual([
      '7290004131074',
      '4131074',
    ]);
    expect(found.get('7290004131074')?.code).toBe('P_4131074');
  });

  it('leaves out barcodes with no exact match', async () => {
    const search = jest.fn(() =>
      Promise.resolve(results([product('other', '999')])),
    );

    const found = await findProductsByBarcodes(search, ['111'], (barcode) => [
      barcode,
    ]);

    expect(found.size).toBe(0);
  });
});

describe('normalizeBarcode', () => {
  it('keeps valid EAN-13 and EAN-8 barcodes', () => {
    expect(normalizeBarcode('7290004131074')).toBe('7290004131074');
    expect(normalizeBarcode('72940761')).toBe('72940761');
  });

  it('pads UPC barcodes to 13 digits so both chains agree', () => {
    expect(normalizeBarcode('37600309417')).toBe('0037600309417');
    expect(normalizeBarcode('037600309417')).toBe('0037600309417');
  });

  it('rejects internal codes and wrong check digits', () => {
    expect(normalizeBarcode('101')).toBeUndefined();
    expect(normalizeBarcode('7290004131075')).toBeUndefined();
  });
});

describe('barcodeFromShufersalCode', () => {
  it('reads full barcodes from product codes', () => {
    expect(barcodeFromShufersalCode('P_7290102398065')).toBe('7290102398065');
    expect(barcodeFromShufersalCode('P_72940761')).toBe('72940761');
    expect(barcodeFromShufersalCode('P_37600309417')).toBe('0037600309417');
  });

  it('rebuilds Israeli barcodes that Shufersal shortened', () => {
    expect(barcodeFromShufersalCode('P_4131074')).toBe('7290004131074');
    expect(barcodeFromShufersalCode('P_66318')).toBe('7290000066318');
  });

  it('returns nothing when the code is not a barcode', () => {
    expect(barcodeFromShufersalCode('P_4131075')).toBeUndefined();
    expect(barcodeFromShufersalCode('7290004131074')).toBeUndefined();
    expect(barcodeFromShufersalCode('P_3614271755346_582')).toBeUndefined();
  });
});
