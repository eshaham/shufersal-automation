import assert from 'assert';

import {
  AccountOrders,
  CartItemToAdd,
  DeliveryTimeSlot,
  ExistingCartItem,
  ItemDetails,
  OrderDetails,
  OrderInfo,
  Product,
  SearchResults,
  SellingMethod,
  ShufersalAccountOrders,
  ShufersalAvailableTimeSlotsResponse,
  ShufersalCartItem,
  ShufersalCartItemAdd,
  ShufersalOrder,
  ShufersalOrderDetails,
  ShufersalOrderEntry,
  ShufersalProduct,
  ShufersalProductSearchResponse,
  ShufersalProductSearchResult,
  ShufersalSellingMethod,
  ShufersalTimeSlot,
} from '@shufersal-automation';
import puppeteer, { Browser, BrowserContext, Page } from 'puppeteer-core';

interface ShufersalBotOptions {
  executablePath: string;
  headless?: boolean;
  chromiumArgs?: string[];
}

interface ShufersalCredentials {
  username: string;
  password: string;
}

declare global {
  interface Window {
    ACC: {
      config: {
        CSRFToken: string;
      };
    };
  }
}

const BASE_URL = 'https://www.shufersal.co.il/online/he';

function shufersalProductSearchResultToProduct(
  result: ShufersalProductSearchResult,
): Product {
  const sellingMethod =
    result.sellingMethod?.code === ShufersalSellingMethod.Unit
      ? SellingMethod.Unit
      : SellingMethod.Weight;

  const mainCategory = result.commercialCategoryGroup;
  const subCategory = result.commercialCategorySubGroup;

  return {
    code: result.code,
    name: result.name,
    description: result.description,
    brand: result.brand,
    mainCategory,
    subCategory,
    sellingMethod,
    inStock: result.stock.stockLevelStatus.code === 'inStock',
    price: result.price.value,
    formattedPrice: result.price.formattedValue,
    rawData: result,
  };
}

function shufersalProductSearchResponseToSearchResults(
  response: ShufersalProductSearchResponse,
): SearchResults {
  return {
    results: response.results.map(shufersalProductSearchResultToProduct),
    totalResults: response.pagination.totalNumberOfResults,
    currentPage: response.pagination.currentPage,
    totalPages: response.pagination.numberOfPages,
    pageSize: response.pagination.pageSize,
  };
}

function extractDeliveryDateTimeFromShufersalOrder(order: ShufersalOrder) {
  if (order.consignments?.length !== 1) {
    throw new Error(`Unexpected number of consignments in order ${order.code}`);
  }
  const consignment = order.consignments[0];
  const dateTime = new Date(consignment.timeSlotStartTime);
  return dateTime;
}

function shufersalAccountOrderToOrderInfo(
  order: ShufersalOrder,
  isBeingUpdated: boolean = false,
): OrderInfo {
  const dateTime = extractDeliveryDateTimeFromShufersalOrder(order);
  return {
    code: order.code,
    deliveryDateTime: dateTime.toISOString(),
    isActive: order.isActive,
    isCancelable: order.isCancelable,
    isUpdatable: order.isUpdatable,
    isBeingUpdated,
    rawData: order,
  };
}

function shufersalProductToProduct(product: ShufersalProduct): Product {
  return {
    code: product.code,
    name: product.name,
    description: product.description,
    brand: product.brand,
    mainCategory: product.commercialCategoryGroup,
    subCategory: product.commercialCategorySubGroup,
    sellingMethod:
      product.sellingMethod.code === ShufersalSellingMethod.Unit
        ? SellingMethod.Unit
        : SellingMethod.Weight,
    inStock: product.stock.stockLevelStatus.code === 'inStock',
    price: product.price.value,
    formattedPrice: product.price.formattedValue,
    rawData: product,
  };
}

function shufersalOrderEntryToItem(entry: ShufersalOrderEntry): ItemDetails {
  let quantity = entry.quantity;
  const product = shufersalProductToProduct(entry.product);
  if (
    entry.product.sellingMethod.code === ShufersalSellingMethod.Package &&
    entry.product.weightConversion
  ) {
    product.sellingMethod = SellingMethod.Unit;
    quantity = entry.quantity / entry.product.weightConversion;
  }
  const pricePerUnit = parseFloat(
    (entry.totalPrice.value / quantity).toFixed(2),
  );
  return {
    productCode: entry.product.code,
    product: shufersalProductToProduct(entry.product),
    quantity: quantity,
    pricePerUnit,
    rawData: entry,
  };
}

