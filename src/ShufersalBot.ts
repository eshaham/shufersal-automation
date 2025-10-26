import assert from 'assert';

import {
  AccountOrders,
  CartItemToAdd,
  DeliveryTimeSlot,
  ExistingCartItem,
  ItemDetails,
  OrderDetails,
  OrderInfo,
  OrderStatus,
  Product,
  ReceiptDetails,
  SearchResults,
  SellingMethod,
  SerializedSessionData,
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
} from '~/types';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import puppeteer, { Browser, BrowserContext, Page } from 'puppeteer-core';

import { parseReceipt } from './receiptParser';
import { createSessionProxy } from './SessionProxy';
import { ShufersalSessionError } from './ShufersalSessionError';

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

export class InvalidCredentialsError extends Error {
  constructor(message = 'Invalid credentials') {
    super(message);
    this.name = 'InvalidCredentialsError';
  }
}

export class LoginTimeoutError extends Error {
  constructor(message = 'Login timeout') {
    super(message);
    this.name = 'LoginTimeoutError';
  }
}

interface ShufersalBotOptions {
  browser?: Browser;
  executablePath?: string;
  browserWSEndpoint?: string;
  headless?: boolean;
  chromiumArgs?: string[];
  takeScreenshotOnErrors?: boolean;
}

interface ShufersalCredentials {
  username: string;
  password: string;
}

declare global {
  interface Window {
    ACC?: {
      config?: {
        CSRFToken?: string;
      };
    };
  }
}

export const BASE_URL = 'https://www.shufersal.co.il';
export const WEBAPP_URL = `${BASE_URL}/online/he`;

