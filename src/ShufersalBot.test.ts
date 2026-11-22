import { shufersalOrderEntryToItem, ShufersalSession } from './ShufersalBot';
import {
  CartMutationResult,
  ExistingCartItem,
  Product,
  SellingMethod,
  ShufersalCheckoutEntry,
  ShufersalComposedCheckout,
  ShufersalOrderEntry,
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
  const session = new ShufersalSession(jest.fn(), {
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

  it('looks up the entry numbers it is not given', async () => {
    const remaining = [cartItem('P_3', 0)];
    const { session, cartRequest } = createSession([
      cartResult([cartItem('P_3', 0), cartItem('P_1', 4)]),
      cartResult(remaining),
    ]);

    const result = await session.removeItemsFromCart([
      { productCode: 'P_1' },
      { productCode: 'P_9' },
    ]);

    expect(cartRequest).toHaveBeenCalledTimes(2);
    const [config] = cartRequest.mock.calls[1];
    expect(config.body).toEqual([
      {
        productCode: 'P_1',
        frontQuantity: 0,
        sellingMethod: ShufersalSellingMethod.Unit,
        comment: '',
        entry: 4,
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

function product(code: string, inStock: boolean): Product {
  return { code, inStock, purchasable: true } as Product;
}

function stubProducts(session: ShufersalSession, products: Product[]) {
  return jest
    .spyOn(session, 'getProductByCode')
    .mockImplementation((code) =>
      Promise.resolve(products.find((p) => p.code === code) ?? null),
    );
}

describe('addToCart', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
  });

  const lemon = {
    productCode: 'P_OOS',
    quantity: 1,
    sellingMethod: SellingMethod.Weight,
  };
  const milk = {
    productCode: 'P_1',
    quantity: 2,
    sellingMethod: SellingMethod.Unit,
  };

  it('adds everything in one request when Shufersal accepts it', async () => {
    const { session, cartRequest } = createSession([
      cartResult([cartItem('P_1', 0)]),
    ]);
    const getProductByCode = stubProducts(session, []);

    await session.addToCart([milk]);

    expect(cartRequest).toHaveBeenCalledTimes(1);
    expect(getProductByCode).not.toHaveBeenCalled();
  });

  it('adds the rest and reports out-of-stock items when the batch fails', async () => {
    const { session, cartRequest } = createSession([]);
    cartRequest
      .mockRejectedValueOnce(new Error('Request failed: 500'))
      .mockResolvedValueOnce(cartResult([cartItem('P_1', 0)]));
    stubProducts(session, [product('P_1', true), product('P_OOS', false)]);

    const result = await session.addToCart([lemon, milk]);

    expect(cartRequest).toHaveBeenCalledTimes(2);
    expect(cartRequest.mock.calls[1][0].body).toEqual([
      expect.objectContaining({ productCode: 'P_1', quantity: 2 }),
    ]);
    expect(result.items).toEqual([cartItem('P_1', 0)]);
    expect(result.modifications).toEqual([
      expect.objectContaining({
        productCode: 'P_OOS',
        statusCode: 'noStock',
        quantity: 0,
      }),
    ]);
  });

  it('reads the cart instead of adding when every item is unavailable', async () => {
    const { session, cartRequest } = createSession([]);
    cartRequest.mockRejectedValueOnce(new Error('Request failed: 500'));
    stubProducts(session, [product('P_OOS', false)]);
    const getCartState = jest
      .spyOn(session, 'getCartState')
      .mockResolvedValue({ items: [], orderInUpdateMode: null });

    const result = await session.addToCart([lemon]);

    expect(cartRequest).toHaveBeenCalledTimes(1);
    expect(getCartState).toHaveBeenCalledTimes(1);
    expect(result.modifications).toEqual([
      expect.objectContaining({ productCode: 'P_OOS', statusCode: 'noStock' }),
    ]);
  });

  it('rethrows when every item is in stock', async () => {
    const { session, cartRequest } = createSession([]);
    cartRequest.mockRejectedValueOnce(new Error('Request failed: 500'));
    stubProducts(session, [product('P_1', true)]);

    await expect(session.addToCart([milk])).rejects.toThrow(
      'Request failed: 500',
    );
    expect(cartRequest).toHaveBeenCalledTimes(1);
  });

  it('rethrows the add error when the stock check fails', async () => {
    const { session, cartRequest } = createSession([]);
    cartRequest.mockRejectedValueOnce(new Error('Request failed: 500'));
    jest
      .spyOn(session, 'getProductByCode')
      .mockRejectedValue(new Error('lookup failed'));

    await expect(session.addToCart([milk])).rejects.toThrow(
      'Request failed: 500',
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('lookup failed'));
  });
});

function checkoutEntry(
  productCode: string,
  entryNumber: number,
  outOfStock: boolean,
): ShufersalCheckoutEntry {
  return {
    entryNumber,
    outOfStock,
    product: {
      code: productCode,
      stock: {
        stockLevelStatus: { code: outOfStock ? 'outOfStock' : 'inStock' },
      },
    },
  } as unknown as ShufersalCheckoutEntry;
}

function composedCheckout(
  entries: ShufersalCheckoutEntry[],
): ShufersalComposedCheckout {
  return { directCart: { entries } };
}

type RemoveOutOfStock = (
  entries: ShufersalCheckoutEntry[],
) => Promise<ShufersalComposedCheckout>;

function stubCheckout(
  session: ShufersalSession,
  checkout: ShufersalComposedCheckout,
) {
  const getComposedCheckout = jest.fn().mockResolvedValue(checkout);
  (
    session as unknown as {
      getComposedCheckout: () => Promise<ShufersalComposedCheckout>;
    }
  ).getComposedCheckout = getComposedCheckout;
  return getComposedCheckout;
}

function removeOutOfStock(
  session: ShufersalSession,
  entries: ShufersalCheckoutEntry[],
) {
  const method = (
    session as unknown as { removeOutOfStockCheckoutEntries: RemoveOutOfStock }
  ).removeOutOfStockCheckoutEntries;
  return method.call(session, entries);
}

describe('removeOutOfStockCheckoutEntries', () => {
  it("removes with the cart's entry number, not checkout's", async () => {
    const { session, cartRequest } = createSession([
      cartResult([cartItem('P_1', 0), cartItem('P_OOS', 41)]),
      cartResult([cartItem('P_1', 0)]),
    ]);
    const afterRemoval = composedCheckout([checkoutEntry('P_1', 0, false)]);
    stubCheckout(session, afterRemoval);

    const checkout = await removeOutOfStock(session, [
      checkoutEntry('P_OOS', 79, true),
    ]);

    expect(cartRequest).toHaveBeenCalledTimes(2);
    expect(cartRequest.mock.calls[1][0].path.startsWith('/cart/modify?')).toBe(
      true,
    );
    expect(cartRequest.mock.calls[1][0].body).toEqual([
      expect.objectContaining({ productCode: 'P_OOS', entry: 41 }),
    ]);
    expect(checkout).toBe(afterRemoval);
  });

  it('throws without removing when a checkout line is not in the cart', async () => {
    const { session, cartRequest } = createSession([
      cartResult([cartItem('P_1', 0)]),
    ]);
    const getComposedCheckout = stubCheckout(session, composedCheckout([]));
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await expect(
      removeOutOfStock(session, [checkoutEntry('P_GIFT', 79, true)]),
    ).rejects.toThrow(
      'Out-of-stock checkout items are not in the cart: P_GIFT',
    );

    expect(cartRequest).toHaveBeenCalledTimes(1);
    expect(getComposedCheckout).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('"entryNumber":79'),
    );
    consoleError.mockRestore();
  });

  it('throws when checkout still has out-of-stock items after removal', async () => {
    const { session } = createSession([
      cartResult([cartItem('P_OOS', 41)]),
      cartResult([]),
    ]);
    stubCheckout(session, composedCheckout([checkoutEntry('P_OOS', 79, true)]));

    await expect(
      removeOutOfStock(session, [checkoutEntry('P_OOS', 79, true)]),
    ).rejects.toThrow(
      'Checkout still has out-of-stock items after removing them: P_OOS',
    );
  });
});

function packedOrderEntry(
  overrides: Partial<ShufersalOrderEntry>,
): ShufersalOrderEntry {
  return {
    entryNumber: 0,
    quantity: 1900,
    basePrice: { value: 14.9 },
    totalPrice: { value: 28.3 },
    product: {
      code: 'P_7296073440611',
      name: 'apples',
      sellingMethod: { code: ShufersalSellingMethod.Package },
      weightConversion: 950,
      price: { value: 14.9 },
      stock: { stockLevelStatus: { code: 'inStock' } },
      images: [],
      promotionCodes: [],
    },
    ...overrides,
  } as unknown as ShufersalOrderEntry;
}

describe('shufersalOrderEntryToItem', () => {
  it('prices a packed item per pack, not per kilogram', () => {
    const item = shufersalOrderEntryToItem(packedOrderEntry({}));

    expect(item.product.sellingMethod).toBe(SellingMethod.Unit);
    expect(item.quantity).toBe(2);
    expect(item.basePricePerUnit).toBe(14.15);
    expect(item.actualPricePerUnit).toBe(14.15);
  });

  it('uses the paid price as base when per-pack rounding differs', () => {
    const item = shufersalOrderEntryToItem(
      packedOrderEntry({
        totalPrice: { value: 28.32 },
      } as Partial<ShufersalOrderEntry>),
    );

    expect(item.basePricePerUnit).toBe(14.16);
    expect(item.actualPricePerUnit).toBe(14.16);
  });

  it('keeps a packed item discount relative to the per-pack price', () => {
    const item = shufersalOrderEntryToItem(
      packedOrderEntry({ priceAfterDiscount: 20, discount: 8.3 }),
    );

    expect(item.basePricePerUnit).toBe(14.16);
    expect(item.actualPricePerUnit).toBe(10);
    expect(item.discountAmount).toBe(8.3);
  });
});

describe('resolvePendingCartMerge', () => {
  function setup(
    mergePending: boolean,
    before: ExistingCartItem[],
    after: ExistingCartItem[],
  ) {
    const { session } = createSession([]);
    const evaluate = jest
      .fn()
      .mockResolvedValueOnce(mergePending)
      .mockResolvedValueOnce(undefined);
    (
      session as unknown as { browser: { page: { evaluate: jest.Mock } } }
    ).browser = { page: { evaluate } };
    const getCartState = jest
      .spyOn(session, 'getCartState')
      .mockResolvedValueOnce({ items: before, orderInUpdateMode: null })
      .mockResolvedValueOnce({ items: after, orderInUpdateMode: null });
    const resolve = () =>
      (
        session as unknown as { resolvePendingCartMerge: () => Promise<void> }
      ).resolvePendingCartMerge();
    return { evaluate, getCartState, resolve };
  }

  it('does nothing when no merge is pending', async () => {
    const { evaluate, getCartState, resolve } = setup(false, [], []);

    await resolve();

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(getCartState).not.toHaveBeenCalled();
  });

  it('merges and keeps going when the cart is unchanged', async () => {
    const items = [cartItem('P_1', 0), cartItem('P_2', 1)];
    const { evaluate, resolve } = setup(true, items, [...items].reverse());

    await resolve();

    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(evaluate).toHaveBeenLastCalledWith(
      expect.any(Function),
      expect.stringContaining('/cart/merge?toMerge=true'),
    );
  });

  it('throws when the merge changed the cart', async () => {
    const extra = { ...cartItem('P_1', 0), quantity: 3 };
    const { resolve } = setup(
      true,
      [cartItem('P_1', 0)],
      [extra, cartItem('P_9', 1)],
    );

    await expect(resolve()).rejects.toThrow(
      'Merging carts changed the cart, not placing the order: P_1 1→3, P_9 0→1',
    );
  });
});
