import fs from 'fs';
import path from 'path';

import { OrderStatus, SellingMethod } from '../core/types';
import {
  RamiLevyLoginRequiredError,
  RamiLevyOrderError,
  RamiLevyPaymentMessageError,
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

  it('needs a payment token to place a new order', async () => {
    const { session } = createSession({
      'clubs/customer/77577': customerRoute,
    });

    await expect(session.createOrder(false)).rejects.toBeInstanceOf(
      RamiLevyPaymentRequiredError,
    );
  });

  it('opens a CVV form for the newest valid card and the cart total', async () => {
    const { session, sent } = createSession({
      'clubs/customer/77577': customerRoute,
      'POST https://www.rami-levy.co.il/api/v2/cart': () =>
        fixture('cart-write'),
      'POST https://www-api.rami-levy.co.il/api/v2/site/clubs/get-token-login':
        () => ({ status: '200', data: 'login-token' }),
      'POST https://www.rami-levy.co.il/api/comax/iframe-url': () => ({
        url: 'https://api.comax.co.il/ComaxWebService/Credit/form.aspx',
      }),
    });

    const form = await session.preparePayment();

    expect(
      sent.find((request) => request.url.endsWith('/get-token-login'))?.body,
    ).toEqual({
      token: 1605204,
      isCvv: true,
      price: 54.25,
      numberPaymentsSelect: 1,
      store_id: '412',
    });
    expect(
      sent.find((request) => request.url.endsWith('/iframe-url'))?.body,
    ).toEqual({ type: 'credit', tokenLogin: 'login-token' });
    expect(form).toEqual({
      url: 'https://api.comax.co.il/ComaxWebService/Credit/form.aspx',
      amount: 54.25,
      messageOrigin: 'https://www-api.rami-levy.co.il',
      cardLastDigits: '0000',
    });
  });

  it('registers the CVV form result as an order token', async () => {
    const { session, sent } = createSession({
      'clubs/customer/77577': customerRoute,
      'POST https://www-api.rami-levy.co.il/api/v3/site/order-token': () => ({
        data: { id: 10534188, type: 'CreditCard', amount: '0.1' },
      }),
      'DELETE https://www-api.rami-levy.co.il/api/v3/site/order-token/10534188':
        () => ({ status: '200' }),
    });

    await expect(
      session.registerPayment({ event: 'save-payment', data: {} }),
    ).rejects.toBeInstanceOf(RamiLevyPaymentMessageError);

    const payment = await session.registerPayment({
      event: 'cvv-success',
      data: {
        token: '3017795539',
        total: '0.1',
        cardIdDB: 1605204,
        cardId: '000000000',
        creditType: '1',
        expirationMonth: '11',
        expirationYear: '2030',
        lastDigits: '0000',
        paymentsNumber: 1,
        IsClubCC: '0',
        CompleteInErr: '0',
      },
    });
    await session.discardPayment(payment);

    expect(payment).toEqual({ id: '10534188', amount: 0.1 });
    expect(
      sent.find(
        (request) =>
          request.method === 'POST' && request.url.endsWith('/order-token'),
      )?.body,
    ).toEqual({
      site_id: 1,
      store_id: '412',
      type: 'CreditCard',
      type_cart: 'market',
      amount: '0.1',
      token: '3017795539',
      card_id: 1605204,
      card_type: '1',
      identity_card: '000000000',
      expiration_month: '11',
      expiration_year: '30',
      last_digits: '0000',
      payments_number: 1,
      is_club: '0',
      complete_in_err: '0',
    });
    expect(sent.at(-1)?.method).toBe('DELETE');
  });

  it('checks the order, places it with the payment token and empties the cart', async () => {
    const { session, sent } = createSession({
      'clubs/customer/77577': customerRoute,
      'POST https://www.rami-levy.co.il/api/catalog': () => fixture('items'),
      'POST https://www-api.rami-levy.co.il/api/v3/site/orders': (request) =>
        (request.body as { checkCloseOrderServer: boolean })
          .checkCloseOrderServer
          ? { status: '200' }
          : { status: '200', data: { order_id: 5685662 } },
      'DELETE https://www-api.rami-levy.co.il/api/v2/site/cart/delete': () => ({
        status: 200,
      }),
      'GET https://www-api.rami-levy.co.il/api/v3/site/orders/5685662': () =>
        fixture('order-details'),
    });

    const order = await session.createOrder(false, {
      id: '10534188',
      amount: 0.1,
    });

    const orderCalls = sent.filter((request) =>
      request.url.endsWith('/v3/site/orders'),
    );
    expect(orderCalls.map((request) => request.method)).toEqual([
      'POST',
      'POST',
    ]);
    expect(orderCalls[0].body).toMatchObject({
      checkCloseOrderServer: true,
      payment: { tokenOrder: null },
    });
    expect(orderCalls[1].body).toMatchObject({
      checkCloseOrderServer: false,
      isCartMall: false,
      items: { '3': 0.5, '3025': 2 },
      payment: {
        typePaymentObligo: false,
        tokenDirect: 0,
        tokenOrder: [10534188],
        numberPayment: 1,
      },
      order: { delivery_id: 16138234, store_id: '412' },
      supply: { city_id: 93, street_id: 115722 },
    });
    expect(sent.some((request) => request.url.endsWith('/cart/delete'))).toBe(
      true,
    );
    expect(order).toMatchObject({ code: '5685662', totalPrice: 526.2 });
    expect(order).not.toHaveProperty('items');
  });

  it('updates the order in edit mode with its existing payment token', async () => {
    const customer = fixture('customer') as {
      user: { edit_order: number | null };
      orderTokens: unknown[];
    };
    customer.user.edit_order = 5685662;
    customer.orderTokens = [
      { id: 77, type: 'CreditCard', amount: '0.1', order_id: 5685662 },
    ];
    const { session, sent } = createSession({
      'clubs/customer/77577': () => customer,
      'POST https://www.rami-levy.co.il/api/catalog': () => fixture('items'),
      'PUT https://www-api.rami-levy.co.il/api/v3/site/orders/5685662': () => ({
        status: '200',
        data: null,
      }),
      'DELETE https://www-api.rami-levy.co.il/api/v2/site/cart/delete': () => ({
        status: 200,
      }),
      'GET https://www-api.rami-levy.co.il/api/v3/site/orders/5685662': () =>
        fixture('order-details'),
    });

    const order = await session.createOrder(false);

    const updates = sent.filter((request) => request.method === 'PUT');
    expect(updates).toHaveLength(2);
    expect(updates[1].body).toMatchObject({ payment: { tokenOrder: [77] } });
    expect(order.code).toBe('5685662');
  });

  it('checks the order without paying', async () => {
    const { session, sent } = createSession({
      'clubs/customer/77577': customerRoute,
      'POST https://www.rami-levy.co.il/api/catalog': () => fixture('items'),
      'POST https://www-api.rami-levy.co.il/api/v3/site/orders': () => ({
        status: '200',
      }),
    });

    await session.checkOrder();

    const orderCalls = sent.filter((request) =>
      request.url.endsWith('/v3/site/orders'),
    );
    expect(orderCalls).toHaveLength(1);
    expect(orderCalls[0].body).toMatchObject({
      checkCloseOrderServer: true,
      payment: { tokenOrder: null },
    });
  });

  it('reports a rejected order check', async () => {
    const { session } = createSession({
      'clubs/customer/77577': customerRoute,
      'POST https://www.rami-levy.co.il/api/catalog': () => fixture('items'),
      'POST https://www-api.rami-levy.co.il/api/v3/site/orders': () => ({
        status: '-1',
        data: 'אזור החלוקה סגור',
      }),
    });

    await expect(
      session.createOrder(false, { id: '1', amount: 0.1 }),
    ).rejects.toBeInstanceOf(RamiLevyOrderError);
  });

  it('opens an order for editing', async () => {
    const { session, sent } = createSession({
      'POST https://www-api.rami-levy.co.il/api/v3/site/orders/open-order':
        () => ({ status: '200' }),
    });

    await session.putOrderInUpdateMode('5685662');

    expect(sent[0].body).toEqual({ id: 5685662 });
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
