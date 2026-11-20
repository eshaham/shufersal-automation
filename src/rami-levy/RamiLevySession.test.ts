import fs from 'fs';
import path from 'path';

import { OrderStatus, SellingMethod } from '../core/types';
import {
  RamiLevyLoginRequiredError,
  RamiLevyPaymentRequiredError,
  RamiLevySession,
} from './RamiLevySession';

function fixture(name: string): unknown {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.json`), 'utf8'),
  ) as unknown;
}

interface SentRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

type Route = (request: SentRequest) => unknown;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeJwt(exp: number): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode({ exp })}.signature`;
}

function createSession(routes: Record<string, Route>) {
  const sent: SentRequest[] = [];
  const fetchMock = jest.fn((input: URL, init?: RequestInit) => {
    const url = input.toString();
    const body = init?.body as string | undefined;
    const request: SentRequest = {
      method: init?.method ?? 'GET',
      url,
      headers: init?.headers as Record<string, string>,
      body: body ? (JSON.parse(body) as unknown) : undefined,
    };
    sent.push(request);
    const key = Object.keys(routes).find((pattern) =>
      `${request.method} ${url}`.includes(pattern),
    );
    if (!key) {
      return Promise.reject(
        new Error(`Unexpected request ${request.method} ${url}`),
      );
    }
    const result = routes[key](request);
    return Promise.resolve(
      result instanceof Response ? result : jsonResponse(result),
    );
  });
  const session = new RamiLevySession(
    { token: fakeJwt(1_800_000_000), customerId: 77577 },
    { fetch: fetchMock as typeof fetch },
  );
  return { session, sent };
}

const customerRoute: Route = () => fixture('customer');

