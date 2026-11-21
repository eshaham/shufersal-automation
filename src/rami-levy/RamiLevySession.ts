import { findProductsByBarcodes } from '../core/barcodes';
import { CookieJar } from '../core/CookieJar';
import type {
  BarcodeLookupSupport,
  GrocerySession,
  InteractivePaymentSupport,
  OrderUpdateSupport,
  PaymentForm,
  PaymentReference,
} from '../core/GrocerySession';
import {
  HttpMethod,
  HttpStatusError,
  HttpTransport,
} from '../core/HttpTransport';
import {
  AccountOrders,
  CartItemToAdd,
  CartItemToRemove,
  CartMutationResult,
  CartState,
  DeliveryTimeSlot,
  ExistingCartItem,
  OrderDetails,
  OrderInfo,
  Product,
  SearchResults,
  SellingMethod,
  SerializedSessionData,
} from '../core/types';
import {
  cartLines,
  cartLineToExistingCartItem,
  cartModifications,
  orderDetailsToOrderDetails,
  ramiLevyProductToProduct,
  reservationToTimeSlot,
  SLOT_CODE_SEPARATOR,
  splitOrders,
  stripToTimeSlot,
} from './mappers';
import {
  RamiLevyAddress,
  RamiLevyCard,
  RamiLevyCartResponse,
  RamiLevyCatalogResponse,
  RamiLevyCustomerResponse,
  RamiLevyCvvSuccessData,
  RamiLevyDeliveryReservation,
  RamiLevyIframeUrlResponse,
  RamiLevyOrderDetailsResponse,
  RamiLevyOrderRow,
  RamiLevyOrdersResponse,
  RamiLevyOrderTokenResponse,
  RamiLevyPlaceOrderResponse,
  RamiLevyProduct,
  RamiLevyReservationResponse,
  RamiLevySupplyDatesResponse,
  RamiLevyTokenLoginResponse,
} from './types';

export const RAMI_LEVY_SITE_URL = 'https://www.rami-levy.co.il';
export const RAMI_LEVY_API_URL = 'https://www-api.rami-levy.co.il/api';

const MAX_ORDER_PAGES = 10;
const UNAUTHORIZED_STATUSES = new Set([401, 403]);
const OK_STATUS = '200';
const PAYMENT_MESSAGE_ORIGIN = 'https://www-api.rami-levy.co.il';
const CVV_SUCCESS_EVENT = 'cvv-success';
const CREDIT_CARD_TOKEN = 'CreditCard';
const MARKET_SITE_ID = 1;

export class RamiLevyOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RamiLevyOrderError';
  }
}

export class RamiLevyPaymentMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RamiLevyPaymentMessageError';
  }
}

function optionalNumber(value: string | null | undefined): number | null {
  return value && !isNaN(Number(value)) ? Number(value) : null;
}

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
}

function isCardExpired(card: RamiLevyCard, now: Date): boolean {
  const year = Number(card.expiration_year);
  const month = Number(card.expiration_month);
  return (
    year < now.getFullYear() ||
    (year === now.getFullYear() && month < now.getMonth() + 1)
  );
}

function cvvSuccessData(message: unknown): RamiLevyCvvSuccessData {
  const envelope = message as { event?: unknown; data?: unknown } | null;
  if (envelope?.event !== CVV_SUCCESS_EVENT || !envelope.data) {
    throw new RamiLevyPaymentMessageError(
      `Expected a ${CVV_SUCCESS_EVENT} message from the payment form`,
    );
  }
  const data = envelope.data as Partial<RamiLevyCvvSuccessData>;
  if (!data.token || !data.cardIdDB) {
    throw new RamiLevyPaymentMessageError(
      'The payment form message has no token or card',
    );
  }
  return data as RamiLevyCvvSuccessData;
}

export class RamiLevyLoginRequiredError extends Error {
  constructor(message = 'Rami Levy needs an interactive login') {
    super(message);
    this.name = 'RamiLevyLoginRequiredError';
  }
}

export class RamiLevyPaymentRequiredError extends Error {
  constructor() {
    super(
      'Rami Levy orders need a payment token from the customer (CVV entry)',
    );
    this.name = 'RamiLevyPaymentRequiredError';
  }
}

