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

function extractDeliveryDateTimeFromShufersalOrder(order: ShufersalOrder) {
  if (order.consignments?.length !== 1) {
    throw new Error(`Unexpected number of consignments in order ${order.code}`);
  }
  const consignment = order.consignments[0];
  const dateTime = new Date(consignment.timeSlotStartTime);
  return dateTime;
}

function shufersalAccountOrderToOrderInfo(order: ShufersalOrder): OrderInfo {
  const dateTime = extractDeliveryDateTimeFromShufersalOrder(order);
  return {
    code: order.code,
    deliveryDateTime: dateTime.toISOString(),
    isActive: order.isActive,
    isCancelable: order.isCancelable,
    isUpdatable: order.isUpdatable,
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
  shufersalOrder: ShufersalOrderDetails,
): OrderDetails {
  const order = shufersalAccountOrderToOrderInfo(shufersalOrder);
  return {
    ...order,
    items: shufersalOrder.entries.map(shufersalOrderEntryToItem),
    rawData: shufersalOrder,
  };
}

function shufersalCartItemToItem(
  cartItem: ShufersalCartItem,
): ExistingCartItem {
  return {
    productCode: cartItem.productCode,
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
  constructor(
    private context: BrowserContext,
    private page: Page,
    private credentials: ShufersalCredentials,
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

  async addToCart(items: CartItemToAdd[]): Promise<void> {
    const shufersalCartEntries = items.map((item) =>
      cartItemToShufersalCartItemAdd(item),
    );
    await this.apiRequest('POST', '/cart/addGrid', shufersalCartEntries);
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

    await this.apiRequest('POST', `/cart/update?${query.toString()}`, {
      quantity: 0,
    });
  }

  async getCartItems(): Promise<ExistingCartItem[]> {
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

  async getSelectedTimeSlot(): Promise<DeliveryTimeSlot | null> {
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

    await this.page.waitForSelector('#j_password', { visible: true });
    await this.page.type('#j_password', this.credentials.password, {
      delay: 100,
    });
    await this.page.click('#checkoutPwd button[type="submit"]');

    await this.page.waitForNavigation({ waitUntil: 'networkidle0' });
    await this.page.click('.btnConfirm');

    await this.page.waitForNavigation({ waitUntil: 'networkidle0' });
  }

  async modifyOrder(code: string): Promise<void> {
    await this.apiRequest('GET', `cart/cartFromOrder/${code}`);
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

    return new ShufersalSession(context, page, { username, password });
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
