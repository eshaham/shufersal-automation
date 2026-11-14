import fs from 'fs';
import path from 'path';

import {
  parseCartModifications,
  parseOrderCodeFromRedirect,
  parseOrderInUpdateMode,
  rawCartPageToCartMutationResult,
} from './cartParser';

const addGridScript = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'cart', 'addGridModifications.txt'),
  'utf8',
);

describe('parseCartModifications', () => {
  it('parses the modifications returned by addGrid', () => {
    const modifications = parseCartModifications(addGridScript);

    expect(
      modifications.map(
        ({ productCode, statusCode, entryNumber, quantity }) => ({
          productCode,
          statusCode,
          entryNumber,
          quantity,
        }),
      ),
    ).toEqual([
      {
        productCode: 'P_7296073151548',
        statusCode: 'success',
        entryNumber: 0,
        quantity: 2,
      },
      {
        productCode: 'P_7296073151555',
        statusCode: 'success',
        entryNumber: 1,
        quantity: 1,
      },
    ]);
    expect(modifications[0].rawData).toMatchObject({
      name: 'מלח בישול גס',
      price: '2.09',
      totalPrice: '4.18',
      sellingMethod: 'BY_UNIT',
      dimension35: true,
    });
  });

  it('handles failed modifications, escaped quotes and missing entries', () => {
    const script = `
      window.miglog.cart.modifications=[
        { statusCode:'noStock', productCode:'P_1', name:'Bob\\'s {special} milk', quantity:0 },
        { statusCode:'maxOrderQuantityExceeded', productCode:'P_2', entry:4, quantity:6 }
      ];
      window.miglog.cart.cartTotalValue='0';
    `;

    expect(
      parseCartModifications(script).map(({ rawData: _, ...rest }) => rest),
    ).toEqual([
      {
        productCode: 'P_1',
        statusCode: 'noStock',
        entryNumber: null,
        quantity: 0,
      },
      {
        productCode: 'P_2',
        statusCode: 'maxOrderQuantityExceeded',
        entryNumber: 4,
        quantity: 6,
      },
    ]);
    expect(parseCartModifications(script)[0].rawData['name']).toBe(
      "Bob's {special} milk",
    );
  });

  it('returns no modifications when the script has none', () => {
    expect(parseCartModifications('window.miglog = {};')).toEqual([]);
    expect(
      parseCartModifications('window.miglog.cart.modifications=[\n];'),
    ).toEqual([]);
  });
});

describe('parseOrderCodeFromRedirect', () => {
  it('extracts the order code from the confirmation path', () => {
    expect(
      parseOrderCodeFromRedirect('/checkout/orderConfirmation/05642313'),
    ).toBe('05642313');
    expect(
      parseOrderCodeFromRedirect(
        'https://www.shufersal.co.il/online/he/checkout/orderConfirmation/05642313?x=1',
      ),
    ).toBe('05642313');
  });

  it('returns null for other redirects', () => {
    expect(parseOrderCodeFromRedirect('/cart')).toBeNull();
    expect(
      parseOrderCodeFromRedirect('/checkout/orderConfirmation/'),
    ).toBeNull();
  });
});

describe('parseOrderInUpdateMode', () => {
  it('finds the order being updated', () => {
    expect(
      parseOrderInUpdateMode('הסל שלי עדכון הזמנה מס׳ 05642313 סיום'),
    ).toBe('05642313');
  });

  it('returns null when no order is being updated', () => {
    expect(parseOrderInUpdateMode('הסל שלי')).toBeNull();
  });
});

describe('rawCartPageToCartMutationResult', () => {
  it('builds the cart state from a parsed cart page', () => {
    const result = rawCartPageToCartMutationResult({
      articles: [
        {
          productCode: 'P_7296073151548',
          quantity: 2,
          entryNumber: 0,
          itemPrice: 4.18,
          isOutOfStock: false,
        },
        {
          productCode: 'P_7296073151555',
          quantity: 1,
          entryNumber: 1,
          itemPrice: 0,
          isOutOfStock: true,
        },
      ],
      bodyText: 'עדכון הזמנה מס׳ 12345678',
      modificationsScript: addGridScript,
    });

    expect(result.orderInUpdateMode).toBe('12345678');
    expect(result.items.map(({ rawData: _, ...item }) => item)).toEqual([
      {
        productCode: 'P_7296073151548',
        quantity: 2,
        entryNumber: 0,
        itemPrice: 4.18,
        inStock: true,
      },
      {
        productCode: 'P_7296073151555',
        quantity: 1,
        entryNumber: 1,
        itemPrice: 0,
        inStock: false,
      },
    ]);
    expect(result.modifications).toHaveLength(2);
  });

  it('returns an empty cart without modifications', () => {
    expect(
      rawCartPageToCartMutationResult({
        articles: [],
        bodyText: 'הסל שלי',
        modificationsScript: null,
      }),
    ).toEqual({ items: [], orderInUpdateMode: null, modifications: [] });
  });
});
