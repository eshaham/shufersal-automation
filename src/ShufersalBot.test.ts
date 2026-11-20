import { shufersalOrderEntryToItem, ShufersalSession } from './ShufersalBot';
import {
  CartMutationResult,
  ExistingCartItem,
  SellingMethod,
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