function shufersalCartItemToItem(
  cartItem: ShufersalCartItem,
): ExistingCartItem {
  return {
    productCode: cartItem.productCode,
    productName: cartItem.productName,
    quantity: cartItem.cartyQty,
    inStock: cartItem.recommendation !== 'SWITCH',
    rawData: cartItem,
  };
}

function shufersalTimeSlotToDeliveryTimeSlot(
  shufersalTimeSlot: ShufersalTimeSlot,
): DeliveryTimeSlot | null {
  if (!shufersalTimeSlot.fromHour || !shufersalTimeSlot.code) {
    return null;
  }
  const dateTime = new Date(shufersalTimeSlot.fromHour);
  const timeSlot = {
    code: shufersalTimeSlot.code,
    dateTime: dateTime.toISOString(),
    rawData: shufersalTimeSlot,
  };
  return timeSlot;
}

function shufersalAvailableTimeslotsResponseToDeliveryTimeslots(
  response: ShufersalAvailableTimeSlotsResponse,
): DeliveryTimeSlot[] {
  const timeSlots: DeliveryTimeSlot[] = [];
  for (const date in response) {
    for (const shufersalTimeSlot of response[date]) {
      const timeSlot = shufersalTimeSlotToDeliveryTimeSlot(shufersalTimeSlot);
      if (timeSlot) {
        timeSlots.push(timeSlot);
      }
    }
  }
  return timeSlots;
}

function cartItemToShufersalCartItemAdd(
  item: CartItemToAdd,
): ShufersalCartItemAdd {
  return {
    productCode: item.productCode,
    quantity: item.quantity,
    frontQuantity: item.quantity,
    sellingMethod:
      item.sellingMethod === SellingMethod.Unit
        ? ShufersalSellingMethod.Unit
        : ShufersalSellingMethod.Package,
    longTail: false,
  };
}

export class ShufersalSession {
  private isLoggedIn = false;

  constructor(
    private context: BrowserContext,
    private page: Page,
    private credentials: ShufersalCredentials,
  ) {}

  async searchProducts(
    query: string,
    limit: number = 20,
    page: number = 0,
  ): Promise<SearchResults> {
    await this.loginIfNeeded();

    const searchQuery = `${encodeURIComponent(query)}:relevance`;
    const response = await this.apiRequest<ShufersalProductSearchResponse>(
      'GET',
      `/search/results?q=${searchQuery}&limit=${limit}&page=${page}`,
    );
    return shufersalProductSearchResponseToSearchResults(response);
  }

  async getProductByCode(productCode: string): Promise<Product | null> {
    const codeToSearch = productCode.startsWith('P_')
      ? productCode.substring(2)
      : productCode;

    const searchResults = await this.searchProducts(codeToSearch);
    const product = searchResults.results.find((p) => p.code === productCode);

    return product || null;
  }

  async getOrders(): Promise<AccountOrders> {
    await this.loginIfNeeded();

    const accountOrders = await this.apiRequest<ShufersalAccountOrders>(
      'GET',
      '/my-account/orders',
    );

    const orderInUpdateMode = await this.getOrderInUpdateMode();
    return {
      activeOrders: accountOrders.activeOrders.map((order) =>
        shufersalAccountOrderToOrderInfo(
          order,
          order.code === orderInUpdateMode,
        ),
      ),
      closedOrders: accountOrders.closedOrders.map((order) =>
        shufersalAccountOrderToOrderInfo(
          order,
          order.code === orderInUpdateMode,
        ),
      ),
    };
  }

  async getOrderDetails(code: string): Promise<OrderDetails> {
    await this.loginIfNeeded();

    const orderDetails = await this.apiRequest<ShufersalOrderDetails>(
      'GET',
      `/my-account/orders/${code}`,
    );

    const orderInUpdateMode = await this.getOrderInUpdateMode();
    const isBeingUpdated = orderInUpdateMode === code;

    const order = shufersalAccountOrderToOrderInfo(
      orderDetails,
      isBeingUpdated,
    );
    return {
      ...order,
      items: orderDetails.entries.map(shufersalOrderEntryToItem),
      rawData: orderDetails,
    };
  }