export interface RamiLevySessionData {
  token: string;
  customerId: number;
  storeId?: string;
}

export interface RamiLevySessionOptions {
  fetch?: typeof fetch;
}

function tokenExpiry(token: string): string | undefined {
  const payload = token.split('.')[1];
  if (!payload) {
    return undefined;
  }
  try {
    const { exp } = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as { exp?: number };
    return exp ? new Date(exp * 1000).toISOString() : undefined;
  } catch (error) {
    console.warn(
      `[rami-levy] could not read the token expiry: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

export class RamiLevySession
  implements
    GrocerySession,
    InteractivePaymentSupport,
    OrderUpdateSupport,
    BarcodeLookupSupport
{
  private readonly http: HttpTransport;
  private storeId: string | undefined;
  private address: RamiLevyAddress | undefined;
  private editOrderId: number | null = null;

  constructor(
    private readonly data: RamiLevySessionData,
    options: RamiLevySessionOptions = {},
  ) {
    this.http = new HttpTransport(new CookieJar(), options.fetch);
    this.storeId = data.storeId;
  }

  static fromSerialized(
    serialized: SerializedSessionData,
    options: RamiLevySessionOptions = {},
  ): RamiLevySession {
    const token = serialized.credentials?.token;
    const customerId = Number(serialized.context?.['customerId']);
    if (!token || !customerId) {
      throw new RamiLevyLoginRequiredError(
        'The saved Rami Levy session has no token or customer id',
      );
    }
    return new RamiLevySession(
      { token, customerId, storeId: serialized.context?.['storeId'] },
      options,
    );
  }

  get tokenExpiresAt(): string | undefined {
    return tokenExpiry(this.data.token);
  }

  performLogin(): Promise<void> {
    return Promise.reject(new RamiLevyLoginRequiredError());
  }

  async restore(): Promise<void> {
    await this.loadCustomer();
  }

  async verifySessionAlive(): Promise<void> {
    await this.loadCustomer();
  }

  serialize(): Promise<SerializedSessionData> {
    const context: Record<string, string> = {
      customerId: String(this.data.customerId),
    };
    if (this.storeId) {
      context['storeId'] = this.storeId;
    }
    return Promise.resolve({
      cookies: [],
      credentials: { token: this.data.token, expiresAt: this.tokenExpiresAt },
      context,
    });
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  takeScreenshot(): Promise<Buffer> {
    return Promise.resolve(Buffer.alloc(0));
  }

  takePageContent(): Promise<string> {
    return Promise.resolve('');
  }

  async searchProducts(
    query: string,
    limit: number = 20,
    page: number = 0,
  ): Promise<SearchResults> {
    const storeId = await this.requireStoreId();
    const response = await this.request<RamiLevyCatalogResponse>(
      'POST',
      `${RAMI_LEVY_SITE_URL}/api/catalog`,
      { q: query, store: storeId, aggs: 0, size: limit, from: page * limit },
    );
    return {
      results: response.data.map((product) =>
        ramiLevyProductToProduct(product, storeId),
      ),
      totalResults: response.total,
      currentPage: page,
      totalPages: Math.ceil(response.total / limit),
      pageSize: limit,
    };
  }

  async getProductByCode(productCode: string): Promise<Product | null> {
    const products = await this.getProductsByCodes([productCode]);
    return products.get(productCode) ?? null;
  }

  getProductsByBarcodes(barcodes: string[]): Promise<Map<string, Product>> {
    return findProductsByBarcodes(
      (query, limit) => this.searchProducts(query, limit),
      barcodes,
      (barcode) => [barcode.replace(/^0+/, '')],
    );
  }

  async getProductsByCodes(
    productCodes: string[],
  ): Promise<Map<string, Product>> {
    if (productCodes.length === 0) {
      return new Map();
    }
    const storeId = await this.requireStoreId();
    const response = await this.request<RamiLevyCatalogResponse>(
      'POST',
      `${RAMI_LEVY_SITE_URL}/api/catalog`,
      {
        store: storeId,
        items: productCodes.join(','),
        size: productCodes.length,
      },
    );
    return new Map(
      response.data.map((product) => [
        String(product.id),
        ramiLevyProductToProduct(product, storeId),
      ]),
    );
  }

  async getOrders(): Promise<AccountOrders> {
    const rows: RamiLevyOrderRow[] = [];
    let editOrderId: number | null = null;
    for (let page = 1; page <= MAX_ORDER_PAGES; page++) {
      const response = await this.request<RamiLevyOrdersResponse>(
        'GET',
        `${RAMI_LEVY_API_URL}/v3/site/orders?page=${String(page)}&activeFilter=0`,
      );
      editOrderId = response.data.editOrderId;
      rows.push(...response.data.data.data);
      if (page >= response.data.data.last_page) {
        break;
      }
    }
    this.editOrderId = editOrderId;
    return splitOrders(rows, editOrderId);
  }

  async getOrderDetails(code: string): Promise<OrderDetails | undefined> {
    const response = await this.request<RamiLevyOrderDetailsResponse>(
      'GET',
      `${RAMI_LEVY_API_URL}/v3/site/orders/${code}`,
    );
    const products = await this.getProductsByCodes(
      response.data.lines.map((line) => String(line.item_id)),
    );
    return orderDetailsToOrderDetails(
      response.data,
      products,
      this.editOrderId,
    );
  }

  async getCartState(): Promise<CartState> {
    const customer = await this.loadCustomer();
    const quantities = customer.cart?.items ?? {};
    const items =
      Object.keys(quantities).length === 0
        ? []
        : await this.writeCart(quantities).then((cart) =>
            cartLines(cart).map(cartLineToExistingCartItem),
          );
    return {
      items,
      orderInUpdateMode: customer.user.edit_order
        ? String(customer.user.edit_order)
        : null,
    };
  }

  async getCartItems(): Promise<ExistingCartItem[]> {
    return (await this.getCartState()).items;
  }

  async addToCart(items: CartItemToAdd[]): Promise<CartMutationResult> {
    const current = await this.currentQuantities();
    const requested = items.map((item): [string, number] => [
      item.productCode,
      (current[item.productCode] ?? 0) + item.quantity,
    ]);
    return this.mutateCart(
      { ...current, ...Object.fromEntries(requested) },
      requested,
    );
  }

  async removeItemsFromCart(
    items: CartItemToRemove[],
  ): Promise<CartMutationResult> {
    return this.setCartItemQuantities(
      items.map(({ productCode }) => ({
        productCode,
        quantity: 0,
        sellingMethod: SellingMethod.Unit,
      })),
    );
  }

  async setCartItemQuantities(
    items: CartItemToAdd[],
  ): Promise<CartMutationResult> {
    const current = await this.currentQuantities();
    const requested = items.map((item): [string, number] => [
      item.productCode,
      item.quantity,
    ]);
    const next = { ...current, ...Object.fromEntries(requested) };
    for (const [code, quantity] of Object.entries(next)) {
      if (quantity <= 0) {
        Reflect.deleteProperty(next, code);
      }
    }
    return this.mutateCart(next, requested);
  }

  async clearCart(): Promise<void> {
    await this.request('DELETE', `${RAMI_LEVY_API_URL}/v2/site/cart/delete`);
  }

  async getAvailableTimeSlots(): Promise<DeliveryTimeSlot[]> {
    const customer = await this.loadCustomer();
    const address = this.requireAddress();
    const response = await this.request<RamiLevySupplyDatesResponse>(
      'POST',
      `${RAMI_LEVY_API_URL}/v2/site/supply/get-supply-date`,
      {
        only_area_availability: false,
        city_id: address.city_id,
        street_id: address.street_id,
        street_name: address.street,
        home_num: address.street_number,
        entrance: address.entrance,
        user_id: customer.user.id,
        name: customer.user.name,
        email: customer.user.email,
        city: address.city,
        street: address.street,
        street_number: address.street_number,
        showStreet: true,
      },
    );
    return Object.values(response.data)
      .flat()
      .filter((strip) => strip.active)
      .map(stripToTimeSlot);
  }

  async getSelectedTimeSlot(): Promise<DeliveryTimeSlot | null> {
    const customer = await this.loadCustomer();
    const reservation = customer.deliveryTimesCustomer;
    if (reservation?.order_id !== null) {
      return null;
    }
    return reservationToTimeSlot(reservation);
  }

  async selectTimeSlot(
    timeSlotOrCode: string | DeliveryTimeSlot,
  ): Promise<void> {
    await this.loadCustomer();
    const address = this.requireAddress();
    const code =
      typeof timeSlotOrCode === 'string' ? timeSlotOrCode : timeSlotOrCode.code;
    const [supplyDate, stripId] = code.split(SLOT_CODE_SEPARATOR);
    if (!supplyDate || !stripId) {
      throw new Error(`Invalid Rami Levy time slot code: ${code}`);
    }
    const response = await this.request<RamiLevyReservationResponse>(
      'POST',
      `${RAMI_LEVY_API_URL}/v3/site/clubs/delivery-times-customer`,
      {
        city_id: address.city_id,
        street_id: address.street_id,
        street: address.street,
        street_number: address.street_number,
        entrance: address.entrance,
        supply_date: supplyDate,
        strip_id: Number(stripId),
        address,
      },
    );
    if (!response.success || !response.data) {
      throw new Error(`Rami Levy did not reserve time slot ${code}`);
    }
  }

  async preparePayment(cardId?: number): Promise<PaymentForm> {
    const customer = await this.loadCustomer();
    const card = this.pickCard(customer, cardId);
    const quantities = customer.cart?.items ?? {};
    if (Object.keys(quantities).length === 0) {
      throw new RamiLevyOrderError('The Rami Levy cart is empty');
    }
    const cart = await this.writeCart(quantities);
    const reservation = this.openReservation(customer);
    const amount = roundPrice(cart.price + (reservation?.price ?? 0));
    const storeId = await this.requireStoreId();
    const tokenLogin = await this.request<RamiLevyTokenLoginResponse>(
      'POST',
      `${RAMI_LEVY_API_URL}/v2/site/clubs/get-token-login`,
      {
        token: card.id,
        isCvv: true,
        price: amount,
        numberPaymentsSelect: 1,
        store_id: storeId,
      },
    );
    if (!tokenLogin.data) {
      throw new RamiLevyOrderError('Rami Levy did not open a payment form');
    }
    const iframe = await this.request<RamiLevyIframeUrlResponse>(
      'POST',
      `${RAMI_LEVY_SITE_URL}/api/comax/iframe-url`,
      { type: 'credit', tokenLogin: tokenLogin.data },
    );
    if (!iframe.url) {
      throw new RamiLevyOrderError('Rami Levy did not return a payment form');
    }
    return {
      url: iframe.url,
      amount,
      messageOrigin: PAYMENT_MESSAGE_ORIGIN,
      cardLastDigits: card.last_digits.slice(-4),
    };
  }

  async registerPayment(message: unknown): Promise<PaymentReference> {
    const data = cvvSuccessData(message);
    const storeId = await this.requireStoreId();
    const response = await this.request<RamiLevyOrderTokenResponse>(
      'POST',
      `${RAMI_LEVY_API_URL}/v3/site/order-token`,
      {
        site_id: MARKET_SITE_ID,
        store_id: storeId,
        type: CREDIT_CARD_TOKEN,
        type_cart: 'market',
        amount: data.total,
        token: data.token,
        card_id: data.cardIdDB,
        card_type: data.creditType,
        identity_card: data.cardId,
        expiration_month: data.expirationMonth,
        expiration_year: data.expirationYear.slice(-2),
        last_digits: data.lastDigits,
        payments_number: data.paymentsNumber,
        is_club: data.IsClubCC,
        complete_in_err: data.CompleteInErr ?? 0,
      },
    );
    return {
      id: String(response.data.id),
      amount: Number(response.data.amount),
    };
  }

  async discardPayment(payment: PaymentReference): Promise<void> {
    await this.request(
      'DELETE',
      `${RAMI_LEVY_API_URL}/v3/site/order-token/${payment.id}`,
    );
  }

  async putOrderInUpdateMode(code: string): Promise<void> {
    await this.request(
      'POST',
      `${RAMI_LEVY_API_URL}/v3/site/orders/open-order`,
      {
        id: Number(code),
      },
    );
    this.editOrderId = Number(code);
  }

  async getOrderInUpdateMode(): Promise<string | null> {
    const customer = await this.loadCustomer();
    return customer.user.edit_order ? String(customer.user.edit_order) : null;
  }

  async checkOrder(): Promise<void> {
    const customer = await this.loadCustomer();
    const request = await this.orderRequest(customer);
    await this.submitOrderCheck(request);
  }

  async createOrder(
    _removeMissingItems: boolean,
    payment?: PaymentReference,
  ): Promise<OrderInfo> {
    const customer = await this.loadCustomer();
    const editOrderId = customer.user.edit_order;
    const tokenOrder = payment
      ? [Number(payment.id)]
      : (customer.orderTokens ?? [])
          .filter(
            (token) =>
              editOrderId !== null &&
              token.type === CREDIT_CARD_TOKEN &&
              token.order_id === editOrderId,
          )
          .map((token) => token.id);
    if (tokenOrder.length === 0) {
      throw new RamiLevyPaymentRequiredError();
    }

    const request = await this.orderRequest(customer);
    await this.submitOrderCheck(request);
    const placed = await this.request<RamiLevyPlaceOrderResponse>(
      request.method,
      request.url,
      {
        ...request.body,
        payment: { ...request.body.payment, tokenOrder },
        checkCloseOrderServer: false,
      },
    );
    const orderId = placed.data?.order_id ?? editOrderId;
    if (String(placed.status) !== OK_STATUS || !orderId) {
      throw new RamiLevyOrderError(
        `Rami Levy did not place the order: ${JSON.stringify(placed)}`,
      );
    }

    await this.clearCart();
    this.editOrderId = null;
    const details = await this.getOrderDetails(String(orderId));
    if (!details) {
      throw new RamiLevyOrderError(
        `Rami Levy placed order ${String(orderId)} but could not load it`,
      );
    }
    const { items: _items, ...order } = details;
    return order;
  }

  private async orderRequest(customer: RamiLevyCustomerResponse) {
    const reservation = this.openReservation(customer);
    if (!reservation) {
      throw new RamiLevyOrderError(
        'Select a delivery time slot before placing the order',
      );
    }
    const quantities = customer.cart?.items ?? {};
    if (Object.keys(quantities).length === 0) {
      throw new RamiLevyOrderError('The Rami Levy cart is empty');
    }
    const editOrderId = customer.user.edit_order;
    return {
      method: editOrderId ? ('PUT' as const) : ('POST' as const),
      url: `${RAMI_LEVY_API_URL}/v3/site/orders${editOrderId ? `/${String(editOrderId)}` : ''}`,
      body: await this.orderBody(customer, reservation, quantities),
    };
  }

  private async submitOrderCheck(
    request: Awaited<ReturnType<RamiLevySession['orderRequest']>>,
  ): Promise<void> {
    const check = await this.request<RamiLevyPlaceOrderResponse>(
      request.method,
      request.url,
      {
        ...request.body,
        payment: { ...request.body.payment, tokenOrder: null },
        checkCloseOrderServer: true,
      },
    );
    if (String(check.status) !== OK_STATUS) {
      throw new RamiLevyOrderError(
        `Rami Levy rejected the order check: ${JSON.stringify(check)}`,
      );
    }
  }

  private pickCard(
    customer: RamiLevyCustomerResponse,
    cardId?: number,
  ): RamiLevyCard {
    const cards = Object.values(customer.user.cards ?? {});
    const now = new Date();
    const card = cardId
      ? cards.find((saved) => saved.id === cardId)
      : cards
          .filter((saved) => !isCardExpired(saved, now))
          .sort((a, b) => b.id - a.id)[0];
    if (!card) {
      throw new RamiLevyOrderError(
        'The Rami Levy account has no valid saved card',
      );
    }
    return card;
  }

  private openReservation(
    customer: RamiLevyCustomerResponse,
  ): RamiLevyDeliveryReservation | null {
    const reservation = customer.deliveryTimesCustomer;
    return reservation?.order_id === null ? reservation : null;
  }

  private async orderBody(
    customer: RamiLevyCustomerResponse,
    reservation: RamiLevyDeliveryReservation,
    quantities: Record<string, number>,
  ) {
    const storeId = await this.requireStoreId();
    const products = await this.getProductsByCodes(Object.keys(quantities));
    const items = Object.fromEntries(
      Object.entries(quantities).map(([code, quantity]) => {
        const prop = (
          products.get(code)?.rawData as RamiLevyProduct | undefined
        )?.prop;
        const multiplier =
          prop?.by_kilo && prop.by_kilo_content > 0 ? prop.by_kilo_content : 1;
        return [code, quantity * multiplier];
      }),
    );
    const address = reservation.address ?? this.requireAddress();
    return {
      isCartMall: false,
      supply: {
        area_id: customer.user.area_id,
        area: address.area,
        city_id: address.city_id,
        city: address.city,
        street_id: address.street_id,
        street: address.street,
        street_number: address.street_number,
        apartment: optionalNumber(address.apartment),
        entrance: address.entrance,
        floor: optionalNumber(address.floor),
        name: address.name,
        zip: optionalNumber(address.zip),
      },
      notes: [],
      payment: {
        typePaymentObligo: false,
        tokenDirect: 0,
        tokenOrder: null as number[] | null,
        numberPayment: 1,
      },
      order: {
        delivery_id: reservation.id,
        order_name: null,
        customer_name: customer.user.name,
        customer_phone: customer.user.phone,
        customer_aditional_phone: customer.user.additional_phone,
        store_id: storeId,
      },
      items,
      itemsPreferences: {},
    };
  }

  private async currentQuantities(): Promise<Record<string, number>> {
    const customer = await this.loadCustomer();
    return { ...(customer.cart?.items ?? {}) };
  }

  private async mutateCart(
    quantities: Record<string, number>,
    requested: [string, number][],
  ): Promise<CartMutationResult> {
    let items: ExistingCartItem[] = [];
    if (Object.keys(quantities).length === 0) {
      await this.clearCart();
    } else {
      const cart = await this.writeCart(quantities);
      items = cartLines(cart).map(cartLineToExistingCartItem);
    }
    return {
      items,
      orderInUpdateMode: this.editOrderId ? String(this.editOrderId) : null,
      modifications: cartModifications(requested, items),
    };
  }

  private async writeCart(
    quantities: Record<string, number>,
  ): Promise<RamiLevyCartResponse> {
    const storeId = await this.requireStoreId();
    const items = Object.fromEntries(
      Object.entries(quantities).map(([code, quantity]) => [
        code,
        quantity.toFixed(2),
      ]),
    );
    return this.request<RamiLevyCartResponse>(
      'POST',
      `${RAMI_LEVY_SITE_URL}/api/v2/cart`,
      {
        store: storeId,
        isClub: 0,
        supplyAt: new Date().toISOString(),
        items,
        meta: null,
      },
    );
  }

  private async loadCustomer(): Promise<RamiLevyCustomerResponse> {
    const customer = await this.request<RamiLevyCustomerResponse>(
      'GET',
      `${RAMI_LEVY_API_URL}/v2/site/clubs/customer/${String(this.data.customerId)}`,
    );
    const addresses = Object.values(customer.user.addresses);
    this.address =
      addresses.find((address) => address.default === 1) ?? addresses[0];
    this.storeId =
      customer.deliveryTimesCustomer?.store_id ??
      customer.user.store_id ??
      this.storeId;
    this.editOrderId = customer.user.edit_order;
    return customer;
  }

  private async requireStoreId(): Promise<string> {
    if (!this.storeId) {
      await this.loadCustomer();
    }
    if (!this.storeId) {
      throw new Error('The Rami Levy account has no store for its address');
    }
    return this.storeId;
  }

  private requireAddress(): RamiLevyAddress {
    if (!this.address) {
      throw new Error('The Rami Levy account has no delivery address');
    }
    return this.address;
  }

  private async request<T>(
    method: HttpMethod,
    url: string,
    body?: unknown,
  ): Promise<T> {
    try {
      const result = await this.http.send(
        {
          method,
          url,
          body,
          headers: { EcomToken: this.data.token, Locale: 'he' },
        },
        'json',
      );
      return result.data as T;
    } catch (error) {
      if (
        error instanceof HttpStatusError &&
        UNAUTHORIZED_STATUSES.has(error.status)
      ) {
        throw new RamiLevyLoginRequiredError(
          `Rami Levy rejected the saved token (${String(error.status)})`,
        );
      }
      throw error;
    }
  }
}
