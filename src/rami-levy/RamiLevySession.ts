import { CookieJar } from '../core/CookieJar';
import type { GrocerySession } from '../core/GrocerySession';
import {
  HttpMethod,
  HttpStatusError,
  HttpTransport,
} from '../core/HttpTransport';
import {
  AccountOrders,
  CartItemToAdd,
  CartMutationResult,
  CartState,
  DeliveryTimeSlot,
  ExistingCartItem,
  OrderDetails,
  OrderInfo,
  Product,
  SearchResults,
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
  RamiLevyCartResponse,
  RamiLevyCatalogResponse,
  RamiLevyCustomerResponse,
  RamiLevyOrderDetailsResponse,
  RamiLevyOrderRow,
  RamiLevyOrdersResponse,
  RamiLevyReservationResponse,
  RamiLevySupplyDatesResponse,
} from './types';

export const RAMI_LEVY_SITE_URL = 'https://www.rami-levy.co.il';
export const RAMI_LEVY_API_URL = 'https://www-api.rami-levy.co.il/api';

const MAX_ORDER_PAGES = 10;
const UNAUTHORIZED_STATUSES = new Set([401, 403]);

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

export class RamiLevySession implements GrocerySession {
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

  createOrder(): Promise<OrderInfo> {
    return Promise.reject(new RamiLevyPaymentRequiredError());
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
