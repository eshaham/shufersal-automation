import type { BrowserContext, Page } from 'puppeteer-core';

import { ShufersalSession } from './ShufersalBot';
import {
  CartMutationResult,
  ExistingCartItem,
  SellingMethod,
  ShufersalSellingMethod,
} from './types';

jest.mock('puppeteer-core', () => ({ __esModule: true, default: {} }));

interface CartRequestConfig {
  method: string;
  path: string;
  body?: unknown;
}

type CartRequest = (config: CartRequestConfig) => Promise<CartMutationResult>;

function cartItem(productCode: string, entryNumber: number): ExistingCartItem {
  return {
    productCode,
    entryNumber,
    quantity: 1,
    itemPrice: 10,
    itemDiscount: 0,
    inStock: true,
    rawData: {},
  };
}

function cartResult(items: ExistingCartItem[]): CartMutationResult {
  return { items, orderInUpdateMode: null, modifications: [] };
}

function createSession(responses: CartMutationResult[]) {
  const page = { on: jest.fn() } as unknown as Page;
  const session = new ShufersalSession({} as BrowserContext, page, {
    username: 'user',
    password: 'password',
  });
  const cartRequest = jest.fn<
    ReturnType<CartRequest>,
    Parameters<CartRequest>
  >();
  for (const response of responses) {
    cartRequest.mockResolvedValueOnce(response);
  }
  (session as unknown as { cartRequest: CartRequest }).cartRequest =
    cartRequest;
  return { session, cartRequest };
}

describe('removeItemsFromCart', () => {
  it('removes all entries in a single cart/modify request', async () => {
    const remaining = [cartItem('P_3', 0)];
    const { session, cartRequest } = createSession([cartResult(remaining)]);

    const result = await session.removeItemsFromCart([
      { productCode: 'P_1', entryNumber: 4 },
      { productCode: 'P_2', entryNumber: 7 },
    ]);

    expect(cartRequest).toHaveBeenCalledTimes(1);
    const [config] = cartRequest.mock.calls[0];
    expect(config.method).toBe('POST');
    expect(config.path.startsWith('/cart/modify?')).toBe(true);
    expect(config.body).toEqual([
      {
        productCode: 'P_1',
        frontQuantity: 0,
        sellingMethod: ShufersalSellingMethod.Unit,
        comment: '',
        entry: 4,
        affiliateCode: '',
      },
      {
        productCode: 'P_2',
        frontQuantity: 0,
        sellingMethod: ShufersalSellingMethod.Unit,
        comment: '',
        entry: 7,
        affiliateCode: '',
      },
    ]);
    expect(result.items).toEqual(remaining);
  });

  it('throws when Shufersal leaves an entry in the cart', async () => {
    const { session } = createSession([cartResult([cartItem('P_1', 4)])]);

    await expect(
      session.removeItemsFromCart([{ productCode: 'P_1', entryNumber: 4 }]),
    ).rejects.toThrow('Shufersal did not remove cart items: P_1');
  });
});

describe('setCartItemQuantities', () => {
  it('adds in one request and removes in one more', async () => {
    const afterAdd = [
      cartItem('P_1', 0),
      cartItem('P_2', 1),
      cartItem('P_3', 2),
    ];
    const afterRemove = [cartItem('P_1', 0)];
    const { session, cartRequest } = createSession([
      cartResult(afterAdd),
      cartResult(afterRemove),
    ]);

    const result = await session.setCartItemQuantities([
      { productCode: 'P_1', quantity: 2, sellingMethod: SellingMethod.Unit },
      { productCode: 'P_2', quantity: 0, sellingMethod: SellingMethod.Unit },
      { productCode: 'P_3', quantity: 0, sellingMethod: SellingMethod.Weight },
    ]);

    expect(cartRequest).toHaveBeenCalledTimes(2);
    expect(cartRequest.mock.calls[0][0].path).toBe('/cart/addGrid');
    expect(cartRequest.mock.calls[1][0].path.startsWith('/cart/modify?')).toBe(
      true,
    );
    expect(cartRequest.mock.calls[1][0].body).toEqual([
      expect.objectContaining({ productCode: 'P_2', entry: 1 }),
      expect.objectContaining({ productCode: 'P_3', entry: 2 }),
    ]);
    expect(result.items).toEqual(afterRemove);
  });
});
