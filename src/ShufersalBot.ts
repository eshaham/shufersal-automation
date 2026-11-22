import {
  AccountOrders,
  CartItemToAdd,
  CartItemToRemove,
  CartModification,
  CartMutationResult,
  CartState,
  CreateOrderOptions,
  DeliveryTimeSlot,
  ExistingCartItem,
  ItemDetails,
  OrderDetails,
  OrderInfo,
  OrderLookupOptions,
  OrderStatus,
  Product,
  PromotionInfo,
  ReceiptDetails,
  ScrapedPromotionDetails,
  SearchResults,
  SellingMethod,
  SerializedSessionData,
  ShufersalAccountOrders,
  ShufersalAvailableTimeSlotsResponse,
  ShufersalBase,
  ShufersalCartEntryModify,
  ShufersalCartItemAdd,
  ShufersalCheckoutAuthResponse,
  ShufersalCheckoutEntry,
  ShufersalComposedCheckout,
  ShufersalOrder,
  ShufersalOrderDetails,
  ShufersalOrderEntry,
  ShufersalPlaceOrderResponse,
  ShufersalProduct,
  ShufersalProductImage,
  ShufersalProductSearchResponse,
  ShufersalProductSearchResult,
  ShufersalSellingMethod,
  ShufersalTimeSlot,
} from '~/types';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { parse as parseHtml } from 'node-html-parser';
import puppeteer, {
  Browser,
  BrowserContext,
  CookieData,
  Page,
} from 'puppeteer-core';

import { barcodeFromShufersalCode, shufersalSearchQueries } from './barcode';
import {
  parseCartHtml,
  parseOrderCodeFromConfirmation,
  RawCartPage,
  rawCartPageToCartMutationResult,
} from './cartParser';
import { findProductsByBarcodes } from './core/barcodes';
import { CookieJar } from './core/CookieJar';
import type {
  BarcodeLookupSupport,
  GrocerySession,
  OrderCancelSupport,
  OrderUpdateSupport,
  PromotionLookupSupport,
  ReceiptEmailSupport,
} from './core/GrocerySession';
import {
  HttpBlockedError,
  ResponseFormat as HttpResponseFormat,
  HttpStatusError,
  HttpTransport,
  HttpTransportOptions,
  LoginRedirectError,
} from './core/HttpTransport';
import { createSessionProxy } from './core/SessionProxy';
import { extractPromotionInfo } from './promotions';
import { parseReceipt } from './receiptParser';
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

export class PendingCartMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PendingCartMergeError';
  }
}

export class SessionExpiredError extends Error {
  constructor(message = 'Persisted session has expired') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export class LoginTimeoutError extends Error {
  constructor(message = 'Login timeout') {
    super(message);
    this.name = 'LoginTimeoutError';
  }
}

export type SessionTransport = 'http' | 'browser';

interface ShufersalBotOptions {
  browser?: Browser | (() => Promise<Browser>);
  executablePath?: string;
  browserWSEndpoint?: string;
  headless?: boolean;
  chromiumArgs?: string[];
  takeScreenshotOnErrors?: boolean;
  transport?: SessionTransport;
  fetch?: typeof fetch;
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
    PayMe?: {
      clientData: (isTestMode: boolean) => Promise<{ hash?: string }>;
    };
    miglog?: {
      showMergeCarts?: boolean;
    };
  }
}

type ResponseFormat = Exclude<HttpResponseFormat, 'html'> | 'cart';

function changedCartQuantities(
  before: ExistingCartItem[],
  after: ExistingCartItem[],
): string[] {
  const quantityIn = (items: ExistingCartItem[], productCode: string): number =>
    items.find((item) => item.productCode === productCode)?.quantity ?? 0;
  const productCodes = Array.from(
    new Set<string>([...before, ...after].map((item) => item.productCode)),
  );
  return productCodes
    .filter(
      (productCode) =>
        quantityIn(before, productCode) !== quantityIn(after, productCode),
    )
    .map(
      (productCode) =>
        `${productCode} ${String(quantityIn(before, productCode))}→${String(quantityIn(after, productCode))}`,
    );
}

const SHUFERSAL_HTTP_OPTIONS: HttpTransportOptions = {
  csrfHeaderName: 'csrftoken',
  isLoginRedirect: (location) => location.includes('/login'),
};

export const BASE_URL = 'https://www.shufersal.co.il';
export const WEBAPP_URL = `${BASE_URL}/online/he`;

const NAVIGATION_TIMEOUT = 30_000;
const CART_PATH = '/cart/load?restoreCart=true';
const SESSION_PAGE_PATH = '/wish-lists/main';
const CSRF_REFRESH_PATH = '/timeSlot/preselection/getSelectedTimeslot';
const CSRF_COOKIE = 'XSRF-TOKEN';

function stripCategoryCodePrefix(
  category: ShufersalBase | null,
): ShufersalBase | null {
  if (!category) {
    return null;
  }

  const name = category.name.replace(/^\d+-/, '');

  return {
    code: category.code,
    name,
  };
}

function extractImageUrl(images?: ShufersalProductImage[]): string | undefined {
  if (!images || images.length === 0) {
    return undefined;
  }

  const largeImage = images.find(
    (img) => img.format === 'large' && img.galleryIndex === 0,
  );

  return largeImage?.url;
}

function shufersalProductSearchResultToProduct(
  result: ShufersalProductSearchResult,
): Product {
  const sellingMethod =
    result.sellingMethod?.code === ShufersalSellingMethod.Unit
      ? SellingMethod.Unit
      : SellingMethod.Weight;

  const mainCategory = stripCategoryCodePrefix(result.commercialCategoryGroup);
  const subCategory = stripCategoryCodePrefix(
    result.commercialCategorySubGroup,
  );

  const promotionCodes =
    result.promotionCodes?.filter(Boolean) ??
    result.promotions?.filter(Boolean) ??
    [];

  const effectivePrice = result.effectivePrice ?? result.price.value;

  return {
    code: result.code,
    name: result.name,
    description: result.description,
    brand: result.brand,
    mainCategory,
    subCategory,
    sellingMethod,
    imageUrl: extractImageUrl(result.images),
    inStock: result.stock.stockLevelStatus.code === 'inStock',
    purchasable: result.purchasable ?? true,
    price: effectivePrice,
    formattedPrice: result.price.formattedValue,
    priceWithoutDiscount: result.price.value,
    depositPrice: result.depositPrice ?? undefined,
    promotionCodes,
    barcode: barcodeFromShufersalCode(result.code),
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
    mainCategory: stripCategoryCodePrefix(product.commercialCategoryGroup),
    subCategory: stripCategoryCodePrefix(product.commercialCategorySubGroup),
    sellingMethod:
      product.sellingMethod.code === ShufersalSellingMethod.Unit
        ? SellingMethod.Unit
        : SellingMethod.Weight,
    imageUrl: extractImageUrl(product.images),
    inStock: product.stock.stockLevelStatus.code === 'inStock',
    purchasable: product.showOnSite || product.showOnMobile,
    price: product.effectivePrice,
    formattedPrice: product.price.formattedValue,
    priceWithoutDiscount: product.price.value,
    depositPrice: product.depositPrice ?? undefined,
    promotionCodes: product.promotionCodes,
    barcode: barcodeFromShufersalCode(product.code),
    rawData: product,
  };
}

