import fs from 'fs';
import path from 'path';

import {
  parseCartHtml,
  parseCartModifications,
  parseOrderCodeFromConfirmation,
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

describe('parseOrderCodeFromConfirmation', () => {
  const confirmationUrl =
    'https://www.shufersal.co.il/online/he/miglog-confirmation';

  it('extracts the order code from a confirmation URL', () => {
    expect(
      parseOrderCodeFromConfirmation(
        'https://www.shufersal.co.il/online/he/checkout/orderConfirmation/05642313?x=1',
        '',
      ),
    ).toBe('05642313');
  });

  it('extracts the order code from a link to the order', () => {
    expect(
      parseOrderCodeFromConfirmation(
        confirmationUrl,
        '<a href="/online/he/my-account/orders">ההזמנות שלי</a><div class="orderFunctions"><a class="view" href="/online/he/my-account/orders/05707808">צפייה בהזמנה</a></div>',
      ),
    ).toBe('05707808');
  });

  it('extracts the order code from analytics data', () => {
    expect(
      parseOrderCodeFromConfirmation(
        confirmationUrl,
        "<script>dataLayer.push({event:'purchase',ecommerce:{transaction_id:'05707808'}})</script>",
      ),
    ).toBe('05707808');
  });

  it('extracts the order code from the order number text', () => {
    expect(
      parseOrderCodeFromConfirmation(
        confirmationUrl,
        '<h2>תודה! ההזמנה התקבלה</h2><p>מספר הזמנה: <strong>05707808</strong></p>',
      ),
    ).toBe('05707808');
    expect(
      parseOrderCodeFromConfirmation(
        confirmationUrl,
        '<p>הזמנה מס׳ 05707808</p>',
      ),
    ).toBe('05707808');
  });

  it('returns null when the page has no order code', () => {
    expect(parseOrderCodeFromConfirmation('/miglog-confirmation', '')).toBe(
      null,
    );
    expect(
      parseOrderCodeFromConfirmation(
        confirmationUrl,
        '<a href="/online/he/my-account/orders">ההזמנות שלי</a><span>₪ 432.10</span>',
      ),
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
          itemDiscount: 0.9,
          isOutOfStock: false,
        },
        {
          productCode: 'P_7296073151555',
          quantity: 1,
          entryNumber: 1,
          itemPrice: 0,
          itemDiscount: 0,
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
        itemDiscount: 0.9,
        inStock: true,
      },
      {
        productCode: 'P_7296073151555',
        quantity: 1,
        entryNumber: 1,
        itemPrice: 0,
        itemDiscount: 0,
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

describe('parseCartHtml', () => {
  it('parses cart articles with their price and entry number', () => {
    const result = parseCartHtml(
      '<html><body><article class="miglog-cart-prod" data-product-code="P_1" data-entry-qty="2" data-entry-number="0"><span class="miglog-prod-totalPrize">12.90 ₪</span></article></body></html>',
    );

    expect(result).toMatchObject({
      articles: [
        {
          productCode: 'P_1',
          quantity: 2,
          entryNumber: 0,
          itemPrice: 12.9,
          itemDiscount: 0,
          isOutOfStock: false,
        },
      ],
      modificationsScript: null,
    });
  });
});