const NAVIGATION_TIMEOUT = 30_000;
const ACTION_TIMEOUT = 10_000;

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
  if (order.consignments.length !== 1) {
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

  let status: OrderStatus;
  if (order.status.code === 'CANCELLED_SENT_TO_ERP') {
    status = OrderStatus.Canceled;
  } else if (order.status.code === 'DELIVERED') {
    status = OrderStatus.Delivered;
  } else if (order.status.code === 'ON_THE_WAY') {
    status = OrderStatus.Shipped;
  } else {
    status = OrderStatus.Active;
  }

  let updateableUntilDateTime: string | null = null;
  if (order.updateToDateString && order.updateToHourString) {
    const parsed = dayjs.tz(
      `${order.updateToDateString} ${order.updateToHourString}`,
      'DD/MM/YY HH:mm',
      'Asia/Jerusalem',
    );
    if (parsed.isValid()) {
      updateableUntilDateTime = parsed.toISOString();
    }
  }

  return {
    code: order.code,
    deliveryDateTime: dateTime.toISOString(),
    updateableUntilDateTime,
    totalPrice: order.totalPrice.value,
    status,
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

interface ApiRequestConfig {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
}

export class ShufersalSession {
  constructor(
    private context: BrowserContext,
    private page: Page,
    private credentials: ShufersalCredentials,
  ) {}

  get browserContext(): BrowserContext {
    return this.context;
  }

  get browserPage(): Page {
    return this.page;
  }

  async performLogin(): Promise<void> {
    await this.page.goto(`${WEBAPP_URL}/login`, {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT,
    });

    await this.page.waitForSelector('#j_username', {
      visible: true,
      timeout: NAVIGATION_TIMEOUT,
    });
    await this.page.waitForSelector('#j_password', {
      visible: true,
      timeout: NAVIGATION_TIMEOUT,
    });
    await this.page.waitForSelector('.btn-login', {
      visible: true,
      timeout: NAVIGATION_TIMEOUT,
    });

    await this.page.type('#j_username', this.credentials.username);
    await this.page.type('#j_password', this.credentials.password);
    await this.page.click('.btn-login');

    const errorModalOrNavigation = await Promise.race([
      this.page
        .waitForSelector('.modal.message-modal.error.in', {
          visible: true,
          timeout: NAVIGATION_TIMEOUT,
        })
        .then(() => 'error' as const)
        .catch(() => null),
      this.page
        .waitForFunction(
          (loginUrl) => !window.location.href.includes(loginUrl),
          { timeout: NAVIGATION_TIMEOUT },
          '/login',
        )
        .then(() => 'navigation' as const)
        .catch(() => null),
    ]);

    if (errorModalOrNavigation === 'error') {
      throw new InvalidCredentialsError();
    }

    if (errorModalOrNavigation === null) {
      throw new LoginTimeoutError();
    }
  }

  async searchProducts(
    query: string,
    limit: number = 20,
    page: number = 0,
  ): Promise<SearchResults> {
    const searchQuery = `${encodeURIComponent(query)}:relevance`;
    const response = await this.apiRequest<ShufersalProductSearchResponse>({
      method: 'GET',
      path: `/search/results?q=${searchQuery}&limit=${String(limit)}&page=${String(page)}`,
    });
    if (!response) {
      throw new Error('Failed to get search results');
    }
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
    const accountOrders = await this.apiRequest<ShufersalAccountOrders>({
      method: 'GET',
      path: '/my-account/orders',
    });
    if (!accountOrders) {
      throw new Error('Failed to get orders');
    }

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

  async getOrderDetails(code: string): Promise<OrderDetails | undefined> {
    const orderDetails = await this.apiRequest<ShufersalOrderDetails>({
      method: 'GET',
      path: `/my-account/orders/${code}`,
    });
    if (!orderDetails) {
      return undefined;
    }

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
    const shufersalCartEntries = items.map((item) =>
      cartItemToShufersalCartItemAdd(item),
    );
    await this.apiRequest({
      method: 'POST',
      path: '/cart/addGrid',
      body: shufersalCartEntries,
    });
  }

  async removeFromCart(productCode: string): Promise<void> {
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

    await this.apiRequest({
      method: 'POST',
      path: `/cart/update?${query.toString()}`,
      body: { quantity: 0 },
    });
  }

  async clearCart(): Promise<void> {
    await this.apiRequest({
      method: 'POST',
      path: '/cart/remove',
    });
  }

  async getCartItems(): Promise<ExistingCartItem[]> {
    const cartItems = await this.apiRequest<ShufersalCartItem[]>({
      method: 'GET',
      path: '/recommendations/entry-recommendations',
    });
    if (!cartItems) {
      return [];
    }
    return cartItems.map(shufersalCartItemToItem);
  }

  async getAvailableTimeSlots(): Promise<DeliveryTimeSlot[]> {
    const response = await this.apiRequest<ShufersalAvailableTimeSlotsResponse>(
      {
        method: 'GET',
        path: '/timeSlot/preselection/getHomeDeliverySlots',
      },
    );
    if (!response) {
      return [];
    }
    return shufersalAvailableTimeslotsResponseToDeliveryTimeslots(response);
  }

  async getSelectedTimeSlot(): Promise<DeliveryTimeSlot | null> {
    const shufersalTimeSlot = await this.apiRequest<
      ShufersalTimeSlot | undefined
    >({
      method: 'GET',
      path: '/timeSlot/preselection/getSelectedTimeslot',
    });
    if (!shufersalTimeSlot || !shufersalTimeSlot.code) {
      return null;
    }
    return shufersalTimeSlotToDeliveryTimeSlot(shufersalTimeSlot);
  }

  async selectTimeSlot(timeSlotCode: string): Promise<void> {
    const availableTimeSlots = await this.getAvailableTimeSlots();
    const timeSlot = availableTimeSlots.find(
      (slot) => slot.code === timeSlotCode,
    );
    if (!timeSlot) {
      throw new Error(`Time slot ${timeSlotCode} not found`);
    }
    await this.apiRequest({
      method: 'POST',
      path: '/timeSlot/preselection/postHomeDeliverySlot',
      body: {
        homeDeliveryTimeSlot: timeSlot.rawData,
      },
    });
  }

  async createOrder(removeMissingItems: boolean): Promise<OrderInfo> {
    const selectedTimeSlot = await this.getSelectedTimeSlot();
    if (!selectedTimeSlot) {
      throw new Error('No time slot selected before creating order');
    }

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

    console.info('createOrder: Navigating to cart summary');
    await this.page.goto(`${WEBAPP_URL}/cart/cartsummary`);

    await this.page.waitForSelector('.miglog-cart-summary-checkoutLink', {
      timeout: 60_000,
      visible: true,
    });
    console.info('createOrder: Starting checkout flow');
    await this.page.click('.miglog-cart-summary-checkoutLink');

    const giftModal = await this.page
      .waitForSelector('#giftProductsModal', {
        visible: true,
        timeout: ACTION_TIMEOUT,
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

    console.info('createOrder: Submitting password');
    await Promise.all([
      this.page.waitForNavigation({
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT,
      }),
      this.page.click('#checkoutPwd button[type="submit"]'),
    ]);
    console.info('createOrder: Password navigation completed');

    const missingProductsModal = await this.page
      .waitForSelector('#missingProducts', {
        visible: true,
        timeout: 5_000,
      })
      .catch(() => null);

    if (missingProductsModal) {
      console.info('createOrder: Dismissing missing products modal');
      await this.page.click('#missingProducts .bottomContainer button');
      await this.page.waitForSelector('#missingProducts', {
        hidden: true,
        timeout: 5_000,
      });
    }

    const over18Checkbox = await this.page
      .waitForSelector('.over-18 .checkboxPic', {
        visible: true,
        timeout: 5_000,
      })
      .catch(() => null);

    if (over18Checkbox) {
      console.info(
        'createOrder: Accepting over-18 checkbox for alcohol/restricted items',
      );
      await this.page.click('.over-18 .checkboxPic');
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    console.info('createOrder: Confirming order');
    await Promise.all([
      this.page.waitForNavigation({
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT,
      }),
      this.page.click('.btnConfirm'),
    ]);
    console.info('createOrder: Order confirmed successfully');

    console.info('createOrder: Waiting for confirmation page to load');
    await this.page.waitForSelector('.orderFunctions .view', {
      visible: true,
      timeout: 10_000,
    });
    console.info('createOrder: Confirmation page loaded');

    console.info('createOrder: Fetching orders to find newly created order');
    const accountOrders = await this.getOrders();
    const matchingOrder = accountOrders.activeOrders.find(
      (order) => order.deliveryDateTime === selectedTimeSlot.dateTime,
    );
    if (!matchingOrder) {
      throw new Error(
        `No active order found with delivery time ${selectedTimeSlot.dateTime} after creating order`,
      );
    }
    return matchingOrder;
  }

  async putOrderInUpdateMode(code: string): Promise<void> {
    await this.apiRequest({
      method: 'GET',
      path: `/cart/cartFromOrder/${code}`,
    });
  }

  async getOrderInUpdateMode(): Promise<string | null> {
    const textContent = await this.page.evaluate(async (url) => {
      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(
          `Request failed with status ${String(response.status)}`,
        );
      }
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      return doc.body.textContent || '';
    }, `${WEBAPP_URL}/cart/load?restoreCart=true`);

    const match = textContent.match(/עדכון הזמנה מס׳ (\d+)/);
    return match ? match[1] : null;
  }

  async sendReceipt(orderNumber: string, email: string): Promise<void> {
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

    await this.apiRequest({
      method: 'POST',
      path: `/emailInvoice/sendEmalInvoice?orderNum=${orderNumber}&email=${encodeURIComponent(email)}`,
      body: { uuid: email },
    });
  }

  async takeScreenshot(): Promise<Buffer> {
    return this.page.screenshot() as Promise<Buffer>;
  }

  async verifySessionAlive(): Promise<void> {
    await this.page.evaluate(() => document.title);
  }

  async serialize(): Promise<SerializedSessionData> {
    const cookies = await this.context.cookies();
    return { cookies };
  }

  async close(): Promise<void> {
    try {
      await this.context.close();
    } catch (error) {
      if (
        error instanceof Error &&
        !error.message.includes('Connection closed') &&
        !error.message.includes('Protocol error')
      ) {
        throw error;
      }
    }
  }

  private async getCSRFToken(): Promise<string> {
    await this.page.waitForFunction(() => window.ACC?.config?.CSRFToken, {
      timeout: 10000,
    });
    const token = await this.page.evaluate(() => window.ACC?.config?.CSRFToken);
    if (!token) {
      throw new Error('CSRFToken not found');
    }
    return token;
  }

  private async apiRequest<T extends object | undefined>(
    config: ApiRequestConfig,
  ) {
    const { method, path, body } = config;
    const csrfToken = method === 'POST' ? await this.getCSRFToken() : undefined;

    const makeRequest = async (): Promise<T | undefined> => {
      const data = await this.page.evaluate(
        async (url, method, body, csrfToken) => {
          const headers: Record<string, string> = {
            'content-type': 'application/json',
          };

          if (csrfToken) {
            headers['csrftoken'] = csrfToken;
          }

          const response = await fetch(url, {
            headers,
            method,
            body: body ? JSON.stringify(body) : undefined,
            mode: 'cors',
            credentials: 'include',
            redirect: 'manual',
          });

          if (
            response.type === 'opaqueredirect' ||
            (response.status >= 300 && response.status < 400)
          ) {
            const location = response.headers.get('location');
            if (location && location.includes('/login')) {
              throw new Error('REDIRECT_TO_LOGIN');
            }
          }

          if (!response.ok) {
            throw new Error(
              `Request failed with status ${String(response.status)}`,
            );
          }

          if (
            response.headers.get('content-type')?.includes('application/json')
          ) {
            return (await response.json()) as T;
          }
          return undefined;
        },
        `${WEBAPP_URL}${path}`,
        method,
        body,
        csrfToken,
      );
      return data as T | undefined;
    };

    try {
      return await makeRequest();
    } catch (error) {
      if (error instanceof Error && error.message === 'REDIRECT_TO_LOGIN') {
        await this.performLogin();
        return await makeRequest();
      }
      throw error;
    }
  }
}
export class ShufersalBot {
  private browser: Browser | undefined;

  constructor(private options: ShufersalBotOptions) {}

  async createSession(
    username: string,
    password: string,
    sessionData?: SerializedSessionData,
  ): Promise<ShufersalSession> {
    const session = await this.initSession(username, password);

    try {
      if (sessionData) {
        await this.restoreSession(session, sessionData);
      } else {
        await session.performLogin();
      }
    } catch (error) {
      if (this.options.takeScreenshotOnErrors && error instanceof Error) {
        let screenshot: Buffer | null = null;
        try {
          screenshot = await session.takeScreenshot();
        } catch (screenshotError) {
          console.warn(
            'Failed to capture screenshot on error:',
            screenshotError,
          );
        }
        throw new ShufersalSessionError(
          error.message,
          error,
          screenshot || undefined,
        );
      }
      throw error;
    }

    if (this.options.takeScreenshotOnErrors) {
      return createSessionProxy(session);
    }

    return session;
  }

  protected async initSession(
    username: string,
    password: string,
  ): Promise<ShufersalSession> {
    const context = await this.createContext();
    const page = await context.newPage();

    return new ShufersalSession(context, page, { username, password });
  }

  async terminate(): Promise<void> {
    if (this.browser && !this.options.browser) {
      await this.browser.close();
      this.browser = undefined;
    }
  }

  static parseReceipt(receiptText: string): ReceiptDetails {
    return parseReceipt(receiptText);
  }

  private async initIfNeeded() {
    if (!this.browser) {
      if (this.options.browser) {
        console.log('Using externally provided browser instance');
        this.browser = this.options.browser;
      } else if (this.options.browserWSEndpoint) {
        console.log(
          'Connecting to remote Chrome at:',
          this.options.browserWSEndpoint,
        );
        this.browser = await puppeteer.connect({
          browserWSEndpoint: this.options.browserWSEndpoint,
        });
      } else {
        console.log(
          'Launching local Chrome from:',
          this.options.executablePath,
        );
        this.browser = await puppeteer.launch({
          executablePath: this.options.executablePath,
          headless: 'headless' in this.options ? this.options.headless : true,
          args: this.options.chromiumArgs,
        });
      }
    }
  }

  private async createContext() {
    await this.initIfNeeded();
    assert(this.browser);

    const context = await this.browser.createBrowserContext();
    return context;
  }

  protected async restoreSession(
    session: ShufersalSession,
    sessionData: SerializedSessionData,
  ): Promise<void> {
    const context = session.browserContext;
    const page = session.browserPage;

    for (const cookie of sessionData.cookies as Array<
      Parameters<BrowserContext['setCookie']>[0]
    >) {
      await context.setCookie(cookie);
    }

    await page.goto(WEBAPP_URL, {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT,
    });
  }
}