const GRAMS_PER_KG = 1000;

export function shufersalOrderEntryToItem(
  entry: ShufersalOrderEntry,
): ItemDetails {
  let quantity = entry.quantity;
  let basePrice = entry.basePrice.value;
  const product = shufersalProductToProduct(entry.product);
  const isPacked =
    entry.product.sellingMethod.code === ShufersalSellingMethod.Package &&
    !!entry.product.weightConversion;
  if (isPacked && entry.product.weightConversion) {
    product.sellingMethod = SellingMethod.Unit;
    quantity = entry.quantity / entry.product.weightConversion;
    basePrice = (basePrice * entry.product.weightConversion) / GRAMS_PER_KG;
  }

  let basePricePerUnit = Math.round(basePrice * 100) / 100;
  let actualPricePerUnit: number;
  let discountAmount: number | undefined;

  if (entry.priceAfterDiscount != null) {
    actualPricePerUnit = parseFloat(
      (entry.priceAfterDiscount / quantity).toFixed(2),
    );
    discountAmount = entry.discount ?? entry.itemDiscount ?? undefined;
  } else {
    actualPricePerUnit = parseFloat(
      (entry.totalPrice.value / quantity).toFixed(2),
    );
    if (isPacked) {
      basePricePerUnit = actualPricePerUnit;
    }
  }

  const promotions: PromotionInfo[] = (entry.promotionOrderEntries || [])
    .filter((p) => p.fired)
    .map((p) =>
      extractPromotionInfo(p, basePricePerUnit, actualPricePerUnit, quantity),
    );

  const outOfStock =
    entry.basePrice.value === 0 && entry.product.price.value > 0;

  return {
    productCode: entry.product.code,
    product,
    quantity,
    pricePerUnit: actualPricePerUnit,
    basePricePerUnit,
    actualPricePerUnit,
    discountAmount,
    depositPrice: entry.product.depositPrice,
    promotions,
    outOfStock,
    rawData: entry,
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

function cartEntryToShufersalRemoval(
  entry: CartEntryToRemove,
): ShufersalCartEntryModify {
  return {
    productCode: entry.productCode,
    frontQuantity: 0,
    sellingMethod: ShufersalSellingMethod.Unit,
    comment: '',
    entry: entry.entryNumber,
    affiliateCode: '',
  };
}

function unavailableCartModification(
  productCode: string,
  product: Product | null,
): CartModification {
  return {
    productCode,
    statusCode: product && !product.inStock ? 'noStock' : 'unavailable',
    entryNumber: null,
    quantity: 0,
    rawData: {},
  };
}

function getConfirmationExcerpt(html: string): string {
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
  const index = text.indexOf('הזמנה');
  const start = index === -1 ? 0 : Math.max(0, index - 100);
  return JSON.stringify(text.slice(start, start + 300));
}

function getOrderConfirmationPath(
  response: ShufersalPlaceOrderResponse | undefined,
): string {
  if (!response) {
    throw new Error('Order placement failed: empty response');
  }
  if (Array.isArray(response)) {
    const errors = response
      .map((error) => error.errorCode ?? error.code ?? error.type ?? 'unknown')
      .join(', ');
    throw new Error(`Order placement failed: ${errors}`);
  }
  if (response.success && response.redirect) {
    return response.redirect;
  }
  if (response.allocationTimeout) {
    throw new Error('Order placement failed: allocation timeout');
  }
  if (response.otherCreditCard3DSLink || response.directCreditCard3DSLink) {
    throw new Error(
      'Order placement failed: credit card requires 3D Secure verification',
    );
  }
  throw new Error(`Order placement failed: ${JSON.stringify(response)}`);
}

interface CheckoutConfig {
  threeDSecureEnabled: boolean;
  threeDSecureTestMode: boolean;
  paymeScriptUrls: string[];
}

interface ApiRequestConfig {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: unknown;
  form?: Record<string, string>;
}

interface RawPage {
  url: string;
  html: string;
}

export interface CartEntryOptions {
  entryNumber?: number;
}

export type CartEntryToRemove = Required<CartItemToRemove>;

function isCheckoutEntryOutOfStock(entry: ShufersalCheckoutEntry): boolean {
  return (
    entry.outOfStock === true ||
    entry.product.stock.stockLevelStatus.code === 'outOfStock'
  );
}

export interface BrowserPage {
  context: BrowserContext;
  page: Page;
}

export type BrowserPageFactory = () => Promise<BrowserPage>;

export interface ShufersalSessionOptions {
  cookies?: CookieData[];
  transport?: SessionTransport;
  fetch?: typeof fetch;
}

export class ShufersalSession
  implements
    GrocerySession,
    OrderCancelSupport,
    OrderUpdateSupport,
    ReceiptEmailSupport,
    PromotionLookupSupport,
    BarcodeLookupSupport
{
  private csrfToken: string | undefined;
  private browser: BrowserPage | undefined;
  private browserOpening: Promise<BrowserPage> | undefined;
  private transport: SessionTransport;
  private readonly jar: CookieJar;
  private readonly http: HttpTransport;

  constructor(
    private openBrowser: BrowserPageFactory,
    private credentials: ShufersalCredentials,
    options: ShufersalSessionOptions = {},
  ) {
    this.transport = options.transport ?? 'browser';
    this.jar = new CookieJar(options.cookies);
    this.http = new HttpTransport(
      this.jar,
      options.fetch,
      SHUFERSAL_HTTP_OPTIONS,
    );
  }

  get activeTransport(): SessionTransport {
    return this.transport;
  }

  get browserPage(): Page {
    return this.page;
  }

  get browserContext(): BrowserContext {
    if (!this.browser) {
      throw new Error('No browser page is open for this session');
    }
    return this.browser.context;
  }

  loadCookies(cookies: CookieData[]): void {
    this.jar.replaceAll(cookies);
  }

  async openBrowserPage(): Promise<BrowserPage> {
    return this.ensureBrowser();
  }

  get hasBrowser(): boolean {
    return this.browser !== undefined;
  }

  private get page(): Page {
    if (!this.browser) {
      throw new Error('No browser page is open for this session');
    }
    return this.browser.page;
  }

  private async ensureBrowser(): Promise<BrowserPage> {
    if (this.browser) {
      return this.browser;
    }
    this.browserOpening ??= (async () => {
      const opened = await this.openBrowser();
      opened.page.on('framenavigated', (frame) => {
        if (frame === opened.page.mainFrame()) {
          this.csrfToken = undefined;
        }
      });
      this.browser = opened;
      return opened;
    })();
    try {
      return await this.browserOpening;
    } finally {
      this.browserOpening = undefined;
    }
  }

  private async loadSessionPageInBrowser(): Promise<boolean> {
    const { context, page } = await this.ensureBrowser();
    const cookies = this.jar.toCookieData();
    if (cookies.length > 0) {
      await context.setCookie(...cookies);
    }
    await page.goto(`${WEBAPP_URL}${SESSION_PAGE_PATH}`, {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT,
    });
    return (
      !page.url().includes('/login') &&
      (await page.evaluate(
        () => document.querySelector('.title-notAnonymous') !== null,
      ))
    );
  }

  private async syncCookiesFromBrowser(): Promise<void> {
    if (this.browser) {
      this.jar.replaceAll(await this.browser.context.cookies());
    }
  }

  async restore(): Promise<void> {
    if (this.transport === 'http') {
      return;
    }
    if (!(await this.loadSessionPageInBrowser())) {
      throw new SessionExpiredError();
    }
  }

  private async switchToBrowser(): Promise<void> {
    if (!(await this.loadSessionPageInBrowser())) {
      await this.performLogin();
    }
    this.transport = 'browser';
  }

  private async withBrowserTransport<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.transport;
    if (previous === 'http') {
      await this.switchToBrowser();
    }
    try {
      return await work();
    } finally {
      if (previous === 'http') {
        await this.syncCookiesFromBrowser();
        this.transport = 'http';
      }
    }
  }

  async performLogin(): Promise<void> {
    await this.ensureBrowser();
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

    // POST requests sent from the page rendered right after login fail with 405 until it is reloaded
    await this.page.reload({
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT,
    });
    await this.syncCookiesFromBrowser();
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
    const productDetails = await this.apiRequest<ShufersalProduct>({
      method: 'GET',
      path: `/products/${productCode}`,
    });

    if (!productDetails) {
      return null;
    }

    return shufersalProductToProduct(productDetails);
  }

  getProductsByBarcodes(barcodes: string[]): Promise<Map<string, Product>> {
    return findProductsByBarcodes(
      (query, limit) => this.searchProducts(query, limit),
      barcodes,
      shufersalSearchQueries,
    );
  }

  async getOrders(options?: OrderLookupOptions): Promise<AccountOrders> {
    const accountOrders = await this.apiRequest<ShufersalAccountOrders>({
      method: 'GET',
      path: '/my-account/orders',
    });
    if (!accountOrders) {
      throw new Error('Failed to get orders');
    }

    const orderInUpdateMode = options?.detectUpdateMode
      ? await this.getOrderInUpdateMode()
      : null;
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

  async getOrderDetails(
    code: string,
    options?: { getFullPromotionData?: boolean } & OrderLookupOptions,
  ): Promise<OrderDetails | undefined> {
    const orderDetails = await this.apiRequest<ShufersalOrderDetails>({
      method: 'GET',
      path: `/my-account/orders/${code}`,
    });
    if (!orderDetails) {
      return undefined;
    }

    const orderInUpdateMode = options?.detectUpdateMode
      ? await this.getOrderInUpdateMode()
      : null;
    const isBeingUpdated = orderInUpdateMode === code;

    const order = shufersalAccountOrderToOrderInfo(
      orderDetails,
      isBeingUpdated,
    );

    const items = orderDetails.entries.map(shufersalOrderEntryToItem);

    if (options?.getFullPromotionData) {
      const promotionCache = new Map<string, ScrapedPromotionDetails>();
      const productFallbackCache = new Map<
        string,
        ScrapedPromotionDetails | null
      >();

      for (const item of items) {
        for (const promotion of item.promotions) {
          let details = promotionCache.get(promotion.code);
          if (!details) {
            details =
              (await this.getPromotionDetails(promotion.code)) ?? undefined;
          }
          if (!details) {
            if (!productFallbackCache.has(item.productCode)) {
              productFallbackCache.set(
                item.productCode,
                await this.getPromotionsByProduct(item.productCode),
              );
            }
            details = productFallbackCache.get(item.productCode) ?? undefined;
          }
          if (details) {
            promotionCache.set(promotion.code, details);
            promotion.participatingProducts = details.eligibleProductCodes
              ? Array.from(new Set(details.eligibleProductCodes))
              : undefined;
          }
        }
      }
    }

    return {
      ...order,
      items,
      rawData: orderDetails,
    };
  }

  async addToCart(items: CartItemToAdd[]): Promise<CartMutationResult> {
    try {
      return await this.addGridRequest(items);
    } catch (error) {
      const unavailable = await this.findUnavailableItems(items, error);
      if (unavailable.length === 0) {
        throw error;
      }

      const unavailableCodes = new Set(
        unavailable.map((modification) => modification.productCode),
      );
      console.warn(
        `[shufersal] cart/addGrid failed with unavailable items ${unavailable.map((modification) => modification.productCode).join(', ')}; adding the rest without them`,
      );
      const availableItems = items.filter(
        (item) => !unavailableCodes.has(item.productCode),
      );
      const result =
        availableItems.length > 0
          ? await this.addGridRequest(availableItems)
          : { ...(await this.getCartState()), modifications: [] };
      return {
        ...result,
        modifications: [...result.modifications, ...unavailable],
      };
    }
  }

  private async addGridRequest(
    items: CartItemToAdd[],
  ): Promise<CartMutationResult> {
    return this.cartRequest({
      method: 'POST',
      path: '/cart/addGrid',
      body: items.map(cartItemToShufersalCartItemAdd),
    });
  }

  private async findUnavailableItems(
    items: CartItemToAdd[],
    addError: unknown,
  ): Promise<CartModification[]> {
    let products: (Product | null)[];
    try {
      products = await Promise.all(
        items.map((item) => this.getProductByCode(item.productCode)),
      );
    } catch (lookupError) {
      console.warn(
        `[shufersal] could not check stock after cart/addGrid failed: ${lookupError instanceof Error ? lookupError.message : String(lookupError)}`,
      );
      throw addError;
    }

    return items.flatMap((item, index) => {
      const product = products[index];
      return product?.inStock && product.purchasable
        ? []
        : [unavailableCartModification(item.productCode, product)];
    });
  }

  async setCartItemQuantities(
    items: CartItemToAdd[],
  ): Promise<CartMutationResult> {
    const itemsToSet = items.filter((item) => item.quantity > 0);
    const productCodesToRemove = items
      .filter((item) => item.quantity <= 0)
      .map((item) => item.productCode);

    let result =
      itemsToSet.length > 0
        ? await this.addToCart(itemsToSet)
        : await this.getCartState().then((state) => ({
            ...state,
            modifications: [],
          }));
    const modifications = [...result.modifications];

    const entriesToRemove = result.items.filter((item) =>
      productCodesToRemove.includes(item.productCode),
    );
    if (entriesToRemove.length > 0) {
      result = await this.removeItemsFromCart(entriesToRemove);
      modifications.push(...result.modifications);
    }

    return { ...result, modifications };
  }

  async removeItemsFromCart(
    items: CartItemToRemove[],
  ): Promise<CartMutationResult> {
    const entries = await this.cartEntriesToRemove(items);
    if (entries.length === 0) {
      const state = await this.getCartState();
      return { ...state, modifications: [] };
    }

    const query = new URLSearchParams({
      'cartContext[openFrom]': 'CART',
      'cartContext[recommendationType]': 'REGULAR',
    });
    const result = await this.cartRequest({
      method: 'POST',
      path: `/cart/modify?${query.toString()}`,
      body: entries.map(cartEntryToShufersalRemoval),
    });

    const productCodes = new Set(entries.map((entry) => entry.productCode));
    const notRemoved = result.items
      .filter((item) => productCodes.has(item.productCode))
      .map((item) => item.productCode);
    if (notRemoved.length > 0) {
      throw new Error(
        `Shufersal did not remove cart items: ${notRemoved.join(', ')}`,
      );
    }

    return result;
  }

  private async cartEntriesToRemove(
    items: CartItemToRemove[],
  ): Promise<CartEntryToRemove[]> {
    const withEntryNumbers = items.filter(
      (item): item is CartEntryToRemove => item.entryNumber !== undefined,
    );
    if (withEntryNumbers.length === items.length) {
      return withEntryNumbers;
    }
    const productCodes = new Set(items.map((item) => item.productCode));
    const cartItems = await this.getCartItems();
    return cartItems
      .filter((item) => productCodes.has(item.productCode))
      .map(({ productCode, entryNumber }) => ({ productCode, entryNumber }));
  }

  async updateCartItemQuantity(
    productCode: string,
    quantity: number,
    options?: CartEntryOptions,
  ): Promise<CartMutationResult> {
    let entryNumber = options?.entryNumber;
    if (entryNumber === undefined) {
      const cartItems = await this.getCartItems();
      const cartItem = cartItems.find(
        (item) => item.productCode === productCode,
      );
      if (!cartItem) {
        throw new Error(`Product ${productCode} not found in cart`);
      }
      entryNumber = cartItem.entryNumber;
    }

    const query = new URLSearchParams({
      entryNumber: entryNumber.toString(),
      qty: quantity.toString(),
      'cartContext[openFrom]': 'CART',
      'cartContext[recommendationType]': 'REGULAR',
    });

    if (quantity === 0) {
      query.set('cartContext[action]', 'remove');
    }

    return this.cartRequest({
      method: 'POST',
      path: `/cart/update?${query.toString()}`,
      body: { quantity },
    });
  }

  async removeFromCart(
    productCode: string,
    options?: CartEntryOptions,
  ): Promise<CartMutationResult> {
    return this.updateCartItemQuantity(productCode, 0, options);
  }

  async clearCart(): Promise<void> {
    await this.apiRequest({
      method: 'POST',
      path: '/cart/remove',
    });
  }

  async getCartState(): Promise<CartState> {
    const { items, orderInUpdateMode } = await this.cartRequest({
      method: 'GET',
      path: CART_PATH,
    });
    return { items, orderInUpdateMode };
  }

  async getCartItems(): Promise<ExistingCartItem[]> {
    const { items } = await this.getCartState();
    return items;
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
    if (!shufersalTimeSlot?.code) {
      return null;
    }
    return shufersalTimeSlotToDeliveryTimeSlot(shufersalTimeSlot);
  }

  async selectTimeSlot(
    timeSlotOrCode: string | DeliveryTimeSlot,
  ): Promise<void> {
    let timeSlot: DeliveryTimeSlot | undefined;
    if (typeof timeSlotOrCode === 'string') {
      const availableTimeSlots = await this.getAvailableTimeSlots();
      timeSlot = availableTimeSlots.find(
        (slot) => slot.code === timeSlotOrCode,
      );
      if (!timeSlot) {
        throw new Error(`Time slot ${timeSlotOrCode} not found`);
      }
    } else {
      timeSlot = timeSlotOrCode;
    }
    await this.apiRequest({
      method: 'POST',
      path: '/timeSlot/preselection/postHomeDeliverySlot',
      body: {
        homeDeliveryTimeSlot: timeSlot.rawData,
      },
    });
  }

  async createOrder({
    removeMissingItems,
    mergePendingCart = false,
  }: CreateOrderOptions): Promise<OrderInfo> {
    return this.withBrowserTransport(() =>
      this.placeOrder(removeMissingItems, mergePendingCart),
    );
  }

  private async placeOrder(
    removeMissingItems: boolean,
    mergePendingCart: boolean,
  ): Promise<OrderInfo> {
    await this.resolvePendingCartMerge(mergePendingCart);

    console.info('createOrder: Authenticating checkout');
    const checkoutConfig = await this.authenticateCheckout();

    let checkout = await this.getComposedCheckout();
    const timeSlotStartTime =
      checkout.directCart.consignments?.[0]?.timeSlotStartTime;
    if (!timeSlotStartTime) {
      throw new Error('No time slot selected before creating order');
    }

    const missingEntries = checkout.directCart.entries.filter(
      isCheckoutEntryOutOfStock,
    );
    if (missingEntries.length > 0) {
      const missingProductCodes = missingEntries.map(
        (entry) => entry.product.code,
      );
      if (!removeMissingItems) {
        throw new Error(
          `Missing items in cart: ${missingProductCodes.join(', ')}`,
        );
      }
      console.info(
        `createOrder: Removing ${String(missingProductCodes.length)} out-of-stock items`,
      );
      checkout = await this.removeOutOfStockCheckoutEntries(missingEntries);
    }

    const requiresAgeVerification = await this.apiRequest<boolean>({
      method: 'GET',
      path: '/checkout/adultCheck/shouldCheckIfAdult',
    });
    if (requiresAgeVerification) {
      console.info('createOrder: Confirming age for restricted items');
      await this.apiRequest({
        method: 'POST',
        path: '/checkout/adultCheck/setAdultsOnlyAllowed',
        form: { load: 'true' },
      });
    }

    const jwtPayme = await this.getPaymeClientHash(checkoutConfig);

    console.info('createOrder: Placing order');
    const response = await this.apiRequest<ShufersalPlaceOrderResponse>({
      method: 'GET',
      path: `/checkout/placeOrder?jwtPayme=${jwtPayme}&after3ds=false`,
    });
    const confirmationPath = getOrderConfirmationPath(response);
    console.info('createOrder: Order placed successfully');

    const deliveryDateTime = new Date(timeSlotStartTime).toISOString();
    const confirmedOrder = await this.getConfirmedOrder(
      confirmationPath,
      deliveryDateTime,
    );
    if (confirmedOrder) {
      return confirmedOrder;
    }

    const accountOrders = await this.getOrders();
    const matchingOrder = accountOrders.activeOrders.find(
      (order) => order.deliveryDateTime === deliveryDateTime,
    );
    if (!matchingOrder) {
      throw new Error(
        `No active order found with delivery time ${deliveryDateTime} after creating order`,
      );
    }
    return matchingOrder;
  }

  private async getConfirmedOrder(
    confirmationPath: string,
    deliveryDateTime: string,
  ): Promise<OrderInfo | null> {
    let confirmationPage: RawPage | undefined;
    try {
      confirmationPage = await this.pageRequest(confirmationPath);
    } catch (error) {
      console.warn(
        `createOrder: Could not load ${confirmationPath}, falling back to the order list`,
        error,
      );
      return null;
    }
    if (!confirmationPage) {
      console.warn(
        `createOrder: Empty response from ${confirmationPath}, falling back to the order list`,
      );
      return null;
    }

    const orderCode = parseOrderCodeFromConfirmation(
      confirmationPage.url,
      confirmationPage.html,
    );
    if (!orderCode) {
      console.warn(
        `createOrder: Could not find the order code on ${confirmationPage.url} (${String(confirmationPage.html.length)} chars), falling back to the order list. Page excerpt: ${getConfirmationExcerpt(confirmationPage.html)}`,
      );
      return null;
    }

    const orderDetails = await this.apiRequest<ShufersalOrderDetails>({
      method: 'GET',
      path: `/my-account/orders/${orderCode}`,
    });
    if (!orderDetails) {
      console.warn(
        `createOrder: Could not load order ${orderCode}, falling back to the order list`,
      );
      return null;
    }
    const order = shufersalAccountOrderToOrderInfo(orderDetails);
    if (order.deliveryDateTime !== deliveryDateTime) {
      console.warn(
        `createOrder: Order ${orderCode} from the confirmation page is for ${order.deliveryDateTime}, expected ${deliveryDateTime}, falling back to the order list`,
      );
      return null;
    }
    return order;
  }

  async putOrderInUpdateMode(code: string): Promise<void> {
    await this.apiRequest({
      method: 'GET',
      path: `/cart/cartFromOrder/${code}`,
    });
  }

  async getOrderInUpdateMode(): Promise<string | null> {
    const { orderInUpdateMode } = await this.getCartState();
    return orderInUpdateMode;
  }

  async cancelOrder(code: string): Promise<void> {
    const { activeOrders } = await this.getOrders();
    const order = activeOrders.find((o) => o.code === code);
    if (!order) {
      throw new Error(`Order ${code} is not an active order`);
    }
    if (!order.isCancelable) {
      throw new Error(`Order ${code} can no longer be cancelled`);
    }

    await this.sendRequest(
      { method: 'DELETE', path: `/my-account/orders/${code}` },
      'text',
    );

    const after = await this.getOrders();
    const stillActive = after.activeOrders.find((o) => o.code === code);
    if (stillActive && stillActive.status !== OrderStatus.Canceled) {
      throw new Error(`Shufersal did not cancel order ${code}`);
    }
  }

  async sendReceipt(orderNumber: string, email: string): Promise<void> {
    const orders = await this.getOrders();
    const allOrders = [...orders.activeOrders, ...orders.closedOrders];
    const order = allOrders.find((o) => o.code === orderNumber);

    if (!order) {
      throw new Error(`Order ${orderNumber} not found`);
    }

    if (order.status === OrderStatus.Active) {
      throw new Error(
        `Cannot send receipt for order ${orderNumber}: order has not been shipped yet`,
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

  async takePageContent(): Promise<string> {
    const cdp = await this.page.createCDPSession();
    try {
      const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
      const { outerHTML } = await cdp.send('DOM.getOuterHTML', {
        nodeId: root.nodeId,
      });
      return outerHTML;
    } finally {
      await cdp.detach();
    }
  }

  async verifySessionAlive(): Promise<void> {
    if (this.transport === 'http') {
      await this.apiRequest({ method: 'GET', path: CSRF_REFRESH_PATH });
      return;
    }
    await this.page.evaluate(() => document.title);
  }

  async serialize(): Promise<SerializedSessionData> {
    if (this.transport === 'browser') {
      await this.syncCookiesFromBrowser();
    }
    return { cookies: this.jar.toCookieData() };
  }

  async getPromotionDetails(
    promotionCode: string,
  ): Promise<ScrapedPromotionDetails | null> {
    const html = (await this.sendRequest(
      { method: 'GET', path: `/promotionPopup/${promotionCode}` },
      'text',
    )) as string | undefined;
    if (html === undefined) {
      return null;
    }

    const result: ScrapedPromotionDetails = {};

    const priceMatches = html.match(/(\d+\.?\d*)\s*₪/g);
    if (priceMatches && priceMatches.length >= 2) {
      result.regularPrice = parseFloat(priceMatches[0]);
      result.promotionalPrice = parseFloat(priceMatches[1]);
    }

    const dateMatch = html.match(/עד\s*(\d{2}\/\d{2}\/\d{2,4})/);
    if (dateMatch) {
      const [day, month, year] = dateMatch[1].split('/');
      const fullYear = year.length === 2 ? `20${year}` : year;
      result.validUntil = new Date(`${fullYear}-${month}-${day}`);
    }

    const productCodes = parseHtml(html)
      .querySelectorAll('[data-product-code]')
      .map((el) => el.getAttribute('data-product-code'))
      .filter((code): code is string => code !== undefined);
    if (productCodes.length > 0) {
      result.eligibleProductCodes = productCodes;
    }

    return result;
  }

  async getPromotionsByProduct(
    productCode: string,
  ): Promise<ScrapedPromotionDetails | null> {
    const text = (await this.sendRequest(
      { method: 'GET', path: `/promotions/addAndSave/${productCode}` },
      'text',
    )) as string | undefined;
    if (!text) {
      return null;
    }

    let data: {
      htmlFragment?: string;
      product?: {
        code?: string;
        price?: { value?: number };
      };
    };
    try {
      data = JSON.parse(text) as typeof data;
    } catch {
      return null;
    }

    const result: ScrapedPromotionDetails = {};

    if (data.product?.price?.value) {
      result.regularPrice = data.product.price.value;
    }

    if (data.htmlFragment) {
      const priceMatch = data.htmlFragment.match(/(\d+)\s*<span[^>]*>\s*₪/);
      if (priceMatch) {
        result.promotionalPrice = parseFloat(priceMatch[1]);
      }

      const dateMatch = data.htmlFragment.match(
        /בתוקף עד\s*(\d{2})\/(\d{2})\/(\d{4})/,
      );
      if (dateMatch) {
        const [, day, month, year] = dateMatch;
        result.validUntil = new Date(`${year}-${month}-${day}`);
      }
    }

    if (data.product?.code) {
      result.eligibleProductCodes = [data.product.code.replace(/^P_/, '')];
    }

    return result;
  }

  async close(): Promise<void> {
    if (!this.browser) {
      return;
    }
    try {
      await this.browser.context.close();
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

  private async resolvePendingCartMerge(
    mergePendingCart: boolean,
  ): Promise<void> {
    const mergePending = await this.page.evaluate(
      () => window.miglog?.showMergeCarts === true,
    );
    if (!mergePending) {
      return;
    }
    if (!mergePendingCart) {
      throw new PendingCartMergeError(
        'Shufersal is asking whether to merge the cart from before sign-in',
      );
    }

    console.info(
      'createOrder: Keeping the cart built before Shufersal asked to merge carts',
    );
    const before = await this.getCartState();
    await this.page.evaluate(async (url) => {
      const response = await fetch(url, {
        credentials: 'include',
        headers: { 'x-requested-with': 'XMLHttpRequest' },
      });
      if (!response.ok) {
        throw new Error(
          `Cart merge failed with status ${String(response.status)}`,
        );
      }
      if (window.miglog) {
        window.miglog.showMergeCarts = false;
      }
    }, `${WEBAPP_URL}/cart/merge?toMerge=true`);
    const after = await this.getCartState();

    const changed = changedCartQuantities(before.items, after.items);
    if (changed.length > 0) {
      throw new PendingCartMergeError(
        `Merging carts changed the cart, not placing the order: ${changed.join(', ')}`,
      );
    }
  }

  private async authenticateCheckout(): Promise<CheckoutConfig> {
    const authForm = await this.page.evaluate(async (url) => {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) {
        throw new Error(
          `Failed to load checkout password form: ${String(response.status)}`,
        );
      }
      const doc = new DOMParser().parseFromString(
        await response.text(),
        'text/html',
      );
      const form = doc.querySelector('form#checkoutPwd');
      if (!form) {
        return null;
      }
      const fields: Record<string, string> = {};
      form.querySelectorAll('input').forEach((input) => {
        if (input.name) {
          fields[input.name] = input.value;
        }
      });
      return {
        fields,
        verifyPath: form.getAttribute('action'),
        submitPath: form.getAttribute('data-action2'),
      };
    }, `${WEBAPP_URL}/cart/checkout/auth?redirect_url=%2Fcheckout&checkout_flow=true`);

    if (!authForm?.verifyPath || !authForm.submitPath) {
      throw new Error('Checkout password form not found');
    }
    if (authForm.fields['strongAuth'] === 'true') {
      throw new Error('Checkout requires OTP verification');
    }

    const fields = {
      ...authForm.fields,
      j_password: this.credentials.password,
    };

    const verification = await this.page.evaluate(
      async (url, fields) => {
        const response = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'x-requested-with': 'XMLHttpRequest',
          },
          body: new URLSearchParams(fields).toString(),
        });
        if (!response.ok) {
          throw new Error(
            `Checkout password verification failed with status ${String(response.status)}`,
          );
        }
        return (await response.json()) as ShufersalCheckoutAuthResponse;
      },
      `${BASE_URL}${authForm.verifyPath}`,
      fields,
    );
    if (!verification.success) {
      throw new Error(
        `Checkout password verification failed: ${verification.message ?? 'unknown reason'}`,
      );
    }

    const checkoutPage = await this.page.evaluate(
      async (url, fields) => {
        const response = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(fields).toString(),
        });
        const html = await response.text();
        const csrfToken = html.match(
          /CSRFToken\s*[:=]\s*["']([^"']+)["']/,
        )?.[1];
        if (csrfToken && window.ACC?.config) {
          window.ACC.config.CSRFToken = csrfToken;
        }
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return {
          url: response.url,
          csrfToken,
          threeDSecureEnabled: html.match(
            /miglog\.threeDSecure\.enabled\s*=\s*(true|false)/,
          )?.[1],
          threeDSecureTestMode: html.match(
            /miglog\.threeDSecure\.isTestMode\s*=\s*(true|false)/,
          )?.[1],
          paymeScriptUrls: Array.from(doc.querySelectorAll('script[src]'))
            .map((script) => script.getAttribute('src') ?? '')
            .filter((src) => src.includes('paymeservice.com')),
        };
      },
      `${BASE_URL}${authForm.submitPath}`,
      fields,
    );

    if (!checkoutPage.url.includes('/miglog-checkout')) {
      throw new Error(
        `Checkout authentication ended on unexpected page: ${checkoutPage.url}`,
      );
    }
    if (!checkoutPage.csrfToken) {
      throw new Error('Checkout page did not include a CSRF token');
    }
    this.csrfToken = checkoutPage.csrfToken;

    return {
      threeDSecureEnabled:
        checkoutPage.threeDSecureEnabled === undefined
          ? checkoutPage.paymeScriptUrls.length > 0
          : checkoutPage.threeDSecureEnabled === 'true',
      threeDSecureTestMode: checkoutPage.threeDSecureTestMode === 'true',
      paymeScriptUrls: checkoutPage.paymeScriptUrls,
    };
  }

  private async getPaymeClientHash(
    checkoutConfig: CheckoutConfig,
  ): Promise<string> {
    if (!checkoutConfig.threeDSecureEnabled) {
      return '';
    }
    if (checkoutConfig.paymeScriptUrls.length === 0) {
      throw new Error('3D Secure is enabled but no PayMe script was found');
    }

    const hash = await this.page.evaluate(
      async (scriptUrls, isTestMode) => {
        if (!window.PayMe) {
          for (const src of scriptUrls) {
            await new Promise<void>((resolve, reject) => {
              const script = document.createElement('script');
              script.src = src;
              script.onload = () => {
                resolve();
              };
              script.onerror = () => {
                reject(new Error(`Failed to load PayMe script ${src}`));
              };
              document.head.appendChild(script);
            });
          }
        }
        const data = await window.PayMe?.clientData(isTestMode);
        return data?.hash ?? '';
      },
      checkoutConfig.paymeScriptUrls,
      checkoutConfig.threeDSecureTestMode,
    );
    if (!hash) {
      console.warn('createOrder: PayMe client hash is empty');
    }
    return encodeURIComponent(hash);
  }

  private async removeOutOfStockCheckoutEntries(
    missingEntries: ShufersalCheckoutEntry[],
  ): Promise<ShufersalComposedCheckout> {
    const { items } = await this.getCartState();
    const cartEntryNumbers = new Map(
      items.map((item) => [item.productCode, item.entryNumber]),
    );

    const entriesToRemove: CartEntryToRemove[] = [];
    const notInCart: ShufersalCheckoutEntry[] = [];
    for (const entry of missingEntries) {
      const entryNumber = cartEntryNumbers.get(entry.product.code);
      if (entryNumber === undefined) {
        notInCart.push(entry);
      } else {
        entriesToRemove.push({ productCode: entry.product.code, entryNumber });
      }
    }
    if (notInCart.length > 0) {
      for (const entry of notInCart) {
        console.error(
          `createOrder: Out-of-stock checkout entry ${String(entry.entryNumber)} (${entry.product.code}) is not in the cart: ${JSON.stringify(entry)}`,
        );
      }
      throw new Error(
        `Out-of-stock checkout items are not in the cart: ${notInCart.map((entry) => entry.product.code).join(', ')}`,
      );
    }

    await this.removeItemsFromCart(entriesToRemove);

    const checkout = await this.getComposedCheckout();
    const stillMissing = checkout.directCart.entries.filter(
      isCheckoutEntryOutOfStock,
    );
    if (stillMissing.length > 0) {
      throw new Error(
        `Checkout still has out-of-stock items after removing them: ${stillMissing.map((entry) => entry.product.code).join(', ')}`,
      );
    }
    return checkout;
  }

  private async getComposedCheckout(): Promise<ShufersalComposedCheckout> {
    const checkout = await this.apiRequest<ShufersalComposedCheckout>({
      method: 'GET',
      path: '/checkout/composed',
    });
    if (!checkout?.directCart) {
      throw new Error('Failed to load checkout details');
    }
    return checkout;
  }

  private async getCSRFToken(): Promise<string> {
    if (this.csrfToken) {
      return this.csrfToken;
    }
    const handle = await this.page.waitForFunction(
      () => window.ACC?.config?.CSRFToken,
      { timeout: 10000 },
    );
    const token = await handle.jsonValue();
    await handle.dispose();
    if (!token) {
      throw new Error('CSRFToken not found');
    }
    this.csrfToken = token;
    return token;
  }

  private async apiRequest<T extends object | boolean | undefined>(
    config: ApiRequestConfig,
  ): Promise<T | undefined> {
    return (await this.sendRequest(config, 'json')) as T | undefined;
  }

  private async pageRequest(path: string): Promise<RawPage | undefined> {
    return (await this.sendRequest({ method: 'GET', path }, 'page')) as
      | RawPage
      | undefined;
  }

  private async cartRequest(
    config: ApiRequestConfig,
  ): Promise<CartMutationResult> {
    const cartPage = (await this.sendRequest(config, 'cart')) as
      | RawCartPage
      | undefined;
    if (!cartPage) {
      throw new Error(
        `Expected cart HTML from ${config.method} ${config.path.split('?')[0]}`,
      );
    }
    return rawCartPageToCartMutationResult(cartPage);
  }

  private async sendRequest(
    config: ApiRequestConfig,
    responseFormat: ResponseFormat,
  ): Promise<unknown> {
    if (this.transport === 'http') {
      try {
        return await this.httpRequest(config, responseFormat);
      } catch (error) {
        if (!(error instanceof HttpBlockedError)) {
          throw error;
        }
        console.warn(
          `[shufersal] ${error.message}; switching this session to the browser`,
        );
        await this.switchToBrowser();
      }
    }
    return this.browserRequest(config, responseFormat);
  }

  private async httpCsrfToken(): Promise<string> {
    let token = this.http.cookie(CSRF_COOKIE, WEBAPP_URL);
    if (!token) {
      await this.refreshHttpCsrfToken();
      token = this.http.cookie(CSRF_COOKIE, WEBAPP_URL);
    }
    if (!token) {
      throw new HttpBlockedError(
        `Shufersal did not set the ${CSRF_COOKIE} cookie`,
      );
    }
    return decodeURIComponent(token);
  }

  private async refreshHttpCsrfToken(): Promise<void> {
    await this.http.send(
      { method: 'GET', url: `${WEBAPP_URL}${CSRF_REFRESH_PATH}` },
      'json',
    );
  }

  private async httpRequest(
    config: ApiRequestConfig,
    responseFormat: ResponseFormat,
    isRetry = false,
  ): Promise<unknown> {
    const { method, path, body, form } = config;
    const startTime = performance.now();
    let status: number | undefined;
    try {
      const csrfToken =
        method === 'GET' ? undefined : await this.httpCsrfToken();
      const result = await this.http.send(
        { method, url: `${WEBAPP_URL}${path}`, body, form, csrfToken },
        responseFormat === 'cart' ? 'html' : responseFormat,
      );
      status = result.status;
      if (responseFormat === 'cart') {
        return typeof result.data === 'string'
          ? parseCartHtml(result.data)
          : undefined;
      }
      return result.data;
    } catch (error) {
      if (error instanceof HttpStatusError) {
        status = error.status;
      }
      if (error instanceof LoginRedirectError && !isRetry) {
        await this.performLogin();
        return await this.httpRequest(config, responseFormat, true);
      }
      if (
        error instanceof HttpStatusError &&
        error.status === 405 &&
        method !== 'GET'
      ) {
        if (isRetry) {
          throw new HttpBlockedError(
            `${method} ${path.split('?')[0]} was rejected with 405 after refreshing the CSRF token`,
          );
        }
        await this.refreshHttpCsrfToken();
        return await this.httpRequest(config, responseFormat, true);
      }
      throw error;
    } finally {
      console.debug(
        `[shufersal] http ${method} ${path.split('?')[0]} ${status === undefined ? 'failed' : String(status)} ${String(Math.round(performance.now() - startTime))}ms`,
      );
    }
  }

  private async browserRequest(
    config: ApiRequestConfig,
    responseFormat: ResponseFormat,
  ): Promise<unknown> {
    const { method, path, body, form } = config;

    const makeRequest = async (): Promise<unknown> => {
      const csrfToken =
        method === 'GET' ? undefined : await this.getCSRFToken();
      const startTime = performance.now();
      let status: number | undefined;
      try {
        const result = await this.page.evaluate(
          async (url, method, body, form, csrfToken, responseFormat) => {
            const headers: Record<string, string> = {
              'content-type': form
                ? 'application/x-www-form-urlencoded; charset=UTF-8'
                : 'application/json',
            };

            if (csrfToken) {
              headers['csrftoken'] = csrfToken;
            }

            let requestBody: string | undefined;
            if (form) {
              requestBody = new URLSearchParams(form).toString();
            } else if (body) {
              requestBody = JSON.stringify(body);
            }

            const response = await fetch(url, {
              headers,
              method,
              body: requestBody,
              mode: 'cors',
              credentials: 'include',
              redirect: responseFormat === 'page' ? 'follow' : 'manual',
            });

            if (
              response.type === 'opaqueredirect' ||
              (response.status >= 300 && response.status < 400)
            ) {
              const location = response.headers.get('location');
              if (location?.includes('/login')) {
                throw new Error('REDIRECT_TO_LOGIN');
              }
            }

            if (responseFormat === 'text') {
              return {
                status: response.status,
                data: response.ok ? await response.text() : undefined,
              };
            }

            if (!response.ok) {
              let errorBody = '';
              try {
                const contentType = response.headers.get('content-type');
                if (contentType?.includes('application/json')) {
                  errorBody = JSON.stringify(await response.json());
                } else {
                  const text = await response.text();
                  if (contentType?.includes('text/html') && text.length > 500) {
                    errorBody =
                      text.substring(0, 500) + '... (HTML response truncated)';
                  } else {
                    errorBody = text;
                  }
                }
              } catch {
                errorBody = 'Failed to read error response body';
              }

              throw new Error(
                `Request failed: ${method} ${url} -> ${String(response.status)} ${response.statusText}. Response: ${errorBody}`,
              );
            }

            const contentType = response.headers.get('content-type') ?? '';

            if (responseFormat === 'cart') {
              if (!contentType.includes('text/html')) {
                return { status: response.status, data: undefined };
              }
              const doc = new DOMParser().parseFromString(
                await response.text(),
                'text/html',
              );
              const articles = Array.from(
                doc.querySelectorAll('article[data-product-code]'),
              ).map((el) => {
                const priceText =
                  (
                    el.querySelector('.miglog-prod-totalPrize')?.textContent ??
                    ''
                  ).trim() || '0';
                const discountText =
                  el
                    .querySelector('.miglog-prod-totalDiscount')
                    ?.textContent.trim() ?? '';
                return {
                  productCode: el.getAttribute('data-product-code') ?? '',
                  quantity: parseFloat(
                    el.getAttribute('data-entry-qty') ?? '0',
                  ),
                  entryNumber: parseInt(
                    el.getAttribute('data-entry-number') ?? '0',
                    10,
                  ),
                  itemPrice: parseFloat(priceText.replace(/[^\d.]/g, '')) || 0,
                  itemDiscount:
                    parseFloat(discountText.replace(/[^\d.]/g, '')) || 0,
                  isOutOfStock: el.classList.contains(
                    'miglog-cart-prod-notInStock',
                  ),
                };
              });
              const modificationsScript =
                Array.from(doc.querySelectorAll('script'))
                  .map((script) => script.textContent)
                  .find((text) => text.includes('miglog.cart.modifications')) ??
                null;
              return {
                status: response.status,
                data: {
                  articles,
                  bodyText: doc.body.textContent,
                  modificationsScript,
                },
              };
            }

            if (responseFormat === 'page') {
              return {
                status: response.status,
                data: { url: response.url, html: await response.text() },
              };
            }

            if (contentType.includes('application/json')) {
              return {
                status: response.status,
                data: (await response.json()) as unknown,
              };
            }
            return { status: response.status, data: undefined };
          },
          `${WEBAPP_URL}${path}`,
          method,
          body,
          form,
          csrfToken,
          responseFormat,
        );
        status = result.status;
        return result.data;
      } finally {
        console.debug(
          `[shufersal] browser ${method} ${path.split('?')[0]} ${status === undefined ? 'failed' : String(status)} ${String(Math.round(performance.now() - startTime))}ms`,
        );
      }
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
  private browserConnecting: Promise<Browser> | undefined;

  constructor(private options: ShufersalBotOptions) {}

  async createSession(
    username: string,
    password: string,
    sessionData?: SerializedSessionData,
  ): Promise<ShufersalSession> {
    const session = await this.initSession(username, password);

    try {
      if (sessionData) {
        session.loadCookies(sessionData.cookies as CookieData[]);
        await session.restore();
      } else {
        await session.performLogin();
      }
    } catch (error) {
      if (this.options.takeScreenshotOnErrors && error instanceof Error) {
        const [screenshot, pageContent] = await Promise.allSettled([
          session.takeScreenshot(),
          session.takePageContent(),
        ]);
        throw new ShufersalSessionError(
          error.message,
          error,
          screenshot.status === 'fulfilled' ? screenshot.value : undefined,
          pageContent.status === 'fulfilled' ? pageContent.value : undefined,
        );
      }
      throw error;
    }

    if (this.options.takeScreenshotOnErrors) {
      return createSessionProxy(
        session,
        (error, screenshot, pageContent) =>
          new ShufersalSessionError(
            error.message,
            error,
            screenshot,
            pageContent,
          ),
      );
    }

    return session;
  }

  protected async initSession(
    username: string,
    password: string,
  ): Promise<ShufersalSession> {
    const session = new ShufersalSession(
      () => this.openBrowserPage(),
      { username, password },
      { transport: this.options.transport, fetch: this.options.fetch },
    );
    if (session.activeTransport === 'browser') {
      await session.openBrowserPage();
    }
    return session;
  }

  protected async openBrowserPage(): Promise<BrowserPage> {
    const browser = await this.getBrowser();
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    return { context, page };
  }

  async terminate(): Promise<void> {
    if (this.browser && !this.options.browser) {
      await this.browser.close();
    }
    this.browser = undefined;
  }

  static parseReceipt(receiptText: string): ReceiptDetails {
    return parseReceipt(receiptText);
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser) {
      return this.browser;
    }
    this.browserConnecting ??= this.connectBrowser();
    try {
      this.browser = await this.browserConnecting;
      return this.browser;
    } finally {
      this.browserConnecting = undefined;
    }
  }

  private async connectBrowser(): Promise<Browser> {
    const { browser } = this.options;
    if (typeof browser === 'function') {
      return browser();
    }
    if (browser) {
      console.log('Using externally provided browser instance');
      return browser;
    }
    if (this.options.browserWSEndpoint) {
      console.log(
        'Connecting to remote Chrome at:',
        this.options.browserWSEndpoint,
      );
      return puppeteer.connect({
        browserWSEndpoint: this.options.browserWSEndpoint,
      });
    }
    console.log('Launching local Chrome from:', this.options.executablePath);
    return puppeteer.launch({
      executablePath: this.options.executablePath,
      headless: 'headless' in this.options ? this.options.headless : true,
      args: this.options.chromiumArgs,
    });
  }
}