  async addToCart(items: CartItemToAdd[]): Promise<void> {
    await this.loginIfNeeded();

    const shufersalCartEntries = items.map((item) =>
      cartItemToShufersalCartItemAdd(item),
    );
    await this.apiRequest('POST', '/cart/addGrid', shufersalCartEntries);
  }

  async removeFromCart(productCode: string): Promise<void> {
    await this.loginIfNeeded();

    const cartItems = await this.getCartItems();
    const cartItem = cartItems.find((item) => item.productCode === productCode);

    if (!cartItem) {
      throw new Error(`Product ${productCode} not found in cart`);
    }

    const shufersalCartItem = cartItem.rawData as ShufersalCartItem;
    const query = new URLSearchParams({
      entryNumber: shufersalCartItem.entryNumber.toString(),
      qty: '0',
      'cartContext[openFrom]': 'CART',
      'cartContext[recommendationType]': 'REGULAR',
      'cartContext[action]': 'remove',
    });

    await this.apiRequest('POST', `/cart/update?${query.toString()}`, {
      quantity: 0,
    });
  }

  async clearCart(): Promise<void> {
    await this.loginIfNeeded();

    await this.apiRequest('POST', '/cart/remove');
  }

  async getCartItems(): Promise<ExistingCartItem[]> {
    await this.loginIfNeeded();

    const cartItems = await this.apiRequest<ShufersalCartItem[]>(
      'GET',
      '/recommendations/entry-recommendations',
    );
    return cartItems.map(shufersalCartItemToItem);
  }

  async getAvailableTimeSlots(): Promise<DeliveryTimeSlot[]> {
    await this.loginIfNeeded();

    const response = await this.apiRequest<ShufersalAvailableTimeSlotsResponse>(
      'GET',
      '/timeSlot/preselection/getHomeDeliverySlots',
    );
    return shufersalAvailableTimeslotsResponseToDeliveryTimeslots(response);
  }

  async getSelectedTimeSlot(): Promise<DeliveryTimeSlot | null> {
    await this.loginIfNeeded();

    const shufersalTimeSlot = await this.apiRequest<ShufersalTimeSlot>(
      'GET',
      '/timeSlot/preselection/getSelectedTimeslot',
    );
    if (!shufersalTimeSlot || !shufersalTimeSlot.code) {
      return null;
    }
    return shufersalTimeSlotToDeliveryTimeSlot(shufersalTimeSlot);
  }

  async selectTimeSlot(timeSlotCode: string): Promise<void> {
    await this.loginIfNeeded();

    const availableTimeSlots = await this.getAvailableTimeSlots();
    const timeSlot = availableTimeSlots.find(
      (slot) => slot.code === timeSlotCode,
    );
    if (!timeSlot) {
      throw new Error(`Time slot ${timeSlotCode} not found`);
    }
    await this.apiRequest(
      'POST',
      '/timeSlot/preselection/postHomeDeliverySlot',
      {
        homeDeliveryTimeSlot: timeSlot.rawData,
      },
    );
  }

  async createOrder(removeMissingItems: boolean): Promise<void> {
    await this.loginIfNeeded();

    const cartItems = await this.getCartItems();
    const missingItems = cartItems.filter((item) => !item.inStock);
    if (missingItems.length > 0) {
      if (removeMissingItems) {
        for (const item of missingItems) {
          await this.removeFromCart(item.productCode);
        }
      } else {
        throw new Error(
          `Missing items in cart: ${missingItems
            .map((item) => item.productCode)
            .join(', ')}`,
        );
      }
    }

    await this.page.goto(`${BASE_URL}/cart/cartsummary`);

    await this.page.waitForSelector('.miglog-cart-summary-checkoutLink', {
      timeout: 60_000,
      visible: true,
    });
    await this.page.click('.miglog-cart-summary-checkoutLink');

    const giftModal = await this.page
      .waitForSelector('#giftProductsModal', {
        visible: true,
        timeout: 10_000,
      })
      .catch(() => null);

    if (giftModal) {
      await this.page.click('#giftProductsModal .btnClose');
    }

    await this.page.waitForSelector('#j_password', {
      visible: true,
      timeout: 60_000,
    });
    await this.page.type('#j_password', this.credentials.password, {
      delay: 100,
    });
    await this.page.click('#checkoutPwd button[type="submit"]');

    await this.page.waitForNavigation({ waitUntil: 'networkidle0' });

    const missingProductsModal = await this.page
      .waitForSelector('#missingProducts', {
        visible: true,
        timeout: 5_000,
      })
      .catch(() => null);

    if (missingProductsModal) {
      await this.page.click('#missingProducts .bottomContainer button');
      await this.page.waitForSelector('#missingProducts', {
        hidden: true,
        timeout: 5_000,
      });
    }

    await this.page.click('.btnConfirm');

    await this.page.waitForNavigation({ waitUntil: 'networkidle0' });
  }