describe('RamiLevySession', () => {
  it('searches the catalog for the customer store with the login token', async () => {
    const { session, sent } = createSession({
      'GET https://www-api.rami-levy.co.il/api/v2/site/clubs/customer/77577':
        customerRoute,
      'POST https://www.rami-levy.co.il/api/catalog': () =>
        fixture('catalog-search'),
    });

    const results = await session.searchProducts('חלב', 3, 2);

    const search = sent.find((request) => request.url.endsWith('/catalog'));
    expect(search?.body).toEqual({
      q: 'חלב',
      store: '412',
      aggs: 0,
      size: 3,
      from: 6,
    });
    expect(search?.headers['EcomToken']).toBe(fakeJwt(1_800_000_000));
    expect(search?.headers['Locale']).toBe('he');
    expect(results).toMatchObject({
      totalResults: 132,
      currentPage: 2,
      totalPages: 44,
      pageSize: 3,
    });
    expect(results.results[1]).toMatchObject({
      code: '3025',
      barcode: '7290004131074',
      price: 7.2,
      formattedPrice: '₪7.20',
      sellingMethod: SellingMethod.Unit,
      brand: { code: 'תנובה', name: 'תנובה' },
      mainCategory: { code: '50', name: 'חלב ביצים וסלטים' },
      subCategory: { code: '198', name: 'חלב' },
      inStock: true,
      quantityStep: 1,
      imageUrl: 'https://img.rami-levy.co.il/product/7290004131074/large.jpg',
    });
  });

  it('looks up products by code and marks weighed produce', async () => {
    const { session, sent } = createSession({
      'clubs/customer/77577': customerRoute,
      'POST https://www.rami-levy.co.il/api/catalog': () => fixture('items'),
    });

    const cucumber = await session.getProductByCode('3');

    expect(sent.at(-1)?.body).toEqual({ store: '412', items: '3', size: 1 });
    expect(cucumber).toMatchObject({
      code: '3',
      sellingMethod: SellingMethod.Weight,
      quantityStep: 0.5,
      barcode: '101',
    });
  });

  it('lists orders across pages and splits active from closed ones', async () => {
    const page = fixture('orders') as {
      data: { data: { last_page: number } };
    };
    page.data.data.last_page = 2;
    const { session, sent } = createSession({
      'GET https://www-api.rami-levy.co.il/api/v3/site/orders?page=': () =>
        page,
    });

    const orders = await session.getOrders();

    expect(sent.map((request) => request.url)).toEqual([
      'https://www-api.rami-levy.co.il/api/v3/site/orders?page=1&activeFilter=0',
      'https://www-api.rami-levy.co.il/api/v3/site/orders?page=2&activeFilter=0',
    ]);
    expect(orders.activeOrders).toHaveLength(0);
    expect(orders.closedOrders.map((order) => order.status)).toEqual([
      OrderStatus.Canceled,
      OrderStatus.Delivered,
      OrderStatus.Delivered,
      OrderStatus.Canceled,
      OrderStatus.Delivered,
      OrderStatus.Delivered,
    ]);
    expect(orders.closedOrders[1]).toMatchObject({
      code: '5685662',
      totalPrice: 526.2,
      deliveryDateTime: '2023-09-29T09:00:00.000Z',
      isBeingUpdated: false,
    });
  });

  it('fills order lines with catalog products', async () => {
    const { session } = createSession({
      'clubs/customer/77577': customerRoute,
      'GET https://www-api.rami-levy.co.il/api/v3/site/orders/5685662': () =>
        fixture('order-details'),
      'POST https://www.rami-levy.co.il/api/catalog': () => fixture('items'),
    });

    const details = await session.getOrderDetails('5685662');

    expect(details?.items[1]).toMatchObject({
      productCode: '6',
      quantity: 0.5,
      pricePerUnit: 7.9,
      actualPricePerUnit: 7.9,
      product: { code: '6', name: 'פלפל אדום' },
    });
    expect(details?.items[0].product).toMatchObject({
      code: '3',
      barcode: '101',
    });
  });

  it('reads the cart without the delivery fee line', async () => {
    const { session } = createSession({
      'clubs/customer/77577': customerRoute,
      'POST https://www.rami-levy.co.il/api/v2/cart': () =>
        fixture('cart-write'),
    });

    const cart = await session.getCartState();

    expect(cart.orderInUpdateMode).toBeNull();
    expect(cart.items).toEqual([
      expect.objectContaining({
        productCode: '3',
        quantity: 0.5,
        entryNumber: 0,
        itemPrice: 3.95,
      }),
      expect.objectContaining({
        productCode: '3025',
        quantity: 2,
        entryNumber: 1,
        itemPrice: 14.4,
      }),
    ]);
  });

  it('writes the whole cart when setting quantities and reports missing items', async () => {
    const { session, sent } = createSession({
      'clubs/customer/77577': customerRoute,
      'POST https://www.rami-levy.co.il/api/v2/cart': () =>
        fixture('cart-write'),
    });

    const result = await session.setCartItemQuantities([
      { productCode: '3025', quantity: 2, sellingMethod: SellingMethod.Unit },
      { productCode: '3', quantity: 0, sellingMethod: SellingMethod.Weight },
      { productCode: '999', quantity: 1, sellingMethod: SellingMethod.Unit },
    ]);

    const write = sent.find((request) => request.url.endsWith('/v2/cart'));
    expect(write?.body).toMatchObject({
      store: '412',
      items: { '3025': '2.00', '999': '1.00' },
    });
    expect(result.modifications).toEqual([
      expect.objectContaining({ productCode: '3025', statusCode: 'success' }),
      expect.objectContaining({ productCode: '3', statusCode: 'success' }),
      expect.objectContaining({ productCode: '999', statusCode: 'noStock' }),
    ]);
  });

  it('adds to the quantities already in the cart', async () => {
    const { session, sent } = createSession({
      'clubs/customer/77577': customerRoute,
      'POST https://www.rami-levy.co.il/api/v2/cart': () =>
        fixture('cart-write'),
    });

    await session.addToCart([
      { productCode: '3025', quantity: 1, sellingMethod: SellingMethod.Unit },
    ]);

    const write = sent.find((request) => request.url.endsWith('/v2/cart'));
    expect(write?.body).toMatchObject({
      items: { '3': '0.50', '3025': '3.00' },
    });
  });

  it('lists active delivery strips as time slots', async () => {
    const { session, sent } = createSession({
      'clubs/customer/77577': customerRoute,
      'POST https://www-api.rami-levy.co.il/api/v2/site/supply/get-supply-date':
        () => fixture('supply-dates'),
    });

    const slots = await session.getAvailableTimeSlots();

    expect(sent.at(-1)?.body).toMatchObject({
      city_id: 93,
      street_id: 115722,
    });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0]).toMatchObject({
      code: '2026-11-22|197',
      dateTime: '2026-11-22T10:00:00.000Z',
      cutoffDateTime: '2026-11-22T06:00:00.000Z',
      deliveryFee: 35.9,
    });
  });

  it('reads the reserved slot and reserves a new one', async () => {
    const { session, sent } = createSession({
      'clubs/customer/77577': customerRoute,
      'POST https://www-api.rami-levy.co.il/api/v3/site/clubs/delivery-times-customer':
        () => ({ success: true, data: { id: 1 } }),
    });

    const selected = await session.getSelectedTimeSlot();
    await session.selectTimeSlot('2026-11-24|197');

    expect(selected).toMatchObject({
      code: '2026-11-23|197',
      dateTime: '2026-11-23T10:00:00.000Z',
    });
    expect(sent.at(-1)?.body).toMatchObject({
      supply_date: '2026-11-24',
      strip_id: 197,
      city_id: 93,
      street_id: 115722,
    });
  });

  it('asks for a new login when the token is rejected', async () => {
    const { session } = createSession({
      'clubs/customer/77577': () => jsonResponse({ message: 'nope' }, 401),
    });

    await expect(session.verifySessionAlive()).rejects.toBeInstanceOf(
      RamiLevyLoginRequiredError,
    );
    await expect(session.performLogin()).rejects.toBeInstanceOf(
      RamiLevyLoginRequiredError,
    );
  });

  it('needs a payment token to place an order', async () => {
    const { session } = createSession({});

    await expect(session.createOrder()).rejects.toBeInstanceOf(
      RamiLevyPaymentRequiredError,
    );
  });

  it('serializes the token with its expiry and restores from it', async () => {
    const { session } = createSession({});

    const serialized = await session.serialize();
    const restored = RamiLevySession.fromSerialized(serialized);

    expect(serialized).toEqual({
      cookies: [],
      credentials: {
        token: fakeJwt(1_800_000_000),
        expiresAt: '2027-01-15T08:00:00.000Z',
      },
      context: { customerId: '77577' },
    });
    expect(restored.tokenExpiresAt).toBe('2027-01-15T08:00:00.000Z');
    expect(() => RamiLevySession.fromSerialized({ cookies: [] })).toThrow(
      RamiLevyLoginRequiredError,
    );
  });
});
