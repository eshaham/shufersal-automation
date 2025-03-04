import assert from 'assert';

import {
  AccountOrders,
  CartItem,
  DeliveryTimeSlot,
  Item,
  ItemDetails,
  OrderDetails,
  OrderInfo,
  Product,
  SellingMethod,
  ShufersalAccountOrders,
  ShufersalAvailableTimeSlotsResponse,
  ShufersalCartItem,
  ShufersalCartItemAdd,
  ShufersalOrder,
  ShufersalOrderDetails,
  ShufersalOrderEntry,
  ShufersalProduct,
  ShufersalSellingMethod,
} from '@shufersal-automation';
import puppeteer, { Browser, BrowserContext, Page } from 'puppeteer-core';

interface ShufersalBotOptions {
  executablePath: string;
  headless?: boolean;
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

function shufersalDateTimeToDateString(dateTime: string | null): string | null {
  if (!dateTime) {
    return null;
  }
  return dateTime.split(' ')[0].replace(/\\/g, '-');
}

function shufersalAccountOrderToOrderInfo(order: ShufersalOrder): OrderInfo {
  return {
    code: order.code,
    deliveryDate: shufersalDateTimeToDateString(order.deliveredDateString),
    rawData: order,
  };
}

function shufersalProductToProduct(product: ShufersalProduct): Product {
  return {
    code: product.code,
    name: product.name,
    mainCategory: product.commercialCategoryGroup,
    subCategory: product.commercialCategorySubGroup,
    sellingMethod:
      product.sellingMethod.code === ShufersalSellingMethod.Unit
        ? SellingMethod.Unit
        : SellingMethod.Weight,
    inStock: product.stock.stockLevelStatus.code === 'inStock',
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

function shufersalOrderToOrderDetails(
  order: ShufersalOrderDetails,
): OrderDetails {
  return {
    code: order.code,
    deliveryDate: shufersalDateTimeToDateString(order.deliveredDateString),
    items: order.entries.map(shufersalOrderEntryToItem),
    rawData: order,
  };
}

function shufersalCartItemToItem(cartItem: ShufersalCartItem): Item {
  return {
    productCode: cartItem.productCode,
    quantity: cartItem.cartyQty,
    rawData: cartItem,
  };
}

function shufersalAvailableTimeslotsResponseToDeliveryTimeslots(
  response: ShufersalAvailableTimeSlotsResponse,
): DeliveryTimeSlot[] {
  const timeSlots: DeliveryTimeSlot[] = [];
  for (const date in response) {
    for (const timeSlot of response[date]) {
      const dateTime = new Date(timeSlot.fromHour);
      timeSlots.push({
        code: timeSlot.code,
        dateTime: dateTime.toISOString(),
        rawData: timeSlot,
      });
    }
  }
  return timeSlots;
}

function cartItemToShufersalCartItemAdd(item: CartItem): ShufersalCartItemAdd {
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
  constructor(
    private context: BrowserContext,
    private page: Page,
  ) {}

  async getOrders(): Promise<AccountOrders> {
    const accountOrders = await this.apiRequest<ShufersalAccountOrders>(
      'GET',
      '/my-account/orders',
    );
    return {
      activeOrders: accountOrders.activeOrders.map((order) =>
        shufersalAccountOrderToOrderInfo(order),
      ),
      closedOrders: accountOrders.closedOrders.map((order) =>
        shufersalAccountOrderToOrderInfo(order),
      ),
    };
  }

  async getOrderDetails(code: string): Promise<OrderDetails> {
    const orderDetails = await this.apiRequest<ShufersalOrderDetails>(
      'GET',
      `/my-account/orders/${code}`,
    );
    return shufersalOrderToOrderDetails(orderDetails);
  }

  async addToCart(items: CartItem[]): Promise<void> {
    const shufersalCartEntries = items.map((item) =>
      cartItemToShufersalCartItemAdd(item),
    );
    await this.apiRequest('POST', '/cart/addGrid', shufersalCartEntries);
  }

  async getCartItems(): Promise<Item[]> {
    const cartItems = await this.apiRequest<ShufersalCartItem[]>(
      'GET',
      '/recommendations/entry-recommendations',
    );
    return cartItems.map(shufersalCartItemToItem);
  }

  async getAvailableTimeSlots(): Promise<DeliveryTimeSlot[]> {
    const response = await this.apiRequest<ShufersalAvailableTimeSlotsResponse>(
      'GET',
      '/timeSlot/preselection/getHomeDeliverySlots',
    );
    return shufersalAvailableTimeslotsResponseToDeliveryTimeslots(response);
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

  async close() {
    await this.context.close();
  }
}

export class ShufersalBot {
  private browser: Browser | undefined;

  constructor(private options: ShufersalBotOptions) {}

  async createSession(username: string, password: string) {
    const context = await this.createContext();
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/login`);
    await page.type('#j_username', username);
    await page.type('#j_password', password);
    await page.click('.btn-login');
    await page.waitForNavigation({ waitUntil: 'networkidle0' });

    return new ShufersalSession(context, page);
  }

  async terminate() {
    assert(this.browser);
    await this.browser.close();
    this.browser = undefined;
  }

  private async initIfNeeded() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        executablePath: this.options.executablePath,
        headless: 'headless' in this.options ? this.options.headless : true,
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