  async putOrderInUpdateMode(code: string): Promise<void> {
    await this.loginIfNeeded();

    await this.apiRequest('GET', `/cart/cartFromOrder/${code}`);
  }

  private async getOrderInUpdateMode(): Promise<string | null> {
    const textContent = await this.page.evaluate(async (url) => {
      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      return doc.body.textContent || '';
    }, `${BASE_URL}/cart/load?restoreCart=true`);

    const match = textContent.match(/עדכון הזמנה מס׳ (\d+)/);
    return match ? match[1] : null;
  }

  async sendReceipt(orderNumber: string, email: string): Promise<void> {
    await this.loginIfNeeded();

    const orders = await this.getOrders();
    const allOrders = [...orders.activeOrders, ...orders.closedOrders];
    const order = allOrders.find((o) => o.code === orderNumber);

    if (!order) {
      throw new Error(`Order ${orderNumber} not found`);
    }

    if (order.isActive) {
      throw new Error(
        `Cannot send receipt for order ${orderNumber}: order is still active`,
      );
    }

    await this.apiRequest(
      'POST',
      `/emailInvoice/sendEmalInvoice?orderNum=${orderNumber}&email=${encodeURIComponent(email)}`,
      { uuid: email },
    );
  }

  async takeScreenshot(): Promise<Buffer> {
    return this.page.screenshot() as Promise<Buffer>;
  }

  async verifySessionAlive(): Promise<void> {
    await this.page.evaluate(() => document.title);
  }

  async close(): Promise<void> {
    try {
      await this.context.close();
    } catch (error) {
      if (
        error instanceof Error &&
        !error.message?.includes('Connection closed') &&
        !error.message?.includes('Protocol error')
      ) {
        throw error;
      }
    }
  }

  private async loginIfNeeded() {
    if (!this.isLoggedIn) {
      await this.page.goto(`${BASE_URL}/login`);
      await this.page.type('#j_username', this.credentials.username);
      await this.page.type('#j_password', this.credentials.password);
      await this.page.click('.btn-login');
      await this.page.waitForNavigation();

      this.isLoggedIn = true;
    }
  }

  private async apiRequest<T extends object | undefined>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ) {
    const data = await this.page.evaluate(
      async (url, method, body) => {
        const csrftoken = window.ACC.config.CSRFToken;
        const response = await fetch(url, {
          headers: {
            'content-type': 'application/json',
            csrftoken,
          },
          method,
          body: body ? JSON.stringify(body) : undefined,
          mode: 'cors',
          credentials: 'include',
        });
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        if (
          response.headers.get('content-type')?.includes('application/json')
        ) {
          const data = await response.json();
          return data;
        }
      },
      `${BASE_URL}${path}`,
      method,
      body,
    );
    return data as T;
  }
}

export class ShufersalBot {
  private browser: Browser | undefined;

  constructor(private options: ShufersalBotOptions) {}

  async createSession(
    username: string,
    password: string,
  ): Promise<ShufersalSession> {
    const context = await this.createContext();
    const page = await context.newPage();

    return new ShufersalSession(context, page, { username, password });
  }

  async terminate(): Promise<void> {
    assert(this.browser);
    await this.browser.close();
    this.browser = undefined;
  }

  private async initIfNeeded() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        executablePath: this.options.executablePath,
        headless: 'headless' in this.options ? this.options.headless : true,
        args: this.options.chromiumArgs,
      });
    }
  }

  private async createContext() {
    await this.initIfNeeded();
    assert(this.browser);

    const context = await this.browser.createBrowserContext();
    return context;
  }
}
